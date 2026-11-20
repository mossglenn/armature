/**
 * Workspaces linked to one computer, and merge requests, on a remote hub
 * (architecture decision record ADR-0072; its §Verification is this file's
 * list, with `cycle.test.ts` for the desktop hub's side).
 *
 * Both records are written to `main`, and requests merge into it, which the
 * contract suite never does on the seeded store, so this file runs a hub over
 * a scratch database of its own, loaded from the seed's export as
 * `authorization.test.ts` loads one, and deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import { createClient } from '@armature/client';
import { app, createApp } from './app';
import { paramsHash } from './checks';
import { configFromEnv } from './config';
import type { UserDocument } from './identity';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from './store';
import { capabilitiesOf } from './version';
import { writeDocuments } from './write';
import { checkBranch } from '../operator/check';

// A request's health is a merge check each time it is read, seconds against a store on the same machine.
vi.setConfig({ testTimeout: 60_000 });

const stamp = Date.now().toString(36);
const SCRATCH_DB = `${process.env.TERMINUS_DB}_workspaces_${stamp}`;
const DESIGNER = 'User/demo-designer';
const REVIEWER = 'User/demo-reviewer';
/** Two installations of the desktop app, as each would have drawn its identifier. */
const HERE = `aaaaaaaaaaaaaaaa${stamp.padStart(16, '0')}`;
const THERE = `bbbbbbbbbbbbbbbb${stamp.padStart(16, '0')}`;

let hub: Hono;
const scratch = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: SCRATCH_DB });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const as = (user: string, link?: string) => (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
  hub.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Armature-User': user, ...(link ? { 'Armature-Workspace-Link': link } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
/** The designer, an administrator and a maintainer of every branch: from no computer in particular, and from each installation. */
const on = as('demo-designer@example.edu');
const here = as('demo-designer@example.edu', HERE);
const there = as('demo-designer@example.edu', THERE);
/** The reviewer, who holds no grant: from no computer, and from an installation of their own. */
const reviewer = as('demo-reviewer@example.edu');
const reviewerHere = as('demo-reviewer@example.edu', HERE);

let n = 0;
const name = (label: string) => `test-ws-${stamp}-${label}-${++n}`;
const need = (label: string) => ({ message: `Need ${label}`, document: { label, rationale: 'r' } });
const record = async (branch: string) => (await json(await on('GET', `/documents/Workspace?branch=main&status=Active`))).body.find((w: TerminusDocument) => w.branch === branch);
const headMessage = async (branch: string) => (await json(await on('GET', `/branches/${branch}/log?count=1`))).body.commits[0].message as string;
/** A workspace of `who`'s, created from `from` and linked to `link`. */
const workspace = async (who: typeof on, link: string, from = 'main', label = 'w') => {
  const branch = name(label);
  const made = await json(await who('POST', '/branches', { name: branch, from: { branch: from }, workspace: { link } }));
  expect(made.status).toBe(201);
  return branch;
};

beforeAll(async () => {
  const exported = (await json(await app.request('/api/v1/export'))).body as { schema: Record<string, unknown>[]; documents: TerminusDocument[] };
  const main = scratch('main');
  await main.ensureDatabase();
  await main.replaceSchema(exported.schema, { author: DESIGNER, message: 'The seed schema, for the workspaces suite' });
  // Two commits, so that every asOf names a commit this copy holds (constraint 13): the undated records first.
  const { commit: undated } = await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf === undefined),
    { author: DESIGNER, message: 'The seed, for the workspaces suite' }
  );
  await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf !== undefined).map((doc) => ({ ...doc, asOf: undated })),
    { author: DESIGNER, message: "The seed's dated records, for the workspaces suite" }
  );
  hub = createApp(() => ({ ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), db: SCRATCH_DB }) }));
});

afterAll(async () => {
  await scratch('main').deleteDatabase().catch(() => undefined);
});

