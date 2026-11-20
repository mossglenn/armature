/**
 * The workspace cycle (docs/workspace-hub-plan.md §13, "The cycle"; ADR-0065
 * decisions 5 and 6; ADR-0072): create a workspace linked to this
 * installation, write, push, update from its parent, resolve a conflict, open
 * a merge request and merge it, unlink and link, with the remote checking its
 * merges before they commit. A merged request
 * writes to the remote's main, which the contract suite never does on the
 * seeded store, so the remote here runs over a scratch database of its own
 * (the seed's export, loaded as authorization.test.ts loads it) on an
 * ephemeral port, and the workspace hub in-process over a second scratch
 * database; both are deleted afterwards.
 */
import { createClient } from '@armature/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startHub, type RunningHub } from '../hub';
import { app, createApp } from './app';
import { paramsHash } from './checks';
import { configFromEnv, type HubConfig } from './config';
import { handleOf } from './routes/workspace';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from './store';
import { memoryRecords, type PushTable, type WorkspaceRecords } from './workspace/records';
import { memoryFiles, type StoreFiles } from './filestore/files';
import { openFileStore } from './filestore/store';

// A merge request's health is a merge check on the remote each time it is read, and several tests read it more than once.
vi.setConfig({ testTimeout: 60_000 });

// The suite runs over the one local store, a file store in memory (ADR-0066 decision 4); the two-store contract test holds it to the remote's store.
describe('over the file-backed store in memory', () => {

  const stamp = Date.now().toString(36);
  const REMOTE_DB = `${process.env.TERMINUS_DB}_cycle_remote_${stamp}`;
  const DESIGNER = 'demo-designer@example.edu';
  const REVIEWER = 'demo-reviewer@example.edu';
  const NAME = `cycle-${stamp}`;
  const WS = `${handleOf(DESIGNER)}_${NAME}`;
  const MINE = `LearningNeed/cycle-mine-${stamp}`;
  const THEIRS = `LearningNeed/cycle-theirs-${stamp}`;
  const LATER = `LearningNeed/cycle-later-${stamp}`;

  let remote: RunningHub;
  let config: HubConfig;
  let workspace: ReturnType<typeof createApp>;
  let onMain: ReturnType<typeof createClient>;
  /** The workspace hub's pairing key, which every write to it carries (ADR-0065 decision 7). */
  const TOKEN = `cycle-token-${stamp}`;
  /** This hub's installation, as its host would have drawn it (ADR-0072 decision 2), and a second computer's. */
  const INSTALLATION = `c1c1c1c1c1c1c1c1${stamp.padStart(16, '0')}`;
  const OTHER_COMPUTER = `d2d2d2d2d2d2d2d2${stamp.padStart(16, '0')}`;
  const headers = (user: string) => ({ 'Content-Type': 'application/json', 'Armature-User': user, 'Armature-Local-Token': TOKEN });
  const on = (method: string, path: string, body?: unknown, user = DESIGNER) =>
    workspace.request(`/api/v1${path}`, { method, headers: headers(user), body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (res: Response) => ({ status: res.status, body: await res.json() });
  const need = (label: string, rationale = 'r') => ({ message: `Need ${label}`, document: { label, rationale } });
  const remoteStore = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: REMOTE_DB });
  // The local store's files, with one removal made to fail when a test asks: what a sync client holding a file does.
  let failRemovalOf: string | undefined;
  const files: StoreFiles = (() => {
    const inner = memoryFiles();
    return {
      ...inner,
      async remove(path) {
        if (failRemovalOf !== undefined && path.startsWith(failRemovalOf)) {
          failRemovalOf = undefined;
          throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${path}'`), { code: 'EBUSY' });
        }
        await inner.remove(path);
      },
    };
  })();
  const localConfig = { files: openFileStore(files) };
  // The records, with one save of a push table made to fail when a test asks: the process ending there.
  let failSaveOf: ((table: PushTable) => boolean) | undefined;
  // The owner's checks.json, as the host would have written it; no route writes it.
  let personalChecks: string | undefined;
  const records: WorkspaceRecords = (() => {
    const inner = memoryRecords(() => personalChecks);
    return {
      ...inner,
      async putPush(branch, table) {
        if (failSaveOf?.(table)) {
          failSaveOf = undefined;
          throw new Error('The process ended here');
        }
        await inner.putPush(branch, table);
      },
    };
  })();
  const localStore = (branch: string) => createOperatorStore({ branch }, localConfig);

  beforeAll(async () => {
    const exported = (await json(await app.request('/api/v1/export'))).body as { schema: Record<string, unknown>[]; documents: TerminusDocument[] };
    const main = remoteStore('main');
    await main.ensureDatabase();
    await main.replaceSchema(exported.schema, { author: 'User/demo-designer', message: 'The seed schema, for the cycle suite' });
    // The copy must hold every commit an asOf names, since the remote now checks a
    // merge over the whole branch (constraint 13): the undated records first, then
    // the dated ones with their asOf naming that commit, where their subjects exist.
    const dated = exported.documents.filter((doc) => doc.asOf !== undefined);
    const { commit: undated } = await main.insertDocuments(
      exported.documents.filter((doc) => doc.asOf === undefined),
      { author: 'User/demo-designer', message: 'The seed, for the cycle suite' }
    );
    await main.insertDocuments(
      dated.map((doc) => ({ ...doc, asOf: undated })),
      { author: 'User/demo-designer', message: 'The seed\'s dated records, for the cycle suite' }
    );
    remote = await startHub({ port: 0, config: { ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), db: REMOTE_DB }) } });
    config = { ...configFromEnv(), role: 'workspace', remote: remote.url, workspaces: records, store: () => localConfig, localToken: TOKEN, actionRoutes: true, installation: { id: INSTALLATION, label: 'Cycle test' } };
    workspace = createApp(() => config);
    onMain = createClient({ baseUrl: remote.url, user: DESIGNER });
  });

  afterAll(async () => {
    await remote?.close();
    await remoteStore('main').deleteDatabase().catch(() => undefined);
    await localStore('main').deleteDatabase().catch(() => undefined);
  });

  describe('the cycle: create, write, push, update, resolve, open a merge request, merge', () => {
    let mergeCommit: string;

    it('creates the workspace and pushes a local commit', async () => {
      const made = await json(await on('POST', '/workspace', { name: NAME }));
      expect(made.status).toBe(201);
      expect(made.body).toMatchObject({ branch: WS, from: 'main', link: INSTALLATION });
      // On the remote it is a workspace, linked to this installation under the name its owner gave the computer.
      expect((await onMain.workspaces.get(WS)).data).toMatchObject({ branch: WS, parent: 'main', owner: 'User/demo-designer', link: INSTALLATION, linkLabel: 'Cycle test', status: 'Active' });
      expect((await on('PUT', `/documents/${MINE}?branch=${WS}`, need('mine'))).status).toBe(200);
      const pushed = await json(await on('POST', `/workspace/${WS}/push`));
      expect(pushed.status).toBe(200);
      expect(pushed.body.pushed).toHaveLength(1);
      expect((await json(await on('GET', `/workspace/${WS}/status`))).body.remote).toMatchObject({ link: 'here' });
      // The remote takes the push from this installation and from nowhere else: the owner's own write from a browser is refused.
      await expect(onMain.documents.put('LearningNeed', `cycle-elsewhere-${stamp}`, { branch: WS, message: 'From a browser', document: { label: 'x', rationale: 'r' } })).rejects.toMatchObject({
        status: 409,
        code: 'held_elsewhere',
        details: { linkLabel: 'Cycle test' },
      });
    });

    it("brings in main after it moved: the remote's merge, read back as one local commit the table maps", async () => {
      const theirs = await onMain.documents.put('LearningNeed', THEIRS, { message: 'Work on main', document: { label: 'theirs', rationale: 'base' } });
      expect(theirs.data.commit).toBeTruthy();
      const res = await json(await on('POST', `/workspace/${WS}/bring-in`, { message: 'Catch up with main' }));
      expect(res.status).toBe(200);
      expect(res.body.upToDate).toBe(false);
      expect(res.body.broughtIn.documents).toBe(1);
      mergeCommit = res.body.remoteHead;
      expect((await onMain.branches.head(WS)).data.head.commit).toBe(mergeCommit);

      const local = await json(await on('GET', `/documents/${THEIRS}?branch=${WS}`));
      expect(local.status).toBe(200);
      expect(local.body.rationale).toBe('base');
      const status = (await json(await on('GET', `/workspace/${WS}/status`))).body;
      expect(status).toMatchObject({ localCommits: 2, pushed: 2, unpushed: 0, remote: { head: mergeCommit, moved: false } });
      const table = await config.workspaces!.getPush(WS);
      expect(table!.commits.at(-1)).toMatchObject({ remote: mergeCommit, parts: 0, broughtIn: true });
    });

    it('a second bring-in with nothing new is up to date; one with unpushed work is refused', async () => {
      const quiet = await json(await on('POST', `/workspace/${WS}/bring-in`));
      expect(quiet.status).toBe(200);
      expect(quiet.body).toMatchObject({ upToDate: true, remoteHead: mergeCommit });
      expect((await on('PUT', `/documents/${MINE}?branch=${WS}`, need('mine', 'edited'))).status).toBe(200);
      const refused = await json(await on('POST', `/workspace/${WS}/bring-in`));
      expect(refused.status).toBe(409);
      expect(refused.body.error).toBe('unpushed_commits');
      expect((await on('POST', `/workspace/${WS}/push`)).status).toBe(200);
    });

    it("a conflict comes back as the remote's; restoring the base locally, pushing and bringing in again clears it (check Z)", async () => {
      expect((await onMain.documents.put('LearningNeed', THEIRS, { message: 'Theirs', document: { label: 'theirs', rationale: 'their edit' } })).data.commit).toBeTruthy();
      expect((await on('PUT', `/documents/${THEIRS}?branch=${WS}`, need('theirs', 'my edit'))).status).toBe(200);
      expect((await on('POST', `/workspace/${WS}/push`)).status).toBe(200);
      const conflicted = await json(await on('POST', `/workspace/${WS}/bring-in`));
      expect(conflicted.status).toBe(409);
      expect(conflicted.body).toMatchObject({ error: 'merge_conflict', remote: true });
      expect(conflicted.body.conflicts).toEqual([{ id: THEIRS, field: 'rationale', base: 'base', target: 'my edit', source: 'their edit' }]);

      // The resolution (plan §6): restore the base, push, bring in clean, then write the resolution.
      expect((await on('PUT', `/documents/${THEIRS}?branch=${WS}`, need('theirs', 'base'))).status).toBe(200);
      expect((await on('POST', `/workspace/${WS}/push`)).status).toBe(200);
      const clean = await json(await on('POST', `/workspace/${WS}/bring-in`));
      expect(clean.status).toBe(200);
      expect(clean.body.broughtIn.documents).toBe(1);
      expect((await json(await on('GET', `/documents/${THEIRS}?branch=${WS}`))).body.rationale).toBe('their edit');
      expect((await on('PUT', `/documents/${THEIRS}?branch=${WS}`, need('theirs', 'resolved'))).status).toBe(200);
      expect((await on('POST', `/workspace/${WS}/push`)).status).toBe(200);
    });

    it('a merge request sends the work on: opened with nothing unpushed, its health the remote\'s, merged by an owner who may, the workspace deleted', async () => {
      // main moves again, on other records: no update is needed first, since nothing conflicts and no check is required.
      expect((await onMain.documents.put('LearningNeed', LATER, { message: 'Later on main', document: { label: 'later', rationale: 'r' } })).data.commit).toBeTruthy();
      expect((await json(await on('GET', `/workspace/${WS}/merge-request`))).body).toEqual({ workspace: WS, parent: 'main', mayMerge: true });
      // A request is about what the remote holds, so nothing may be unpushed.
      expect((await on('PUT', `/documents/${MINE}?branch=${WS}`, need('mine', 'edited again'))).status).toBe(200);
      const early = await json(await on('POST', `/workspace/${WS}/merge-request`, { message: 'Deliver the cycle' }));
      expect(early.status).toBe(409);
      expect(early.body.error).toBe('unpushed_commits');
      expect((await on('POST', `/workspace/${WS}/push`)).status).toBe(200);
      expect((await json(await on('POST', `/workspace/${WS}/merge-request`, { message: '' }))).body.error).toBe('message_required');

      const opened = await json(await on('POST', `/workspace/${WS}/merge-request`, { message: 'Deliver the cycle' }));
      expect(opened.status).toBe(201);
      expect(opened.body).toMatchObject({
        workspace: WS,
        parent: 'main',
        mayMerge: true,
        request: { source: WS, target: 'main', status: 'Open', message: 'Deliver the cycle', openedBy: 'User/demo-designer' },
        health: { mergeable: true, upToDate: false, conflicts: [], violations: [] },
      });
      const again = await json(await on('POST', `/workspace/${WS}/merge-request`, { message: 'Once more' }));
      expect(again.status).toBe(409);
      expect(again.body).toMatchObject({ error: 'request_open', remote: true, request: opened.body.request['@id'] });
      expect((await json(await on('GET', `/workspace/${WS}/merge-request`))).body.request['@id']).toBe(opened.body.request['@id']);
      // The work leaves a workspace only this way: the remote refuses the direct merge delivery used to make.
      await expect(onMain.branches.merge('main', { from: WS, message: 'Direct' })).rejects.toMatchObject({ status: 409, code: 'request_required' });

      const merged = await json(await on('POST', `/workspace/${WS}/merge-request/merge`, { deleteWorkspace: true }));
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      expect(merged.body).toMatchObject({ deleted: true, merged: { upToDate: false }, request: { status: 'Merged', mergeCommit: merged.body.merged.commit } });
      const main = await onMain.documents.get('LearningNeed', THEIRS);
      expect(main.data.rationale).toBe('resolved');
      expect((await onMain.documents.get('LearningNeed', MINE)).data.rationale).toBe('edited again');
      // Three commits on main: the merge, with the request's message and the hub's trailer; the record, Merged; and the
      // deletion, which revoked the branch's grant and closed its workspace record.
      const log = (await onMain.branches.log('main', { count: 3 })).data.commits;
      expect(log[2]).toMatchObject({ commit: merged.body.merged.commit, message: `Deliver the cycle\n\nArmature-Merge-Request: ${opened.body.request['@id']}` });
      expect(log[1].message).toContain('Merge request merged by demo-designer@example.edu');
      expect(log[0].message).toContain('its workspace record closed');
      await expect(onMain.branches.head(WS)).rejects.toMatchObject({ status: 404 });
      await expect(onMain.workspaces.get(WS)).rejects.toMatchObject({ status: 404 });
      expect((await onMain.workspaces.list({ status: 'Closed' })).data.map((w) => w.branch)).toContain(WS);
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).not.toContain(WS);
      expect(await localStore('main').listBranches()).not.toContain(WS);
      expect((await json(await on('POST', `/workspace/${WS}/merge-request/merge`))).status).toBe(404);
    });

    it("the reviewer, who may not merge into main, opens the request and is refused the merge with the remote's 403; a maintainer merges it there", async () => {
      const R = `${handleOf(REVIEWER)}_${NAME}`;
      expect((await on('POST', '/workspace', { name: NAME }, REVIEWER)).status).toBe(201);
      expect((await on('PUT', `/documents/LearningNeed/cycle-reviewer-${stamp}?branch=${R}`, need('reviewer'), REVIEWER)).status).toBe(200);
      expect((await on('POST', `/workspace/${R}/push`, undefined, REVIEWER)).status).toBe(200);
      expect((await json(await on('POST', `/workspace/${R}/bring-in`, undefined, REVIEWER))).body.upToDate).toBe(true);
      const opened = await json(await on('POST', `/workspace/${R}/merge-request`, { message: 'A need from the reviewer' }, REVIEWER));
      expect(opened.status).toBe(201);
      expect(opened.body).toMatchObject({ mayMerge: false, request: { status: 'Open', openedBy: 'User/demo-reviewer' }, health: { mergeable: true } });
      const refused = await json(await on('POST', `/workspace/${R}/merge-request/merge`, undefined, REVIEWER));
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: 'forbidden', remote: true, permission: 'merge', branch: 'main' });
      // No one else acts on a workspace through this hub.
      for (const action of ['merge-request', 'merge-request/merge', 'merge-request/close']) {
        const notTheirs = await json(await on('POST', `/workspace/${R}/${action}`, { message: 'x' }));
        expect(notTheirs.status).toBe(403);
        expect(notTheirs.body).toMatchObject({ error: 'forbidden', permission: 'merge-request', owner: REVIEWER });
      }
      // Whoever may merge into the target decides, on the remote; the reviewer's hub then shows no open request.
      const decided = (await onMain.mergeRequests.merge(opened.body.request['@id'])).data;
      expect(decided.request).toMatchObject({ status: 'Merged', decidedBy: 'User/demo-designer' });
      expect((await json(await on('GET', `/workspace/${R}/merge-request`, undefined, REVIEWER))).body).toEqual({ workspace: R, parent: 'main', mayMerge: false });
      // And a request the opener thinks better of is closed from the hub.
      expect((await on('PUT', `/documents/LearningNeed/cycle-reviewer-2-${stamp}?branch=${R}`, need('second thoughts'), REVIEWER)).status).toBe(200);
      expect((await on('POST', `/workspace/${R}/push`, undefined, REVIEWER)).status).toBe(200);
      expect((await on('POST', `/workspace/${R}/merge-request`, { message: 'Another' }, REVIEWER)).status).toBe(201);
      const closed = await json(await on('POST', `/workspace/${R}/merge-request/close`, undefined, REVIEWER));
      expect(closed.status).toBe(200);
      expect(closed.body.request).toMatchObject({ status: 'Closed', decidedBy: 'User/demo-reviewer' });
      expect((await json(await on('POST', `/workspace/${R}/merge-request/close`, undefined, REVIEWER))).body.error).toBe('no_request');
    });
  });

  // The three actions hold the workspace's write queue from their check that nothing is unpushed to their
  // last local write (ADR-0025 decision 7, note of 2026-11-11; the 2026-11-09 review's W3 and W4). Each test
  // sends a tool's write together with the action: whichever takes the queue first, a write answered 200 stands.
  describe('a write sent together with an action', () => {
    const listed = async () => (await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch) as string[];

    it('is never answered 200 and then deleted with the workspace by a removal', async () => {
      for (let round = 0; round < 3; round++) {
        const name = `${NAME}-race-remove-${round}`;
        const branch = `${handleOf(DESIGNER)}_${name}`;
        const id = `LearningNeed/race-remove-${round}-${stamp}`;
        expect((await on('POST', '/workspace', { name })).status).toBe(201);
        const [removed, written] = await Promise.all([on('DELETE', `/workspace/${branch}`), on('PUT', `/documents/${id}?branch=${branch}`, need('late'))]);
        if (written.status === 200) {
          expect(removed.status).toBe(409);
          expect((await removed.json()).error).toBe('unpushed_commits');
          expect(await listed()).toContain(branch);
          expect((await on('GET', `/documents/${id}?branch=${branch}`)).status).toBe(200);
        } else {
          expect(removed.status).toBe(200);
          expect(written.status).toBe(404);
        }
      }
    });

    it('is never answered 200 and then deleted with the workspace by a merge that deletes it', async () => {
      const name = `${NAME}-race-deliver`;
      const branch = `${handleOf(DESIGNER)}_${name}`;
      const id = `LearningNeed/race-deliver-${stamp}`;
      expect((await on('POST', '/workspace', { name })).status).toBe(201);
      expect((await on('PUT', `/documents/LearningNeed/race-deliver-first-${stamp}?branch=${branch}`, need('first'))).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/push`)).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/bring-in`)).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/merge-request`, { message: 'Merge, with a write beside it' })).status).toBe(201);
      const [delivered, written] = await Promise.all([
        on('POST', `/workspace/${branch}/merge-request/merge`, { deleteWorkspace: true }),
        on('PUT', `/documents/${id}?branch=${branch}`, need('late')),
      ]);
      if (written.status === 200) {
        expect(delivered.status).toBe(409);
        expect(await listed()).toContain(branch);
        expect((await on('GET', `/documents/${id}?branch=${branch}`)).status).toBe(200);
      } else {
        expect(delivered.status).toBe(200);
        expect(written.status).toBe(404);
      }
    });

    it('is never answered 200 and then overwritten by what a bring-in read back', async () => {
      for (let round = 0; round < 3; round++) {
        const name = `${NAME}-race-bring-in-${round}`;
        const branch = `${handleOf(DESIGNER)}_${name}`;
        const id = `LearningNeed/race-bring-in-${round}-${stamp}`;
        await onMain.documents.put('LearningNeed', id, { message: 'On main before the workspace', document: { label: 'shared', rationale: 'base' } });
        expect((await on('POST', '/workspace', { name })).status).toBe(201);
        await onMain.documents.put('LearningNeed', id, { message: 'Main moves', document: { label: 'shared', rationale: 'their edit' } });
        const [brought, written] = await Promise.all([
          on('POST', `/workspace/${branch}/bring-in`),
          on('PUT', `/documents/${id}?branch=${branch}`, need('shared', 'my edit')),
        ]);
        const local = (await json(await on('GET', `/documents/${id}?branch=${branch}`))).body.rationale;
        if (written.status === 200) {
          // The write went first, so the bring-in found it unpushed; or it waited and landed on what was brought in.
          expect(local).toBe('my edit');
          if (brought.status !== 200) expect((await brought.json()).error).toBe('unpushed_commits');
        } else {
          // The write waited, and the bring-in had changed the document it replaces (ADR-0025 decision 7).
          expect(brought.status).toBe(200);
          expect(written.status).toBe(409);
          expect((await written.json()).error).toBe('document_moved');
          expect(local).toBe('their edit');
        }
      }
    });
  });

  // A bring-in the remote merged and this hub did not finish (workspace/merged.ts; the 2026-11-09 review's
  // W4, "related"): the marker in push.json lets the next bring-in or push settle it.
  describe('a bring-in that did not finish', () => {
    const status = async (branch: string) => (await json(await on('GET', `/workspace/${branch}/status`))).body;
    const local = async (branch: string, id: string) => (await json(await on('GET', `/documents/${id}?branch=${branch}`))).body.rationale;
    /** A workspace holding `id` as main had it, main then moved on it, and a bring-in ended at `where`. */
    async function interrupted(label: string, where: (table: PushTable) => boolean): Promise<{ branch: string; id: string }> {
      const name = `${NAME}-${label}`;
      const branch = `${handleOf(DESIGNER)}_${name}`;
      const id = `LearningNeed/${label}-${stamp}`;
      await onMain.documents.put('LearningNeed', id, { message: 'On main before the workspace', document: { label, rationale: 'base' } });
      expect((await on('POST', '/workspace', { name })).status).toBe(201);
      await onMain.documents.put('LearningNeed', id, { message: 'Main moves', document: { label, rationale: 'their edit' } });
      failSaveOf = where;
      expect((await on('POST', `/workspace/${branch}/bring-in`)).status).toBe(500);
      expect(failSaveOf).toBeUndefined();
      return { branch, id };
    }
    /** The save after the remote answered with its merge commit: merged there, nothing read back here. */
    const afterTheMerge = (table: PushTable) => table.bringingIn?.merged !== undefined;
    /** The save of the table's entry: the local commit made, the table not told. */
    const beforeTheEntry = (table: PushTable) => table.bringingIn === undefined && table.commits.at(-1)?.broughtIn === true;

    it('is finished by the next bring-in, from the remote’s log', async () => {
      const { branch, id } = await interrupted('settle-bring-in', afterTheMerge);
      expect(await local(branch, id)).toBe('base');
      expect((await status(branch)).remote.moved).toBe(true);

      const again = await json(await on('POST', `/workspace/${branch}/bring-in`));
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toMatchObject({ upToDate: false, broughtIn: { documents: 1 } });
      expect(await local(branch, id)).toBe('their edit');
      expect(await status(branch)).toMatchObject({ localCommits: 1, pushed: 1, unpushed: 0, remote: { moved: false } });
      expect((await records.getPush(branch))?.bringingIn).toBeUndefined();
    });

    it('is finished by the next push, which then replays a commit made since on other documents', async () => {
      const { branch, id } = await interrupted('settle-push', afterTheMerge);
      const mine = `LearningNeed/settle-push-mine-${stamp}`;
      expect((await on('PUT', `/documents/${mine}?branch=${branch}`, need('mine'))).status).toBe(200);
      const pushed = await json(await on('POST', `/workspace/${branch}/push`));
      expect(pushed.status, JSON.stringify(pushed.body)).toBe(200);
      expect(pushed.body.pushed).toHaveLength(1);
      expect(await local(branch, id)).toBe('their edit');
      expect(await status(branch)).toMatchObject({ localCommits: 2, pushed: 2, unpushed: 0, remote: { moved: false } });
      // Here and on the remote the branch holds the same two documents.
      expect((await onMain.documents.get('LearningNeed', id, { branch })).data.rationale).toBe('their edit');
      expect((await onMain.documents.get('LearningNeed', mine, { branch })).data.rationale).toBe('r');
    });

    it('is refused, naming the documents, when a commit made since changed one the merge changed', async () => {
      const { branch, id } = await interrupted('settle-overlap', afterTheMerge);
      expect((await on('PUT', `/documents/${id}?branch=${branch}`, need('settle-overlap', 'my edit'))).status).toBe(200);
      for (const action of ['bring-in', 'push']) {
        const refused = await json(await on('POST', `/workspace/${branch}/${action}`));
        expect(refused.status).toBe(409);
        expect(refused.body).toMatchObject({ error: 'unpushed_commits', overlapping: [id] });
      }
      expect(await local(branch, id)).toBe('my edit');
      // The way out (the review's D6): the one commit given up, the unfinished bring-in's marker with it.
      const discarded = await json(await on('DELETE', `/workspace/${branch}?discard=1`));
      expect(discarded.status, JSON.stringify(discarded.body)).toBe(200);
      // The discard clears this computer's link too, since the remote answers (ADR-0072 decision 4).
      expect(discarded.body).toMatchObject({ remote: 'untouched', link: 'cleared', discarded: { commits: [expect.any(String)] } });
      expect(await records.get(branch)).toBeUndefined();
      expect(await records.getPush(branch)).toBeUndefined();
      // The remote's branch, with its merge, is as it was, an unlinked workspace, and is linked again as it stands.
      expect((await on('POST', '/workspace', { link: branch })).status).toBe(201);
      expect(await local(branch, id)).toBe('their edit');
    });

    it('takes the local commit already made as the bring-in, by what it holds, when only the table’s entry was missing', async () => {
      const { branch, id } = await interrupted('settle-entry', beforeTheEntry);
      expect(await local(branch, id)).toBe('their edit');
      expect(await status(branch)).toMatchObject({ localCommits: 1, pushed: 0 });
      const again = await json(await on('POST', `/workspace/${branch}/bring-in`));
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toMatchObject({ upToDate: false, broughtIn: { documents: 1 } });
      expect(await status(branch)).toMatchObject({ localCommits: 1, pushed: 1, unpushed: 0, remote: { moved: false } });
    });

    it('leaves nothing behind when the merge never landed, and the usual 412 when someone else wrote the branch instead', async () => {
      const name = `${NAME}-settle-none`;
      const branch = `${handleOf(DESIGNER)}_${name}`;
      expect((await on('POST', '/workspace', { name })).status).toBe(201);
      const record = (await records.get(branch))!;
      const marker = { ifMatch: record.base, localHead: record.local, sentAt: new Date().toISOString() };
      await records.putPush(branch, { commits: [], bringingIn: marker });
      expect((await json(await on('POST', `/workspace/${branch}/bring-in`))).body).toMatchObject({ upToDate: true });
      expect((await records.getPush(branch))?.bringingIn).toBeUndefined();

      // Something writes the branch on the remote with this installation's link, which only a copied identifier
      // could now (ADR-0072 decision 2): not a merge, so not this hub's bring-in.
      const copied = createClient({ baseUrl: remote.url, user: DESIGNER, workspaceLink: INSTALLATION });
      await copied.documents.put('LearningNeed', `settle-none-${stamp}`, { branch, message: 'Written on the remote', document: { label: 'elsewhere', rationale: 'r' } });
      await records.putPush(branch, { commits: [], bringingIn: marker });
      const moved = await json(await on('POST', `/workspace/${branch}/bring-in`));
      expect(moved.status).toBe(412);
      expect((await records.getPush(branch))?.bringingIn).toBeUndefined();
    });
  });

  // Removing a workspace (since 2026-11-07): this machine's copy goes with nothing unpushed, and the
  // remote deletes the branch only when another holds its head (ADR-0025 decision 6).
  describe('removing a workspace', () => {
    const KEPT = `${handleOf(DESIGNER)}_${NAME}-kept`;
    const GONE = `${handleOf(DESIGNER)}_${NAME}-gone`;
    const write = (branch: string, id: string) => on('PUT', `/documents/LearningNeed/${id}?branch=${branch}`, need(id));

    it('refuses with anything unpushed, then removes only this copy of a branch main does not hold', async () => {
      expect((await on('POST', '/workspace', { name: `${NAME}-kept` })).status).toBe(201);
      expect((await write(KEPT, `remove-kept-${stamp}`)).status).toBe(200);
      const early = await json(await on('DELETE', `/workspace/${KEPT}`));
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ error: 'unpushed_commits' });
      expect((await on('POST', `/workspace/${KEPT}/push`)).status).toBe(200);

      const removed = await json(await on('DELETE', `/workspace/${KEPT}`));
      expect(removed.status).toBe(200);
      expect(removed.body).toMatchObject({ workspace: { branch: KEPT }, remote: 'kept', reason: 'unmerged', link: 'cleared' });
      // Gone here; the remote keeps the branch, now as an unlinked workspace, which can be linked again (ADR-0072 decision 4).
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).not.toContain(KEPT);
      expect(await localStore('main').listBranches()).not.toContain(KEPT);
      expect((await onMain.branches.head(KEPT)).data.head.commit).toBeTruthy();
      const there = (await onMain.workspaces.get(KEPT)).data;
      expect(there.status).toBe('Active');
      expect(there).not.toHaveProperty('link');
      expect((await json(await on('GET', '/workspace/elsewhere'))).body.unlinked).toContainEqual({ branch: KEPT, parent: 'main' });
      expect((await json(await on('POST', '/workspace', { existing: KEPT }))).status).toBe(400);
      const linked = await json(await on('POST', '/workspace', { link: KEPT }));
      expect(linked.status).toBe(201);
      expect(linked.body).toMatchObject({ branch: KEPT, from: 'main', link: INSTALLATION });
      expect((await on('GET', `/documents/LearningNeed/remove-kept-${stamp}?branch=${KEPT}`)).status).toBe(200);
    });

    it('removes the branch from the remote too once main holds its head, as after a merge that kept the workspace', async () => {
      expect((await on('POST', '/workspace', { name: `${NAME}-gone` })).status).toBe(201);
      expect((await write(GONE, `remove-gone-${stamp}`)).status).toBe(200);
      expect((await on('POST', `/workspace/${GONE}/push`)).status).toBe(200);
      expect((await on('POST', `/workspace/${GONE}/bring-in`)).status).toBe(200);
      expect((await on('POST', `/workspace/${GONE}/merge-request`, { message: 'Merged, kept' })).status).toBe(201);
      const delivered = await json(await on('POST', `/workspace/${GONE}/merge-request/merge`));
      expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
      expect(delivered.body.deleted).toBe(false);

      const removed = await json(await on('DELETE', `/workspace/${GONE}`));
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(removed.body).toMatchObject({ remote: 'deleted' });
      expect(removed.body).not.toHaveProperty('link');
      await expect(onMain.branches.head(GONE)).rejects.toMatchObject({ status: 404 });
      await expect(onMain.workspaces.get(GONE)).rejects.toMatchObject({ status: 404 });
      expect(await localStore('main').listBranches()).not.toContain(GONE);
      // A second removal finds nothing here to remove.
      expect((await on('DELETE', `/workspace/${GONE}`)).status).toBe(404);
    });

    it('is finished by asking again after a removal that failed partway (the 2026-11-09 review’s W2)', async () => {
      const TWICE = `${handleOf(DESIGNER)}_${NAME}-twice`;
      expect((await on('POST', '/workspace', { name: `${NAME}-twice` })).status).toBe(201);
      expect((await write(TWICE, `remove-twice-${stamp}`)).status).toBe(200);
      expect((await on('POST', `/workspace/${TWICE}/push`)).status).toBe(200);
      // The head goes, then a commit file is held by another program.
      failRemovalOf = `${TWICE}/commits/`;
      expect((await on('DELETE', `/workspace/${TWICE}`)).status).toBe(500);
      expect(failRemovalOf).toBeUndefined();
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).toContain(TWICE);

      const again = await json(await on('DELETE', `/workspace/${TWICE}`));
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toMatchObject({ remote: 'kept', reason: 'unmerged' });
      // The first try had cleared the link before it failed, so the second finds none of this installation's to clear.
      expect(['cleared', 'not_ours']).toContain(again.body.link);
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).not.toContain(TWICE);
      expect(await localStore('main').listBranches()).not.toContain(TWICE);
    });

    // A discard (since 2026-11-12; ADR-0065 decision 6, note; the 2026-11-09 review's W8 and D6): the
    // removal of a workspace whose commits will never be pushed, on this machine alone.
    it('discards a stated number of unpushed commits without asking the remote, the workspace set aside first', async () => {
      const LOST = `${handleOf(DESIGNER)}_${NAME}-lost`;
      expect((await on('POST', '/workspace', { name: `${NAME}-lost` })).status).toBe(201);
      expect((await write(LOST, `discard-pushed-${stamp}`)).status).toBe(200);
      expect((await on('POST', `/workspace/${LOST}/push`)).status).toBe(200);
      const remoteHead = (await onMain.branches.head(LOST)).data.head.commit;
      // Nothing unpushed: there is nothing to discard, and the plain removal is the one to ask for.
      const nothing = await json(await on('DELETE', `/workspace/${LOST}?discard=1`));
      expect(nothing.status).toBe(409);
      expect(nothing.body).toMatchObject({ error: 'discard_mismatch', stated: 1, unpushed: [] });

      expect((await write(LOST, `discard-one-${stamp}`)).status).toBe(200);
      expect((await write(LOST, `discard-two-${stamp}`)).status).toBe(200);
      expect((await json(await on('DELETE', `/workspace/${LOST}`))).body).toMatchObject({ error: 'unpushed_commits' });
      for (const bad of ['0', '-1', '1.5', 'all', '']) {
        const refused = await json(await on('DELETE', `/workspace/${LOST}?discard=${bad}`));
        expect(refused.status, bad).toBe(400);
        expect(refused.body.error, bad).toBe('bad_query');
      }
      // The count is the confirmation: one that is not what is there changes nothing.
      for (const stated of [1, 3]) {
        const mismatch = await json(await on('DELETE', `/workspace/${LOST}?discard=${stated}`));
        expect(mismatch.status).toBe(409);
        expect(mismatch.body).toMatchObject({ error: 'discard_mismatch', stated });
        expect(mismatch.body.unpushed).toHaveLength(2);
      }
      expect((await json(await on('GET', `/workspace/${LOST}/status`))).body).toMatchObject({ unpushed: 2 });
      // The owner's alone, as a removal is.
      expect((await on('DELETE', `/workspace/${LOST}?discard=2`, undefined, REVIEWER)).status).toBe(403);

      // With the remote out of reach, which a plain removal would report: a discard does not ask.
      const reachable = config;
      config = { ...config, remote: 'http://127.0.0.1:9' };
      try {
        const discarded = await json(await on('DELETE', `/workspace/${LOST}?discard=2`));
        expect(discarded.status, JSON.stringify(discarded.body)).toBe(200);
        expect(discarded.body).toMatchObject({ workspace: { branch: LOST }, remote: 'untouched' });
        expect(discarded.body.reason).toBeUndefined();
        expect(discarded.body.discarded.commits).toHaveLength(2);
        expect(discarded.body.discarded.setAside).toMatch(new RegExp(`^_discarded/${LOST}\\.\\d{8}T\\d{6}Z$`));
      } finally {
        config = reachable;
      }
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).not.toContain(LOST);
      expect(await localStore('main').listBranches()).not.toContain(LOST);
      expect(await records.getPush(LOST)).toBeUndefined();
      // The remote's branch stands where the last push left it, without the two commits given up.
      expect((await onMain.branches.head(LOST)).data.head.commit).toBe(remoteHead);
      await expect(onMain.documents.get('LearningNeed', `LearningNeed/discard-one-${stamp}`, { branch: LOST })).rejects.toMatchObject({ status: 404 });
      expect((await on('DELETE', `/workspace/${LOST}?discard=2`)).status).toBe(404);
    });

    it('finishes a discard that failed partway by asking again, with nothing left to count', async () => {
      const HALF = `${handleOf(DESIGNER)}_${NAME}-half`;
      expect((await on('POST', '/workspace', { name: `${NAME}-half` })).status).toBe(201);
      expect((await write(HALF, `discard-half-${stamp}`)).status).toBe(200);
      failRemovalOf = `${HALF}/commits/`;
      expect((await on('DELETE', `/workspace/${HALF}?discard=1`)).status).toBe(500);
      expect(failRemovalOf).toBeUndefined();
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).toContain(HALF);
      const again = await json(await on('DELETE', `/workspace/${HALF}?discard=1`));
      expect(again.status, JSON.stringify(again.body)).toBe(200);
      expect(again.body).toMatchObject({ remote: 'untouched', discarded: { commits: [] } });
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).not.toContain(HALF);
    });

    it('is the owner’s alone', async () => {
      const refused = await json(await on('DELETE', `/workspace/${KEPT}`, undefined, REVIEWER));
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: 'forbidden', permission: 'remove', owner: DESIGNER });
    });
  });


  describe('links and parents (ADR-0072 decisions 1, 4 and 7)', () => {
    const made = async (name: string, from?: string) => {
      const res = await json(await on('POST', '/workspace', { name, ...(from ? { from } : {}) }));
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      return res.body.branch as string;
    };
    const write = (branch: string, id: string, rationale = 'r') => on('PUT', `/documents/LearningNeed/${id}?branch=${branch}`, need(id, rationale));

    it("unlinked from the other computer, this one's push is refused not_linked, the status says so, and the discard is the way on", async () => {
      const branch = await made(`${NAME}-unlinked`);
      expect((await write(branch, `lost-pushed-${stamp}`)).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/push`)).status).toBe(200);
      // The owner, at another computer or in any client, takes this one for lost.
      expect((await onMain.workspaces.unlink(branch)).data.unlinked).toBe(true);
      expect((await write(branch, `lost-unpushed-${stamp}`)).status).toBe(200);
      const refused = await json(await on('POST', `/workspace/${branch}/push`));
      expect(refused.status).toBe(409);
      expect(refused.body).toMatchObject({ error: 'not_linked', remote: true, workspace: branch, pushed: [] });
      expect((await json(await on('GET', `/workspace/${branch}/status`))).body).toMatchObject({ unpushed: 1, remote: { link: 'unlinked' } });
      // Linked to another computer since, it says where; and nothing here takes it back.
      await createClient({ baseUrl: remote.url, user: DESIGNER }).workspaces.link(branch, { link: OTHER_COMPUTER, linkLabel: 'Laptop' });
      expect((await json(await on('GET', `/workspace/${branch}/status`))).body.remote).toMatchObject({ link: 'elsewhere', linkLabel: 'Laptop', linkedAt: expect.any(String) });
      expect((await json(await on('POST', `/workspace/${branch}/push`))).body).toMatchObject({ error: 'held_elsewhere', remote: true, linkLabel: 'Laptop' });
      for (const action of ['bring-in', 'unlink']) {
        expect((await json(await on('POST', `/workspace/${branch}/${action}`))).body.error, action).toBe('unpushed_commits');
      }
      // The discard gives up the one commit and leaves the other computer's link alone.
      const discarded = await json(await on('DELETE', `/workspace/${branch}?discard=1`));
      expect(discarded.status, JSON.stringify(discarded.body)).toBe(200);
      expect(discarded.body).toMatchObject({ remote: 'untouched', link: 'not_ours', discarded: { commits: [expect.any(String)] } });
      expect((await onMain.workspaces.get(branch)).data).toMatchObject({ link: OTHER_COMPUTER, linkLabel: 'Laptop' });
      expect((await json(await on('GET', '/workspace/elsewhere'))).body.linkedElsewhere.map((w: { branch: string }) => w.branch)).toContain(branch);
    });

    it('a workspace made from another branch updates from it and sends its request into it: the parent, never main', async () => {
      const method = `cycle-method-${stamp}`;
      await onMain.branches.create(method);
      const branch = await made(`${NAME}-under`, method);
      expect((await records.get(branch))!.from).toBe(method);
      expect((await onMain.workspaces.get(branch)).data.parent).toBe(method);
      // Its own work, pushed; the method moves on another record; main moves too, which is none of its business.
      expect((await write(branch, `under-mine-${stamp}`)).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/push`)).status).toBe(200);
      await onMain.documents.put('LearningNeed', `under-method-${stamp}`, { branch: method, message: 'On the method', document: { label: 'method', rationale: 'r' } });
      await onMain.documents.put('LearningNeed', `under-main-${stamp}`, { message: 'On main', document: { label: 'main', rationale: 'r' } });
      const updated = await json(await on('POST', `/workspace/${branch}/bring-in`));
      expect(updated.status, JSON.stringify(updated.body)).toBe(200);
      expect(updated.body).toMatchObject({ upToDate: false, broughtIn: { documents: 1 } });
      expect((await on('GET', `/documents/LearningNeed/under-method-${stamp}?branch=${branch}`)).status).toBe(200);
      expect((await on('GET', `/documents/LearningNeed/under-main-${stamp}?branch=${branch}`)).status).toBe(404);
      expect((await localStore(branch).log({ count: 1 }))[0].message).toContain(`Update from ${method} at `);
      // The request goes to the method's branch, which the designer owns and so may merge into.
      const opened = await json(await on('POST', `/workspace/${branch}/merge-request`, { message: 'For the method' }));
      expect(opened.body).toMatchObject({ parent: method, mayMerge: true, request: { source: branch, target: method }, health: { mergeable: true } });
      const merged = await json(await on('POST', `/workspace/${branch}/merge-request/merge`));
      expect(merged.status, JSON.stringify(merged.body)).toBe(200);
      expect((await onMain.documents.get('LearningNeed', `under-mine-${stamp}`, { branch: method })).data.label).toBe(`under-mine-${stamp}`);
      await expect(onMain.documents.get('LearningNeed', `under-mine-${stamp}`)).rejects.toMatchObject({ status: 404 });
      // A workspace is no one's parent: nothing is made from one.
      const child = await json(await on('POST', '/workspace', { name: `${NAME}-child`, from: branch }));
      expect(child.status).toBe(409);
      expect(child.body).toMatchObject({ error: 'parent_is_workspace', remote: true });
    });

    it("a request's health follows the workspace: a conflict once its parent moves against it, clean again after the update, the resolution and the push", async () => {
      const branch = await made(`${NAME}-health`);
      const id = `health-${stamp}`;
      expect((await write(branch, id, 'mine')).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/push`)).status).toBe(200);
      expect((await json(await on('POST', `/workspace/${branch}/merge-request`, { message: 'A need' }))).body.health.mergeable).toBe(true);
      await onMain.documents.put('LearningNeed', id, { message: 'The same record, on main', document: { label: id, rationale: 'theirs' } });
      const conflicted = (await json(await on('GET', `/workspace/${branch}/merge-request`))).body.health;
      expect(conflicted.mergeable).toBe(false);
      expect(conflicted.conflicts).toEqual([{ id: `LearningNeed/${id}`, op: 'InsertConflict' }]);
      expect((await json(await on('POST', `/workspace/${branch}/merge-request/merge`))).body).toMatchObject({ error: 'merge_conflict', remote: true });
      // Resolved in the source (decision 5): the update reports the same conflict; its owner removes theirs by matching main's record, pushes and updates.
      expect((await json(await on('POST', `/workspace/${branch}/bring-in`))).body.error).toBe('merge_conflict');
      expect((await write(branch, id, 'theirs')).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/push`)).status).toBe(200);
      const after = (await json(await on('GET', `/workspace/${branch}/merge-request`))).body.health;
      expect(after).toMatchObject({ conflicts: [], violations: [] });
    });

    it('records on the remote, at its first contact, a workspace this hub held before workspaces were linked (decision 7)', async () => {
      const branch = await made(`${NAME}-before`);
      // As it was before the upgrade: no record on the remote, and none of the link here.
      const there = (await onMain.workspaces.get(branch)).data as unknown as TerminusDocument;
      const older: Record<string, unknown> = { ...there, status: 'Closed' };
      for (const field of ['link', 'linkedAt', 'linkLabel']) delete older[field];
      await remoteStore('main').putDocuments([older as unknown as TerminusDocument], { author: 'User/demo-designer', message: 'As before workspaces were linked', create: true });
      const held = (await records.get(branch))!;
      delete held.link;
      await records.put(held);
      await expect(onMain.workspaces.get(branch)).rejects.toMatchObject({ status: 404 });
      // Unprotected until then: the owner's write from anywhere lands, as on any branch. This hub's next push would
      // meet it as a moved branch, which is the dead end the record prevents from here on.
      expect((await json(await on('GET', `/workspace/${branch}/status`))).body.remote).toMatchObject({ link: 'none' });

      expect((await write(branch, `before-${stamp}`)).status).toBe(200);
      const pushed = await json(await on('POST', `/workspace/${branch}/push`));
      expect(pushed.status, JSON.stringify(pushed.body)).toBe(200);
      expect((await onMain.workspaces.get(branch)).data).toMatchObject({ branch, parent: 'main', owner: 'User/demo-designer', link: INSTALLATION, linkLabel: 'Cycle test', status: 'Active' });
      expect((await records.get(branch))!.link).toBe(INSTALLATION);
      expect((await json(await on('GET', `/workspace/${branch}/status`))).body.remote).toMatchObject({ link: 'here' });
      await expect(onMain.documents.put('LearningNeed', `before-elsewhere-${stamp}`, { branch, message: 'x', document: { label: 'x', rationale: 'r' } })).rejects.toMatchObject({ code: 'held_elsewhere' });
    });
  });

  describe("checks on a person's machine: the push gate, the mirror and a merge request's wait (ADR-0070 decision 8)", () => {
    const G = `${handleOf(DESIGNER)}_gate-${stamp}`;
    const LINT = `lint/mine-${stamp}`;
    const TEAM = `lint/team-${stamp}`;
    const SERVICE = `agent:test/cycle-lint-${stamp}`;
    const PARAMS = { strict: true };
    let n = 0;
    const work = async () => {
      const written = await json(await on('PUT', `/documents/LearningNeed/cycle-gate-${stamp}-${++n}?branch=${G}`, need(`gate ${n}`)));
      expect(written.status).toBe(200);
      return written.body.commit as string;
    };
    const push = async (body?: unknown) => json(await on('POST', `/workspace/${G}/push`, body));
    const report = (commit: string, conclusion: string, extra: Record<string, unknown> = {}) =>
      on('POST', '/checks/runs', { check: LINT, branch: G, commit, conclusion, paramsHash: paramsHash(PARAMS), ...extra });
    const remoteMessage = async () => (await onMain.branches.log(G, { count: 1 })).data.commits[0].message;

    beforeAll(async () => {
      expect((await on('POST', '/workspace', { name: `gate-${stamp}` })).status).toBe(201);
    });

    afterAll(() => {
      personalChecks = undefined;
    });

    it('with no checks.json a push is as before; with one, and nothing to push, nothing is gated or even read', async () => {
      await work();
      const plain = await push();
      expect(plain.status).toBe(200);
      expect(plain.body).not.toHaveProperty('checks');
      personalChecks = 'not json';
      expect((await push()).body).toMatchObject({ upToDate: true });
    });

    it('a checks.json the hub cannot read stops the push (422 personal_checks_invalid), with every problem, rather than opening the gate', async () => {
      await work();
      const unreadable = await push();
      expect(unreadable.status).toBe(422);
      expect(unreadable.body.error).toBe('personal_checks_invalid');
      personalChecks = JSON.stringify({ requirements: [{ check: '', level: 'Sometimes', reporter: 'User/x', params: null }, 'lint'] });
      const invalid = await push();
      expect(invalid.status).toBe(422);
      expect(invalid.body.issues.map((i: { path: string }) => i.path)).toEqual(['requirements[0].reporter', 'requirements[0].check', 'requirements[0].level', 'requirements[0].params', 'requirements[1]']);
      // One for another workspace, one revoked, one by a prefix this workspace lacks: none binds this push.
      personalChecks = JSON.stringify({ requirements: [{ check: LINT, branch: 'someone_else' }, { check: LINT, status: 'Revoked' }, { check: LINT, fromPrefix: 'zz' }] });
      expect((await push()).status).toBe(200);
    });

    it("a personal requirement stops the push until a run on this machine passes at the workspace's head: 409 checks_pending, 422 checks_failed, nothing replayed", async () => {
      personalChecks = JSON.stringify({ requirements: [{ check: LINT, params: PARAMS, rationale: 'I lint before I push' }] });
      const before = (await onMain.branches.head(G)).data.head.commit;
      const head = await work();
      const pending = await push();
      expect(pending.status).toBe(409);
      expect(pending.body).toMatchObject({ error: 'checks_pending', pending: [LINT], commit: head });
      expect(pending.body.checks).toEqual([{ check: LINT, requirement: `checks.json#${LINT}`, level: 'Required', locked: false, paramsHash: paramsHash(PARAMS), conclusion: 'pending', satisfied: false }]);

      // What a plugin on the machine reads to know what to run, and under which hash.
      const asked = (await json(await on('GET', `/checks/requirements?target=${G}`))).body;
      expect(asked.personal).toEqual([{ check: LINT, level: 'Required', params: PARAMS, status: 'Active', rationale: 'I lint before I push', paramsHash: paramsHash(PARAMS) }]);

      // A run under other settings does not count; one that fails stops the push as failed.
      expect((await report(head, 'pass', { paramsHash: paramsHash({ strict: false }) })).status).toBe(201);
      expect((await push()).body.error).toBe('checks_pending');
      expect((await report(head, 'fail', { summary: '1 required' })).status).toBe(201);
      const failed = await push();
      expect(failed.status).toBe(422);
      expect(failed.body).toMatchObject({ error: 'checks_failed', failed: [LINT] });
      expect(failed.body.checks[0]).toMatchObject({ conclusion: 'fail', run: { summary: '1 required' } });
      expect((await onMain.branches.head(G)).data.head.commit).toBe(before);
    });

    it("the owner's override opens it, and the reason reaches the remote as the pusher's claim on the first commit replayed", async () => {
      for (const overrides of ['yes', [{ check: LINT }], [{ check: `lint/other-${stamp}`, reason: 'x' }]]) {
        const bad = await push({ overrides });
        expect(bad.status, JSON.stringify(overrides)).toBe(400);
        expect(bad.body.error).toBe('bad_request');
      }
      const pushed = await push({ overrides: [{ check: LINT, reason: 'A known false positive' }] });
      expect(pushed.status).toBe(200);
      expect(pushed.body.pushed).toHaveLength(1);
      expect(pushed.body.checks[0]).toMatchObject({ conclusion: 'fail', overridden: { reason: 'A known false positive' } });
      const message = await remoteMessage();
      expect(message).toContain(`Armature-Local-Check-Override: ${LINT} reason="A known false positive"`);
      expect(message).toContain('Armature-Workspace-Commit: ');
      // The remote wrote none of its own: the claim is the pusher's, and the remote's name stays the remote's.
      expect(message).not.toContain('Armature-Check-Override');
      expect(message).not.toContain('Armature-Check:');
    });

    it('a passing run at the head opens it with nothing to claim', async () => {
      const head = await work();
      expect((await report(head, 'pass')).status).toBe(201);
      const pushed = await push();
      expect(pushed.status).toBe(200);
      expect(pushed.body.checks[0]).toMatchObject({ conclusion: 'pass', satisfied: true });
      expect(await remoteMessage()).not.toContain('Armature-Local-Check-Override');
    });

    it("the remote's requirements are mirrored for the tools here to read, and a merge request waits on the remote's check: its health and its refusal carry the remote's verdicts", async () => {
      personalChecks = undefined;
      const agent = (await onMain.users.register({ message: 'A lint service for the cycle', user: { displayName: 'Lint (cycle)', externalId: SERVICE } })).data.id;
      const required = { '@type': 'CheckRequirement', check: TEAM, reporter: agent, level: 'Required', locked: false, params: { severity: 'error' }, status: 'Active' };
      const written = await onMain.documents.batch({ message: 'Lint before anything reaches main', documents: [required as never] });
      try {
        // main moved (the agent, the requirement): the workspace updates first, a merge from its parent, which no gate stops.
        expect((await on('POST', `/workspace/${G}/bring-in`)).status).toBe(200);
        const opened = await json(await on('POST', `/workspace/${G}/merge-request`, { message: 'Merge the gate' }));
        expect(opened.status).toBe(201);
        expect(opened.body.health).toMatchObject({ mergeable: false, conflicts: [], violations: [] });
        expect(opened.body.health.checks).toEqual([expect.objectContaining({ check: TEAM, reporter: agent, conclusion: 'pending', satisfied: false })]);
        // Opening refreshed the mirror: the requirement is read here, with the hash a preview runs under.
        const mirrored = (await json(await on('GET', '/checks/requirements?target=main'))).body;
        expect(mirrored.requirements.map((r: { check: string; paramsHash: string }) => [r.check, r.paramsHash])).toContainEqual([TEAM, paramsHash({ severity: 'error' })]);
        expect(mirrored.personal).toEqual([]);

        const waiting = await json(await on('POST', `/workspace/${G}/merge-request/merge`));
        expect(waiting.status).toBe(409);
        expect(waiting.body).toMatchObject({ error: 'checks_pending', remote: true, pending: [TEAM] });
        // The service reports on the remote, about the remote's head of the branch; then the health clears and the merge lands.
        const head = (await onMain.branches.head(G)).data.head.commit;
        const service = createClient({ baseUrl: remote.url, user: SERVICE });
        await service.checks.report({ check: TEAM, branch: G, commit: head, conclusion: 'pass', paramsHash: paramsHash({ severity: 'error' }) });
        expect((await json(await on('GET', `/workspace/${G}/merge-request`))).body.health).toMatchObject({ mergeable: true, checks: [expect.objectContaining({ conclusion: 'pass', satisfied: true })] });
        const delivered = await json(await on('POST', `/workspace/${G}/merge-request/merge`));
        expect(delivered.status).toBe(200);
        expect(delivered.body.checks).toEqual([expect.objectContaining({ check: TEAM, conclusion: 'pass', satisfied: true })]);
        const message = (await onMain.branches.log('main', { count: 2 })).data.commits[1].message;
        expect(message).toContain(`Armature-Check: ${TEAM} pass run=`);
        expect(message).toContain('Armature-Merge-Request: MergeRequest/');
      } finally {
        // Withdrawn, so nothing after this group is gated.
        await onMain.documents.batch({ message: 'Withdraw', documents: [{ ...required, status: 'Revoked', rationale: 'The test is over' } as never] });
        expect(written.data.ids).toHaveLength(1);
      }
    });
  });
});
