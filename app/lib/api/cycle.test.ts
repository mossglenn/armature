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
import { memoryRecords } from './workspace/records';
import { localStoreConfig } from './filestore/testing';

// Both local stores run the whole cycle (ADR-0066 decision 3): a scratch TerminusDB database, the test bed, and the file-backed store in memory.
for (const local of ['terminusdb', 'files'] as const) {
  describe(`over a local store of ${local}`, () => {

    const stamp = `${Date.now().toString(36)}${local === 'files' ? 'f' : 't'}`;
    const REMOTE_DB = `${process.env.TERMINUS_DB}_cycle_remote_${stamp}`;
    const LOCAL_DB = `${process.env.TERMINUS_DB}_cycle_local_${stamp}`;
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
    const headers = (user: string) => ({ 'Content-Type': 'application/json', 'Armature-User': user });
    const on = (method: string, path: string, body?: unknown, user = DESIGNER) =>
      workspace.request(`/api/v1${path}`, { method, headers: headers(user), body: body === undefined ? undefined : JSON.stringify(body) });
    const json = async (res: Response) => ({ status: res.status, body: await res.json() });
    const need = (label: string, rationale = 'r') => ({ message: `Need ${label}`, document: { label, rationale } });
    const remoteStore = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: REMOTE_DB });
    const localConfig = localStoreConfig(local, LOCAL_DB);
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
      config = { ...configFromEnv(), role: 'workspace', remote: remote.url, workspaces: memoryRecords(), store: () => localConfig };
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

  });
}