describe('the records and their rules (ADR-0072 decisions 2 and 5; constraints 27 to 33)', () => {
  let who: { id: string; user: UserDocument };
  const main = () => scratch('main');
  const put = (documents: Record<string, unknown>[], target = 'main') =>
    writeDocuments(documents as unknown as TerminusDocument[], { branch: target === 'main' ? main() : scratch(target), who, message: 'A record, as the hub writes one' });
  const violations = async (documents: Record<string, unknown>[]) => {
    try {
      await put(documents);
    } catch (err) {
      return ((err as { violations?: Array<{ code: string; field?: string }> }).violations ?? []).map((v) => `${v.code}@${v.field ?? ''}`);
    }
    return [];
  };
  const ws = (fields: Record<string, unknown>) => ({ '@type': 'Workspace', '@id': `Workspace/rule-${stamp}-${++n}`, owner: DESIGNER, parent: 'main', status: 'Active', ...fields });
  const mr = (fields: Record<string, unknown>) => ({ '@type': 'MergeRequest', '@id': `MergeRequest/rule-${stamp}-${++n}`, openedBy: DESIGNER, message: 'Why', status: 'Open', ...fields });
  const linked = { link: HERE, linkedAt: '2026-11-20T10:00:00Z' };
  const decided = { decidedBy: DESIGNER, decidedAt: '2026-11-20T11:00:00Z' };

  beforeAll(async () => {
    const me = (await json(await on('GET', '/users/me'))).body as UserDocument;
    who = { id: me['@id'], user: me };
  });

  it('no client writes either record: the document routes refuse both classes, on main and anywhere', async () => {
    for (const document of [ws({ branch: 'x' }), mr({ source: 'x', target: 'main' })]) {
      const batch = await json(await on('POST', '/documents?branch=main', { message: 'x', documents: [document] }));
      expect(batch.status).toBe(400);
      expect(batch.body.error).toBe('invalid_document');
      expect(batch.body.issues[0].message).toContain('not a writable document type');
      const [type, id] = (document['@id'] as string).split('/');
      const single = await json(await on('PUT', `/documents/${type}/${id}?branch=main`, { message: 'x', document: { ...document, '@id': undefined, '@type': undefined } }));
      expect(single.status).toBe(400);
      expect(single.body.error).toBe('invalid_type');
    }
  });

  it('both live on main only (constraint 27), judged by the branch the write is for', async () => {
    const elsewhere = name('rule');
    expect((await on('POST', '/branches', { name: elsewhere })).status).toBe(201);
    await expect(put([ws({ branch: 'x' })], elsewhere)).rejects.toMatchObject({ status: 400, code: 'workspaces_live_on_main' });
    await expect(put([mr({ source: 'x', target: 'main' })], elsewhere)).rejects.toMatchObject({ status: 400, code: 'merge_requests_live_on_main' });
  });

  it('a branch has at most one Active Workspace record (28); a Closed one keeps the name free', async () => {
    const branch = name('rule');
    const first = ws({ branch, ...linked });
    await put([first]);
    expect(await violations([ws({ branch })])).toEqual(['workspace_exists@branch']);
    // Two in one write are held to the rule too.
    const other = name('rule');
    expect(await violations([ws({ branch: other }), ws({ branch: other })])).toEqual(['workspace_exists@branch', 'workspace_exists@branch']);
    // The same record written again is a replace, not a second record; closed, the name is free.
    await put([{ ...first, link: undefined, linkedAt: undefined, status: 'Closed' }]);
    await put([ws({ branch })]);
  });

  it('a parent names a branch that is no workspace (29)', async () => {
    const parent = name('rule');
    await put([ws({ branch: parent })]);
    expect(await violations([ws({ branch: name('rule'), parent })])).toEqual(['parent_is_workspace@parent']);
    const own = name('rule');
    expect(await violations([ws({ branch: own, parent: own })])).toEqual(['parent_is_workspace@parent']);
    await put([ws({ branch: name('rule'), parent: 'main' })]);
  });

  it('a link comes whole (30): link and linkedAt together, a label only with them, none on a Closed record', async () => {
    expect(await violations([ws({ branch: name('rule'), link: HERE })])).toEqual(['link_incomplete@linkedAt']);
    expect(await violations([ws({ branch: name('rule'), linkedAt: linked.linkedAt })])).toEqual(['link_incomplete@link']);
    expect(await violations([ws({ branch: name('rule'), linkLabel: 'Office' })])).toEqual(['link_incomplete@linkLabel']);
    expect(await violations([ws({ branch: name('rule'), ...linked, status: 'Closed' })])).toEqual(['link_incomplete@link']);
    await put([ws({ branch: name('rule'), ...linked, linkLabel: 'Office' })]);
    await put([ws({ branch: name('rule') })]);
  });

  it('at most one Open request names a source and a target (31); a decided one does not count', async () => {
    const source = name('rule');
    const first = mr({ source, target: 'main' });
    await put([first]);
    expect(await violations([mr({ source, target: 'main' })])).toEqual(['request_open@source']);
    await put([mr({ source, target: name('rule') })]); // another target is another pair
    await put([{ ...first, status: 'Closed', ...decided }]);
    await put([mr({ source, target: 'main' })]);
  });

  it("an Open request's target is a branch, never a workspace, nor its own source (32)", async () => {
    const target = name('rule');
    await put([ws({ branch: target })]);
    expect(await violations([mr({ source: name('rule'), target })])).toEqual(['target_is_workspace@target']);
    expect(await violations([mr({ source: target, target })])).toContain('target_is_workspace@target');
    // A request already decided is the record of what happened, whatever its target has become since.
    await put([mr({ source: name('rule'), target, status: 'Closed', ...decided })]);
  });

  it('a decision comes whole (33): none on an Open request, all three on a Merged one, who and when on a Closed one', async () => {
    const pair = () => ({ source: name('rule'), target: 'main' });
    expect(await violations([mr({ ...pair(), ...decided })])).toEqual(['decision_incomplete@decidedBy', 'decision_incomplete@decidedAt']);
    expect(await violations([mr({ ...pair(), mergeCommit: 'abc' })])).toEqual(['decision_incomplete@mergeCommit']);
    expect(await violations([mr({ ...pair(), status: 'Merged', ...decided })])).toEqual(['decision_incomplete@mergeCommit']);
    expect(await violations([mr({ ...pair(), status: 'Merged', mergeCommit: 'abc' })])).toEqual(['decision_incomplete@decidedBy', 'decision_incomplete@decidedAt']);
    expect(await violations([mr({ ...pair(), status: 'Closed', ...decided, mergeCommit: 'abc' })])).toEqual(['decision_incomplete@mergeCommit']);
    await put([mr({ ...pair(), status: 'Merged', ...decided, mergeCommit: 'abc' })]);
    await put([mr({ ...pair(), status: 'Closed', ...decided })]);
  });

  it("check reports a workspace record and an open request whose branch the store lacks, and nothing for what this suite's hub made", async () => {
    const report = await checkBranch(main());
    const codes = report.violations.map((v) => v.code);
    expect(codes).toContain('workspace_without_branch');
    expect(codes).toContain('request_without_branch');
    // The records above name branches that never existed; none of the engine's own rules is broken by them.
    expect(codes.filter((code) => !['workspace_without_branch', 'request_without_branch', 'grant_without_branch', 'branch_without_owner'].includes(code))).toEqual([]);
  });
});

