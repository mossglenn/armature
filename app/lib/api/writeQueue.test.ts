/**
 * Writes in flight together (ADR-0025 decision 7, note of 2026-11-06; check
 * AO). The store compares a data version ahead of what orders its commits, so
 * writers sent at once at one head all land, each told 200. These are the
 * probes that found it, kept: real requests sent together, nothing mocked,
 * each asserting what one-at-a-time writers would have seen. race.test.ts
 * lands a commit between two of a request's own store calls instead, which is
 * a second writer the queue does not cover. Over a scratch branch.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { app } from './app';
import { grantsAt } from './grants';
import { createStore, TerminusStore, type TerminusDocument } from './store';

import { deleteDocument, deleteScratchBranch } from '../operator/repair';

const AS_OPERATOR = { as: 'demo-designer@example.edu' };
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const stamp = Date.now().toString(36);
const BRANCH = `test-queue-${stamp}`;
const q = `?branch=${BRANCH}`;
const OBJECTIVE = 'LearningObjective/identify-ai-limitations';
const MODULE = 'Module/how-ai-works';
const WRITERS = [0, 1, 2, 3];
const ROUNDS = 5;
const scratch = new Set([BRANCH]);

const send = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> =>
  app.request(path, { method, headers: { ...HEADERS, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const post = (path: string, body: unknown, headers?: Record<string, string>) => send('POST', path, body, headers);
const put = (path: string, body: unknown, headers?: Record<string, string>) => send('PUT', path, body, headers);
const need = (label: string) => ({ '@type': 'LearningNeed', '@id': `LearningNeed/${label}`, label, rationale: 'r' });
const pin = (commit: string | undefined) => ({ 'If-Match': `"${commit}"` });
const headOf = async (branch = BRANCH) => (await createStore({ branch }).head())?.id;
const commitsOn = async (branch = BRANCH) => (await createStore({ branch }).log({ count: 100 })).map((c) => c.id);
const statuses = (answers: Response[]) => answers.map((a) => a.status).sort();
const ofStatus = (status: number) => [status, ...WRITERS.slice(1).map(() => 412)].sort();

const fork = async (label: string): Promise<string> => {
  const name = `test-queue-${label}-${stamp}`;
  scratch.add(name);
  expect((await post('/api/v1/branches', { name, from: { branch: 'main' } })).status).toBe(201);
  return name;
};

beforeAll(async () => {
  expect((await post('/api/v1/branches', { name: BRANCH, from: { branch: 'main' } })).status).toBe(201);
  const scaffold = await post(`/api/v1/documents${q}`, {
    message: 'Something to replace, and activities to sequence',
    documents: [
      need(`queue-${stamp}`),
      { '@type': 'LearningActivity', '@id': `LearningActivity/queue-a-${stamp}`, label: 'Queue A', targets: [OBJECTIVE] },
      { '@type': 'LearningActivity', '@id': `LearningActivity/queue-b-${stamp}`, label: 'Queue B', targets: [OBJECTIVE] },
    ],
  });
  expect(scaffold.status).toBe(200);
});

afterAll(async () => {
  for (const name of scratch) await deleteScratchBranch(name, AS_OPERATOR).catch(() => undefined);
});

describe('If-Match holds for writes in flight together', () => {
  const id = `queue-${stamp}`;

  it('lands one of several replaces of a document at one head, the rest 412', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const head = await headOf();
      const answers = await Promise.all(
        WRITERS.map((i) =>
          put(`/api/v1/documents/LearningNeed/${id}${q}`, { message: `Writer ${i}`, document: { ...need(id), label: `r${round} w${i}` } }, pin(head))
        )
      );
      expect(statuses(answers)).toEqual(ofStatus(200));
      const log = await commitsOn();
      expect(log[1]).toBe(head); // one commit landed on the head they named
      const winner = WRITERS[answers.findIndex((a) => a.status === 200)];
      const { document } = await createStore({ branch: BRANCH }).getDocument(`LearningNeed/${id}`);
      expect(document.label).toBe(`r${round} w${winner}`);
    }
  });

  it('lands one of several writes of different documents at one head', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const head = await headOf();
      const answers = await Promise.all(
        WRITERS.map((i) => post(`/api/v1/documents${q}`, { message: `Writer ${i}`, documents: [need(`queue-${stamp}-${round}-${i}`)] }, pin(head)))
      );
      expect(statuses(answers)).toEqual(ofStatus(200));
    }
  });

  it('tells each loser the head that beat it', async () => {
    const head = await headOf();
    const answers = await Promise.all(
      WRITERS.map((i) => put(`/api/v1/documents/LearningNeed/${id}${q}`, { message: `Writer ${i}`, document: { ...need(id), label: `told ${i}` } }, pin(head)))
    );
    const won = answers.find((a) => a.status === 200);
    const commit = won?.headers.get('ETag')?.replace(/"/g, '');
    for (const lost of answers.filter((a) => a.status === 412)) {
      expect(await lost.json()).toMatchObject({ error: 'precondition_failed', expected: head, current: commit });
    }
  });
});

describe('writers without If-Match', () => {
  it('all land, one commit each', async () => {
    const before = await headOf();
    const answers = await Promise.all(WRITERS.map((i) => post(`/api/v1/documents${q}`, { message: `Writer ${i}`, documents: [need(`queue-${stamp}-free-${i}`)] })));
    expect(answers.map((a) => a.status)).toEqual(WRITERS.map(() => 200));
    expect((await commitsOn())[WRITERS.length]).toBe(before);
  });

  it('meet the rules on the write ahead of them: one placement of a sequence, the other 422', async () => {
    const place = (activity: string) =>
      post(`/api/v1/documents${q}`, {
        message: `Place ${activity}`,
        documents: [{ '@type': 'ModuleActivityLink', module: MODULE, activity: `LearningActivity/${activity}-${stamp}`, sequence: 31 }],
      });
    const answers = await Promise.all([place('queue-a'), place('queue-b')]);
    expect(statuses(answers)).toEqual([200, 422]);
    const refused = answers.find((a) => a.status === 422);
    expect((await refused?.json()).violations.map((v: { code: string }) => v.code)).toEqual(['duplicate_sequence']);
  });
});

describe('a write that waited its turn', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Sends `writes` while the queue is held, and lets them go once each has joined it, so every one arrived before any landed. */
  const whileHeld = async (writes: Array<() => Promise<Response>>): Promise<Response[]> => {
    const joined = vi.spyOn(TerminusStore.prototype, 'exclusive');
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    const holder = createStore({ branch: BRANCH }).exclusive(() => held);
    const answers = writes.map((write) => write());
    await vi.waitFor(() => expect(joined.mock.calls.length).toBe(writes.length + 1));
    release();
    await holder;
    return Promise.all(answers);
  };
  const replace = (id: string, label: string) => () => put(`/api/v1/documents/LearningNeed/${id}${q}`, { message: label, document: { ...need(id), label } });

  it('refuses rather than overwrites a document changed since it arrived (409 document_moved)', async () => {
    const id = `queue-${stamp}`;
    // Either may reach the queue first: each reads the head before it joins.
    const answers = await whileHeld([replace(id, 'first'), replace(id, 'second')]);
    expect(statuses(answers)).toEqual([200, 409]);
    const refused = answers.find((a) => a.status === 409);
    expect(await refused?.json()).toMatchObject({ error: 'document_moved', documents: [`LearningNeed/${id}`] });
    const { document } = await createStore({ branch: BRANCH }).getDocument(`LearningNeed/${id}`);
    expect(document.label).toBe(answers[0].status === 200 ? 'first' : 'second');
  });

  it('lands when what changed is another document', async () => {
    const other = `queue-other-${stamp}`;
    expect((await post(`/api/v1/documents${q}`, { message: 'Another to replace', documents: [need(other)] })).status).toBe(200);
    const answers = await whileHeld([replace(`queue-${stamp}`, 'one'), replace(other, 'two')]);
    expect(answers.map((a) => a.status)).toEqual([200, 200]);
  });
});

