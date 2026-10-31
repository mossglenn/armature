/**
 * Reads and writes at one commit (the deep review's B1 and B2). Each test
 * lands a real commit on the branch between two of the request's own store
 * calls, by wrapping an adapter method, and asserts that the answer belongs
 * entirely to one commit: a multi-read request is served at the head it
 * resolved first, and a write checks its rules on the state it lands on.
 * Integration tests like write.test.ts, on a scratch branch.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from './app';
import { createStore, TerminusStore, type TerminusDocument } from './store';
import { WRITE_ATTEMPTS } from './write';

const AUTHOR = 'User/demo-designer';
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const stamp = Date.now().toString(36);
const BRANCH = `test-race-${stamp}`;
const q = `?branch=${BRANCH}`;
const OBJECTIVE = 'LearningObjective/identify-ai-limitations';
const MODULE = 'Module/how-ai-works';

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: 'POST', headers: { ...HEADERS, ...headers }, body: JSON.stringify(body) });
const json = async (path: string) => (await app.request(path)).json();
const etagOf = (res: Response) => res.headers.get('ETag')?.replace(/"/g, '');
const headOf = async () => (await createStore({ branch: BRANCH }).head())?.id;

// The adapter's own methods, kept before any test wraps them, so a
// concurrent commit goes straight to the store and is not itself intercepted.
const real = {
  putDocuments: TerminusStore.prototype.putDocuments,
  allDocuments: TerminusStore.prototype.allDocuments,
  history: TerminusStore.prototype.history,
  queryDocuments: TerminusStore.prototype.queryDocuments,
};

/** Another writer's commit, landing on the branch now. */
let concurrent = 0;
async function concurrentWrite(documents: Array<Record<string, unknown>> = []): Promise<string> {
  concurrent++;
  const note = { '@type': 'LearningNeed', '@id': `LearningNeed/race-${stamp}-${concurrent}`, label: `Concurrent ${concurrent}`, rationale: 'r' };
  const { commit } = await real.putDocuments.call(createStore({ branch: BRANCH }) as TerminusStore, [note, ...documents], {
    author: AUTHOR,
    message: `A concurrent write (${concurrent})`,
  });
  return commit;
}

/** True when a putDocuments call carries the document with this id (the test's own write, not a concurrent one). */
const carries = (documents: Array<Record<string, unknown>>, id: string) => documents.some((d) => d['@id'] === id);

beforeAll(async () => {
  const res = await post('/api/v1/branches', { name: BRANCH, from: { branch: 'main' } });
  expect(res.status).toBe(201);
  const scaffold = await post(`/api/v1/documents${q}`, {
    message: 'Activities to sequence',
    documents: [
      { '@type': 'LearningActivity', '@id': `LearningActivity/race-a-${stamp}`, label: 'Race A', targets: [OBJECTIVE] },
      { '@type': 'LearningActivity', '@id': `LearningActivity/race-b-${stamp}`, label: 'Race B', targets: [OBJECTIVE] },
    ],
  });
  expect(scaffold.status).toBe(200);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await createStore({ branch: 'main' }).deleteBranch(BRANCH).catch(() => undefined);
});