describe('a workspace is a branch with a record (decisions 1 and 2)', () => {
  it('POST /branches with workspace writes the grant and the record on main in one commit, before the branch', async () => {
    const before = (await scratch('main').head())?.id;
    const branch = name('made');
    const made = await json(await on('POST', '/branches', { name: branch, workspace: { link: HERE, linkLabel: 'Office' } }));
    expect(made.status).toBe(201);
    expect(made.body.workspace).toEqual({ parent: 'main', linked: true });
    const written = await record(branch);
    expect(written).toMatchObject({ '@type': 'Workspace', branch, owner: DESIGNER, parent: 'main', link: HERE, linkLabel: 'Office', status: 'Active' });
    expect(written['@id']).toMatch(/^Workspace\/[0-9a-f-]{36}$/);
    expect(Date.parse(written.linkedAt)).toBeGreaterThan(Date.now() - 60_000);
    // One commit on main holds both, and the branch was cut from main after it.
    const log = await scratch('main').log({ count: 2 });
    expect(log[1].id).toBe(before);
    expect(log[0].message).toContain(`Owner grant for workspace ${branch}`);
    const grants = (await json(await on('GET', `/documents/Grant?branch=main&branch=${branch}`))).body;
    expect(grants).toEqual(expect.any(Array));
    const changed = (await json(await on('GET', `/branches/main/changes?since=${before}`))).body.changes.map((c: { id: string }) => c.id.split('/')[0]).sort();
    expect(changed).toEqual(['Grant', 'Workspace']);
    // A branch made without `workspace` has no record, and is a branch.
    const plain = name('plain');
    expect((await on('POST', '/branches', { name: plain })).status).toBe(201);
    expect(await record(plain)).toBeUndefined();
    expect((await on('GET', `/workspaces/${plain}`)).status).toBe(404);
    expect((await json(await on('GET', `/workspaces/${branch}`))).body).toMatchObject({ branch, link: HERE });
  });

  it('a workspace is created from a branch, its parent: a commit is refused, and so is a workspace (409 parent_is_workspace)', async () => {
    const parent = await workspace(on, HERE);
    const fromWorkspace = await json(await on('POST', '/branches', { name: name('child'), from: { branch: parent }, workspace: { link: HERE } }));
    expect(fromWorkspace.status).toBe(409);
    expect(fromWorkspace.body).toMatchObject({ error: 'parent_is_workspace', parent });
    const head = (await scratch('main').head())!.id;
    const fromCommit = await json(await on('POST', '/branches', { name: name('child'), from: { commit: head }, workspace: { link: HERE } }));
    expect(fromCommit.status).toBe(400);
    // A branch, and not a workspace, may still be cut from a workspace: it reads it.
    expect((await on('POST', '/branches', { name: name('copy'), from: { branch: parent } })).status).toBe(201);
    // From another branch, the workspace's parent is that branch.
    const method = name('method');
    expect((await on('POST', '/branches', { name: method })).status).toBe(201);
    const under = await workspace(on, HERE, method);
    expect((await record(under)).parent).toBe(method);
  });

  it('the link is an identifier of a known shape, and the label one line', async () => {
    for (const bad of [{ link: 'short' }, { link: 'has spaces in it and more' }, {}, { link: HERE, linkLabel: 'two\nlines' }, { link: HERE, other: 1 }, 'x']) {
      const res = await json(await on('POST', '/branches', { name: name('bad'), workspace: bad }));
      expect(res.status).toBe(400);
    }
  });

  it('a record left Active by a creation that failed between its steps is closed when the name is used again', async () => {
    const branch = name('stale');
    const me = (await json(await on('GET', '/users/me'))).body as UserDocument;
    const stale = { '@type': 'Workspace', '@id': `Workspace/stale-${stamp}`, branch, owner: DESIGNER, parent: 'main', link: THERE, linkedAt: '2026-11-19T10:00:00Z', status: 'Active' };
    await writeDocuments([stale as unknown as TerminusDocument], { branch: scratch('main'), who: { id: me['@id'], user: me }, message: 'A record whose branch was never made' });
    // Made now as a plain branch: it is not that workspace, and takes a write from anywhere.
    expect((await on('POST', '/branches', { name: branch })).status).toBe(201);
    expect(await record(branch)).toBeUndefined();
    expect((await json(await on('GET', `/documents/Workspace/stale-${stamp}`))).body).toMatchObject({ status: 'Closed' });
    expect((await on('PUT', `/documents/LearningNeed/stale-${stamp}?branch=${branch}`, need('Stale'))).status).toBe(200);
  });
});

