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
import { createOperatorStore, storeConfigFromEnv } from './store';
import { pushWorkspace } from './workspace/push';
import { memoryRecords, type WorkspaceRecord } from './workspace/records';
import { trailerValue } from './trailers';

import { deleteScratchBranch } from '../operator/repair';

const AS_OPERATOR = { as: 'demo-designer@example.edu' };
const stamp = Date.now().toString(36);
const USER = 'demo-designer@example.edu';
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': USER };
const LOCAL_DB = `${process.env.TERMINUS_DB}_ws_${stamp}`;

const NAME = `test-ws-${stamp}`;
const BRANCH = `${handleOf(USER)}_${NAME}`;
const EXISTING = `test-ws-existing-${stamp}`;
const UNFINISHED = `test-ws-unfinished-${stamp}`;
const WORKED = `test-ws-worked-${stamp}`;
const FORBIDDEN = `test-ws-forbidden-${stamp}`;
const REMOTE_BRANCHES = [BRANCH, EXISTING, UNFINISHED, WORKED, FORBIDDEN];
const REVIEWER = 'demo-reviewer@example.edu';
const AGENT = `agent:test/ws-${stamp}`;
let agentId: string;

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
  // An agent registered before the first workspace, so the mirror of main carries it.
  const registered = await json(await on(app, 'POST', '/users', { message: 'A drafting agent for the workspace tests', user: { displayName: 'Workspace agent', externalId: AGENT } }));
  expect(registered.status).toBe(201);
  agentId = registered.body.id;
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
    const client = createClient({ baseUrl: 'http://localhost', user: USER, fetch: (input, init) => workspace.request(input, init) });
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
    const result = await pushWorkspace(config, records(), record, { documents: 2, bytes: 1e9 });
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
    expect((await on(app, 'PUT', `/documents/${theirs}?branch=${BRANCH}`, need('theirs'))).status).toBe(200);
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
  const asReviewer = { 'Content-Type': 'application/json', 'Armature-User': REVIEWER };
  const reviewer = (method: string, path: string, body?: unknown) =>
    workspace.request(`/api/v1${path}`, { method, headers: asReviewer, body: body === undefined ? undefined : JSON.stringify(body) });

  it("warns at creation when the remote would refuse the owner's push, and makes the workspace anyway", async () => {
    await remoteBranch(FORBIDDEN);
    const res = await json(await reviewer('POST', '/workspace', { existing: FORBIDDEN }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ branch: FORBIDDEN, ownerExternalId: REVIEWER, warning: { code: 'forbidden', holders: ['User/demo-designer'] } });
    expect(res.body.warning.message).toMatch(/may not: write to branch/);
  });

  it("the owner writes locally; the push is the remote's 403 before any commit; anyone else is refused here", async () => {
    const id = `LearningNeed/ws-forbidden-${stamp}`;
    expect((await reviewer('PUT', `/documents/${id}?branch=${FORBIDDEN}`, { message: 'Work while asking for a grant', document: { label: 'x', rationale: 'r' } })).status).toBe(200);
    const pushed = await json(await reviewer('POST', `/workspace/${FORBIDDEN}/push`));
    expect(pushed.status).toBe(403);
    expect(pushed.body).toMatchObject({ error: 'forbidden', remote: true, permission: 'write', branch: FORBIDDEN, pushed: [], at: { part: 1, total: 1 } });
    expect((await on(app, 'GET', `/documents/${id}?branch=${FORBIDDEN}`)).status).toBe(404);

    const designerWrites = await json(await on(workspace, 'PUT', `/documents/LearningNeed/ws-not-mine-${stamp}?branch=${FORBIDDEN}`, { message: 'x', document: { label: 'x', rationale: 'r' } }));
    expect(designerWrites.status).toBe(403);
    expect(designerWrites.body).toMatchObject({ error: 'forbidden', permission: 'write', branch: FORBIDDEN, owner: REVIEWER });
    const designerPushes = await json(await on(workspace, 'POST', `/workspace/${FORBIDDEN}/push`));
    expect(designerPushes.status).toBe(403);
    expect(designerPushes.body).toMatchObject({ error: 'forbidden', permission: 'push', owner: REVIEWER });
  });
});
