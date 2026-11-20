import { readFile, rename } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { DEFAULT_SNAPSHOT_BUDGET } from '../api/config';
import { ApiError } from '../api/errors';
import type { InstanceProfile } from '../api/workspace/records';
import { writeWhole } from '../workspaceFolder';

/**
 * The desktop program's settings (docs/desktop-program-plan.md §9): one JSON
 * file in the program's data folder, `settings.json`, which the core reads at
 * `start` and writes when the shell changes a setting. The core owns the file
 * rather than the shell (decided 2026-11-07, Amos): the shell then only
 * relays (ADR-0069 decision 1), the core run in a terminal without a shell
 * reads the same file, and the rules live where the tests run. The shell
 * names the data folder, Tauri's `app_local_data_dir`
 * (`~/Library/Application Support/com.mossglenn.armature` on macOS,
 * `%LOCALAPPDATA%\com.mossglenn.armature` on Windows,
 * `~/.local/share/com.mossglenn.armature` on Linux).
 *
 * No credential is ever in it: the refresh token and the pairing key live in
 * the shell's keychain and reach the core over the channel (plan §6, §7).
 *
 * An unknown key is refused rather than ignored, so a setting misspelled by
 * hand, or left by an older program, is noticed (as `ARMATURE_STORE` is
 * refused by `config.ts`).
 */

/** The port a workspace hub listens on by default, the compose profile's, so a tool finds it where the documentation says (plan §9). */
export const DEFAULT_PORT = 3101;

export const SETTINGS_FILE = 'settings.json';

export interface DesktopSettings {
  /** The remote hub's address, set on the connect screen; one per program (plan §9, §16 question 5). */
  remote?: string;
  /** What the remote's `GET /discover` said of the instance when the person confirmed it (plan §8). */
  instance?: InstanceProfile;
  /**
   * How the remote knows who calls, from its `GET /discover` when the person confirmed it (ADR-0067
   * decision 9): `header`, or `oidc` with the issuer and the client id the program signs in with.
   * Kept so the program starts and works offline without asking the remote again.
   */
  identity?: RemoteIdentity;
  /** Where the workspaces live; `<data folder>/workspaces` when unset (plan §9). */
  folder?: string;
  /** The hub's port on 127.0.0.1. */
  port: number;
  /** How many older remote commits a workspace holds as snapshots (`ARMATURE_SNAPSHOTS`). */
  snapshots: number;
  /** The person's identifier on a remote under `header`, a development arrangement (plan §6); unused under `oidc`. */
  user?: string;
  /** Whether the shell starts the program at login; off until use shows otherwise (plan §9). */
  startAtLogin: boolean;
  /**
   * This installation's identifier (ADR-0072 decision 2): 128 random bits the core draws at its first start
   * and keeps here, which the instance links this computer's workspaces to. Not a secret, and never set by
   * a person: a new one would strand every workspace linked to the old, each of which would then have to
   * be unlinked from the other computer and linked again.
   */
  installation?: string;
  /**
   * A name the owner gives this computer, sent as the label of its links and shown where a workspace is
   * linked elsewhere. Unset, nothing is sent: the instance's `main` is read by everyone it serves, and a
   * computer's name says more about a person than the app needs (ADR-0072 decision 2).
   */
  computerName?: string;
}

export type RemoteIdentity = { resolver: 'header' } | { resolver: 'oidc'; issuer: string; clientId: string };

export const defaultSettings = (): DesktopSettings => ({ port: DEFAULT_PORT, snapshots: DEFAULT_SNAPSHOT_BUDGET, startAtLogin: false });

const KEYS: ReadonlySet<string> = new Set(['remote', 'instance', 'identity', 'folder', 'port', 'snapshots', 'user', 'startAtLogin', 'installation', 'computerName']);

/** An installation's identifier as the hub's link takes one (`../api/workspaces.ts`). */
const INSTALLATION = /^[A-Za-z0-9_-]{16,128}$/;

const bad = (field: string, message: string) => new ApiError(400, 'bad_settings', message, { field });