describe('writes to a workspace carry its link (decision 3)', () => {
  let branch: string;
  beforeAll(async () => {
    branch = name('linked');
    expect((await on('POST', '/branches', { name: branch, workspace: { link: HERE, linkLabel: 'Office' } })).status).toBe(201);
  });

  it('a write with the link is served; without it, or with another, 409 held_elsewhere naming the label and the time, never the identifier', async () => {
    expect((await here('PUT', `/documents/LearningNeed/linked-${stamp}?branch=${branch}`, need('Linked'))).status).toBe(200);
    for (const from of [on, there]) {
      for (const res of [
        await json(await from('PUT', `/documents/LearningNeed/linked-${stamp}?branch=${branch}`, need('Elsewhere'))),
        await json(await from('POST', `/documents?branch=${branch}`, { message: 'A batch', documents: [{ '@type': 'LearningNeed', '@id': `LearningNeed/linked-b-${stamp}`, label: 'B', rationale: 'r' }] })),
      ]) {
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('held_elsewhere');
        expect(res.body).toMatchObject({ workspace: branch, linkLabel: 'Office', linkedAt: expect.any(String) });
        expect(JSON.stringify(res.body)).not.toContain(HERE);
      }
    }
    expect((await json(await on('GET', `/documents/LearningNeed/linked-${stamp}?branch=${branch}`))).body.label).toBe('Linked');
    // A header of another shape is refused as such, before it is compared.
    expect((await json(await as('demo-designer@example.edu', 'x')('PUT', `/documents/LearningNeed/linked-${stamp}?branch=${branch}`, need('Odd')))).body.error).toBe('bad_link');
  });

  it('the check comes after authority: someone who may not write the branch is 403, whatever link they send', async () => {
    const res = await json(await reviewerHere('PUT', `/documents/LearningNeed/linked-${stamp}?branch=${branch}`, need('Not mine')));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('a read needs no link, and a branch that is no workspace takes writes from anywhere, the header ignored', async () => {
    expect((await reviewer('GET', `/documents/LearningNeed/linked-${stamp}?branch=${branch}`)).status).toBe(200);
    const plain = name('plain');
    expect((await on('POST', '/branches', { name: plain })).status).toBe(201);
    expect((await on('PUT', `/documents/LearningNeed/plain-${stamp}?branch=${plain}`, need('Plain'))).status).toBe(200);
    expect((await there('PUT', `/documents/LearningNeed/plain-${stamp}?branch=${plain}`, need('Plain again'))).status).toBe(200);
  });

  it("a merge into a workspace, its update from its parent, carries the link; a dry run needs none", async () => {
    expect((await on('PUT', `/documents/LearningNeed/parent-moved-${stamp}?branch=${name('unused')}`, need('x'))).status).toBe(404);
    const method = name('method');
    expect((await on('POST', '/branches', { name: method })).status).toBe(201);
    const under = await workspace(on, HERE, method);
    expect((await on('PUT', `/documents/LearningNeed/method-${stamp}?branch=${method}`, need('On the method'))).status).toBe(200);
    const update = { message: `Update from ${method}`, from: method };
    const without = await json(await on('POST', `/branches/${under}/merge`, update));
    expect(without.status).toBe(409);
    expect(without.body.error).toBe('held_elsewhere');
    expect((await json(await on('POST', `/branches/${under}/merge`, { ...update, dryRun: true }))).body).toMatchObject({ dryRun: true, conflicts: [], violations: [] });
    const merged = await json(await here('POST', `/branches/${under}/merge`, update));
    expect(merged.status).toBe(200);
    expect((await here('GET', `/documents/LearningNeed/method-${stamp}?branch=${under}`)).status).toBe(200);
  });
});

describe('moving a workspace is two steps: unlink, then link (decision 4)', () => {
  it('unlinked from elsewhere, the old computer is refused not_linked; linked from another, that one writes and the first is held_elsewhere', async () => {
    const branch = await workspace(on, HERE, 'main', 'move');
    expect((await here('PUT', `/documents/LearningNeed/move-${stamp}?branch=${branch}`, need('Before'))).status).toBe(200);
    // Linking never takes a workspace over.
    const taken = await json(await there('POST', `/workspaces/${branch}/link`, { link: THERE }));
    expect(taken.status).toBe(409);
    expect(taken.body.error).toBe('held_elsewhere');
    // Unlinked from anywhere, by its owner: no link header is needed, since the computer may be lost.
    const unlinked = await json(await on('POST', `/workspaces/${branch}/unlink`));
    expect(unlinked.status).toBe(200);
    expect(unlinked.body).toMatchObject({ unlinked: true, workspace: { branch, status: 'Active' }, was: { linkedAt: expect.any(String) } });
    expect(unlinked.body.workspace).not.toHaveProperty('link');
    expect((await json(await on('POST', `/workspaces/${branch}/unlink`))).body).toMatchObject({ unlinked: false });
    // The old computer's push is refused, and so is every write: the workspace is linked nowhere.
    const old = await json(await here('PUT', `/documents/LearningNeed/move-${stamp}?branch=${branch}`, need('Too late')));
    expect(old.status).toBe(409);
    expect(old.body).toMatchObject({ error: 'not_linked', workspace: branch });
    // Linked from the other computer, with a name for it.
    const linked = await json(await there('POST', `/workspaces/${branch}/link`, { link: THERE, linkLabel: 'Laptop' }));
    expect(linked.status).toBe(200);
    expect(linked.body).toMatchObject({ branch, link: THERE, linkLabel: 'Laptop' });
    expect((await there('PUT', `/documents/LearningNeed/move-${stamp}?branch=${branch}`, need('After'))).status).toBe(200);
    const first = await json(await here('PUT', `/documents/LearningNeed/move-${stamp}?branch=${branch}`, need('Too late')));
    expect(first.body).toMatchObject({ error: 'held_elsewhere', linkLabel: 'Laptop' });
    // Asked again by the computer that holds it, the link stands, and a new label is taken.
    expect((await json(await there('POST', `/workspaces/${branch}/link`, { link: THERE, linkLabel: 'Laptop' }))).status).toBe(200);
    expect((await json(await there('POST', `/workspaces/${branch}/link`, { link: THERE }))).body).not.toHaveProperty('linkLabel');
    // Each change is a commit on main by the caller.
    expect(await headMessage('main')).toContain(`Workspace ${branch} linked to a computer by demo-designer@example.edu`);
  });

  it('linking and unlinking are the owner\'s; an administrator may unlink and list any (decision 6)', async () => {
    const theirs = await workspace(reviewer, THERE, 'main', 'theirs');
    const mine = await workspace(on, HERE, 'main', 'mine');
    // The reviewer may not unlink or link the designer's.
    for (const res of [await json(await reviewer('POST', `/workspaces/${mine}/unlink`)), await json(await reviewer('POST', `/workspaces/${mine}/link`, { link: THERE }))]) {
      expect(res.status).toBe(403);
      expect(res.body.error).toBe('forbidden');
    }
    // The designer, an administrator, unlinks the reviewer's, and may not link it: that is its owner's.
    expect((await json(await on('POST', `/workspaces/${theirs}/unlink`))).body).toMatchObject({ unlinked: true });
    expect((await json(await on('POST', `/workspaces/${theirs}/link`, { link: HERE }))).status).toBe(403);
    expect((await json(await reviewer('POST', `/workspaces/${theirs}/link`, { link: THERE }))).status).toBe(200);

    // Lists: one's own by owner=me, with linked; everyone's, an administrator's.
    const own = (await json(await reviewer('GET', '/workspaces?owner=me'))).body as Array<{ branch: string; owner: string }>;
    expect(own.map((w) => w.branch)).toEqual([theirs]);
    expect((await json(await reviewer('GET', '/workspaces?owner=me&linked=false'))).body).toEqual([]);
    expect((await json(await reviewer('GET', `/workspaces?owner=${REVIEWER}`))).status).toBe(200);
    for (const path of ['/workspaces', `/workspaces?owner=${DESIGNER}`]) {
      const refused = await json(await reviewer('GET', path));
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: 'forbidden', permission: 'list_workspaces' });
    }
    const all = (await json(await on('GET', '/workspaces'))).body as Array<{ branch: string }>;
    expect(all.map((w) => w.branch)).toEqual(expect.arrayContaining([theirs, mine]));
    expect((await json(await on('GET', `/workspaces?owner=${REVIEWER}`))).body.map((w: { branch: string }) => w.branch)).toEqual([theirs]);
    expect((await on('GET', '/workspaces?linked=maybe')).status).toBe(400);
    expect((await on('POST', `/workspaces/${name('none')}/unlink`)).status).toBe(404);
  });

  it("deleting a workspace's branch closes its record: from the linked computer when linked, by whoever may when unlinked", async () => {
    const branch = await workspace(on, HERE, 'main', 'gone');
    // Nothing on it that main lacks, so the deletion is allowed by ADR-0025's rule; the link decides who.
    const elsewhere = await json(await on('DELETE', `/branches/${branch}`));
    expect(elsewhere.status).toBe(409);
    expect(elsewhere.body.error).toBe('held_elsewhere');
    expect((await here('DELETE', `/branches/${branch}`)).status).toBe(200);
    expect(await record(branch)).toBeUndefined();
    const closed = (await json(await on('GET', '/documents/Workspace?branch=main&status=Closed'))).body.filter((w: TerminusDocument) => w.branch === branch);
    expect(closed).toHaveLength(1);
    expect(closed[0]).not.toHaveProperty('link');
    expect(await headMessage('main')).toContain('its workspace record closed');
    // The name may be used again, as a workspace or a branch.
    expect((await on('POST', '/branches', { name: branch, workspace: { link: THERE } })).status).toBe(201);
    expect((await json(await on('POST', `/workspaces/${branch}/unlink`))).body.unlinked).toBe(true);
    // Unlinked, it is deleted by whoever may delete it, with no link at all.
    expect((await on('DELETE', `/branches/${branch}`)).status).toBe(200);
  });
});

