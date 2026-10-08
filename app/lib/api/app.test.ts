/**
 * In-process tests for the Hono API.
 *
 * Integration tests: they need the TerminusDB container from
 * docker/docker-compose.yml running with the seed loaded (which includes
 * User/demo-designer, externalId demo-designer@example.edu). No HTTP server
 * is started; `app.request()` invokes the app directly.
 *
 * The version-control walkthrough is Phase 2's exit criterion (plan §4):
 * create a branch from a commit, write to it as a named author, read one
 * document at two commits, list its history with diffs, merge, and provoke
 * one conflict, all through /api/v1. It works on scratch branches it creates
 * and deletes, so the seed is untouched. The one write to `main` is the
 * users suite (ADR-0032): users live on main, so registering one writes
 * there; the suite deletes what it registered through the adapter.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app';
import { createStore } from './store';

/** The seed's User and the header value that resolves to it (ADR-0032 decision 1). */
const AUTHOR = 'User/demo-designer';
const AUTHOR_EXTERNAL_ID = 'demo-designer@example.edu';
const stamp = Date.now().toString(36);
const TARGET = `test-target-${stamp}`;
const SOURCE = `test-source-${stamp}`;
const DOC = `LearningNeed/vc-walkthrough-${stamp}`;

const etagOf = (res: Response): string | undefined => res.headers.get('etag')?.replace(/"/g, '');

function write(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Armature-User': AUTHOR_EXTERNAL_ID, ...headers },
    body: JSON.stringify(body),
  });
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Armature-User': AUTHOR_EXTERNAL_ID, ...headers },
    body: JSON.stringify(body),
  });
}

function get(path: string, headers: Record<string, string> = {}) {
  return app.request(path, { headers });
}