/** An http or https address without a trailing slash. */
function address(field: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw bad(field, `${field} must be an http or https address`);
  const trimmed = value.trim().replace(/\/+$/, '');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw bad(field, `${field}=${trimmed} is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw bad(field, `${field}=${trimmed} is not an http or https address`);
  if (url.search || url.hash) throw bad(field, `${field}=${trimmed} carries a query or a fragment; give the hub's address alone`);
  return trimmed;
}

function wholeNumber(field: string, value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw bad(field, `${field} must be a whole number from ${min} to ${max}`);
  }
  return value;
}

function text(field: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw bad(field, `${field} must be a non-empty string`);
  return value.trim();
}

function instance(value: unknown): InstanceProfile {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('instance', 'instance must be the object GET /discover gave');
  const { name, api, program } = value as Record<string, unknown>;
  const releases = typeof program === 'object' && program !== null ? (program as Record<string, unknown>).releases : undefined;
  return {
    name: text('instance.name', name),
    ...(api !== undefined ? { api: address('instance.api', api) } : {}),
    program: { releases: address('instance.program.releases', releases) },
  };
}

function remoteIdentity(value: unknown): RemoteIdentity {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('identity', 'identity must be the object GET /discover gave');
  const { resolver, issuer, clientId } = value as Record<string, unknown>;
  if (resolver === 'header') return { resolver };
  if (resolver === 'oidc') return { resolver, issuer: address('identity.issuer', issuer), clientId: text('identity.clientId', clientId) };
  // The field's own name in settings.json: vocabulary-allow: resolver
  throw bad('identity.resolver', `identity.resolver must be header or oidc, not ${JSON.stringify(resolver)}`);
}

/**
 * Settings as given, checked and with the defaults filled; throws 400
 * `bad_settings` naming the field. A `null` value clears an optional setting
 * and restores a default one.
 */
export function parseSettings(value: unknown, base: DesktopSettings = defaultSettings()): DesktopSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw bad('settings', 'Settings are a JSON object');
  const given = value as Record<string, unknown>;
  for (const key of Object.keys(given)) {
    if (!KEYS.has(key)) throw bad(key, `${key} is not a setting (known: ${[...KEYS].join(', ')})`);
  }
  const defaults = defaultSettings();
  const next: DesktopSettings = { ...base };
  const set = <K extends keyof DesktopSettings>(key: K, read: (raw: unknown) => DesktopSettings[K]) => {
    if (!(key in given)) return;
    const raw = given[key];
    if (raw === null) {
      if (key in defaults) next[key] = defaults[key];
      else delete next[key];
      return;
    }
    next[key] = read(raw);
  };
  set('remote', (raw) => address('remote', raw));
  set('instance', instance);
  set('identity', remoteIdentity);
  set('folder', (raw) => {
    const folder = text('folder', raw);
    if (!isAbsolute(folder)) throw bad('folder', `folder must be an absolute path, not ${folder}`);
    return folder;
  });
  set('port', (raw) => wholeNumber('port', raw, 1, 65535));
  set('snapshots', (raw) => wholeNumber('snapshots', raw, 0, 10_000));
  set('user', (raw) => text('user', raw));
  set('startAtLogin', (raw) => {
    if (typeof raw !== 'boolean') throw bad('startAtLogin', 'startAtLogin must be true or false');
    return raw;
  });
  set('installation', (raw) => {
    const id = text('installation', raw);
    if (!INSTALLATION.test(id)) throw bad('installation', 'installation must be 16 to 128 letters, digits, hyphens or underscores');
    return id;
  });
  set('computerName', (raw) => {
    const name = text('computerName', raw);
    if (name.length > 100 || /[\r\n]/.test(name)) throw bad('computerName', 'computerName must be one line of at most 100 characters');
    return name;
  });
  return next;
}

/** The folder the workspaces live in: the setting, or `workspaces` in the data folder. */
export const workspacesFolder = (dataDir: string, settings: DesktopSettings): string => settings.folder ?? join(dataDir, 'workspaces');