describe('the desktop app records the workspaces it held before this (decision 7)', () => {
  it("POST /workspaces makes an existing branch a workspace linked to that installation, for the branch's Owner alone", async () => {
    const branch = name('held');
    expect((await reviewer('POST', '/branches', { name: branch })).status).toBe(201);
    expect((await reviewer('PUT', `/documents/LearningNeed/held-${stamp}?branch=${branch}`, need('Held'))).status).toBe(200);
    // Not its Owner: refused, a maintainer of every branch included.
    const notOwner = await json(await on('POST', '/workspaces', { branch, link: HERE }));
    expect(notOwner.status).toBe(403);
    expect(notOwner.body).toMatchObject({ error: 'forbidden', permission: 'adopt_workspace' });
    const adopted = await json(await reviewerHere('POST', '/workspaces', { branch, link: HERE }));
    expect(adopted.status).toBe(201);
    expect(adopted.body).toMatchObject({ branch, owner: REVIEWER, parent: 'main', link: HERE, status: 'Active' });
    // Asked again by the same installation, the record stands; from another, the workspace is not taken over.
    const again = await json(await reviewerHere('POST', '/workspaces', { branch, link: HERE }));
    expect(again.status).toBe(200);
    expect(again.body['@id']).toBe(adopted.body['@id']);
    expect((await json(await as('demo-reviewer@example.edu', THERE)('POST', '/workspaces', { branch, link: THERE }))).body.error).toBe('held_elsewhere');
    // From then on it is protected: a write without the link is refused.
    expect((await json(await reviewer('PUT', `/documents/LearningNeed/held-${stamp}?branch=${branch}`, need('From a browser')))).body.error).toBe('held_elsewhere');
    expect((await reviewerHere('PUT', `/documents/LearningNeed/held-${stamp}?branch=${branch}`, need('From its computer'))).status).toBe(200);
  });

  it('refuses main, a branch the store lacks, and a parent that is a workspace or missing', async () => {
    expect((await on('POST', '/workspaces', { branch: 'main', link: HERE })).status).toBe(400);
    const branch = name('held');
    expect((await on('POST', '/branches', { name: branch })).status).toBe(201);
    const parent = await workspace(on, HERE);
    expect((await json(await on('POST', '/workspaces', { branch, parent, link: HERE }))).body.error).toBe('parent_is_workspace');
    expect((await on('POST', '/workspaces', { branch, parent: name('nowhere'), link: HERE })).status).toBe(404);
    expect((await on('POST', '/workspaces', { branch, link: 'short' })).status).toBe(400);
    // A branch that was never made has no Owner to ask as.
    expect((await on('POST', '/workspaces', { branch: name('nowhere'), link: HERE })).status).toBe(403);
  });
});

