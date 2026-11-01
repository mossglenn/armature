/**
 * Workspace mode (docs/workspace-hub-plan.md §13, "The cycle", as far as step 2
 * goes: create and clone). A remote hub runs on an ephemeral port over the
 * seeded store, as `app/server.ts` runs one; a workspace hub runs in-process
 * beside it over a scratch database of its own, which its first clone creates
 * (platform check AN) and the suite deletes. Nothing is pushed yet: the remote
 * gains only the workspace branches, which are deleted too.
 */
import { createClient } from '@armature/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHub, type RunningHub } from '../hub';
import { app, createApp } from './app';
import { configFromEnv, type HubConfig } from './config';
import { normalizeSchema } from './export/exporter';
import { canonical } from './fragments';
import { handleOf } from './routes/workspace';
import { createOperatorStore, createStore, storeConfigFromEnv } from './store';
import { memoryRecords, type WorkspaceRecord } from './workspace/records';

const stamp = Date.now().toString(36);
const USER = 'demo-designer@example.edu';
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': USER };
const LOCAL_DB = `${process.env.TERMINUS_DB}_ws_${stamp}`;

const NAME = `ws-${stamp}`;
const BRANCH = `${handleOf(USER)}_${NAME}`;
const EXISTING = `ws-existing-${stamp}`;
const UNFINISHED = `ws-unfinished-${stamp}`;
const WORKED = `ws-worked-${stamp}`;
const REMOTE_BRANCHES = [BRANCH, EXISTING, UNFINISHED, WORKED];

let remote: RunningHub;
let config: HubConfig;
let workspace: ReturnType<typeof createApp>;
const localStore = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: LOCAL_DB });

const on = (hub: { request: typeof app.request }, method: string, path: string, body?: unknown) =>
  hub.request(`/api/v1${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
const create = (body: unknown) => on(workspace, 'POST', '/workspace', body);
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

/** A branch on the remote, made directly, for the cases that clone an existing one. */
const remoteBranch = async (name: string) => expect((await on(app, 'POST', '/branches', { name })).status).toBe(201);

beforeAll(async () => {
  remote = await startHub({ port: 0 });
  config = {
    ...configFromEnv(),
    role: 'workspace',
    remote: remote.url,
    workspaces: memoryRecords(),
    store: () => ({ ...storeConfigFromEnv(), db: LOCAL_DB }),
  };
  workspace = createApp(() => config);
});

afterAll(async () => {
  for (const name of REMOTE_BRANCHES) await createStore({ branch: 'main' }).deleteBranch(name).catch(() => undefined);
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
    const head = await json(await on(app, 'GET', `/branches/${BRANCH}`));
    expect(head.body.head.commit).toBe(record.base);
  });

  it('the clone is the remote branch at its base: the same documents and the same schema', async () => {
    const theirs = (await json(await on(app, 'GET', `/export?ref=${record.base}`))).body;
    const ours = (await json(await on(workspace, 'GET', `/export?branch=${BRANCH}`))).body;
    // Compared as export.test.ts compares a reload: keys in order, the store's nested ids aside.
    const byId = (docs: Array<{ '@id': string }>) => new Map(docs.map((d) => [d['@id'], canonical(d)]));
    expect(byId(ours.documents)).toEqual(byId(theirs.documents));
    expect(ours.schema.map((e: { '@id'?: string }) => e['@id']).sort()).toEqual(theirs.schema.map((e: { '@id'?: string }) => e['@id']).sort());
  });

  it('main is mirrored: the remote\'s users, so identity resolves here offline', async () => {
    const theirs = (await json(await on(app, 'GET', '/users'))).body;
    const ours = (await json(await on(workspace, 'GET', '/users'))).body;
    expect(ours.map((u: { '@id': string }) => u['@id']).sort()).toEqual(theirs.map((u: { '@id': string }) => u['@id']).sort());
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
    expect(status.body.remote).toEqual({ head: record.base, moved: false });
  });

  it('@armature/client reads the same status through its workspace functions', async () => {
    const client = createClient({ baseUrl: 'http://localhost', user: USER, fetch: (input, init) => workspace.request(input, init) });
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

describe('cloning a branch the remote already has', () => {
  it('clones it as it is, with no from, and mirrors nothing that has not changed', async () => {
    await remoteBranch(EXISTING);
    const mirrorBefore = (await localStore('main').head())?.id;
    const res = await json(await create({ existing: EXISTING }));
    expect(res.status).toBe(201);
    expect(res.body.branch).toBe(EXISTING);
    expect(res.body.from).toBeUndefined();
    expect((await localStore('main').head())?.id).toBe(mirrorBefore);
  });

  it('passes the remote\'s refusal through with its own status and code', async () => {
    const res = await json(await create({ existing: `ws-no-such-${stamp}` }));
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: 'unknown_ref', remote: true });
  });

  it('replaces a clone that did not finish, and refuses a local branch with work in it', async () => {
    await remoteBranch(UNFINISHED);
    const unfinished = localStore(UNFINISHED);
    await unfinished.createEmptyBranch(UNFINISHED);
    await unfinished.replaceSchema(normalizeSchema((await localStore('main').getSchema()).entries), { author: 'User/demo-designer', message: `Schema of ${UNFINISHED} from ${remote.url} at x` });
    expect((await create({ existing: UNFINISHED })).status).toBe(201);

    await remoteBranch(WORKED);
    const worked = localStore(WORKED);
    await worked.createEmptyBranch(WORKED);
    await worked.replaceSchema(normalizeSchema((await localStore('main').getSchema()).entries), { author: 'User/demo-designer', message: 'Someone\'s work' });
    const refused = await json(await create({ existing: WORKED }));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('branch_exists');
  });
});

describe('what a workspace hub refuses and reports', () => {
  it('refuses a malformed request and an identity the remote does not know', async () => {
    for (const body of [{}, { name: 'a', existing: 'b' }, { existing: 'b', from: 'main' }, { name: 3 }]) {
      expect((await create(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await json(await create({ name: 'bad/name' }))).body.error).toBe('bad_name');
    const stranger = await workspace.request('/api/v1/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Armature-User': `nobody-${stamp}@example.edu` },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(stranger.status).toBe(401);
    expect((await stranger.json()).remote).toBe(true);
  });

  it('answers status with the remote unreachable, and 404 for a workspace it does not hold', async () => {
    const offline = createApp(() => ({ ...config, remote: 'http://127.0.0.1:9' }));
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
    expect((await json(await on(workspace, 'GET', '/discover'))).body.capabilities['armature/workspace']).toEqual({ fallback: 'reject', profile: 'full' });
  });
});