describe('GET /api/v1/documents/:type/:id', () => {
  it('returns a seeded module with the commit it was read at as a bare id in ETag', async () => {
    const res = await app.request('/api/v1/documents/Module/how-ai-works');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[a-z0-9]+"$/);
    expect(res.headers.get('terminusdb-data-version')).toBeNull();
    const body = await res.json();
    expect(body['@id']).toBe('Module/how-ai-works');
    expect(body['@type']).toBe('Module');
  });

  it('reads the same document at the commit named by ref=', async () => {
    const first = await app.request('/api/v1/documents/Module/how-ai-works');
    const commit = etagOf(first);
    const res = await app.request(`/api/v1/documents/Module/how-ai-works?ref=${commit}`);
    expect(res.status).toBe(200);
    expect(etagOf(res)).toBe(commit);
  });

  it('returns 404 for an id that does not exist', async () => {
    const res = await app.request('/api/v1/documents/Module/does-not-exist');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('returns 404 when the id exists under another type', async () => {
    const res = await app.request('/api/v1/documents/Course/how-ai-works');
    expect(res.status).toBe(404);
  });

  it('returns 404 for a type the schema does not have', async () => {
    const res = await app.request('/api/v1/documents/Widget/x');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('unknown_type');
  });

  it('rejects branch= and ref= together', async () => {
    const res = await app.request('/api/v1/documents/Module/how-ai-works?branch=main&ref=abc');
    expect(res.status).toBe(400);
  });

  it('returns 404 for a commit id that does not exist', async () => {
    const res = await app.request('/api/v1/documents/Module/how-ai-works?ref=nosuchcommit000');
    expect(res.status).toBe(404);
  });
});

describe('version-control walkthrough (Phase 2 exit criterion)', () => {
  let forkCommit: string;
  let firstWrite: string;
  let secondWrite: string;

  beforeAll(async () => {
    const res = await post('/api/v1/branches', { name: TARGET, from: { branch: 'main' } });
    expect(res.status).toBe(201);
    const body = await res.json();
    forkCommit = body.head.commit;
    expect(forkCommit).toMatch(/^[a-z0-9]+$/);
  });

  afterAll(async () => {
    const store = createStore({ branch: 'main' });
    for (const name of [SOURCE, TARGET]) {
      await store.deleteBranch(name).catch(() => undefined);
    }
  });

  it('creates a branch from a commit and it starts at that commit', async () => {
    const res = await post('/api/v1/branches', { name: SOURCE, from: { commit: forkCommit } });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.head.commit).toBe(forkCommit);
    expect(etagOf(res)).toBe(forkCommit);
  });

  it('refuses to create a branch that already exists', async () => {
    const res = await post('/api/v1/branches', { name: SOURCE, from: { commit: forkCommit } });
    expect(res.status).toBe(409);
  });

  it('lists branches with their heads', async () => {
    const res = await app.request('/api/v1/branches');
    expect(res.status).toBe(200);
    const names = (await res.json()).map((b: { name: string }) => b.name);
    expect(names).toContain('main');
    expect(names).toContain(SOURCE);
  });

  it('rejects a write without an identity', async () => {
    const res = await app.request(`/api/v1/documents/${DOC}?branch=${SOURCE}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'no author', document: { label: 'x', rationale: 'y' } }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('identity_required');
  });

  it('rejects a write whose identity is not a registered User', async () => {
    const res = await write(
      `/api/v1/documents/${DOC}?branch=${SOURCE}`,
      { message: 'bad author', document: { label: 'x', rationale: 'y' } },
      { 'Armature-User': `nobody-${stamp}@example.edu` }
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('unknown_user');
  });

  it('rejects a write without a message', async () => {
    const res = await write(`/api/v1/documents/${DOC}?branch=${SOURCE}`, {
      document: { label: 'x', rationale: 'y' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('message_required');
  });

  it('rejects a write at a commit', async () => {
    const res = await write(`/api/v1/documents/${DOC}?ref=${forkCommit}`, {
      message: 'nope',
      document: { label: 'x', rationale: 'y' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('write_at_commit');
  });

  it('writes to the branch as the resolved author and returns the commit', async () => {
    const res = await write(`/api/v1/documents/${DOC}?branch=${SOURCE}`, {
      message: 'Capture the walkthrough need',
      document: { label: 'Walkthrough need', rationale: 'Phase 2 exit criterion', createdBy: 'User/ignored' },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    firstWrite = body.commit;
    expect(etagOf(res)).toBe(firstWrite);
    expect(firstWrite).not.toBe(forkCommit);

    const head = await app.request(`/api/v1/branches/${SOURCE}`);
    const headBody = await head.json();
    expect(headBody.head.commit).toBe(firstWrite);
    expect(headBody.head.author).toBe(AUTHOR);
    expect(headBody.head.message).toBe('Capture the walkthrough need');

    // createdBy is the resolved User, not the body's value (ADR-0032 decision 4)
    const written = await (await get(`/api/v1/documents/${DOC}?branch=${SOURCE}`)).json();
    expect(written.createdBy).toBe(AUTHOR);
  });

  it('honours If-Match and rejects a stale one with 412', async () => {
    const ok = await write(
      `/api/v1/documents/${DOC}?branch=${SOURCE}`,
      { message: 'Refine the rationale', document: { label: 'Walkthrough need', rationale: 'Refined', createdBy: 'User/other' } },
      { 'If-Match': `"${firstWrite}"` }
    );
    expect(ok.status).toBe(200);
    secondWrite = (await ok.json()).commit;

    // a replace keeps the stored createdBy (ADR-0032 decision 4)
    const replaced = await (await get(`/api/v1/documents/${DOC}?branch=${SOURCE}`)).json();
    expect(replaced.createdBy).toBe(AUTHOR);

    const stale = await write(
      `/api/v1/documents/${DOC}?branch=${SOURCE}`,
      { message: 'Stale write', document: { label: 'Walkthrough need', rationale: 'Stale' } },
      { 'If-Match': `"${firstWrite}"` }
    );
    expect(stale.status).toBe(412);
    const body = await stale.json();
    expect(body.error).toBe('precondition_failed');
    expect(body.current).toBe(secondWrite);
  });

  it('reads the same document at two commits', async () => {
    const atFirst = await app.request(`/api/v1/documents/${DOC}?ref=${firstWrite}`);
    expect(atFirst.status).toBe(200);
    expect((await atFirst.json()).rationale).toBe('Phase 2 exit criterion');
    expect(etagOf(atFirst)).toBe(firstWrite);

    const atSecond = await app.request(`/api/v1/documents/${DOC}?ref=${secondWrite}`);
    expect((await atSecond.json()).rationale).toBe('Refined');

    const onMain = await app.request(`/api/v1/documents/${DOC}`);
    expect(onMain.status).toBe(404);
  });

  it('lists the history with diffs, newest first', async () => {
    const res = await app.request(`/api/v1/documents/${DOC}/history?branch=${SOURCE}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.map((e: { commit: string }) => e.commit)).toEqual([secondWrite, firstWrite]);
    expect(body.entries[0].author).toBe(AUTHOR);
    expect(body.entries[0].diff.rationale['@op']).toBe('SwapValue');
    expect(body.entries[0].diff.rationale['@after']).toBe('Refined');
    expect(body.entries[1].diff['@op']).toBe('Insert');
  });

  it('diffs the document between two commits', async () => {
    const res = await app.request(`/api/v1/documents/${DOC}/diff?from=${firstWrite}&to=${secondWrite}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.diff.rationale['@before']).toBe('Phase 2 exit criterion');
    expect(body.diff.rationale['@after']).toBe('Refined');
  });

  it('merges the branch cleanly and records author and reason on the merge commit', async () => {
    const res = await post(`/api/v1/branches/${TARGET}/merge`, { message: 'Merge the walkthrough', from: SOURCE });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.base).toBe(forkCommit);
    expect(body.source).toBe(secondWrite);
    expect(body.upToDate).toBe(false);
    expect(etagOf(res)).toBe(body.commit);

    const head = await (await app.request(`/api/v1/branches/${TARGET}`)).json();
    expect(head.head.commit).toBe(body.commit);
    expect(head.head.author).toBe(AUTHOR);
    expect(head.head.message).toBe('Merge the walkthrough');
    expect(head.head.metadata).toEqual({ armature: { mergeSource: secondWrite } });

    const merged = await app.request(`/api/v1/documents/${DOC}?branch=${TARGET}`);
    expect(merged.status).toBe(200);
    expect((await merged.json()).rationale).toBe('Refined');
  });

  it('reports a merge with nothing new as up to date', async () => {
    const res = await post(`/api/v1/branches/${TARGET}/merge`, { message: 'Again', from: SOURCE });
    expect(res.status).toBe(200);
    expect((await res.json()).upToDate).toBe(true);
  });

  it('lists the changes on a branch since a commit', async () => {
    const res = await app.request(`/api/v1/branches/${TARGET}/changes?since=${forkCommit}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.from).toBe(forkCommit);
    expect(body.changes).toEqual([{ id: DOC, op: 'insert' }]);
  });

  it('provokes a conflict and reports base, target and source values', async () => {
    const onTarget = await write(`/api/v1/documents/${DOC}?branch=${TARGET}`, {
      message: 'Target edits the rationale',
      document: { label: 'Walkthrough need', rationale: 'Target version' },
    });
    expect(onTarget.status).toBe(200);
    const onSource = await write(`/api/v1/documents/${DOC}?branch=${SOURCE}`, {
      message: 'Source edits the rationale',
      document: { label: 'Walkthrough need', rationale: 'Source version' },
    });
    expect(onSource.status).toBe(200);

    const res = await post(`/api/v1/branches/${TARGET}/merge`, { message: 'Merge again', from: SOURCE });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('merge_conflict');
    expect(body.conflicts).toEqual([
      { id: DOC, field: 'rationale', base: 'Refined', target: 'Target version', source: 'Source version' },
    ]);

    const head = await (await app.request(`/api/v1/branches/${TARGET}`)).json();
    expect(head.head.message).toBe('Target edits the rationale');
  });

  it('refuses to write User documents through the provisional route', async () => {
    const res = await write(`/api/v1/documents/User/minted-${stamp}?branch=${TARGET}`, {
      message: 'Mint an author',
      document: { displayName: 'Minted', externalId: 'minted' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_type');
  });

  it('rejects a write whose body names another type', async () => {
    const res = await write(`/api/v1/documents/${DOC}?branch=${TARGET}`, {
      message: 'Clobber',
      document: { '@type': 'Course', label: 'x' },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('type_mismatch');
  });
});

describe('users and identity resolution (ADR-0032)', () => {
  const REVIEWER_ID = `User/test-reviewer-${stamp}`;
  const REVIEWER_EXTERNAL_ID = `reviewer-${stamp}@example.edu`;
  const AGENT_EXTERNAL_ID = `agent:test/drafter-${stamp}`;
  const EARLY = `test-early-${stamp}`; // forked before the reviewer exists
  const LATE = `test-late-${stamp}`; // forked after
  const NEED = `LearningNeed/carried-${stamp}`;
  const asReviewer = { 'Armature-User': REVIEWER_EXTERNAL_ID };
  let agentId: string;

  beforeAll(async () => {
    const res = await post('/api/v1/branches', { name: EARLY, from: { branch: 'main' } });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    const main = createStore({ branch: 'main' });
    for (const name of [EARLY, LATE]) await main.deleteBranch(name).catch(() => undefined);
    for (const id of [REVIEWER_ID, agentId]) {
      if (id) await main.deleteDocument(id, { author: AUTHOR, message: `Test cleanup: remove ${id}` }).catch(() => undefined);
    }
  });

  it('lists the seeded users at main with an ETag', async () => {
    const res = await get('/api/v1/users');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[a-z0-9]+"$/);
    const ids = (await res.json()).map((u: { '@id': string }) => u['@id']);
    expect(ids).toContain(AUTHOR);
  });

  it('answers /users/me with the resolved User, or 401', async () => {
    const me = await get('/api/v1/users/me', { 'Armature-User': AUTHOR_EXTERNAL_ID });
    expect(me.status).toBe(200);
    expect((await me.json())['@id']).toBe(AUTHOR);

    const anonymous = await get('/api/v1/users/me');
    expect(anonymous.status).toBe(401);
    expect((await anonymous.json()).error).toBe('identity_required');

    const unknown = await get('/api/v1/users/me', asReviewer);
    expect(unknown.status).toBe(401);
    expect((await unknown.json()).error).toBe('unknown_user');
  });

  it('refuses to register a User anywhere but main', async () => {
    const res = await post(`/api/v1/users?branch=${EARLY}`, {
      message: 'Register on a branch',
      user: { displayName: 'Nope', externalId: REVIEWER_EXTERNAL_ID },
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('users_live_on_main');
  });

  it('validates the user envelope', async () => {
    const missing = await post('/api/v1/users', { message: 'No externalId', user: { displayName: 'Nope' } });
    expect(missing.status).toBe(400);
    const extra = await post('/api/v1/users', {
      message: 'Unknown field',
      user: { displayName: 'Nope', externalId: 'x', role: 'reviewer' },
    });
    expect(extra.status).toBe(400);
    expect((await extra.json()).error).toBe('unknown_field');
    const badId = await post('/api/v1/users', {
      message: 'Bad id',
      user: { '@id': 'Reviewer/x', displayName: 'Nope', externalId: 'x' },
    });
    expect(badId.status).toBe(400);
    expect((await badId.json()).error).toBe('bad_id');
  });

  it('registers a User on main under a client-supplied id, authored by the caller', async () => {
    const res = await post('/api/v1/users', {
      message: 'Register the test reviewer',
      user: { '@id': REVIEWER_ID, displayName: 'Test Reviewer', externalId: REVIEWER_EXTERNAL_ID, institution: 'Test U' },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe(REVIEWER_ID);
    expect(etagOf(res)).toBe(body.commit);

    const head = await (await get('/api/v1/branches/main')).json();
    expect(head.head.commit).toBe(body.commit);
    expect(head.head.author).toBe(AUTHOR);

    const me = await get('/api/v1/users/me', asReviewer);
    expect(me.status).toBe(200);
    expect((await me.json()).displayName).toBe('Test Reviewer');
  });

  it('refuses a second User for the same externalId', async () => {
    const res = await post('/api/v1/users', {
      message: 'Register again',
      user: { displayName: 'Duplicate', externalId: REVIEWER_EXTERNAL_ID },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('user_exists');
    expect(body.id).toBe(REVIEWER_ID);
  });

  it('registers an agent as an ordinary User with a hub-minted id', async () => {
    const res = await post('/api/v1/users', {
      message: 'Register the drafting agent',
      user: { displayName: 'Test Drafter', externalId: AGENT_EXTERNAL_ID },
    });
    expect(res.status).toBe(201);
    agentId = (await res.json()).id;
    expect(agentId).toMatch(/^User\/[0-9a-f-]{36}$/);

    const listed = (await (await get('/api/v1/users')).json()).map((u: { '@id': string }) => u['@id']);
    expect(listed).toContain(agentId);
    expect(listed).toContain(REVIEWER_ID);
  });

  it('carries the User onto a branch forked before it existed, in the same commit as the write', async () => {
    const before = await get(`/api/v1/documents/User/test-reviewer-${stamp}?branch=${EARLY}`);
    expect(before.status).toBe(404);

    const res = await write(
      `/api/v1/documents/${NEED}?branch=${EARLY}`,
      { message: 'First write by the reviewer', document: { label: 'Carried need', rationale: 'ADR-0032 decision 5' } },
      asReviewer
    );
    expect(res.status).toBe(200);
    const { commit } = await res.json();

    const need = await (await get(`/api/v1/documents/${NEED}?branch=${EARLY}`)).json();
    expect(need.createdBy).toBe(REVIEWER_ID);
    const carried = await get(`/api/v1/documents/User/test-reviewer-${stamp}?branch=${EARLY}`);
    expect(carried.status).toBe(200);
    expect(etagOf(carried)).toBe(commit);

    const head = await (await get(`/api/v1/branches/${EARLY}`)).json();
    expect(head.head.commit).toBe(commit);
    expect(head.head.author).toBe(REVIEWER_ID);
  });

  it('merges the carried copy into a branch that already holds the User without conflict', async () => {
    const created = await post('/api/v1/branches', { name: LATE, from: { branch: 'main' } });
    expect(created.status).toBe(201);

    const res = await post(`/api/v1/branches/${LATE}/merge`, { message: 'Merge the carried write', from: EARLY }, asReviewer);
    expect(res.status).toBe(200);
    expect((await res.json()).upToDate).toBe(false);

    const need = await (await get(`/api/v1/documents/${NEED}?branch=${LATE}`)).json();
    expect(need.createdBy).toBe(REVIEWER_ID);
    const user = await (await get(`/api/v1/documents/User/test-reviewer-${stamp}?branch=${LATE}`)).json();
    expect(user.displayName).toBe('Test Reviewer');
  });

  it('reports a same-id, different-content insert on both sides as an InsertConflict', async () => {
    const doc = `LearningNeed/twice-${stamp}`;
    const onLate = await write(`/api/v1/documents/${doc}?branch=${LATE}`, {
      message: 'Insert on late',
      document: { label: 'Late version', rationale: 'x' },
    });
    expect(onLate.status).toBe(200);
    const onEarly = await write(`/api/v1/documents/${doc}?branch=${EARLY}`, {
      message: 'Insert on early',
      document: { label: 'Early version', rationale: 'x' },
    });
    expect(onEarly.status).toBe(200);

    const res = await post(`/api/v1/branches/${LATE}/merge`, { message: 'Merge twice-inserted', from: EARLY });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('merge_conflict');
    expect(body.conflicts).toEqual([{ id: doc, op: 'InsertConflict' }]);
  });
});