describe('a write checks its rules on the state it lands on (B2)', () => {
  it('runs again on the new head when another write lands first, and the rule sees that write', async () => {
    // Both writers place an activity at sequence 21; before B2 both landed.
    const mine = `LearningActivity/race-a-${stamp}`;
    const theirs = `LearningActivity/race-b-${stamp}`;
    const put = vi.spyOn(TerminusStore.prototype, 'putDocuments').mockImplementation(async function (this: TerminusStore, documents, opts) {
      if (put.mock.calls.length === 1) {
        await concurrentWrite([{ '@type': 'ModuleActivityLink', module: MODULE, activity: theirs, sequence: 21 }]);
      }
      return real.putDocuments.call(this, documents, opts);
    });
    const res = await post(`/api/v1/documents${q}`, {
      message: 'Place activity A',
      documents: [{ '@type': 'ModuleActivityLink', module: MODULE, activity: mine, sequence: 21 }],
    });
    expect(res.status).toBe(422);
    expect((await res.json()).violations.map((v: { code: string }) => v.code)).toEqual(['duplicate_sequence']);
    // The first run reached the store and lost; the second was refused by the rule.
    expect(put).toHaveBeenCalledTimes(1);
    const placed = await json(`/api/v1/documents/ModuleActivityLink${q}&module=${MODULE}`);
    expect(placed.filter((l: TerminusDocument) => l.sequence === 21).map((l: TerminusDocument) => l.activity)).toEqual([theirs]);
  });

  it('fills asOf with the head of the run that lands, not of the run that lost', async () => {
    const id = `DesignFinding/race-${stamp}`;
    let theirs: string | undefined;
    const put = vi.spyOn(TerminusStore.prototype, 'putDocuments').mockImplementation(async function (this: TerminusStore, documents, opts) {
      if (put.mock.calls.length === 1) theirs = await concurrentWrite();
      return real.putDocuments.call(this, documents, opts);
    });
    const res = await post(`/api/v1/documents${q}`, {
      message: 'Raise a finding',
      documents: [{ '@type': 'DesignFinding', '@id': id, label: 'Race', finding: 'f', subject: [OBJECTIVE], status: 'Open' }],
    });
    expect(res.status).toBe(200);
    expect(put).toHaveBeenCalledTimes(2);
    expect(theirs).toBeDefined();
    expect((await json(`/api/v1/documents/${id}${q}`)).asOf).toBe(theirs);
  });

  it(`answers 409 branch_moved when the branch moves under each of ${WRITE_ATTEMPTS} runs, and writes nothing`, async () => {
    const id = `LearningNeed/race-moved-${stamp}`;
    const put = vi.spyOn(TerminusStore.prototype, 'putDocuments').mockImplementation(async function (this: TerminusStore, documents, opts) {
      await concurrentWrite();
      return real.putDocuments.call(this, documents, opts);
    });
    const res = await post(`/api/v1/documents${q}`, {
      message: 'Never lands',
      documents: [{ '@type': 'LearningNeed', '@id': id, label: 'Never', rationale: 'r' }],
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('branch_moved');
    expect(put.mock.calls.filter(([documents]) => carries(documents, id))).toHaveLength(WRITE_ATTEMPTS);
    expect((await app.request(`/api/v1/documents/${id}${q}`)).status).toBe(404);
  });

  it('answers a stale If-Match with 412 before reading anything', async () => {
    const stale = await headOf();
    await concurrentWrite();
    const now = await headOf();
    const query = vi.spyOn(TerminusStore.prototype, 'queryDocuments');
    const get = vi.spyOn(TerminusStore.prototype, 'getDocument');
    const res = await post(
      `/api/v1/documents${q}`,
      { message: 'Stale', documents: [{ '@type': 'LearningNeed', '@id': `LearningNeed/race-stale-${stamp}`, label: 'Stale', rationale: 'r' }] },
      { 'If-Match': `"${stale}"` }
    );
    expect(res.status).toBe(412);
    expect(await res.json()).toMatchObject({ error: 'precondition_failed', expected: stale, current: now });
    // Identity resolution reads the registry on main; nothing reads the branch or a commit of it.
    const refs = [...query.mock.contexts, ...get.mock.contexts].map((store) => (store as TerminusStore).ref);
    expect(refs.filter((ref) => !('branch' in ref && ref.branch === 'main'))).toEqual([]);
  });

  it('answers a race lost under If-Match with 412 and does not run again', async () => {
    const id = `LearningNeed/race-ifmatch-${stamp}`;
    const head = await headOf();
    let theirs: string | undefined;
    const put = vi.spyOn(TerminusStore.prototype, 'putDocuments').mockImplementation(async function (this: TerminusStore, documents, opts) {
      theirs = await concurrentWrite();
      return real.putDocuments.call(this, documents, opts);
    });
    const res = await post(
      `/api/v1/documents${q}`,
      { message: 'Conditioned', documents: [{ '@type': 'LearningNeed', '@id': id, label: 'Conditioned', rationale: 'r' }] },
      { 'If-Match': `"${head}"` }
    );
    expect(res.status).toBe(412);
    expect(await res.json()).toMatchObject({ error: 'precondition_failed', expected: head, current: theirs });
    expect(put).toHaveBeenCalledTimes(1);
  });
});

describe('a request that reads more than once is answered at one commit (B1)', () => {
  it('serves an intelligence read at the head it resolved, though the branch moves mid-request', async () => {
    const before = await headOf();
    // A content link lands after the read has listed the module's links once.
    let moved = false;
    vi.spyOn(TerminusStore.prototype, 'queryDocuments').mockImplementation(async function (this: TerminusStore, ...args) {
      if (!moved) {
        moved = true;
        await concurrentWrite([{ '@type': 'ModuleLessonLink', module: MODULE, lesson: `Lesson/race-${stamp}`, sequence: 31 }, { '@type': 'Lesson', '@id': `Lesson/race-${stamp}`, label: 'Race lesson' }]);
      }
      return real.queryDocuments.apply(this, args);
    });
    const res = await app.request(`/api/v1/intelligence/module-content/how-ai-works${q}`);
    expect(res.status).toBe(200);
    expect(etagOf(res)).toBe(before);
    vi.restoreAllMocks();
    const answered = await res.json();
    expect(answered).toEqual(await json(`/api/v1/intelligence/module-content/how-ai-works?ref=${before}`));
    expect(JSON.stringify(answered)).not.toContain(`Lesson/race-${stamp}`);
    expect(JSON.stringify(await json(`/api/v1/intelligence/module-content/how-ai-works${q}`))).toContain(`Lesson/race-${stamp}`);
  });

  it('exports the commit it resolved first, though the branch moves before the documents are read', async () => {
    const before = await headOf();
    let added: string | undefined;
    vi.spyOn(TerminusStore.prototype, 'allDocuments').mockImplementation(async function (this: TerminusStore) {
      if (!added) {
        await concurrentWrite();
        added = `LearningNeed/race-${stamp}-${concurrent}`;
      }
      return real.allDocuments.call(this);
    });
    const res = await app.request(`/api/v1/export${q}`);
    expect(res.status).toBe(200);
    expect(etagOf(res)).toBe(before);
    const body = await res.json();
    expect(body.armature.ref).toBe(before);
    expect(body.documents.map((d: TerminusDocument) => d['@id'])).not.toContain(added);
  });

  it('serves a history only when the head stood still around it, reading again when it moved', async () => {
    const doc = `LearningActivity/race-a-${stamp}`;
    let theirs: string | undefined;
    const history = vi.spyOn(TerminusStore.prototype, 'history').mockImplementation(async function (this: TerminusStore, ...args) {
      if (history.mock.calls.length === 1) theirs = await concurrentWrite();
      return real.history.apply(this, args);
    });
    const res = await app.request(`/api/v1/documents/${doc}/history${q}`);
    expect(res.status).toBe(200);
    expect(history).toHaveBeenCalledTimes(2);
    expect(etagOf(res)).toBe(theirs);
  });

  it('answers 503 branch_busy with Retry-After when the head moves around every history read', async () => {
    const history = vi.spyOn(TerminusStore.prototype, 'history').mockImplementation(async function (this: TerminusStore, ...args) {
      const answer = await real.history.apply(this, args);
      await concurrentWrite();
      return answer;
    });
    const res = await app.request(`/api/v1/documents/LearningActivity/race-b-${stamp}/history${q}`);
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('1');
    expect((await res.json()).error).toBe('branch_busy');
    expect(history).toHaveBeenCalledTimes(3);
  });
});
