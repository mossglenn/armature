/**
 * The event feed (architecture decision record ADR-0070 decision 2), on both
 * stores: the derivation over the file-backed store in memory, where the
 * tests make and delete branches as they please, and the route over the
 * seeded store, where a write, a merge and a deletion are the routes' own and
 * a held request returns on the next commit. `requirement.changed` is
 * authorization.test.ts's, over its scratch database, where requirements are
 * written.
 *
 * Across branches the feed's order is advisory (the file-backed store stamps
 * to the millisecond, check AQ), so the tests hold each branch's events to its
 * log's order and the whole to its membership, never to an order across
 * branches.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, createApp } from './app';
import { configFromEnv } from './config';
import { decodeCursor, encodeCursor, EventFeed, EVENT_TYPES, EVENTS_BACKLOG, EVENTS_PAGE, EVENTS_WAIT, eventsSince, isTransientBranch, type Cursor, type FeedEvent } from './events';
import { memoryFiles } from './filestore/files';
import { openFileStore } from './filestore/store';
import { committed, generationNow, nextCommit, waitingCount } from './notifier';
import { deleteScratchBranch } from '../operator/repair';
import { createOperatorStore, type OperatorStore, type StoreConfig } from './store';

const stamp = Date.now().toString(36);
const DESIGNER = 'demo-designer@example.edu';
const AS_OPERATOR = { as: DESIGNER };
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': DESIGNER };
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

describe('the cursor and the transient branches', () => {
  it('a cursor is opaque text that reads back as it was written, and anything else is 400 bad_cursor', () => {
    const cursor: Cursor = { v: 1, hub: 'abcd1234', t: 1763200000.123, heads: { main: 'abc', 'test-x': '' } };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(encodeCursor(cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
    for (const text of ['not a cursor', encodeCursor({ ...cursor, v: 2 } as unknown as Cursor), Buffer.from('{"v":1,"hub":"x","t":0,"heads":{"main":1}}').toString('base64url')]) {
      expect(() => decodeCursor(text)).toThrowError(expect.objectContaining({ code: 'bad_cursor', status: 400 }));
    }
  });

  it("leaves out a merge's check and an operator's repair, and nothing a person could name by accident", () => {
    expect(isTransientBranch('operator-merge-mhzk3a1b-0f9e8d7c')).toBe(true);
    expect(isTransientBranch('operator-mhzk3a1b-0f9e8d7c')).toBe(true);
    for (const name of ['main', 'operator-notes', 'test-operator-merge-mhzk3a1b-0f9e8d7c', 'at.abc123']) expect(isTransientBranch(name)).toBe(false);
  });
});

describe('the notifier', () => {
  it('returns at once when something committed since the generation noted, and holds nothing after', async () => {
    const before = generationNow();
    committed();
    await nextCommit(before, 5_000);
    expect(waitingCount()).toBe(0);
  });

  it('wakes a waiting request on a commit, ends at its time, and lets go when the client leaves', async () => {
    let woken = false;
    const waiting = nextCommit(generationNow(), 5_000).then(() => (woken = true));
    expect(waitingCount()).toBe(1);
    committed();
    await waiting;
    expect(woken).toBe(true);
    const started = Date.now();
    await nextCommit(generationNow(), 30);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
    const gone = new AbortController();
    const left = nextCommit(generationNow(), 5_000, gone.signal);
    gone.abort();
    await left;
    expect(waitingCount()).toBe(0);
  });
});

describe('the feed derived from the logs, on the file-backed store', () => {
  let files: StoreConfig;
  let main: OperatorStore;
  const feed = new EventFeed();
  const on = (branch: string) => createOperatorStore({ branch }, files);
  const need = (name: string) => ({ '@type': 'LearningNeed', '@id': `LearningNeed/${name}`, label: name, rationale: 'For the feed' });
  const write = async (branch: string, name: string) => (await on(branch).insertDocuments([need(name)], { author: 'User/demo-designer', message: `Add ${name}` })).commit;
  const since = (cursor: Cursor | undefined, opts = {}) => eventsSince(main, feed, cursor, opts);
  const of = (events: FeedEvent[], branch: string) => events.filter((event) => event.branch === branch);
  let seeded = '';

  beforeAll(async () => {
    const exported = (await json(await app.request('/api/v1/export'))).body as { schema: Record<string, unknown>[] };
    files = { files: openFileStore(memoryFiles()) };
    main = on('main');
    await main.ensureDatabase();
    await main.replaceSchema(exported.schema, { author: 'User/demo-designer', message: 'The seed schema, for the feed' });
    seeded = await write('main', 'first');
  });

  it('with no cursor tells nothing and gives a cursor at the present', async () => {
    const { events, cursor } = await since(undefined);
    expect(events).toEqual([]);
    expect(cursor).toMatchObject({ v: 1, hub: feed.id, heads: { main: seeded } });
    // Nothing has changed since: the same cursor comes back.
    expect(await since(cursor)).toEqual({ events: [], cursor });
  });

  it("tells a branch's commits in its log's order, each with its parent, its author and what it changed by class", async () => {
    const { cursor } = await since(undefined);
    const a = await write('main', 'a');
    const b = (await main.insertDocuments([need('b1'), need('b2')], { author: 'User/demo-reviewer', message: 'Add two' })).commit;
    const { events, cursor: after } = await since(cursor);
    expect(events).toEqual([
      { type: 'commit', branch: 'main', commit: a, parent: seeded, author: 'User/demo-designer', timestamp: expect.any(Number), changed: { LearningNeed: 1 } },
      { type: 'commit', branch: 'main', commit: b, parent: a, author: 'User/demo-reviewer', timestamp: expect.any(Number), changed: { LearningNeed: 2 } },
    ]);
    expect(after.heads.main).toBe(b);
    expect((await since(after)).events).toEqual([]);
  });

  it('tells a new branch once, from the commit it started at, then its own commits and none of the branch it was cut from', async () => {
    const { cursor } = await since(undefined);
    const base = cursor.heads.main;
    await main.createBranch('work', { branch: 'main' });
    const quiet = await since(cursor);
    expect(quiet.events).toEqual([{ type: 'branch.created', branch: 'work', commit: base }]);
    expect(quiet.cursor.heads.work).toBe(base);
    const w1 = await write('work', 'w1');
    const m1 = await write('main', 'm1');
    const w2 = await write('work', 'w2');
    const { events } = await since(quiet.cursor);
    expect(of(events, 'work').map((e) => [e.type, e.commit, e.parent])).toEqual([
      ['commit', w1, base],
      ['commit', w2, w1],
    ]);
    expect(of(events, 'main').map((e) => e.commit)).toEqual([m1]);
    // The same, to a client that was away the whole time: the branch, then its commits, and main's once.
    const away = await since(cursor);
    expect(of(away.events, 'work').map((e) => [e.type, e.commit])).toEqual([
      ['branch.created', base],
      ['commit', w1],
      ['commit', w2],
    ]);
    expect(of(away.events, 'main').map((e) => e.commit)).toEqual([m1]);
  });

  it('a branch cut from an old commit, behind every head, takes none of the history before it', async () => {
    const { cursor } = await since(undefined);
    await main.createBranch('from-the-past', { commit: seeded });
    const p1 = await write('from-the-past', 'p1');
    const { events } = await since(cursor);
    expect(events.map((e) => [e.type, e.branch, e.commit])).toEqual([
      ['branch.created', 'from-the-past', seeded],
      ['commit', 'from-the-past', p1],
    ]);
  });

  it('tells a deleted branch last, and a branch deleted and made again as both', async () => {
    await main.createBranch('short-lived', { branch: 'main' });
    await main.createBranch('remade', { branch: 'main' });
    const r1 = await write('remade', 'r1');
    const { cursor } = await since(undefined);
    const m2 = await write('main', 'm2');
    await main.deleteBranch('short-lived');
    await main.deleteBranch('remade');
    await main.createBranch('remade', { commit: seeded });
    const r2 = await write('remade', 'r2');
    const { events, cursor: after } = await since(cursor);
    expect(of(events, 'remade').map((e) => [e.type, e.commit])).toEqual([
      ['branch.deleted', r1],
      ['branch.created', seeded],
      ['commit', r2],
    ]);
    expect(events[events.length - 1]).toEqual({ type: 'branch.deleted', branch: 'short-lived', commit: cursor.heads['short-lived'] });
    expect(of(events, 'main').map((e) => e.commit)).toEqual([m2]);
    expect(Object.keys(after.heads)).not.toContain('short-lived');
    expect(after.heads.remade).toBe(r2);
  });

  it('pages: a client behind by more than a page is told everything once, in each branch\'s order, by asking again', async () => {
    const { cursor } = await since(undefined);
    await main.createBranch('paged', { branch: 'main' });
    const written: Record<string, string[]> = { main: [], paged: [] };
    for (let i = 0; i < 4; i++) {
      written.main.push(await write('main', `page-m${i}`));
      written.paged.push(await write('paged', `page-p${i}`));
    }
    const told: FeedEvent[] = [];
    let at = cursor;
    for (let page = 0; page < 10; page++) {
      const answer = await since(at, { limit: 3 });
      if (!answer.events.length) break;
      told.push(...answer.events);
      at = answer.cursor;
    }
    expect(of(told, 'main').map((e) => e.commit)).toEqual(written.main);
    expect(of(told, 'paged').map((e) => [e.type, e.commit])).toEqual([['branch.created', cursor.heads.main], ...written.paged.map((id) => ['commit', id])]);
    expect(told).toHaveLength(9);
    expect(at).toEqual((await since(undefined)).cursor);
  });

  it('filters by type and by branch, and the cursor still moves past what was left out', async () => {
    const { cursor } = await since(undefined);
    await main.createBranch('filtered', { branch: 'main' });
    const f1 = await write('filtered', 'f1');
    const m3 = await write('main', 'm3');
    const created = await since(cursor, { types: new Set(['branch.created'] as const) });
    expect(created.events.map((e) => [e.type, e.branch])).toEqual([['branch.created', 'filtered']]);
    expect(created.cursor.heads).toMatchObject({ filtered: f1, main: m3 });
    const onMain = await since(cursor, { branch: 'main' });
    expect(onMain.events.map((e) => e.commit)).toEqual([m3]);
    expect((await since(onMain.cursor)).events).toEqual([]);
  });

  it('after a restart the cursor still holds: hub.started first, then what was missed, as the logs have it', async () => {
    const { cursor } = await since(undefined);
    const m4 = await write('main', 'm4');
    const m5 = await write('main', 'm5');
    const restarted = new EventFeed();
    const { events, cursor: after } = await eventsSince(main, restarted, cursor);
    expect(events[0]).toEqual({ type: 'hub.started', startedAt: restarted.startedAt });
    const log = await main.log({ count: 2 });
    expect(events.slice(1).map((e) => e.commit)).toEqual([m4, m5]);
    expect(events.slice(1).map((e) => e.commit)).toEqual(log.map((c) => c.id).reverse());
    expect(after.hub).toBe(restarted.id);
    // Told once: the next request under the same life says nothing of it.
    expect((await eventsSince(main, restarted, after)).events).toEqual([]);
    // hub.started concerns every branch, so a branch filter keeps it.
    expect((await eventsSince(main, restarted, cursor, { branch: 'nowhere' })).events).toEqual([{ type: 'hub.started', startedAt: restarted.startedAt }]);
  });

  it(`refuses a cursor more than ${EVENTS_BACKLOG} commits behind on a branch (400 cursor_too_old)`, async () => {
    const { cursor } = await since(undefined);
    await main.createBranch('long', { branch: 'main' });
    for (let i = 0; i <= EVENTS_BACKLOG; i++) await write('long', `long-${i}`);
    await expect(since(cursor)).rejects.toMatchObject({ code: 'cursor_too_old', status: 400, details: { branch: 'long' } });
  }, 60_000);
});

describe('GET /events on the seeded store', () => {
  const A = `test-events-a-${stamp}`;
  const B = `test-events-b-${stamp}`;
  const get = (query: string, hub = app) => hub.request(`/api/v1/events${query}`, { headers: HEADERS });
  const feedOf = async (query: string, hub = app) => (await json(await get(query, hub))).body as { events: FeedEvent[]; cursor: string };
  const mine = (events: FeedEvent[]) => events.filter((event) => event.branch === A || event.branch === B);
  const put = (branch: string, name: string) =>
    app.request(`/api/v1/documents/LearningNeed/${name}-${stamp}?branch=${branch}`, {
      method: 'PUT',
      headers: HEADERS,
      body: JSON.stringify({ message: `Add ${name}`, document: { label: name, rationale: 'For the feed' } }),
    });
  let start = '';
  let mainHead = '';

  beforeAll(async () => {
    const first = await feedOf('');
    expect(first.events).toEqual([]);
    start = first.cursor;
    mainHead = decodeCursor(start).heads.main;
  });

  afterAll(async () => {
    await deleteScratchBranch(B, AS_OPERATOR).catch(() => undefined);
    await deleteScratchBranch(A, AS_OPERATOR).catch(() => undefined);
  });

  it('needs an identity, and refuses a cursor, a type, a branch, a wait or a limit it cannot read (400)', async () => {
    expect((await app.request('/api/v1/events')).status).toBe(401);
    expect((await json(await get('?since=nonsense'))).body.error).toBe('bad_cursor');
    for (const query of ['?types=commit,pushes', '?branch=not%20a%20branch', `?wait=${EVENTS_WAIT + 1}`, '?limit=0', `?limit=${EVENTS_PAGE + 1}`]) {
      const res = await json(await get(query));
      expect(res.status, query).toBe(400);
      expect(res.body.error, query).toBe('bad_query');
    }
  });

  it('tells a branch made, written, merged into and deleted, with the grant commits on main, and never the merge check\'s branch', async () => {
    for (const name of [A, B]) expect((await app.request('/api/v1/branches', { method: 'POST', headers: HEADERS, body: JSON.stringify({ name }) })).status).toBe(201);
    const written = await json(await put(B, 'need'));
    expect(written.status).toBe(200);
    const made = await feedOf(`?since=${start}&wait=0`);
    // Each branch's Owner grant is a commit on main, written before the branch is cut (ADR-0068 decision 3), so
    // each branch starts from its own grant's commit.
    const grants = made.events.filter((e) => e.branch === 'main');
    expect(grants.map((e) => [e.type, e.changed])).toEqual([
      ['commit', { Grant: 1 }],
      ['commit', { Grant: 1 }],
    ]);
    expect(grants[0].parent).toBe(mainHead);
    expect(mine(made.events).map((e) => [e.type, e.branch, e.commit])).toEqual([
      ['branch.created', A, grants[0].commit],
      ['branch.created', B, grants[1].commit],
      ['commit', B, written.body.commit],
    ]);
    expect(mine(made.events)[2]).toMatchObject({ parent: grants[1].commit, author: 'User/demo-designer', changed: { LearningNeed: 1 } });

    const merged = await json(await app.request(`/api/v1/branches/${A}/merge`, { method: 'POST', headers: HEADERS, body: JSON.stringify({ message: 'Merge the round', from: B }) }));
    expect(merged.status).toBe(200);
    expect((await app.request(`/api/v1/branches/${B}`, { method: 'DELETE', headers: HEADERS })).status).toBe(200);
    const { events, cursor } = await feedOf(`?since=${made.cursor}&wait=0`);
    expect(events.filter((e) => e.branch && isTransientBranch(e.branch))).toEqual([]);
    expect(mine(events).map((e) => [e.type, e.branch, e.commit])).toEqual([
      ['merge', A, merged.body.commit],
      ['branch.deleted', B, written.body.commit],
    ]);
    expect(mine(events)[0]).toMatchObject({ parent: grants[0].commit, mergeSource: written.body.commit, author: 'User/demo-designer' });
    // The deleted branch's grants revoked, one commit on main; the deletion is told last.
    expect(events.filter((e) => e.branch === 'main').map((e) => [e.type, e.changed])).toEqual([['commit', { Grant: 1 }]]);
    expect(events[events.length - 1]).toMatchObject({ type: 'branch.deleted', branch: B });
    expect(Object.keys(decodeCursor(cursor).heads)).not.toContain(B);
    expect((await feedOf(`?since=${cursor}&wait=0`)).events).toEqual([]);

    // A client away for all of it is told what stands: A with its merge, and nothing of B, which it never knew and
    // which is gone (the stated limit; ./events.ts).
    const away = await feedOf(`?since=${start}&wait=0`);
    expect(mine(away.events).map((e) => [e.type, e.branch, e.commit])).toEqual([
      ['branch.created', A, grants[0].commit],
      ['merge', A, merged.body.commit],
    ]);
  });

  it('holds a request open and returns on the next commit; with nothing to tell, it returns at its time with the cursor', async () => {
    const { cursor } = await feedOf('');
    const started = Date.now();
    const held = feedOf(`?since=${cursor}&wait=20&types=commit&branch=${A}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(waitingCount()).toBe(1);
    const written = await json(await put(A, 'held'));
    const { events } = await held;
    expect(events.map((e) => [e.type, e.branch, e.commit])).toEqual([['commit', A, written.body.commit]]);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(waitingCount()).toBe(0);

    const { cursor: quiet } = await feedOf('');
    const waited = Date.now();
    const empty = await feedOf(`?since=${quiet}&wait=1`);
    expect(empty).toEqual({ events: [], cursor: quiet });
    expect(Date.now() - waited).toBeGreaterThanOrEqual(900);
  });

  it('a commit the caller filtered out does not end the wait, and the cursor it gets back is past it', async () => {
    const { cursor } = await feedOf('');
    const held = feedOf(`?since=${cursor}&wait=2&types=branch.deleted`);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const written = await json(await put(A, 'unseen'));
    const answer = await held;
    expect(answer.events).toEqual([]);
    expect(decodeCursor(answer.cursor).heads[A]).toBe(written.body.commit);
  });

  it('a second hub over the same store, as after a restart, answers the cursor with hub.started and what it missed', async () => {
    const { cursor } = await feedOf('');
    const written = await json(await put(A, 'missed'));
    const restarted = createApp(configFromEnv);
    const { events } = await feedOf(`?since=${cursor}&wait=0`, restarted);
    expect(events[0].type).toBe('hub.started');
    expect(mine(events).map((e) => e.commit)).toEqual([written.body.commit]);
  });

  it('is discovered under armature/checks with its types, its page, its wait and its backlog', async () => {
    const discover = (await json(await app.request('/api/v1/discover'))).body;
    expect(discover.capabilities['armature/checks']).toMatchObject({ events: [...EVENT_TYPES], eventsPage: EVENTS_PAGE, eventsWait: EVENTS_WAIT, eventsBacklog: EVENTS_BACKLOG });
    expect(discover.versions[0]).toBe('2026-11-16');
  });
});
