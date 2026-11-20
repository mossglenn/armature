/**
 * Workspace mode (docs/workspace-hub-plan.md §13, "The cycle", as far as step 2
 * goes: create and clone). A remote hub runs on an ephemeral port over the
 * seeded store, as `app/server.ts` runs one; a workspace hub runs in-process
 * beside it over a scratch database of its own, which its first clone creates
 * (platform check AN) and the suite deletes. Nothing is pushed yet: the remote
 * gains only the workspace branches, which are deleted too.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createClient } from '@armature/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHub, type RunningHub } from '../hub';
import { app, createApp } from './app';
import { RunStore } from './checks';
import { configFromEnv, type HubConfig } from './config';
import { ApiError } from './errors';
import { normalizeSchema } from './export/exporter';
import { canonical } from './fragments';
import { handleOf, profileOf } from './routes/workspace';
import { createOperatorStore } from './store';
import { cloneBranch } from './workspace/clone';
import { pushWorkspace } from './workspace/push';
import { memoryRecords, type WorkspaceRecord } from './workspace/records';
import { remoteCommitOf } from './workspace/remote';
import { asOfCommitsOf, fetchRemoteLog } from './workspace/snapshots';
import { trailerValue } from './trailers';

import { deleteScratchBranch } from '../operator/repair';
import { localStoreConfig } from './filestore/testing';

// The suite runs over the one local store, a file store in memory (ADR-0066 decision 4); the two-store contract test holds it to the remote's store.
describe('over the file-backed store in memory', () => {

  const AS_OPERATOR = { as: 'demo-designer@example.edu' };
  const stamp = Date.now().toString(36);
  const USER = 'demo-designer@example.edu';
  /** The hub's pairing key, which every write carries (ADR-0065 decision 7; ../localToken.ts). */
  const TOKEN = `ws-token-${stamp}`;
  const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': USER, 'Armature-Local-Token': TOKEN };
  /** This hub's installation, as its host would have drawn it (ADR-0072 decision 2). */
  const INSTALLATION = `e3e3e3e3e3e3e3e3${stamp.padStart(16, '0')}`;
  /** A request to the remote as this installation would send it: what stands for another process holding a copied identifier. */
  const LINKED = { ...HEADERS, 'Armature-Workspace-Link': INSTALLATION };
  const onLinked = (hub: { request: typeof app.request }, method: string, path: string, body?: unknown) =>
    hub.request(`/api/v1${path}`, { method, headers: LINKED, body: body === undefined ? undefined : JSON.stringify(body) });

  const NAME = `test-ws-${stamp}`;
  const BRANCH = `${handleOf(USER)}_${NAME}`;
  const EXISTING = `test-ws-existing-${stamp}`;
  const UNFINISHED = `test-ws-unfinished-${stamp}`;
  const WORKED = `test-ws-worked-${stamp}`;
  const FORBIDDEN = `test-ws-forbidden-${stamp}`;
  /** The reviewer's own workspace, made in the group that tests whose a workspace is. */
  let THEIRS = '';
  const ELSEWHERE = `test-ws-elsewhere-${stamp}`;
  const REMOTE_BRANCHES = [BRANCH, EXISTING, UNFINISHED, WORKED, FORBIDDEN, ELSEWHERE];
  const REVIEWER = 'demo-reviewer@example.edu';
  const AGENT = `agent:test/ws-${stamp}`;
  let agentId: string;

  let remote: RunningHub;
  let config: HubConfig;
  let workspace: ReturnType<typeof createApp>;
  const localConfig = localStoreConfig();
  const localStore = (branch: string) => createOperatorStore({ branch }, localConfig);

  const on = (hub: { request: typeof app.request }, method: string, path: string, body?: unknown) =>
    hub.request(`/api/v1${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
  const create = (body: unknown) => on(workspace, 'POST', '/workspace', body);
  const json = async (res: Response) => ({ status: res.status, body: await res.json() });

  /** A workspace of the designer's on the remote, linked to no computer, for the cases that link one: made as another computer would, then unlinked. */
  const remoteBranch = async (name: string) => {
    expect((await on(app, 'POST', '/branches', { name, workspace: { link: 'ffffffffffffffffffffffffffffffff' } })).status).toBe(201);
    expect((await on(app, 'POST', `/workspaces/${name}/unlink`)).status).toBe(200);
  };

  beforeAll(async () => {
    remote = await startHub({ port: 0 });
    // An agent registered before the first workspace, so the mirror of main carries it.
    const registered = await json(await on(app, 'POST', '/users', { message: 'A drafting agent for the workspace tests', user: { displayName: 'Workspace agent', externalId: AGENT } }));
    expect(registered.status).toBe(201);
    agentId = registered.body.id;
    config = {
      ...configFromEnv(),
      role: 'workspace',
      remote: remote.url,
      workspaces: memoryRecords(),
      store: () => localConfig,
      localToken: TOKEN,
      actionRoutes: true,
      installation: { id: INSTALLATION },
    };
    workspace = createApp(() => config);
  });

  afterAll(async () => {
    for (const name of REMOTE_BRANCHES) await deleteScratchBranch(name, AS_OPERATOR).catch(() => undefined);
    if (agentId) await createOperatorStore({ branch: 'main' }).deleteDocument(agentId, { author: 'User/demo-designer', message: `Test cleanup: remove ${agentId}` }).catch(() => undefined);
    await localStore('main').deleteDatabase().catch(() => undefined);
    await remote?.close();
  });

  describe('creating a workspace (plan §4: create and clone)', () => {
    let record: WorkspaceRecord;

    it('creates <handle>_<name> on the remote from main, clones it, and answers the record', async () => {
      const res = await json(await create({ name: NAME }));
      expect(res.status).toBe(201);
      record = res.body;
      expect(record).toMatchObject({ branch: BRANCH, remote: remote.url, owner: 'User/demo-designer', ownerExternalId: USER, from: 'main' });
      expect((record as { warning?: unknown }).warning).toBeUndefined(); // the owner made it, so the owner may write it
      const head = await json(await on(app, 'GET', `/branches/${BRANCH}`));
      expect(head.body.head.commit).toBe(record.base);
    });

    it("keeps the remote's connection profile at the clone, and answers it in its own GET /discover (desktop plan §8)", async () => {
      const profile = (await (await fetch(`${remote.url}/api/v1/discover`)).json()).instance;
      expect(profile.program.releases).toContain('/releases');
      expect(record.instance).toEqual(profile);
      expect((await json(await on(workspace, 'GET', '/discover'))).body.instance).toEqual(profile);
    });

    it("refuses a base that is not a commit identifier before writing anything: a proxy's altered ETag (the Droplet run of 2026-11-05)", async () => {
      // What Caddy's `encode` did to the export's ETag through the published hub, as a client of the remote would hand it over.
      const altered = `${stamp}-gzip-branch`;
      const proxied = { export: { read: async () => ({ commit: 'abc123-gzip', data: { schema: [], documents: [] } }) } } as unknown as Parameters<typeof cloneBranch>[1];
      const err = await cloneBranch(config, proxied, { id: 'User/demo-designer', externalId: USER }, altered).then(() => undefined, (e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 502, code: 'remote_error', details: { remote: true, reason: 'etag_altered', commit: 'abc123-gzip' } });
      expect((err as ApiError).message).toMatch(/proxy/);
      expect(await localStore('main').listBranches()).not.toContain(altered);
    });

    it('the clone is the remote branch at its base: the same documents and the same schema', async () => {
      const theirs = (await json(await on(app, 'GET', `/export?ref=${record.base}`))).body;
      const ours = (await json(await on(workspace, 'GET', `/export?branch=${BRANCH}`))).body;
      // Compared as export.test.ts compares a reload: keys in order, the store's nested ids aside.
      const byId = (docs: Array<{ '@id': string }>) => new Map(docs.map((d) => [d['@id'], canonical(d)]));
      expect(byId(ours.documents)).toEqual(byId(theirs.documents));
      expect(ours.schema.map((e: { '@id'?: string }) => e['@id']).sort()).toEqual(theirs.schema.map((e: { '@id'?: string }) => e['@id']).sort());
    });

    it('main is mirrored: the owner and the agents, so identity resolves here offline; not every person (since 2026-11-05)', async () => {
      const theirs = (await json(await on(app, 'GET', '/users'))).body as Array<{ '@id': string; externalId: string }>;
      const ours = (await json(await on(workspace, 'GET', '/users'))).body as Array<{ '@id': string; externalId: string }>;
      const ids = ours.map((u) => u['@id']).sort();
      expect(ids).toEqual(['User/demo-designer', ...theirs.filter((u) => u.externalId.startsWith('agent:')).map((u) => u['@id'])].sort());
      expect(ids).not.toContain('User/demo-reviewer');
      const me = await json(await on(workspace, 'GET', '/users/me'));
      expect(me.body['@id']).toBe('User/demo-designer');
    });

    it('a write on the workspace is a local commit; the remote is untouched and status counts it', async () => {
      const doc = `LearningNeed/ws-local-${stamp}`;
      const write = await on(workspace, 'PUT', `/documents/${doc}?branch=${BRANCH}`, { message: 'Offline work', document: { label: 'Offline', rationale: 'r' } });
      expect(write.status).toBe(200);
      expect((await on(app, 'GET', `/documents/${doc}?branch=${BRANCH}`)).status).toBe(404);

      const status = await json(await on(workspace, 'GET', `/workspace/${BRANCH}/status`));
      expect(status.status).toBe(200);
      expect(status.body.workspace.branch).toBe(BRANCH);
      expect(status.body.head).toBe(write.headers.get('etag')?.replace(/"/g, ''));
      expect(status.body.localCommits).toBe(1);
      // Main has moved since by the workspace's own records, which is not being behind it.
      expect(status.body.remote).toEqual({ head: record.base, moved: false, link: 'here', parent: { branch: 'main', behind: false } });
    });

    it('@armature/client reads the same status through its workspace functions', async () => {
      const client = createClient({ baseUrl: 'http://localhost', user: USER, localToken: TOKEN, fetch: (input, init) => workspace.request(input, init) });
      const { data } = await client.workspace.status(BRANCH);
      expect(data.workspace.base).toBe(record.base);
      expect(data.localCommits).toBe(1);
      expect((await client.workspace.list()).data.map((r) => r.branch)).toContain(BRANCH);
    });

    it('lists the workspace, and refuses a second of the same name', async () => {
      const list = await json(await on(workspace, 'GET', '/workspace'));
      expect(list.body.map((r: WorkspaceRecord) => r.branch)).toContain(BRANCH);
      const again = await json(await create({ name: NAME }));
      expect(again.status).toBe(409);
      expect(again.body.error).toBe('workspace_exists');
    });
  });

  describe('linking a workspace the remote already has (ADR-0072 decision 4)', () => {
    it('links it to this installation and clones it as it is, with its parent, and mirrors nothing that has not changed', async () => {
      await remoteBranch(EXISTING);
      const mirrorBefore = (await localStore('main').head())?.id;
      const res = await json(await create({ link: EXISTING }));
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ branch: EXISTING, from: 'main', link: INSTALLATION });
      expect((await json(await on(app, 'GET', `/workspaces/${EXISTING}`))).body.link).toBe(INSTALLATION);
      expect((await localStore('main').head())?.id).toBe(mirrorBefore);
    });

    it('passes the remote\'s refusal through with its own status and code', async () => {
      const res = await json(await create({ link: `ws-no-such-${stamp}` }));
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ error: 'not_found', remote: true });
      // A branch that is no workspace is not linked either, and neither is one linked to another computer.
      const plain = `test-ws-plain-${stamp}`;
      REMOTE_BRANCHES.push(plain);
      expect((await on(app, 'POST', '/branches', { name: plain })).status).toBe(201);
      expect((await json(await create({ link: plain }))).body).toMatchObject({ error: 'not_found', remote: true });
      const held = `test-ws-held-${stamp}`;
      REMOTE_BRANCHES.push(held);
      expect((await on(app, 'POST', '/branches', { name: held, workspace: { link: 'ffffffffffffffffffffffffffffffff', linkLabel: 'Laptop' } })).status).toBe(201);
      const taken = await json(await create({ link: held }));
      expect(taken.status).toBe(409);
      expect(taken.body).toMatchObject({ error: 'held_elsewhere', remote: true, linkLabel: 'Laptop' });
      expect((await json(await on(workspace, 'GET', '/workspace/elsewhere'))).body.linkedElsewhere).toContainEqual({ branch: held, parent: 'main', linkLabel: 'Laptop', linkedAt: expect.any(String) });
      // Its owner unlinks it from the other computer through this hub, saying which of the two they mean, and links it here.
      expect((await json(await on(workspace, 'POST', `/workspace/${held}/unlink`))).status).toBe(404);
      const unlinked = await json(await on(workspace, 'POST', `/workspace/${held}/unlink`, { elsewhere: true }));
      expect(unlinked.status).toBe(200);
      expect(unlinked.body).toMatchObject({ workspace: held, unlinked: true, elsewhere: true, was: { linkLabel: 'Laptop' } });
      expect((await json(await on(workspace, 'GET', '/workspace/elsewhere'))).body.unlinked).toContainEqual({ branch: held, parent: 'main' });
      expect((await create({ link: held })).status).toBe(201);
      // Held here, it is unlinked from this computer: the remote's link cleared, the copy gone, the workspace kept there.
      expect((await json(await on(workspace, 'POST', `/workspace/${held}/unlink`, { elsewhere: true }))).body.error).toBe('workspace_here');
      const left = await json(await on(workspace, 'POST', `/workspace/${held}/unlink`));
      expect(left.status).toBe(200);
      expect(left.body).toMatchObject({ workspace: { branch: held }, link: 'cleared' });
      expect((await on(workspace, 'GET', `/workspace/${held}/status`)).status).toBe(404);
      expect(await localStore('main').listBranches()).not.toContain(held);
      const there = (await json(await on(app, 'GET', `/workspaces/${held}`))).body;
      expect(there.status).toBe('Active');
      expect(there).not.toHaveProperty('link');
    });

    it('replaces a clone that did not finish, and refuses a local branch with work in it', async () => {
      await remoteBranch(UNFINISHED);
      const unfinished = localStore(UNFINISHED);
      await unfinished.createEmptyBranch(UNFINISHED);
      await unfinished.replaceSchema(normalizeSchema((await localStore('main').getSchema()).entries), { author: 'User/demo-designer', message: `Schema of ${UNFINISHED} from ${remote.url} at x` });
      expect((await create({ link: UNFINISHED })).status).toBe(201);

      await remoteBranch(WORKED);
      const worked = localStore(WORKED);
      await worked.createEmptyBranch(WORKED);
      await worked.replaceSchema(normalizeSchema((await localStore('main').getSchema()).entries), { author: 'User/demo-designer', message: 'Someone\'s work' });
      const refused = await json(await create({ link: WORKED }));
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe('branch_exists');
    });
  });

  describe('what a workspace hub refuses and reports', () => {
    it('refuses a malformed request and an identity the remote does not know', async () => {
      for (const body of [{}, { name: 'a', link: 'b' }, { link: 'b', from: 'main' }, { name: 3 }, { existing: 'b' }]) {
        expect((await create(body)).status, JSON.stringify(body)).toBe(400);
      }
      expect((await json(await create({ name: 'bad/name' }))).body.error).toBe('bad_name');
      const stranger = await workspace.request('/api/v1/workspace', {
        method: 'POST',
        headers: { ...HEADERS, 'Armature-User': `nobody-${stamp}@example.edu` },
        body: JSON.stringify({ name: 'x' }),
      });
      expect(stranger.status).toBe(401);
      expect((await stranger.json()).remote).toBe(true);
    });

    it('answers status with the remote unreachable, and 404 for a workspace it does not hold', async () => {
      // The workspace's own remote, out of reach: the record names the address the hub dials (another address would be another remote, W10 below).
      const dead = 'http://127.0.0.1:9';
      const held = config.workspaces!;
      const workspaces = { ...held, get: async (branch: string) => held.get(branch).then((record) => record && { ...record, remote: dead }) };
      const offline = createApp(() => ({ ...config, remote: dead, workspaces }));
      const status = await json(await on(offline, 'GET', `/workspace/${BRANCH}/status`));
      expect(status.status).toBe(200);
      expect(status.body.remote).toEqual({ reachable: false });
      expect((await on(workspace, 'GET', `/workspace/ws-none-${stamp}/status`)).status).toBe(404);
    });

    it('a remote hub refuses the workspace routes; only a workspace hub lists the capability', async () => {
      const res = await json(await on(app, 'GET', '/workspace'));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('workspace_only');
      expect((await json(await on(app, 'GET', '/discover'))).body.capabilities['armature/workspace']).toBeUndefined();
      expect((await json(await on(workspace, 'GET', '/discover'))).body.capabilities['armature/workspace']).toEqual({ fallback: 'reject', profile: 'full', localToken: 'required', link: 'installation', delivery: 'merge-request', actions: 'routes' });
    });
  });

  describe("what the remote supplies is checked before it is kept or followed (the 2026-11-09 review's W5 to W7, W9 and W10)", () => {
    it("refuses to clone a branch under a name the hub's own folder and store use, before the remote is asked (W9)", async () => {
      const nowhere = createApp(() => ({ ...config, remote: 'http://127.0.0.1:9' }));
      for (const existing of ['main', 'at.abc123', 'lock', 'store.json', 'Checks.json']) {
        const res = await json(await on(nowhere, 'POST', '/workspace', { link: existing }));
        expect(res.status, existing).toBe(400);
        expect(res.body, existing).toMatchObject({ error: 'bad_name', reserved: true });
      }
    });

    it('follows no redirect from the remote: 502 remote_error naming where it pointed, and nothing sent there (W5)', async () => {
      const reached: string[] = [];
      const target = createServer((req, res) => {
        reached.push(`${req.method} ${req.url}`);
        res.end('{}');
      });
      const moved = createServer((req, res) => {
        res.writeHead(307, { Location: `http://127.0.0.1:${(target.address() as AddressInfo).port}${req.url}` });
        res.end();
      });
      await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
      await new Promise<void>((resolve) => moved.listen(0, '127.0.0.1', resolve));
      try {
        const address = `http://127.0.0.1:${(moved.address() as AddressInfo).port}`;
        const redirected = createApp(() => ({ ...config, remote: address }));
        const res = await json(await on(redirected, 'POST', '/workspace', { name: `ws-moved-${stamp}` }));
        expect(res.status).toBe(502);
        expect(res.body).toMatchObject({ error: 'remote_error', remote: true, reason: 'redirect' });
        expect(res.body.location).toContain('/api/v1/users/me');
        expect(reached).toEqual([]);
      } finally {
        await new Promise((resolve) => moved.close(resolve));
        await new Promise((resolve) => target.close(resolve));
      }
    });

    it('sends a token to a remote over plain http only on loopback or in a rehearsal (W5)', () => {
      const env = (remoteUrl: string, extra: Record<string, string> = {}) => ({
        ARMATURE_ROLE: 'workspace',
        ARMATURE_REMOTE_URL: remoteUrl,
        ARMATURE_WORKSPACE_DIR: '/tmp/ws',
        ARMATURE_REMOTE_TOKEN: 'a-token',
        ...extra,
      });
      expect(() => configFromEnv(env('http://armature.example.edu'))).toThrow(/plain http/);
      expect(configFromEnv(env('https://armature.example.edu')).remoteToken).toBeTypeOf('function');
      expect(configFromEnv(env('http://localhost:3100')).remoteToken).toBeTypeOf('function');
      expect(configFromEnv(env('http://hub:3100', { ARMATURE_REHEARSAL: '1' })).remoteToken).toBeTypeOf('function');
      // Without a token nothing secret travels: a remote under header is reached as it always was.
      expect(configFromEnv({ ...env('http://armature.example.edu'), ARMATURE_REMOTE_TOKEN: '' }).remote).toBe('http://armature.example.edu');
    });

    it("keeps the remote's log from the base back, and refuses one that repeats or lacks the base (W6)", async () => {
      type Log = Parameters<typeof fetchRemoteLog>[1];
      const entry = (commit: string) => ({ commit, author: 'User/a', message: 'm', timestamp: 1 });
      const paged = (pages: Array<Array<{ commit: unknown }>>, asked: number[] = []) =>
        ({
          branches: {
            log: async (_branch: string, { start = 0 }: { start?: number } = {}) => {
              asked.push(start);
              return { data: { commits: pages[start / 100] ?? [] } };
            },
          },
        }) as unknown as Log;
      const refusal = (pending: Promise<unknown>) => pending.then(() => undefined, (e: unknown) => e);

      const kept = await fetchRemoteLog(config, paged([[entry('newer'), entry('base'), entry('older')]]), 'b', 'base');
      expect(kept).toEqual({ head: 'base', commits: [entry('base'), entry('older')] });

      // A remote, or a proxy, that ignores `start` answers the first page for every page: read twice, not forever.
      const full = Array.from({ length: 100 }, (_, i) => entry(`c${i}`));
      const asked: number[] = [];
      const same = { branches: { log: async (_b: string, { start = 0 }: { start?: number } = {}) => (asked.push(start), { data: { commits: full } }) } } as unknown as Log;
      expect(await refusal(fetchRemoteLog(config, same, 'b', 'c0'))).toMatchObject({ status: 502, code: 'remote_error', details: { reason: 'log_repeats', commit: 'c0' } });
      expect(asked).toEqual([0, 100]);

      expect(await refusal(fetchRemoteLog(config, paged([[entry('x'), entry('y')]]), 'b', 'base'))).toMatchObject({
        status: 502,
        code: 'remote_error',
        details: { reason: 'log_without_base', base: 'base' },
      });
      expect(await refusal(fetchRemoteLog(config, paged([[{ commit: '../../etc' }]]), 'b', 'base'))).toMatchObject({ code: 'remote_error', details: { reason: 'not_a_commit' } });

      // A history longer than the pages read is kept to there, and the read ends.
      const long: number[] = [];
      const endless = {
        branches: { log: async (_b: string, { start = 0 }: { start?: number } = {}) => (long.push(start), { data: { commits: Array.from({ length: 100 }, (_, i) => entry(`n${start + i}`)) } }) },
      } as unknown as Log;
      const capped = await fetchRemoteLog(config, endless, 'b', 'n0');
      expect(long).toHaveLength(50);
      expect(capped.commits).toHaveLength(5000);
    });

    it("takes a commit identifier, a profile and an asOf from the remote only in their own shape (W7)", () => {
      expect(remoteCommitOf(config, 'abc123', 'the merge')).toBe('abc123');
      for (const bad of [undefined, '', 'abc-gzip', 'a'.repeat(98), 7, '../x']) {
        expect(() => remoteCommitOf(config, bad, 'the merge'), String(bad)).toThrow(ApiError);
      }
      expect(profileOf({ name: 'An instance', api: 'https://api.example.edu', program: { releases: 'https://example.edu/releases', extra: 1 }, script: '<b>' })).toEqual({
        name: 'An instance',
        api: 'https://api.example.edu',
        program: { releases: 'https://example.edu/releases' },
      });
      expect(profileOf({ name: 7 })).toBeUndefined();
      expect(profileOf({ name: 'x'.repeat(5000) })).toBeUndefined();
      expect(profileOf('a profile')).toBeUndefined();
      // An asOf no store minted names no snapshot: the branch `at.<commit>` would be no branch name.
      expect([...asOfCommitsOf([{ '@id': 'a', '@type': 'T', asOf: 'abc' }, { '@id': 'b', '@type': 'T', asOf: 'a'.repeat(98) }, { '@id': 'c', '@type': 'T', asOf: 'abc' }])]).toEqual([['abc', 2]]);
    });

    it("refuses a workspace's actions through another remote than the one it was cloned from, and removes it here alone (W10)", async () => {
      await remoteBranch(ELSEWHERE);
      expect((await create({ link: ELSEWHERE })).status).toBe(201);
      // The folder pointed back at after a connection made elsewhere: the same records, another remote.
      const other = createApp(() => ({ ...config, remote: 'http://127.0.0.1:9' }));
      for (const [path, body] of [
        ['push', undefined],
        ['bring-in', undefined],
        ['merge-request', { message: 'Merge it' }],
        ['merge-request/merge', undefined],
        ['merge-request/close', undefined],
        ['unlink', undefined],
      ] as const) {
        const res = await json(await on(other, 'POST', `/workspace/${ELSEWHERE}/${path}`, body));
        expect(res.status, path).toBe(409);
        expect(res.body, path).toMatchObject({ error: 'other_remote', workspace: ELSEWHERE, clonedFrom: remote.url, remote: 'http://127.0.0.1:9' });
      }
      const status = await json(await on(other, 'GET', `/workspace/${ELSEWHERE}/status`));
      expect(status.status).toBe(200);
      expect(status.body.remote).toEqual({ reachable: false, reason: 'other_remote' });

      // The way out asks nothing of a remote that never held the branch; the first remote keeps its own.
      const removed = await json(await on(other, 'DELETE', `/workspace/${ELSEWHERE}`));
      expect(removed.status).toBe(200);
      expect(removed.body.remote).toBe('untouched');
      expect((await on(workspace, 'GET', `/workspace/${ELSEWHERE}/status`)).status).toBe(404);
      expect((await on(app, 'GET', `/branches/${ELSEWHERE}`)).status).toBe(200);
    });
  });

  describe('push (plan §5; ADR-0065 decision 5 with its notes)', () => {
    const push = async () => json(await on(workspace, 'POST', `/workspace/${BRANCH}/push`));
    const remoteLog = async (count = 5) => (await json(await on(app, 'GET', `/branches/${BRANCH}/log?count=${count}`))).body;
    const records = () => config.workspaces!;
    const need = (label: string) => ({ message: `Need ${label}`, document: { label, rationale: 'r' } });
    let first: { local: string; remote: string; parts: number };

    it('replays the local commit as one remote commit carrying the workspace trailers, records the table, and status counts it', async () => {
      const local = (await localStore(BRANCH).log({ count: 1 }))[0];
      const res = await push();
      expect(res.status).toBe(200);
      expect(res.body.pushed).toHaveLength(1);
      expect(res.body.upToDate).toBe(false);
      first = res.body.pushed[0];
      expect(first).toMatchObject({ local: local.id, parts: 1 });
      expect(res.body.remoteHead).toBe(first.remote);

      const log = await remoteLog(1);
      expect(log.head).toBe(first.remote);
      expect(log.commits[0].author).toBe('User/demo-designer');
      expect(log.commits[0].message).toBe(
        `Offline work\n\nArmature-Workspace-Commit: ${local.id}\nArmature-Authored-At: ${new Date(local.timestamp * 1000).toISOString()}`
      );
      const theirs = await json(await on(app, 'GET', `/documents/LearningNeed/ws-local-${stamp}?branch=${BRANCH}`));
      expect(theirs.status).toBe(200);
      expect(theirs.body).toMatchObject({ label: 'Offline', createdBy: 'User/demo-designer' });

      const table = await records().getPush(BRANCH);
      expect(table).toEqual({ commits: [first] });
      const status = (await json(await on(workspace, 'GET', `/workspace/${BRANCH}/status`))).body;
      expect(status).toMatchObject({ localCommits: 1, pushed: 1, unpushed: 0, remote: { head: first.remote, moved: false } });
    });

    it('a second push with nothing new is up to date, and @armature/client reads it', async () => {
      const client = createClient({ baseUrl: 'http://localhost', user: USER, localToken: TOKEN, fetch: (input, init) => workspace.request(input, init) });
      const { data } = await client.workspace.push(BRANCH);
      expect(data).toMatchObject({ pushed: [], remoteHead: first.remote, upToDate: true });
    });

    it('rewrites asOf: a finding written offline names the local head, and on the remote the commit that head became', async () => {
      const id = `DesignFinding/ws-finding-${stamp}`;
      const written = await json(
        await on(workspace, 'PUT', `/documents/${id}?branch=${BRANCH}`, {
          message: 'A finding, offline',
          document: { label: 'Offline finding', finding: 'f', subject: ['LearningObjective/identify-ai-limitations'], status: 'Open' },
        })
      );
      expect(written.status).toBe(200);
      expect((await json(await on(workspace, 'GET', `/documents/${id}?branch=${BRANCH}`))).body.asOf).toBe(first.local);
      const res = await push();
      expect(res.status).toBe(200);
      expect(res.body.pushed).toHaveLength(1);
      expect((await json(await on(app, 'GET', `/documents/${id}?branch=${BRANCH}`))).body.asOf).toBe(first.remote);
    });

    it("replays an agent's local commit as the agent acting for the owner: the agent is the author, the remote writes the trailer", async () => {
      const id = `LearningNeed/ws-agent-${stamp}`;
      const drafted = await workspace.request(`/api/v1/documents/${id}?branch=${BRANCH}`, {
        method: 'PUT',
        headers: { ...HEADERS, 'Armature-Agent': AGENT },
        body: JSON.stringify({ message: 'Drafted by the agent', document: { label: 'Drafted', rationale: 'r' } }),
      });
      expect(drafted.status).toBe(200);
      const local = (await localStore(BRANCH).log({ count: 1 }))[0];
      expect(local.author).toBe(agentId);
      expect(trailerValue(local.message, 'Armature-On-Behalf-Of')).toBe(USER);

      const res = await push();
      expect(res.status).toBe(200);
      const head = (await remoteLog(1)).commits[0];
      expect(head.author).toBe(agentId);
      expect(head.message.split('\n').filter((line: string) => line.startsWith('Armature-On-Behalf-Of'))).toEqual([`Armature-On-Behalf-Of: ${USER}`]);
      expect(trailerValue(head.message, 'Armature-Workspace-Commit')).toBe(local.id);
      expect((await json(await on(app, 'GET', `/documents/${id}?branch=${BRANCH}`))).body.createdBy).toBe(agentId);
    });

    it('splits a local commit larger than one request into parts that each carry the part trailer, mapped to the last', async () => {
      const batch = await on(workspace, 'POST', `/documents?branch=${BRANCH}`, {
        message: 'Three needs at once',
        documents: ['a', 'b', 'c'].map((n) => ({ '@type': 'LearningNeed', '@id': `LearningNeed/ws-split-${n}-${stamp}`, label: n, rationale: 'r' })),
      });
      expect(batch.status).toBe(200);
      const record = (await records().get(BRANCH))!;
      const result = await pushWorkspace(config, records(), record, { runs: new RunStore() }, { documents: 2, bytes: 1e9 });
      expect(result.pushed).toHaveLength(1);
      expect(result.pushed[0].parts).toBe(2);
      const log = await remoteLog(2);
      expect(log.commits.map((c: { message: string }) => trailerValue(c.message, 'Armature-Workspace-Part'))).toEqual(['2/2', '1/2']);
      expect(log.commits.map((c: { message: string }) => trailerValue(c.message, 'Armature-Workspace-Commit'))).toEqual([result.pushed[0].local, result.pushed[0].local]);
      expect(result.pushed[0].remote).toBe(log.commits[0].commit);
      expect(result.remoteHead).toBe(log.commits[0].commit);
      for (const n of ['a', 'b', 'c']) expect((await on(app, 'GET', `/documents/LearningNeed/ws-split-${n}-${stamp}?branch=${BRANCH}`)).status).toBe(200);
    });

    it('settles an in-flight part that did land from the remote log, without sending it again (ADR-0066 decision 2, note)', async () => {
      const table = (await records().getPush(BRANCH))!;
      const last = table.commits.pop()!;
      expect(last.parts).toBe(2);
      const [second, firstPart] = (await remoteLog(2)).commits;
      expect(second.commit).toBe(last.remote);
      table.inFlight = { local: last.local, part: 2, total: 2, ifMatch: firstPart.commit, landed: [firstPart.commit], sentAt: new Date().toISOString() };
      await records().putPush(BRANCH, table);

      const res = await push();
      expect(res.status).toBe(200);
      expect(res.body.pushed).toEqual([expect.objectContaining({ local: last.local, remote: last.remote, parts: 2 })]);
      expect((await remoteLog(1)).head).toBe(last.remote);
      expect((await records().getPush(BRANCH))!.inFlight).toBeUndefined();
    });

    it('sends an in-flight request that did not land, once', async () => {
      const id = `LearningNeed/ws-lost-${stamp}`;
      expect((await on(workspace, 'PUT', `/documents/${id}?branch=${BRANCH}`, need('lost'))).status).toBe(200);
      const local = (await localStore(BRANCH).log({ count: 1 }))[0];
      const table = (await records().getPush(BRANCH))!;
      const before = table.commits.at(-1)!.remote;
      table.inFlight = { local: local.id, part: 1, total: 1, ifMatch: before, landed: [], sentAt: new Date().toISOString() };
      await records().putPush(BRANCH, table);

      const res = await push();
      expect(res.status).toBe(200);
      expect(res.body.pushed).toEqual([expect.objectContaining({ local: local.id, parts: 1 })]);
      const log = await remoteLog(3);
      expect(log.commits.filter((c: { message: string }) => trailerValue(c.message, 'Armature-Workspace-Commit') === local.id)).toHaveLength(1);
      expect(log.commits[1].commit).toBe(before);
    });

    it('stops with the remote\'s 412 when the branch moved there, saying what moved, and records nothing', async () => {
      const theirs = `LearningNeed/ws-remote-${stamp}`;
      // Since 2026-11-20 only this installation writes the branch there (ADR-0072 decision 3): the owner's own write
      // from elsewhere is refused, and what moves the branch here is a write carrying this installation's identifier.
      expect((await json(await on(app, 'PUT', `/documents/${theirs}?branch=${BRANCH}`, need('theirs')))).body.error).toBe('held_elsewhere');
      expect((await onLinked(app, 'PUT', `/documents/${theirs}?branch=${BRANCH}`, need('theirs'))).status).toBe(200);
      expect((await on(workspace, 'PUT', `/documents/LearningNeed/ws-after-${stamp}?branch=${BRANCH}`, need('after'))).status).toBe(200);
      const local = (await localStore(BRANCH).log({ count: 1 }))[0];

      const res = await push();
      expect(res.status).toBe(412);
      expect(res.body).toMatchObject({ error: 'precondition_failed', remote: true, pushed: [], at: { local: local.id, part: 1, total: 1 } });
      expect(res.body.moved).toEqual([{ id: theirs, op: 'insert' }]);
      const status = (await json(await on(workspace, 'GET', `/workspace/${BRANCH}/status`))).body;
      expect(status.unpushed).toBe(1);
      expect(status.remote.moved).toBe(true);
      expect((await records().getPush(BRANCH))!.inFlight).toBeUndefined();
    });
  });

  describe("a workspace is its owner's (plan §7; ADR-0068 decision 9)", () => {
    const asReviewer = { ...HEADERS, 'Armature-User': REVIEWER };
    const reviewer = (method: string, path: string, body?: unknown) =>
      workspace.request(`/api/v1${path}`, { method, headers: asReviewer, body: body === undefined ? undefined : JSON.stringify(body) });

    it("links no one else's workspace: the remote refuses, and nothing is made here", async () => {
      await remoteBranch(FORBIDDEN);
      const res = await json(await reviewer('POST', '/workspace', { link: FORBIDDEN }));
      expect(res.status).toBe(403);
      expect(res.body).toMatchObject({ error: 'forbidden', remote: true, permission: 'link_workspace' });
      expect((await reviewer('GET', `/workspace/${FORBIDDEN}/status`)).status).toBe(404);
      expect(await localStore('main').listBranches()).not.toContain(FORBIDDEN);
    });

    it("a workspace whose owner has lost the right to write it on the remote still takes local work; its push is the remote's 403", async () => {
      // The reviewer's own workspace, whose Owner grant an administrator then revokes.
      // A scratch name, so the suite's cleanup may delete its branch on the remote (`isScratchName`).
      const made = await json(await reviewer('POST', '/workspace', { name: `test-forbidden-${stamp}` }));
      expect(made.status).toBe(201);
      REMOTE_BRANCHES.push(made.body.branch);
      THEIRS = made.body.branch;
      // Given to someone else, not only withdrawn: a branch with no owner at all is writable by anyone (ADR-0068 decision 3, note).
      const moved = await on(app, 'POST', '/documents?branch=main', {
        message: 'Ownership moved, for the test',
        documents: [
          { '@type': 'Grant', user: made.body.owner, role: 'Owner', branch: THEIRS, status: 'Revoked', rationale: 'Moved for the test' },
          { '@type': 'Grant', user: 'User/demo-designer', role: 'Owner', branch: THEIRS, status: 'Active' },
        ],
      });
      expect(moved.status).toBe(200);
    });

    it("the owner writes locally; the push is the remote's 403 before any commit; anyone else is refused here", async () => {
      const id = `LearningNeed/ws-forbidden-${stamp}`;
      expect((await reviewer('PUT', `/documents/${id}?branch=${THEIRS}`, { message: 'Work while asking for a grant', document: { label: 'x', rationale: 'r' } })).status).toBe(200);
      const pushed = await json(await reviewer('POST', `/workspace/${THEIRS}/push`));
      expect(pushed.status).toBe(403);
      expect(pushed.body).toMatchObject({ error: 'forbidden', remote: true, permission: 'write', branch: THEIRS, pushed: [], at: { part: 1, total: 1 } });
      expect((await on(app, 'GET', `/documents/${id}?branch=${THEIRS}`)).status).toBe(404);

      const designerWrites = await json(await on(workspace, 'PUT', `/documents/LearningNeed/ws-not-mine-${stamp}?branch=${THEIRS}`, { message: 'x', document: { label: 'x', rationale: 'r' } }));
      expect(designerWrites.status).toBe(403);
      expect(designerWrites.body).toMatchObject({ error: 'forbidden', permission: 'write', branch: THEIRS, owner: REVIEWER });
      const designerPushes = await json(await on(workspace, 'POST', `/workspace/${THEIRS}/push`));
      expect(designerPushes.status).toBe(403);
      expect(designerPushes.body).toMatchObject({ error: 'forbidden', permission: 'push', owner: REVIEWER });
    });
  });

  describe('what the clone holds beyond the base: snapshots, remote identifiers, forwarding and the log (plan §8, §16 question 3; step 5)', () => {
    const records = () => config.workspaces!;
    const etag = (res: Response) => res.headers.get('ETag');
    let attestation: { '@id': string; asOf: string };
    let findingAsOf: string;
    let datasetAsOf: string;
    let held: string[];

    beforeAll(async () => {
      [attestation] = (await json(await on(app, 'GET', '/documents/Attestation?branch=main'))).body;
      datasetAsOf = (await json(await on(app, 'GET', '/documents/LearningDataset/mod3-spring-pilot?branch=main'))).body.asOf;
      findingAsOf = (await json(await on(app, 'GET', '/documents/DesignFinding/bias-objective-rests-on-one-item?branch=main'))).body.asOf;
      held = [...new Set([attestation.asOf, datasetAsOf, findingAsOf])].sort();
      expect(held.length).toBeGreaterThan(1); // the seed names at least two older commits
    });

    it('holds a snapshot of the remote at each commit a cloned record names, as branches of its own that are neither listed nor written', async () => {
      const status = (await json(await on(workspace, 'GET', `/workspace/${BRANCH}/status`))).body;
      expect(status.snapshots).toEqual({ budget: config.snapshotBudget, held: expect.arrayContaining(held), declined: [] });
      expect([...status.snapshots.held].sort()).toEqual(held);
      const branches = (await json(await on(workspace, 'GET', '/branches'))).body as Array<{ name: string }>;
      expect(branches.map((b) => b.name).filter((n) => n.startsWith('at.'))).toEqual([]);
      expect((await localStore('main').listBranches()).filter((n) => n.startsWith('at.')).sort()).toEqual(expect.arrayContaining(held.map((c) => `at.${c}`)));
      const write = await json(await on(workspace, 'PUT', `/documents/LearningNeed/ws-snap-${stamp}?branch=at.${held[0]}`, { message: 'x', document: { label: 'x', rationale: 'r' } }));
      expect(write.status).toBe(400);
      expect(write.body.error).toBe('remote_only');
    });

    it('serves a read at a remote commit it holds under that identifier: documents, the schema, and the staleness read', async () => {
      // The attestation's subject as it stood at the attestation's asOf (the attestation itself was written after that commit).
      const at = attestation.asOf;
      const ours = await on(workspace, 'GET', `/documents/AssessmentItem/bias-type-mc?ref=${at}`);
      expect(ours.status).toBe(200);
      expect(etag(ours)).toBe(`"${at}"`);
      const theirs = await on(app, 'GET', `/documents/AssessmentItem/bias-type-mc?ref=${at}`);
      expect(canonical(await ours.json())).toEqual(canonical(await theirs.json()));
      expect((await on(workspace, 'GET', `/documents/${attestation['@id']}?ref=${at}`)).status).toBe(404); // not yet written then, there or here
      const schema = await on(workspace, 'GET', `/schema?ref=${at}`);
      expect(schema.status).toBe(200);
      expect(etag(schema)).toBe(`"${at}"`);
      expect((await schema.json()).ref).toBe(at);

      // The attestation staleness read compares the subject at asOf with now (ADR-0028): offline, from the snapshot.
      const offline = createApp(() => ({ ...config, remote: 'http://127.0.0.1:9' }));
      const mine = (await json(await on(offline, 'GET', `/intelligence/attestations/AssessmentItem/bias-type-mc?branch=${BRANCH}`))).body;
      const remote = (await json(await on(app, 'GET', `/intelligence/attestations/AssessmentItem/bias-type-mc?branch=${BRANCH}`))).body;
      expect(mine.attestations.map((a: { id: string; state: string }) => [a.id, a.state])).toEqual(remote.attestations.map((a: { id: string; state: string }) => [a.id, a.state]));
      expect(mine.attestations.length).toBeGreaterThan(0);
    });

    it('checks constraint 13 offline against a snapshot: a cloned finding is replaced keeping its asOf, a metric is written at the dataset\'s', async () => {
      const offline = createApp(() => ({ ...config, remote: 'http://127.0.0.1:9' }));
      const id = 'DesignFinding/bias-objective-rests-on-one-item';
      const cloned = (await json(await on(offline, 'GET', `/documents/${id}?branch=${BRANCH}`))).body as Record<string, unknown>;
      const fields = Object.fromEntries(Object.entries(cloned).filter(([k]) => !['@id', '@type', 'createdBy', 'asOf'].includes(k))) as { label: string };
      const replaced = await json(await on(offline, 'PUT', `/documents/${id}?branch=${BRANCH}`, { message: 'Relabel the cloned finding offline', document: { ...fields, label: `${fields.label} (offline)` } }));
      expect(replaced.status).toBe(200);
      expect((await json(await on(offline, 'GET', `/documents/${id}?branch=${BRANCH}`))).body.asOf).toBe(findingAsOf);

      const metric = `LearningMetric/ws-metric-${stamp}`;
      const written = await json(
        await on(offline, 'PUT', `/documents/${metric}?branch=${BRANCH}`, {
          message: 'A metric written offline at the dataset\'s commit',
          document: { label: 'Offline difficulty', source: 'test', collectedAt: '2026-05-15T09:00:00Z', subject: 'AssessmentItem/bias-type-mc', derivedFrom: 'LearningDataset/mod3-spring-pilot', unit: 'proportion correct', value: 0.5, asOf: datasetAsOf },
        })
      );
      expect(written.status).toBe(200);
      expect((await json(await on(offline, 'GET', `/documents/${metric}?branch=${BRANCH}`))).body.asOf).toBe(datasetAsOf);
    });

    it('forwards a read at a commit it does not hold to the remote when online, as the caller, and answers 404 remote_needed offline', async () => {
      if (!(await records().get(EXISTING))) {
        await remoteBranch(EXISTING);
        expect((await create({ link: EXISTING })).status).toBe(201);
      }
      const id = `LearningNeed/ws-forwarded-${stamp}`;
      const theirs = await onLinked(app, 'PUT', `/documents/${id}?branch=${EXISTING}`, { message: 'Written on the remote after the clone', document: { label: 'Forwarded', rationale: 'r' } });
      expect(theirs.status).toBe(200);
      const later = etag(theirs)!.replace(/"/g, '');

      const ours = await on(workspace, 'GET', `/documents/${id}?ref=${later}`);
      expect(ours.status).toBe(200);
      expect(etag(ours)).toBe(`"${later}"`);
      expect((await ours.json()).label).toBe('Forwarded');
      // An intelligence read at that commit runs here over the remote's state: the same answer the remote gives.
      const coverage = await on(workspace, 'GET', `/intelligence/coverage/how-ai-works?ref=${later}`);
      expect(coverage.status).toBe(200);
      expect(etag(coverage)).toBe(`"${later}"`);
      expect(await coverage.json()).toEqual(await (await on(app, 'GET', `/intelligence/coverage/how-ai-works?ref=${later}`)).json());
      // A write whose asOf names that commit is checked against the remote's state.
      const finding = `DesignFinding/ws-forwarded-finding-${stamp}`;
      const body = { message: 'A finding at a commit only the remote holds', document: { label: 'At a remote commit', finding: 'f', subject: ['LearningObjective/identify-ai-limitations'], status: 'Open', asOf: later } };
      const checkedRemotely = await json(await on(workspace, 'PUT', `/documents/${finding}?branch=${BRANCH}`, body));
      expect([checkedRemotely.status, checkedRemotely.body]).toEqual([200, expect.anything()]);

      const offline = createApp(() => ({ ...config, remote: 'http://127.0.0.1:9' }));
      const refused = await json(await on(offline, 'GET', `/documents/${id}?ref=${later}`));
      expect(refused.status).toBe(404);
      expect(refused.body).toMatchObject({ error: 'unknown_ref', remote_needed: true });
      expect((await on(offline, 'GET', `/documents/AssessmentItem/bias-type-mc?ref=${attestation.asOf}`)).status).toBe(200); // a snapshot needs no remote
      const unchecked = await json(await on(offline, 'PUT', `/documents/${finding}-2?branch=${BRANCH}`, body));
      expect(unchecked.status).toBe(422);
      expect(unchecked.body.violations.map((v: { code: string }) => v.code)).toEqual(['unknown_commit']);
      const unknown = await json(await on(workspace, 'GET', `/documents/${id}?ref=nosuchcommit0000000000000000000`));
      expect(unknown.status).toBe(404);
      expect(unknown.body.remote_needed).toBeUndefined();
    });

    it('after a push, a pushed commit is read here by its remote identifier (ADR-0065 decision 5, note)', async () => {
      const [first] = (await records().getPush(BRANCH))!.commits;
      const res = await on(workspace, 'GET', `/documents/LearningNeed/ws-local-${stamp}?ref=${first.remote}`);
      expect(res.status).toBe(200);
      expect(etag(res)).toBe(`"${first.remote}"`);
      expect((await res.json()).label).toBe('Offline');
      expect((await on(workspace, 'GET', `/documents/LearningNeed/ws-local-${stamp}?ref=${first.local}`)).status).toBe(200);
    });

    it("continues a workspace's log past the clone with the remote's, from the base back", async () => {
      const record = (await records().get(BRANCH))!;
      const ours = (await json(await on(workspace, 'GET', `/branches/${BRANCH}/log?count=100`))).body;
      const theirs = (await json(await on(app, 'GET', `/branches/${BRANCH}/log?count=100`))).body;
      const clone = ours.commits.findIndex((c: { message: string }) => c.message.startsWith(`Schema of ${BRANCH} from `));
      expect(clone).toBeGreaterThan(1); // local work, the clone's documents, then its schema
      const from = theirs.commits.findIndex((c: { commit: string }) => c.commit === record.base);
      expect(from).toBeGreaterThanOrEqual(0);
      const expected = theirs.commits.slice(from).map((c: { commit: string }) => c.commit);
      const tail = ours.commits.slice(clone + 1).map((c: { commit: string }) => c.commit);
      expect(tail.slice(0, expected.length)).toEqual(expected.slice(0, tail.length));
      expect(ours.commits[clone + 1]).toMatchObject({ commit: record.base, author: expect.any(String), message: expect.any(String) });
      // The whole log from the base back, not one page: as long as the remote's when that fits a page, at least a page otherwise.
      const kept = (await records().getLog(BRANCH))!.commits.length;
      if (theirs.commits.length < 100) expect(kept).toBe(theirs.commits.length - from);
      else expect(kept).toBeGreaterThanOrEqual(100 - from);
    });

    it('keeps the most-referenced commits within the budget, declines the rest and forwards reads at them; If-Match may name the base', async () => {
      const budgeted = createApp(() => ({ ...config, snapshotBudget: 1 }));
      const name = `test-ws-budget-${stamp}`;
      const branch = `${handleOf(USER)}_${name}`;
      REMOTE_BRANCHES.push(branch);
      const made = await json(await on(budgeted, 'POST', '/workspace', { name }));
      expect(made.status).toBe(201);
      const byCount = new Map<string, number>();
      for (const doc of (await json(await on(app, 'GET', `/export?ref=${made.body.base}`))).body.documents as Array<{ asOf?: string }>) {
        if (doc.asOf) byCount.set(doc.asOf, (byCount.get(doc.asOf) ?? 0) + 1);
      }
      const most = [...byCount].sort((a, b) => b[1] - a[1])[0][0];
      expect(made.body.snapshots).toEqual([
        expect.objectContaining({ commit: most, held: true, references: byCount.get(most) }),
        ...[...byCount.keys()].filter((c) => c !== most).map((c) => ({ commit: c, references: byCount.get(c), held: false, reason: 'budget' })),
      ]);
      const declined = [...byCount.keys()].find((c) => c !== most)!;
      const forwarded = await on(budgeted, 'GET', `/documents/AssessmentItem/bias-type-mc?ref=${declined}`);
      expect(forwarded.status).toBe(200);
      expect(etag(forwarded)).toBe(`"${declined}"`);
      expect((await forwarded.json())['@id']).toBe('AssessmentItem/bias-type-mc');

      // The head is the clone's commit, whose remote counterpart is the base: either names it.
      const put = (ifMatch: string) =>
        budgeted.request(`/api/v1/documents/LearningNeed/ws-ifmatch-${stamp}?branch=${branch}`, {
          method: 'PUT',
          headers: { ...HEADERS, 'If-Match': `"${ifMatch}"` },
          body: JSON.stringify({ message: 'With the remote identifier in If-Match', document: { label: 'x', rationale: 'r' } }),
        });
      const accepted = await put(made.body.base);
      expect(accepted.status).toBe(200);
      const stale = await json(await put(made.body.base));
      expect(stale.status).toBe(412);
      expect(stale.body).toMatchObject({ expected: made.body.base, current: etag(accepted)!.replace(/"/g, '') });
    });
  });

});