describe('merge requests (decision 5)', () => {
  /** A branch of the designer's under `from`, with one commit of its own. */
  const work = async (from = 'main', who = on) => {
    const branch = name('work');
    expect((await who('POST', '/branches', { name: branch, from: { branch: from } })).status).toBe(201);
    const written = await json(await who('PUT', `/documents/LearningNeed/${branch}?branch=${branch}`, need(`Work on ${branch}`)));
    expect(written.status).toBe(200);
    return { branch, head: written.body.commit as string };
  };
  const open = async (source: string, target: string, who = on, message = `Merge ${source}`) => json(await who('POST', '/merge-requests', { source, target, message }));
  const idOf = (request: { '@id': string }) => request['@id'].split('/')[1];

  it('a merge from a workspace, or into main, is refused outside a request (409 request_required); a dry run and a merge between two other branches are served', async () => {
    const { branch } = await work();
    const intoMain = await json(await on('POST', '/branches/main/merge', { message: 'Direct', from: branch }));
    expect(intoMain.status).toBe(409);
    expect(intoMain.body).toMatchObject({ error: 'request_required', source: branch, target: 'main', reason: 'into_main' });
    expect((await json(await on('POST', '/branches/main/merge', { message: 'Direct', from: branch, dryRun: true }))).body).toMatchObject({ dryRun: true, conflicts: [], violations: [] });

    const method = name('method');
    expect((await on('POST', '/branches', { name: method })).status).toBe(201);
    const ws = await workspace(on, HERE, method);
    expect((await here('PUT', `/documents/LearningNeed/${ws}?branch=${ws}`, need('In the workspace'))).status).toBe(200);
    const fromWorkspace = await json(await on('POST', `/branches/${method}/merge`, { message: 'Direct', from: ws }));
    expect(fromWorkspace.status).toBe(409);
    expect(fromWorkspace.body).toMatchObject({ error: 'request_required', reason: 'from_workspace' });

    // Between two branches other than main, as a client that writes while connected merges its rounds.
    const round = await work(method);
    const direct = await json(await on('POST', `/branches/${method}/merge`, { message: 'A round', from: round.branch }));
    expect(direct.status).toBe(200);
    expect(direct.body.upToDate).toBe(false);
    // Whoever may not merge at all is told that first, as before.
    expect((await reviewer('POST', '/branches/main/merge', { message: 'Direct', from: branch })).status).toBe(403);
  });

  it('opened by whoever may write the source, once per pair; listed and read by anyone; its health computed on the read', async () => {
    const { branch, head } = await work();
    const opened = await open(branch, 'main', on, 'Three needs for module 2\n\nAsked for by the pilot.');
    expect(opened.status).toBe(201);
    expect(opened.body).toMatchObject({ '@type': 'MergeRequest', source: branch, target: 'main', openedBy: DESIGNER, status: 'Open', message: 'Three needs for module 2\n\nAsked for by the pilot.' });
    expect(opened.body['@id']).toMatch(/^MergeRequest\/[0-9a-f-]{36}$/);
    expect(await headMessage('main')).toContain(`Merge request opened by demo-designer@example.edu: ${branch} into main`);
    const again = await open(branch, 'main');
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: 'request_open', request: opened.body['@id'] });

    const listed = (await json(await reviewer('GET', `/merge-requests?source=${branch}&status=Open`))).body;
    expect(listed.map((r: { '@id': string }) => r['@id'])).toEqual([opened.body['@id']]);
    expect((await json(await reviewer('GET', `/merge-requests?target=main&status=Merged&source=${branch}`))).body).toEqual([]);
    expect((await reviewer('GET', '/merge-requests?status=Sometimes')).status).toBe(400);
    expect((await reviewer('GET', '/merge-requests?opener=x')).status).toBe(400);

    const read = await json(await reviewer('GET', `/merge-requests/${idOf(opened.body)}`));
    expect(read.status).toBe(200);
    expect(read.body.request).toEqual(opened.body);
    expect(read.body.health).toEqual({ mergeable: true, upToDate: false, base: expect.any(String), source: head, target: expect.any(String), conflicts: [], violations: [], checks: [], bringInFirst: false });
    expect((await reviewer('GET', '/merge-requests/no-such')).status).toBe(404);
    // Nothing of the health is stored.
    const stored = (await json(await on('GET', `/documents/MergeRequest/${idOf(opened.body)}`))).body;
    expect(Object.keys(stored).sort()).toEqual(['@id', '@type', 'message', 'openedBy', 'source', 'status', 'target']);
  });

  it('refuses a request nobody may make: a stranger to the source, a target that is a workspace, a missing branch, a message with the hub\'s trailer', async () => {
    const { branch } = await work();
    const stranger = await open(branch, 'main', reviewer);
    expect(stranger.status).toBe(403);
    expect(stranger.body).toMatchObject({ error: 'forbidden', permission: 'open_request', branch });
    const ws = await workspace(on, HERE);
    expect((await open(branch, ws)).body).toMatchObject({ error: 'target_is_workspace', target: ws });
    expect((await open(name('nowhere'), 'main')).status).toBe(404);
    expect((await open(branch, branch)).status).toBe(400);
    expect((await json(await on('POST', '/merge-requests', { source: branch, target: 'main' }))).body.error).toBe('message_required');
    const forged = await open(branch, 'main', on, 'Looks official\n\nArmature-Merge-Request: MergeRequest/forged');
    expect(forged.status).toBe(400);
    expect(forged.body.error).toBe('reserved_trailer');
    // A workspace's request is its owner's: a maintainer of every branch may not open it for them.
    const theirs = await workspace(reviewer, THERE);
    expect((await open(theirs, 'main', on)).body).toMatchObject({ error: 'forbidden', permission: 'open_request' });
  });

  it('merged by whoever may merge into the target: the commit carries the trailer, the record becomes Merged with it, and it is not decided twice', async () => {
    const ws = await workspace(reviewer, THERE, 'main', 'theirs');
    const written = await json(await as('demo-reviewer@example.edu', THERE)('PUT', `/documents/LearningNeed/${ws}?branch=${ws}`, need('From the reviewer')));
    expect(written.status).toBe(200);
    const opened = await open(ws, 'main', reviewer, 'A need the pilot found');
    expect(opened.status).toBe(201);
    const id = idOf(opened.body);
    // The reviewer holds no grant on main, so asks; the designer, a maintainer, decides.
    const refused = await json(await reviewer('POST', `/merge-requests/${id}/merge`));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'forbidden', permission: 'merge', branch: 'main' });
    const merged = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(merged.status).toBe(200);
    expect(merged.body).toMatchObject({ upToDate: false, source: written.body.commit, request: { status: 'Merged', decidedBy: DESIGNER, mergeCommit: merged.body.commit } });
    expect(Date.parse(merged.body.request.decidedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect((await on('GET', `/documents/LearningNeed/${ws}?branch=main`)).status).toBe(200);
    // The merge commit: the request's message, the trailer, the designer as author.
    const log = (await json(await on('GET', '/branches/main/log?count=2'))).body.commits;
    expect(log[1].commit).toBe(merged.body.commit);
    expect(log[1].message).toBe(`A need the pilot found\n\nArmature-Merge-Request: ${opened.body['@id']}`);
    expect(log[1].author).toBe(DESIGNER);
    expect(log[0].message).toContain(`Merge request merged by demo-designer@example.edu: ${ws} into main at ${merged.body.commit}`);
    // Read again: the record, and no health, since nothing is left to merge.
    const read = (await json(await reviewer('GET', `/merge-requests/${id}`))).body;
    expect(read.request.status).toBe('Merged');
    expect(read).not.toHaveProperty('health');
    for (const action of ['merge', 'close']) {
      const twice = await json(await on('POST', `/merge-requests/${id}/${action}`));
      expect(twice.status).toBe(409);
      expect(twice.body).toMatchObject({ error: 'request_decided', status: 'Merged', mergeCommit: merged.body.commit });
    }
    // A new one may be opened for the same pair.
    expect((await open(ws, 'main', reviewer)).status).toBe(201);
  });

  it('closed unmerged by its opener, its source\'s owner or whoever may merge into the target, and by no one else', async () => {
    const method = name('method');
    expect((await reviewer('POST', '/branches', { name: method })).status).toBe(201); // the reviewer owns it, so may merge into it
    const { branch } = await work(method);
    const opened = await open(branch, method);
    const id = idOf(opened.body);
    // An agent, registered and with no part in the request.
    const AGENT = `agent:test/ws-${stamp}`;
    expect((await on('POST', '/users', { message: 'An agent for the workspaces suite', user: { displayName: 'Agent', externalId: AGENT } })).status).toBe(201);
    expect((await as(AGENT)('POST', `/merge-requests/${id}/close`)).status).toBe(403);
    // The target's owner closes it.
    const closed = await json(await reviewer('POST', `/merge-requests/${id}/close`));
    expect(closed.status).toBe(200);
    expect(closed.body.request).toMatchObject({ status: 'Closed', decidedBy: REVIEWER });
    expect(closed.body.request).not.toHaveProperty('mergeCommit');
    expect(await headMessage('main')).toContain('not merged');
    // Its opener closes their own, without any right over the target.
    const theirs = await workspace(reviewer, THERE);
    const asked = await open(theirs, 'main', reviewer);
    const stranger = await json(await as(AGENT)('POST', `/merge-requests/${idOf(asked.body)}/close`));
    expect(stranger.status).toBe(403);
    expect((await json(await reviewer('POST', `/merge-requests/${idOf(asked.body)}/close`))).body.request.status).toBe('Closed');
  });

  it("a request's health follows its branches: a conflict when the target moved against it, clean again once the source has updated", async () => {
    const method = name('method');
    expect((await on('POST', '/branches', { name: method })).status).toBe(201);
    const shared = `LearningNeed/shared-${stamp}`;
    expect((await on('PUT', `/documents/${shared}?branch=${method}`, need('As first written'))).status).toBe(200);
    const ws = await workspace(on, HERE, method);
    expect((await here('PUT', `/documents/${shared}?branch=${ws}`, need('As the workspace has it'))).status).toBe(200);
    const opened = await open(ws, method);
    const id = idOf(opened.body);
    expect((await json(await on('GET', `/merge-requests/${id}`))).body.health.mergeable).toBe(true);
    // The method's branch moves against it.
    expect((await on('PUT', `/documents/${shared}?branch=${method}`, need('As the method has it'))).status).toBe(200);
    const conflicted = (await json(await on('GET', `/merge-requests/${id}`))).body.health;
    expect(conflicted.mergeable).toBe(false);
    expect(conflicted.conflicts).toEqual([{ id: shared, field: 'label', base: 'As first written', target: 'As the method has it', source: 'As the workspace has it' }]);
    const refused = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('merge_conflict');
    expect((await json(await on('GET', `/merge-requests/${id}`))).body.request.status).toBe('Open');
    // Conflicts are resolved in the source: its owner takes the method's value, which is a write from its own computer, then updates from the parent.
    expect((await here('PUT', `/documents/${shared}?branch=${ws}`, need('As the method has it'))).status).toBe(200);
    expect((await json(await here('POST', `/branches/${ws}/merge`, { message: `Update from ${method}`, from: method }))).status).toBe(200);
    expect((await here('PUT', `/documents/LearningNeed/after-${stamp}?branch=${ws}`, need('And one more'))).status).toBe(200);
    const clean = (await json(await on('GET', `/merge-requests/${id}`))).body.health;
    expect(clean).toMatchObject({ mergeable: true, conflicts: [], violations: [] });
    expect((await json(await on('POST', `/merge-requests/${id}/merge`))).status).toBe(200);
  });

  it('a request with nothing to merge says so: its health is upToDate, and merging it is 409 nothing_to_merge', async () => {
    const branch = name('empty');
    expect((await on('POST', '/branches', { name: branch })).status).toBe(201);
    const opened = await open(branch, 'main');
    const id = idOf(opened.body);
    expect((await json(await on('GET', `/merge-requests/${id}`))).body.health).toMatchObject({ mergeable: false, upToDate: true });
    const merged = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(merged.status).toBe(409);
    expect(merged.body).toMatchObject({ error: 'nothing_to_merge', request: opened.body['@id'] });
    expect((await json(await on('POST', `/merge-requests/${id}/close`))).status).toBe(200);
  });

  it('a request found merged and still Open is recorded from the trailer, and makes no second merge', async () => {
    const { branch } = await work();
    const opened = await open(branch, 'main');
    const id = idOf(opened.body);
    const merged = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(merged.status).toBe(200);
    // The hub stopping between the merge and the record leaves this: the merge on main, the request still Open.
    const me = (await json(await on('GET', '/users/me'))).body as UserDocument;
    await writeDocuments([opened.body as TerminusDocument], { branch: scratch('main'), who: { id: me['@id'], user: me }, message: 'The record as it was before the merge was recorded' });
    expect((await json(await on('GET', `/merge-requests/${id}`))).body).toMatchObject({ request: { status: 'Open' }, health: { upToDate: true, mergeable: false } });
    const head = (await scratch('main').head())!.id;
    const again = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ upToDate: true, commit: merged.body.commit, request: { status: 'Merged', mergeCommit: merged.body.commit } });
    // One commit since: the record. No merge.
    const log = await scratch('main').log({ count: 2 });
    expect(log[1].id).toBe(head);
  });

  it('deleting a branch closes the open requests that name it', async () => {
    const method = name('method');
    expect((await on('POST', '/branches', { name: method })).status).toBe(201);
    const source = name('source');
    expect((await on('POST', '/branches', { name: source, from: { branch: method } })).status).toBe(201);
    const opened = await open(source, method);
    expect((await on('DELETE', `/branches/${source}`)).status).toBe(200);
    const read = (await json(await on('GET', `/merge-requests/${idOf(opened.body)}`))).body;
    expect(read.request).toMatchObject({ status: 'Closed', decidedBy: DESIGNER });
    expect(await headMessage('main')).toContain('1 open merge request(s) naming it closed');
  });

  it("the gate's refusals come through a request as through a merge: pending, failed, then passed with the Armature-Check trailer beside the request's", async () => {
    const REPORTER = `agent:test/ws-gate-${stamp}`;
    const registered = await json(await on('POST', '/users', { message: 'A check service', user: { displayName: 'Gate', externalId: REPORTER } }));
    const method = name('gated');
    expect((await on('POST', '/branches', { name: method })).status).toBe(201);
    const LINT = `ws/lint-${stamp}`;
    const PARAMS = { severity: 'error' };
    const requirement = { '@type': 'CheckRequirement', check: LINT, branch: method, reporter: registered.body.id, level: 'Required', locked: false, params: PARAMS, status: 'Active' };
    expect((await on('POST', '/documents?branch=main', { message: 'Lint before anything merges here', documents: [requirement] })).status).toBe(200);
    const { branch, head } = await work(method);
    const opened = await open(branch, method);
    const id = idOf(opened.body);
    const report = (conclusion: string) => as(REPORTER)('POST', '/checks/runs', { check: LINT, branch, commit: head, conclusion, paramsHash: paramsHash(PARAMS) });

    expect((await json(await on('GET', `/merge-requests/${id}`))).body.health).toMatchObject({ mergeable: false, checks: [expect.objectContaining({ check: LINT, conclusion: 'pending' })] });
    const pending = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(pending.status).toBe(409);
    expect(pending.body.error).toBe('checks_pending');
    expect((await report('fail')).status).toBe(201);
    const failed = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(failed.status).toBe(422);
    expect(failed.body.error).toBe('checks_failed');
    expect((await json(await on('GET', `/merge-requests/${id}`))).body.request.status).toBe('Open');
    expect((await report('pass')).status).toBe(201);
    expect((await json(await on('GET', `/merge-requests/${id}`))).body.health.mergeable).toBe(true);
    const merged = await json(await on('POST', `/merge-requests/${id}/merge`));
    expect(merged.status).toBe(200);
    const message = await headMessage(method);
    expect(message).toContain(`Armature-Check: ${LINT} pass`);
    expect(message).toContain(`Armature-Merge-Request: ${opened.body['@id']}`);
  });

  it('the trailer is the hub\'s: a client\'s message carrying it is refused on any write', async () => {
    const { branch } = await work();
    const res = await json(await on('PUT', `/documents/LearningNeed/forged-${stamp}?branch=${branch}`, { message: 'A write\n\nArmature-Merge-Request: MergeRequest/x', document: { label: 'x', rationale: 'r' } }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('reserved_trailer');
  });
});