/** The settings in `dataDir`, the defaults when there is no file yet; a file that is not valid is refused naming it. */
export async function readSettings(dataDir: string): Promise<DesktopSettings> {
  const path = join(dataDir, SETTINGS_FILE);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return defaultSettings();
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'bad_settings', `${path} is not JSON; correct it or remove it to start from the defaults`, { field: 'settings', path });
  }
  try {
    return parseSettings(value);
  } catch (err) {
    if (err instanceof ApiError) throw new ApiError(err.status, err.code, `${path}: ${err.message}`, { ...err.details, path });
    throw err;
  }
}

/**
 * The settings in `dataDir` for a start, which a faulty file must not prevent (the 2026-11-09
 * review's C12): until 2026-11-16 a file that was not JSON, or that held a key this version does
 * not know (written by a later version, then a downgrade), failed the start with a 400 and the
 * person had to delete it by hand. Each setting is read on its own: one that is unknown or
 * faulty is left out, the default taking its place, and named in `problems`; the rest stand. A
 * file that is not JSON is moved aside, kept under the name returned, and the defaults are used.
 * The file is rewritten only by the next save, which keeps what was read.
 */
export async function readSettingsForStart(dataDir: string, now: () => Date = () => new Date()): Promise<{ settings: DesktopSettings; problems: string[] }> {
  const path = join(dataDir, SETTINGS_FILE);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { settings: defaultSettings(), problems: [] };
    throw err;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    value = undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    const aside = `${path}.unreadable-${now().toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '')}`;
    try {
      await rename(path, aside);
      return { settings: defaultSettings(), problems: [`${path} is not a JSON object; it was moved to ${aside} and the app starts from the defaults`] };
    } catch {
      // The settings are a file, so they are saved: vocabulary-allow: save
      return { settings: defaultSettings(), problems: [`${path} is not a JSON object and could not be moved aside; the app starts from the defaults, and the next save replaces it`] };
    }
  }
  let settings = defaultSettings();
  const problems: string[] = [];
  for (const [key, given] of Object.entries(value as Record<string, unknown>)) {
    try {
      settings = parseSettings({ [key]: given }, settings);
    } catch (err) {
      if (!(err instanceof ApiError)) throw err;
      // vocabulary-allow: save
      problems.push(`${path}: ${err.message}; the setting is left out until it is saved again`);
    }
  }
  return { settings, problems };
}

/** One write of the settings at a time: two together shared one temporary name, and the second rename failed (C12). */
let writing: Promise<void> = Promise.resolve();

/** Writes the settings to `dataDir` whole: a temporary name, flushed, renamed into place; after any write already under way. */
export function writeSettings(dataDir: string, settings: DesktopSettings): Promise<void> {
  const write = writing.then(() => writeWhole(join(dataDir, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`));
  writing = write.catch(() => undefined);
  return write;
}

/**
 * Why a change of settings is refused, or undefined when it may be made. The
 * remote is changeable only while no workspace exists, since a workspace's
 * record names its remote and a push elsewhere would be meaningless (plan §9).
 */
export function changeRefusal(current: DesktopSettings, next: DesktopSettings, workspaces: readonly string[]): ApiError | undefined {
  if (current.remote !== undefined && next.remote !== current.remote && workspaces.length > 0) {
    return new ApiError(
      409,
      'workspaces_exist',
      `The app is connected to ${current.remote}, which ${workspaces.length === 1 ? 'a workspace names' : `${workspaces.length} workspaces name`}; merge or remove ${workspaces.length === 1 ? 'it' : 'them'} before connecting elsewhere`,
      { field: 'remote', workspaces: [...workspaces] }
    );
  }
  return undefined;
}

/** Whether a change takes effect only when the hub starts again: what the hub was started with. */
export const needsRestart = (current: DesktopSettings, next: DesktopSettings): boolean =>
  (['remote', 'folder', 'port', 'snapshots', 'user'] as const).some((key) => current[key] !== next[key]);
