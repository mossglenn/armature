/**
 * The connection profile (docs/desktop-program-plan.md §8): `instance` in
 * `GET /discover`, which a person confirms before connecting and a program
 * reads before any sign-in. No request here reaches a store: a remote hub's
 * entry comes from its settings and the request, a workspace hub's from its
 * records, held in memory. The clone's copy of the remote's entry is in
 * workspace.test.ts, against a real remote.
 */
import { describe, expect, it } from 'vitest';
import { createApp } from './app';
import { configFromEnv, type HubConfig } from './config';
import { PROGRAM_RELEASES } from './version';
import { memoryRecords, type WorkspaceRecord } from './workspace/records';

const PROGRAM = { releases: PROGRAM_RELEASES };
const OIDC = { ARMATURE_IDENTITY: 'oidc', ARMATURE_OIDC_ISSUER: 'https://login.example.edu/realms/armature', ARMATURE_OIDC_AUDIENCE: 'armature-hub' };

/** The body of GET /discover from a hub of this configuration, called at `url`. */
const discover = async (config: HubConfig, url = 'http://localhost:3100/api/v1/discover') => (await createApp(() => config).request(url)).json();
const fromEnv = (env: Record<string, string>) => discover(configFromEnv(env));

describe('a remote hub says who it is', () => {
  it('names itself by the host it was called at when nothing is set, with no public address', async () => {
    expect((await fromEnv({})).instance).toEqual({ name: 'localhost', program: PROGRAM });
    const listed = configFromEnv({ ARMATURE_ALLOWED_HOSTS: 'hub.example.org' });
    expect((await discover(listed, 'http://hub.example.org:3100/api/v1/discover')).instance.name).toBe('hub.example.org');
  });

  it('takes ARMATURE_INSTANCE_NAME under either resolver', async () => {
    const name = 'Armature at Example University';
    expect((await fromEnv({ ARMATURE_INSTANCE_NAME: `  ${name} ` })).instance.name).toBe(name);
    expect((await fromEnv({ ...OIDC, ARMATURE_INSTANCE_NAME: name })).instance.name).toBe(name);
  });

  it('publishes ARMATURE_PUBLIC_URL under oidc, its host the name when none is set', async () => {
    const { instance } = await fromEnv({ ...OIDC, ARMATURE_PUBLIC_URL: 'https://api.armature.example.edu/' });
    expect(instance).toEqual({ name: 'api.armature.example.edu', api: 'https://api.armature.example.edu', program: PROGRAM });
  });

  it('prefers the public name to the one the viewer calls it by inside the network', async () => {
    const config = configFromEnv({ ...OIDC, ARMATURE_PUBLIC_URL: 'https://api.armature.example.edu', ARMATURE_ALLOWED_HOSTS: 'hub' });
    expect((await discover(config, 'http://hub:3100/api/v1/discover')).instance.name).toBe('api.armature.example.edu');
  });

  it('publishes no address under header, which the compose file derives without knowing the resolver: nothing proxies such a hub', async () => {
    expect((await fromEnv({ ARMATURE_PUBLIC_URL: 'https://api.armature.example.edu' })).instance).toEqual({ name: 'localhost', program: PROGRAM });
  });

  it('stops at start on an address that is not one, naming the variable', () => {
    expect(() => configFromEnv({ ...OIDC, ARMATURE_PUBLIC_URL: 'api.armature.example.edu' })).toThrow(/ARMATURE_PUBLIC_URL/);
    expect(() => configFromEnv({ ...OIDC, ARMATURE_PUBLIC_URL: 'ftp://api.armature.example.edu' })).toThrow(/ARMATURE_PUBLIC_URL/);
  });

  it('says nothing of the admission list or any other setting: the entry is read before sign-in', async () => {
    const body = await fromEnv({ ...OIDC, ARMATURE_OIDC_ADMIT: 'example.edu', ARMATURE_EXPORT_KEY: 'a-secret', ARMATURE_PUBLIC_URL: 'https://api.armature.example.edu' });
    expect(Object.keys(body.instance).sort()).toEqual(['api', 'name', 'program']);
    expect(JSON.stringify(body)).not.toContain('a-secret');
  });
});

describe('a workspace hub describes its remote, as cloned', () => {
  const REMOTE = 'https://api.armature.example.edu';
  const profile = (name: string) => ({ name, api: REMOTE, program: PROGRAM });
  const record = (branch: string, clonedAt: string, extra: Partial<WorkspaceRecord> = {}): WorkspaceRecord => ({
    branch,
    remote: REMOTE,
    owner: 'User/demo-designer',
    ownerExternalId: 'demo-designer@example.edu',
    base: 'base',
    local: 'local',
    clonedAt,
    ...extra,
  });
  const hubHolding = async (...records: WorkspaceRecord[]) => {
    const workspaces = memoryRecords();
    for (const r of records) await workspaces.put(r);
    return { ...configFromEnv(), role: 'workspace', remote: REMOTE, workspaces } satisfies HubConfig;
  };

  it('has no entry before its first clone, whatever its own settings say', async () => {
    expect((await discover(await hubHolding())).instance).toBeUndefined();
    const env = { ARMATURE_ROLE: 'workspace', ARMATURE_REMOTE_URL: REMOTE, ARMATURE_WORKSPACE_DIR: '/tmp/unused', ARMATURE_INSTANCE_NAME: 'Not the remote' };
    expect(configFromEnv(env).instanceName).toBeUndefined();
  });

  it('repeats the newest clone from its remote, skipping one that kept no profile and one from another remote', async () => {
    const hub = await hubHolding(
      record('older', '2026-11-01T10:00:00.000Z', { instance: profile('As it was named') }),
      record('newer', '2026-11-05T10:00:00.000Z', { instance: profile('As it is named') }),
      record('before-the-profile', '2026-11-06T10:00:00.000Z'),
      record('elsewhere', '2026-11-06T11:00:00.000Z', { remote: 'https://other.example.org', instance: profile('Another instance') })
    );
    expect((await discover(hub)).instance).toEqual(profile('As it is named'));
  });
});
