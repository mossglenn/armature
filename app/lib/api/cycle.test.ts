/**
 * The workspace cycle (docs/workspace-hub-plan.md §13, "The cycle"; ADR-0065
 * decisions 5 and 6): create, write, push, bring in main, resolve a conflict,
 * deliver, with the remote checking its merges before they commit. Delivery
 * writes to the remote's main, which the contract suite never does on the
 * seeded store, so the remote here runs over a scratch database of its own
 * (the seed's export, loaded as authorization.test.ts loads it) on an
 * ephemeral port, and the workspace hub in-process over a second scratch
 * database; both are deleted afterwards.
 */
import { createClient } from '@armature/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startHub, type RunningHub } from '../hub';
import { app, createApp } from './app';
import { configFromEnv, type HubConfig } from './config';
import { handleOf } from './routes/workspace';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from './store';
import { memoryRecords, type PushTable, type WorkspaceRecords } from './workspace/records';
import { memoryFiles, type StoreFiles } from './filestore/files';
import { openFileStore } from './filestore/store';

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
  /** The workspace hub's per-launch secret, which every write to it carries (ADR-0065 decision 7). */
  const TOKEN = `cycle-token-${stamp}`;
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
  const records: WorkspaceRecords = (() => {
    const inner = memoryRecords();
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
    config = { ...configFromEnv(), role: 'workspace', remote: remote.url, workspaces: records, store: () => localConfig, localToken: TOKEN, actionRoutes: true };
    workspace = createApp(() => config);
    onMain = createClient({ baseUrl: remote.url, user: DESIGNER });
  });

  afterAll(async () => {
    await remote?.close();
    await remoteStore('main').deleteDatabase().catch(() => undefined);
    await localStore('main').deleteDatabase().catch(() => undefined);
  });

  describe('the cycle: create, write, push, bring in, resolve, deliver', () => {
    let mergeCommit: string;

    it('creates the workspace and pushes a local commit', async () => {
      expect((await on('POST', '/workspace', { name: NAME })).status).toBe(201);
      expect((await on('PUT', `/documents/${MINE}?branch=${WS}`, need('mine'))).status).toBe(200);
      const pushed = await json(await on('POST', `/workspace/${WS}/push`));
      expect(pushed.status).toBe(200);
      expect(pushed.body.pushed).toHaveLength(1);
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

    it('delivery needs main brought in first, then merges into main and deletes the workspace', async () => {
      expect((await onMain.documents.put('LearningNeed', LATER, { message: 'Later on main', document: { label: 'later', rationale: 'r' } })).data.commit).toBeTruthy();
      const early = await json(await on('POST', `/workspace/${WS}/deliver`, { message: 'Deliver the cycle' }));
      expect(early.status).toBe(409);
      expect(early.body).toMatchObject({ error: 'bring_in_first', conflicts: [], violations: [] });
      expect((await on('POST', `/workspace/${WS}/bring-in`)).status).toBe(200);

      const delivered = await json(await on('POST', `/workspace/${WS}/deliver`, { message: 'Deliver the cycle', deleteWorkspace: true }));
      expect(delivered.status).toBe(200);
      expect(delivered.body.delivered.upToDate).toBe(false);
      expect(delivered.body.deleted).toBe(true);
      const main = await onMain.documents.get('LearningNeed', THEIRS);
      expect(main.data.rationale).toBe('resolved');
      expect((await onMain.documents.get('LearningNeed', MINE)).data.rationale).toBe('edited');
      await expect(onMain.branches.head(WS)).rejects.toMatchObject({ status: 404 });
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).not.toContain(WS);
      expect(await localStore('main').listBranches()).not.toContain(WS);
    });

    it("the reviewer, who may not merge into main, brings in but is refused delivery with the remote's 403", async () => {
      const R = `${handleOf(REVIEWER)}_${NAME}`;
      expect((await on('POST', '/workspace', { name: NAME }, REVIEWER)).status).toBe(201);
      expect((await on('PUT', `/documents/LearningNeed/cycle-reviewer-${stamp}?branch=${R}`, need('reviewer'), REVIEWER)).status).toBe(200);
      expect((await on('POST', `/workspace/${R}/push`, undefined, REVIEWER)).status).toBe(200);
      expect((await json(await on('POST', `/workspace/${R}/bring-in`, undefined, REVIEWER))).body.upToDate).toBe(true);
      const refused = await json(await on('POST', `/workspace/${R}/deliver`, { message: 'Deliver' }, REVIEWER));
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: 'forbidden', remote: true, permission: 'merge', branch: 'main' });
      const notTheirs = await json(await on('POST', `/workspace/${R}/deliver`, { message: 'Deliver' }));
      expect(notTheirs.status).toBe(403);
      expect(notTheirs.body).toMatchObject({ error: 'forbidden', permission: 'deliver', owner: REVIEWER });
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

    it('is never answered 200 and then deleted with the workspace by a delivery that deletes it', async () => {
      const name = `${NAME}-race-deliver`;
      const branch = `${handleOf(DESIGNER)}_${name}`;
      const id = `LearningNeed/race-deliver-${stamp}`;
      expect((await on('POST', '/workspace', { name })).status).toBe(201);
      expect((await on('PUT', `/documents/LearningNeed/race-deliver-first-${stamp}?branch=${branch}`, need('first'))).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/push`)).status).toBe(200);
      expect((await on('POST', `/workspace/${branch}/bring-in`)).status).toBe(200);
      const [delivered, written] = await Promise.all([
        on('POST', `/workspace/${branch}/deliver`, { message: 'Deliver, with a write beside it', deleteWorkspace: true }),
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
      expect(discarded.body).toMatchObject({ remote: 'untouched', discarded: { commits: [expect.any(String)] } });
      expect(await records.get(branch)).toBeUndefined();
      expect(await records.getPush(branch)).toBeUndefined();
      // The remote's branch, with its merge, is as it was, and is cloned again as it stands.
      expect((await on('POST', '/workspace', { existing: branch })).status).toBe(201);
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

      // Someone with a grant writes the branch on the remote: not a merge, so not this hub's bring-in.
      await onMain.documents.put('LearningNeed', `settle-none-${stamp}`, { branch, message: 'Written on the remote', document: { label: 'elsewhere', rationale: 'r' } });
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
      expect(removed.body).toMatchObject({ workspace: { branch: KEPT }, remote: 'kept', reason: 'unmerged' });
      // Gone here; the remote keeps the branch as the record of that work, and it can be cloned again.
      expect((await json(await on('GET', '/workspace'))).body.map((r: { branch: string }) => r.branch)).not.toContain(KEPT);
      expect(await localStore('main').listBranches()).not.toContain(KEPT);
      expect((await onMain.branches.head(KEPT)).data.head.commit).toBeTruthy();
      expect((await on('POST', '/workspace', { existing: KEPT })).status).toBe(201);
    });

    it('removes the branch from the remote too once main holds its head, as after a delivery without deleting', async () => {
      expect((await on('POST', '/workspace', { name: `${NAME}-gone` })).status).toBe(201);
      expect((await write(GONE, `remove-gone-${stamp}`)).status).toBe(200);
      expect((await on('POST', `/workspace/${GONE}/push`)).status).toBe(200);
      expect((await on('POST', `/workspace/${GONE}/bring-in`)).status).toBe(200);
      const delivered = await json(await on('POST', `/workspace/${GONE}/deliver`, { message: 'Delivered, kept' }));
      expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
      expect(delivered.body.deleted).toBe(false);

      const removed = await json(await on('DELETE', `/workspace/${GONE}`));
      expect(removed.status, JSON.stringify(removed.body)).toBe(200);
      expect(removed.body).toMatchObject({ remote: 'deleted' });
      await expect(onMain.branches.head(GONE)).rejects.toMatchObject({ status: 404 });
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

});
