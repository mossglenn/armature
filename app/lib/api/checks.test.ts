/**
 * Check runs (architecture decision record ADR-0070 decisions 3 and 4): the
 * run store and its routes on the seeded store. A run is not a write to the
 * graph, so the tests leave no commit but the branch they read a head from
 * and the agent they register, both deleted at the end. Who may write a
 * requirement, and the requirements read over records on `main`, are
 * authorization.test.ts's, over its scratch database.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, createApp } from './app';
import { canonicalJson, CONCLUSIONS, paramsHash, RUNS_KEPT, RunStore } from './checks';
import { configFromEnv } from './config';
import { deleteDocument, deleteScratchBranch } from '../operator/repair';

const stamp = Date.now().toString(36);
const BRANCH = `test-checks-${stamp}`;
const DESIGNER = 'demo-designer@example.edu';
const AGENT = `agent:test/checks-${stamp}`;
const AS_OPERATOR = { as: DESIGNER };
const headers = (user = DESIGNER, extra: Record<string, string> = {}) => ({ 'Content-Type': 'application/json', 'Armature-User': user, ...extra });
const post = (body: unknown, h: Record<string, string> = headers()) => app.request('/api/v1/checks/runs', { method: 'POST', headers: h, body: JSON.stringify(body) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

let head = '';
let agentId = '';

describe('paramsHash (decision 3, check AP2b)', () => {
  it('is the SHA-256 of a canonical form: keys sorted at every depth, no whitespace, numbers as JSON prints them', () => {
    expect(canonicalJson({ b: 1, a: { d: [1.0, 'x', null, true], c: 2 } })).toBe('{"a":{"c":2,"d":[1,"x",null,true]},"b":1}');
    expect(paramsHash({ b: 1, a: 2 })).toBe(paramsHash({ a: 2, b: 1 }));
    expect(paramsHash({ a: 1.0 })).toBe(paramsHash({ a: 1 }));
    expect(paramsHash({ a: 1 })).not.toBe(paramsHash({ a: 2 }));
    expect(paramsHash('a string')).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(paramsHash([])).not.toBe(paramsHash({}));
  });
});

describe('the run store (decision 3)', () => {
  it(`keeps the newest ${RUNS_KEPT} per check and branch, newest first, and lists by commit, branch and check`, () => {
    const runs = new RunStore();
    const at = (i: number) => new Date(Date.UTC(2026, 10, 13, 0, 0, i));
    for (let i = 0; i < RUNS_KEPT + 5; i++) runs.record({ check: 'lint/team', commit: `c${i}`, branch: 'b', conclusion: 'pass' }, 'User/a', at(i));
    runs.record({ check: 'lint/team', commit: 'c0', branch: 'other', conclusion: 'fail' }, 'User/a', at(0));
    runs.record({ check: 'structure/spof', commit: 'c0', branch: 'b', conclusion: 'neutral' }, 'User/a', at(1));
    const onB = runs.list({ branch: 'b', check: 'lint/team' });
    expect(onB).toHaveLength(RUNS_KEPT);
    expect(onB[0].commit).toBe(`c${RUNS_KEPT + 4}`);
    expect(onB.map((r) => r.commit)).not.toContain('c0'); // the oldest five are gone
    expect(runs.list({ commit: 'c0' }).map((r) => [r.check, r.branch])).toEqual([
      ['structure/spof', 'b'],
      ['lint/team', 'other'],
    ]);
    expect(runs.list({ check: 'structure/spof' })).toHaveLength(1);
    expect(runs.list()).toHaveLength(RUNS_KEPT + 2);
  });
});

describe('POST /checks/runs and GET /checks (decisions 3 and 4)', () => {
  beforeAll(async () => {
    const created = await app.request('/api/v1/branches', { method: 'POST', headers: headers(), body: JSON.stringify({ name: BRANCH }) });
    expect(created.status).toBe(201);
    head = ((await created.json()) as { head: { commit: string } }).head.commit;
    const registered = await json(
      await app.request('/api/v1/users', { method: 'POST', headers: headers(), body: JSON.stringify({ message: 'A lint service for the tests', user: { displayName: 'Lint (test)', externalId: AGENT } }) })
    );
    expect(registered.status).toBe(201);
    agentId = registered.body.id;
  });

  afterAll(async () => {
    await deleteScratchBranch(BRANCH, AS_OPERATOR).catch(() => undefined);
    if (agentId) await deleteDocument({ id: agentId, branch: 'main', as: DESIGNER, reason: 'The test is over' }).catch(() => undefined);
  });

  const run = (extra: Record<string, unknown> = {}) => ({ check: `lint/team-${stamp}`, commit: head, branch: BRANCH, conclusion: 'pass', ...extra });

  it('records a verdict about a commit the hub holds, with the caller as reporter, the time and an id, and no commit', async () => {
    const res = await post(run({ summary: '2 required, 5 warnings', counts: { require: 2, warn: 5 }, paramsHash: paramsHash({ severity: 'error' }), detailsUrl: 'https://lint.example.edu/runs/1' }));
    expect(res.status).toBe(201);
    expect(res.headers.get('etag')).toBeNull();
    const body = await res.json();
    expect(body).toMatchObject({ ...run(), summary: '2 required, 5 warnings', counts: { require: 2, warn: 5 }, reporter: 'User/demo-designer' });
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(body.reportedAt)).toBeGreaterThan(Date.now() - 60_000);
    const listed = await json(await app.request(`/api/v1/checks?commit=${head}`, { headers: headers() }));
    expect(listed.status).toBe(200);
    expect(listed.body.map((r: { id: string }) => r.id)).toContain(body.id);
    expect((await json(await app.request(`/api/v1/checks?branch=${BRANCH}&check=lint/team-${stamp}`, { headers: headers() }))).body[0].id).toBe(body.id);
    expect((await json(await app.request(`/api/v1/checks?commit=${head}&check=nobody/${stamp}`, { headers: headers() }))).body).toEqual([]);
  });

  it('refuses a malformed run with every problem at once (400 invalid_run), and a commit or a branch the hub lacks (404)', async () => {
    const bad = await json(await post({ ...run({ conclusion: 'maybe', paramsHash: 'md5:1', counts: { x: -1 }, detailsUrl: 'ftp://x', reporter: 'User/demo-reviewer' }), summary: '' }));
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_run');
    expect(bad.body.issues.map((i: { path: string }) => i.path).sort()).toEqual(['conclusion', 'counts', 'detailsUrl', 'paramsHash', 'reporter', 'summary']);
    expect((await json(await post(run({ commit: 'ffffffffffffffffffffffffffffffff' })))).body.error).toBe('unknown_ref');
    expect((await json(await post(run({ branch: `test-nowhere-${stamp}` })))).body.error).toBe('unknown_ref');
    expect((await json(await post(run({ branch: 'not a branch' })))).body.error).toBe('invalid_run');
    expect((await post(run(), { 'Content-Type': 'application/json' })).status).toBe(401);
  });

  it('the agent under Armature-Agent is the reporter, and an agent as the credential itself may post: a run is not a write to the graph (decision 4)', async () => {
    const acting = await json(await post(run({ check: `lint/acting-${stamp}` }), headers(DESIGNER, { 'Armature-Agent': AGENT })));
    expect(acting.status).toBe(201);
    expect(acting.body.reporter).toBe(agentId);
    const itself = await json(await post(run({ check: `lint/service-${stamp}`, conclusion: 'error' }), headers(AGENT)));
    expect(itself.status).toBe(201);
    expect(itself.body.reporter).toBe(agentId);
    // The same credential still writes nothing to the graph (ADR-0067 decision 10).
    const write = await app.request(`/api/v1/documents/LearningNeed/by-agent-${stamp}?branch=${BRANCH}`, {
      method: 'PUT',
      headers: headers(AGENT),
      body: JSON.stringify({ message: 'x', document: { label: 'x', rationale: 'r' } }),
    });
    expect(write.status).toBe(403);
  });

  it('holds its runs per hub: a second app over the same store starts empty', async () => {
    const other = createApp(configFromEnv);
    const listed = await json(await other.request(`/api/v1/checks?commit=${head}`, { headers: headers() }));
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([]);
  });

  it('is discovered as armature/checks on both roles, with the bound and the conclusions', async () => {
    const discover = (await json(await app.request('/api/v1/discover'))).body;
    expect(discover.capabilities['armature/checks']).toEqual({ fallback: 'reject', runsKept: RUNS_KEPT, conclusions: [...CONCLUSIONS] });
    expect(discover.versions[0]).toBe('2026-11-13');
  });
});