describe('the other writes to a branch join the queue', () => {
  it('a merge and a write pinned to one head: one lands', async () => {
    const source = await fork('merge-source');
    const target = await fork('merge-target');
    expect((await post(`/api/v1/documents?branch=${source}`, { message: 'To merge', documents: [need(`queue-merge-${stamp}`)] })).status).toBe(200);
    const head = await headOf(target);
    const [merged, written] = await Promise.all([
      post(`/api/v1/branches/${target}/merge`, { message: 'Merge', from: source }, pin(head)),
      post(`/api/v1/documents?branch=${target}`, { message: 'Write', documents: [need(`queue-write-${stamp}`)] }, pin(head)),
    ]);
    expect([merged.status, written.status].filter((s) => s === 200)).toHaveLength(1);
    expect((await commitsOn(target))[1]).toBe(head);
  });

  // Fewer rounds, and more time: when the write lands first the delete walks every
  // branch's log for a holder, which grows with the database's commits, not with this test.
  it('a branch and a write to it: the commit is never lost to the delete', { timeout: 60_000 }, async () => {
    for (let round = 0; round < 3; round++) {
      const name = await fork(`delete-${round}`);
      const [deleted, written] = await Promise.all([
        send('DELETE', `/api/v1/branches/${name}`),
        post(`/api/v1/documents?branch=${name}`, { message: 'Write', documents: [need(`queue-delete-${round}-${stamp}`)] }),
      ]);
      expect([deleted.status, written.status].filter((s) => s === 200)).toHaveLength(1);
    }
  });

  it('two creations of one branch: one is 201, and the winner keeps its Owner grant', async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const name = `test-queue-create-${round}-${stamp}`;
      scratch.add(name);
      const answers = await Promise.all(WRITERS.map(() => post('/api/v1/branches', { name, from: { branch: 'main' } })));
      expect(answers.map((a) => a.status).sort()).toEqual([201, 409, 409, 409]);
      const { grants } = await grantsAt(createStore({ branch: 'main' }));
      expect(grants.filter((g) => g.branch === name).map((g) => g.status)).toEqual(['Active']);
    }
  });

  it('several registrations of one person: one User', async () => {
    const externalId = `queue-${stamp}@example.edu`;
    const answers = await Promise.all(WRITERS.map(() => post('/api/v1/users', { message: 'Register', user: { displayName: 'Queue', externalId } })));
    const { documents } = await createStore({ branch: 'main' }).queryDocuments('User', { externalId });
    for (const user of documents as TerminusDocument[]) {
      await deleteDocument({ branch: 'main', id: user['@id'], as: AS_OPERATOR.as, reason: 'The test is over' });
    }
    expect(answers.map((a) => a.status).sort()).toEqual([201, 409, 409, 409]);
    expect(documents).toHaveLength(1);
  });
});