describe('what the hub says of itself, and the client (ADR-0059 decision 4)', () => {
  it('discover lists armature/merge-requests on a remote, with the merges it is required for, and workspaces under branches', async () => {
    const body = (await json(await on('GET', '/discover'))).body;
    expect(body.capabilities['armature/merge-requests']).toEqual({ fallback: 'reject', required: ['from a workspace', 'into main'] });
    expect(body.capabilities['armature/branches'].workspaces).toBe('linked');
    expect(capabilitiesOf('workspace').map(([id]) => id)).not.toContain('armature/merge-requests');
  });

  it('@armature/client carries the link, creates a workspace, and opens, reads and merges a request', async () => {
    const fetch = (input: string | URL | Request, init?: RequestInit) => hub.request(input as string, init);
    const client = createClient({ baseUrl: 'http://localhost', user: 'demo-designer@example.edu', workspaceLink: HERE, fetch });
    const elsewhere = createClient({ baseUrl: 'http://localhost', user: 'demo-designer@example.edu', fetch });
    const branch = name('client');
    const made = await client.branches.create(branch, { branch: 'main' }, { workspace: { link: HERE, linkLabel: 'Office' } });
    expect(made.data.workspace).toEqual({ parent: 'main', linked: true });
    expect((await client.workspaces.get(branch)).data).toMatchObject({ branch, linkLabel: 'Office' });
    expect((await client.workspaces.list({ owner: 'me', linked: true })).data.map((w) => w.branch)).toContain(branch);
    await client.documents.put('LearningNeed', `client-${stamp}`, { branch, message: 'From the client', document: { label: 'Client', rationale: 'r' } });
    await expect(elsewhere.documents.put('LearningNeed', `client-${stamp}`, { branch, message: 'x', document: { label: 'x', rationale: 'r' } })).rejects.toMatchObject({ status: 409, code: 'held_elsewhere', details: { linkLabel: 'Office' } });
    await expect(elsewhere.branches.merge('main', { message: 'Direct', from: branch })).rejects.toMatchObject({ code: 'request_required' });
    const opened = (await elsewhere.mergeRequests.open({ source: branch, target: 'main', message: 'From the client' })).data;
    expect((await elsewhere.mergeRequests.list({ source: branch, status: 'Open' })).data).toHaveLength(1);
    expect((await elsewhere.mergeRequests.get(opened['@id'])).data.health?.mergeable).toBe(true);
    const merged = (await elsewhere.mergeRequests.merge(opened['@id'])).data;
    expect(merged.request).toMatchObject({ status: 'Merged', mergeCommit: merged.commit });
    expect((await elsewhere.workspaces.unlink(branch)).data).toMatchObject({ unlinked: true, was: { linkLabel: 'Office' } });
    expect((await client.workspaces.link(branch, { link: HERE })).data.link).toBe(HERE);
    const other = name('client');
    await elsewhere.branches.create(other);
    expect((await client.workspaces.adopt({ branch: other, link: HERE })).data).toMatchObject({ branch: other, parent: 'main' });
    const second = (await elsewhere.mergeRequests.open({ source: other, target: 'main', message: 'Nothing yet' })).data;
    expect((await elsewhere.mergeRequests.close(second['@id'])).data.request.status).toBe('Closed');
  });
});
