import { readFile } from 'node:fs/promises';
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
 * No credential is ever in it: the refresh token and the local token live in
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
}

export const defaultSettings = (): DesktopSettings => ({ port: DEFAULT_PORT, snapshots: DEFAULT_SNAPSHOT_BUDGET, startAtLogin: false });

const KEYS: ReadonlySet<string> = new Set(['remote', 'instance', 'folder', 'port', 'snapshots', 'user', 'startAtLogin']);

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

/** Writes the settings to `dataDir` whole: a temporary name, flushed, renamed into place. */
export async function writeSettings(dataDir: string, settings: DesktopSettings): Promise<void> {
  await writeWhole(join(dataDir, SETTINGS_FILE), `${JSON.stringify(settings, null, 2)}\n`);
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
      `The remote is ${current.remote}, which ${workspaces.length === 1 ? 'a workspace names' : `${workspaces.length} workspaces name`}; deliver or delete ${workspaces.length === 1 ? 'it' : 'them'} before connecting elsewhere`,
      { field: 'remote', workspaces: [...workspaces] }
    );
  }
  return undefined;
}

/** Whether a change takes effect only when the hub starts again: what the hub was started with. */
export const needsRestart = (current: DesktopSettings, next: DesktopSettings): boolean =>
  (['remote', 'folder', 'port', 'snapshots', 'user'] as const).some((key) => current[key] !== next[key]);
