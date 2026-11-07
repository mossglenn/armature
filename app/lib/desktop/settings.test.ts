/**
 * The desktop program's settings file (./settings.ts;
 * docs/desktop-program-plan.md §9 and §12): defaults, checks, a value
 * cleared, the file read and written in a temporary data folder, the remote's
 * change rule. No store.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SNAPSHOT_BUDGET } from '../api/config';
import { ApiError } from '../api/errors';
import { changeRefusal, DEFAULT_PORT, defaultSettings, needsRestart, parseSettings, readSettings, workspacesFolder, writeSettings } from './settings';

const absolute = process.platform === 'win32' ? 'C:\\Users\\amos\\Armature' : '/Users/amos/Armature';
const INSTANCE = { name: 'Armature at Example University', api: 'https://api.armature.example.edu', program: { releases: 'https://github.com/mossglenn/armature/releases' } };

const refusalOf = (work: () => unknown): ApiError => {
  try {
    work();
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
};

describe('parseSettings', () => {
  it('fills the defaults: port 3101, the hub’s snapshot budget, not at login', () => {
    expect(parseSettings({})).toEqual({ port: DEFAULT_PORT, snapshots: DEFAULT_SNAPSHOT_BUDGET, startAtLogin: false });
    expect(DEFAULT_PORT).toBe(3101);
  });

  it('keeps what is given, the remote without its trailing slash', () => {
    const settings = parseSettings({ remote: 'https://api.armature.example.edu/', instance: INSTANCE, folder: absolute, port: 3200, snapshots: 5, user: ' amos@example.edu ', startAtLogin: true });
    expect(settings).toEqual({ remote: 'https://api.armature.example.edu', instance: INSTANCE, folder: absolute, port: 3200, snapshots: 5, user: 'amos@example.edu', startAtLogin: true });
  });

  it('refuses each malformed setting, naming the field', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ remote: 'ftp://example.edu' }, 'remote'],
      [{ remote: 'not a url' }, 'remote'],
      [{ remote: 'https://api.example.edu/?x=1' }, 'remote'],
      [{ folder: 'relative/path' }, 'folder'],
      [{ port: 0 }, 'port'],
      [{ port: 70000 }, 'port'],
      [{ port: '3101' }, 'port'],
      [{ snapshots: -1 }, 'snapshots'],
      [{ snapshots: 1.5 }, 'snapshots'],
      [{ user: '  ' }, 'user'],
      [{ startAtLogin: 'yes' }, 'startAtLogin'],
      [{ instance: { api: 'https://x' } }, 'instance.name'],
      [{ instance: { name: 'X' } }, 'instance.program.releases'],
      [{ token: 'secret' }, 'token'],
    ];
    for (const [given, field] of cases) {
      const err = refusalOf(() => parseSettings(given));
      expect([err.status, err.code, err.details?.field], JSON.stringify(given)).toEqual([400, 'bad_settings', field]);
    }
    expect(refusalOf(() => parseSettings([])).code).toBe('bad_settings');
  });

  it('keeps how the remote knows who calls, header or oidc with its issuer and client id', () => {
    expect(parseSettings({ identity: { resolver: 'header' } }).identity).toEqual({ resolver: 'header' });
    expect(parseSettings({ identity: { resolver: 'oidc', issuer: 'https://login.example.edu/realms/a/', clientId: 'armature-desktop' } }).identity).toEqual({
      resolver: 'oidc',
      issuer: 'https://login.example.edu/realms/a',
      clientId: 'armature-desktop',
    });
    expect(refusalOf(() => parseSettings({ identity: { resolver: 'saml' } })).details?.field).toBe('identity.resolver');
    expect(refusalOf(() => parseSettings({ identity: { resolver: 'oidc', issuer: 'https://x.example.edu' } })).details?.field).toBe('identity.clientId');
    expect(refusalOf(() => parseSettings({ identity: 'oidc' })).details?.field).toBe('identity');
  });

  it('applies a change over the current settings; null clears an optional one and restores a default', () => {
    const current = parseSettings({ remote: 'https://a.example.edu', user: 'amos', port: 3200 });
    expect(parseSettings({ user: null, port: null, snapshots: 3 }, current)).toEqual({ remote: 'https://a.example.edu', port: DEFAULT_PORT, snapshots: 3, startAtLogin: false });
  });
});

describe('the settings file', () => {
  let dataDir: string;
  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'armature-settings-'));
  });
  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
  });

  it('reads the defaults when there is no file yet', async () => {
    expect(await readSettings(dataDir)).toEqual(defaultSettings());
  });

  it('writes and reads back, with no credential among the keys', async () => {
    const settings = parseSettings({ remote: 'https://api.armature.example.edu', instance: INSTANCE, port: 3102 });
    await writeSettings(dataDir, settings);
    expect(await readSettings(dataDir)).toEqual(settings);
    expect(Object.keys(JSON.parse(await readFile(join(dataDir, 'settings.json'), 'utf8'))).sort()).toEqual(['instance', 'port', 'remote', 'snapshots', 'startAtLogin']);
  });

  it('refuses a file that is not JSON or not valid, naming the file', async () => {
    await writeFile(join(dataDir, 'settings.json'), '{ not json');
    await expect(readSettings(dataDir)).rejects.toMatchObject({ code: 'bad_settings', details: { path: join(dataDir, 'settings.json') } });
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ port: 'x' }));
    await expect(readSettings(dataDir)).rejects.toMatchObject({ code: 'bad_settings', details: { field: 'port' } });
  });

  it('keeps the workspaces in the data folder unless a folder is chosen', () => {
    expect(workspacesFolder(dataDir, defaultSettings())).toBe(join(dataDir, 'workspaces'));
    expect(workspacesFolder(dataDir, parseSettings({ folder: absolute }))).toBe(absolute);
  });
});

describe('changes', () => {
  const current = parseSettings({ remote: 'https://a.example.edu', port: 3101 });

  it('refuses another remote while a workspace names this one', () => {
    const next = parseSettings({ remote: 'https://b.example.edu' }, current);
    expect(changeRefusal(current, next, [])).toBeUndefined();
    const refused = changeRefusal(current, next, ['amos_unit-3']);
    expect(refused).toMatchObject({ status: 409, code: 'workspaces_exist', details: { field: 'remote', workspaces: ['amos_unit-3'] } });
    expect(changeRefusal(current, parseSettings({ port: 3102 }, current), ['amos_unit-3'])).toBeUndefined();
    // The first remote is set freely.
    expect(changeRefusal(defaultSettings(), current, ['left-from-before'])).toBeUndefined();
  });

  it('says which changes wait for the hub to start again', () => {
    expect(needsRestart(current, parseSettings({ port: 3102 }, current))).toBe(true);
    expect(needsRestart(current, parseSettings({ startAtLogin: true }, current))).toBe(false);
    expect(needsRestart(current, parseSettings({ instance: INSTANCE }, current))).toBe(false);
  });
});
