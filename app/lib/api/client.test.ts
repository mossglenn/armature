/**
 * The contract test for @armature/client (Phase 7): the typed client over the
 * Hono app in-process, through the client's `fetch` option, so every call
 * crosses the same boundary a plugin's would without a server. What is checked
 * is the client's side of the contract (docs/api.md): refs, the commit from
 * the ETag, If-Match, identity, envelopes, ids in both spellings, and the
 * error body as a HubError. The routes' own behavior is app.test.ts,
 * write.test.ts, intelligence.test.ts and export.test.ts.
 */
import { createClient, HubError } from '@armature/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app';
import { createStore } from './store';

const stamp = Date.now().toString(36);
const BRANCH = `test-client-${stamp}`;

const hub = createClient({
  baseUrl: 'http://hub.test/',
  user: 'demo-designer@example.edu',
  fetch: (input, init) => app.request(input, init),
});

describe('@armature/client over the app in-process', () => {
  beforeAll(async () => {
    await hub.branches.create(BRANCH);
  });

  afterAll(async () => {
    // The branch holds commits no other branch has, so the API refuses to
    // delete it; the adapter does, as the other suites' cleanup does.
    await createStore({ branch: 'main' }).deleteBranch(BRANCH).catch(() => undefined);
  });

  it('reads a list at main with the commit from the ETag, and the same list at that commit', async () => {
    const { data, commit } = await hub.documents.list('LearningObjective');
    expect(data.length).toBeGreaterThan(0);
    expect(data[0]['@type']).toBe('LearningObjective');
    expect(commit).toMatch(/^[a-z0-9]+$/);
    const again = await hub.documents.list('LearningObjective', { ref: commit });
    expect(again.data.map((o) => o['@id'])).toEqual(data.map((o) => o['@id']));
    expect(again.commit).toBe(commit);
  });

  it('filters a list through query parameters', async () => {
    const { data } = await hub.documents.list('Assessment', { filter: { module: 'Module/how-ai-works' } });
    expect(data.length).toBeGreaterThan(0);
    for (const a of data) expect(a.module).toBe('Module/how-ai-works');
  });

  it('reads one document by Type/local or local alone', async () => {
    const full = await hub.documents.get('LearningObjective', 'LearningObjective/distinguish-ai-approaches');
    const local = await hub.documents.get('LearningObjective', 'distinguish-ai-approaches');
    expect(full.data['@id']).toBe('LearningObjective/distinguish-ai-approaches');
    expect(local.data).toEqual(full.data);
    expect(typeof full.data.label).toBe('string');
  });

  it('throws a HubError carrying the status and the stable code', async () => {
    const err = await hub.documents.get('LearningObjective', 'no-such-objective').catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err.status).toBe(404);
    expect(err.code).toBe('not_found');
    expect(err.message).toMatch(/not found/i);
  });

  it('writes on a branch with the identity and envelope the route expects, then reads history and diff', async () => {
    const id = `client-note-${stamp}`;
    const first = await hub.documents.put('DesignNote', id, {
      branch: BRANCH,
      message: 'First version',
      document: { label: 'Client note', rationale: 'Written through the client', subject: ['Module/how-ai-works'] },
    });
    expect(first.data).toEqual({ id: `DesignNote/${id}`, commit: first.commit });

    const second = await hub.documents.put('DesignNote', `DesignNote/${id}`, {
      branch: BRANCH,
      ifMatch: first.commit,
      message: 'Second version',
      document: { label: 'Client note', rationale: 'Revised through the client', subject: ['Module/how-ai-works'] },
    });
    expect(second.commit).not.toBe(first.commit);

    const read = await hub.documents.get('DesignNote', id, { branch: BRANCH });
    expect(read.data.rationale).toBe('Revised through the client');
    expect(read.data.createdBy).toBe('User/demo-designer');

    const history = await hub.documents.history('DesignNote', id, { branch: BRANCH, diff: false });
    expect(history.data.entries.map((e) => e.message)).toEqual(['Second version', 'First version']);
    expect(history.data.entries[0].diff).toBeUndefined();

    const diff = await hub.documents.diff('DesignNote', id, { from: first.commit!, to: second.commit! });
    expect(diff.data).toMatchObject({ id: `DesignNote/${id}`, from: first.commit, to: second.commit });
  });

  it('turns a stale If-Match into a 412 precondition_failed with both commits', async () => {
    const head = await hub.branches.head(BRANCH);
    const stale = (await hub.documents.history('DesignNote', `client-note-${stamp}`, { branch: BRANCH, diff: false })).data
      .entries[1].commit;
    const err = await hub.documents
      .put('DesignNote', `client-stale-${stamp}`, {
        branch: BRANCH,
        ifMatch: stale,
        message: 'Should not land',
        document: { label: 'Stale', rationale: 'x', subject: ['Module/how-ai-works'] },
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err.status).toBe(412);
    expect(err.code).toBe('precondition_failed');
    expect(err.details).toMatchObject({ expected: stale, current: head.data.head.commit });
  });

  it('surfaces a rule violation as a 422 with the violations in details', async () => {
    const err = await hub.documents
      .batch({
        branch: BRANCH,
        message: 'Two placements, one sequence',
        documents: [
          { '@type': 'ItemInstance', sequence: 99, pointValue: 1, randomize: false, status: 'Draft', assessment: 'Assessment/mod1-assessment', implements: 'AssessmentItem/distinguish-ai-mc' },
          { '@type': 'ItemInstance', sequence: 99, pointValue: 1, randomize: false, status: 'Draft', assessment: 'Assessment/mod1-assessment', implements: 'AssessmentItem/hallucination-mc' },
        ],
      })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('invariant_violation');
    expect((err.details.violations as Array<{ code: string }>).map((v) => v.code)).toEqual(['duplicate_sequence', 'duplicate_sequence']);
  });

  it('refuses a write without an identity', async () => {
    const anonymous = createClient({ baseUrl: 'http://hub.test', fetch: (input, init) => app.request(input, init) });
    const err = await anonymous.branches.create(`anon-${stamp}`).catch((e) => e);
    // Branch creation is not a commit and needs no identity; a write does.
    expect(err).not.toBeInstanceOf(HubError);
    const write = await anonymous.documents
      .put('DesignNote', `anon-${stamp}`, { branch: BRANCH, message: 'x', document: { label: 'x', rationale: 'x', subject: ['Module/how-ai-works'] } })
      .catch((e) => e);
    expect(write).toBeInstanceOf(HubError);
    expect(write.code).toBe('identity_required');
    await createStore({ branch: 'main' }).deleteBranch(`anon-${stamp}`).catch(() => undefined);
  });

  it('lists branches, reads changes since a commit, merges and deletes', async () => {
    const names = (await hub.branches.list()).data.map((b) => b.name);
    expect(names).toContain('main');
    expect(names).toContain(BRANCH);

    const mainHead = (await hub.branches.head('main')).data.head.commit;
    const changes = await hub.branches.changes(BRANCH, mainHead);
    expect(changes.data.changes.map((c) => c.id)).toContain(`DesignNote/client-note-${stamp}`);

    const target = `${BRANCH}-target`;
    await hub.branches.create(target, { branch: BRANCH });
    const merge = await hub.branches.merge(target, { message: 'Nothing new', from: BRANCH });
    expect(merge.data.upToDate).toBe(true);
    await hub.branches.delete(target);
    expect((await hub.branches.list()).data.map((b) => b.name)).not.toContain(target);
  });

  it('reads the identity and the registry', async () => {
    const me = await hub.users.me();
    expect(me.data.externalId).toBe('demo-designer@example.edu');
    const users = await hub.users.list();
    expect(users.data.map((u) => u['@id'])).toContain('User/demo-designer');
  });

  it('reads the five intelligence routes with ids in either spelling', async () => {
    const coverage = await hub.intelligence.coverage('Module/how-ai-works', { fullyAssessedAt: 1 });
    expect(coverage.data.thresholds.fullyAssessedAt).toBe(1);
    expect(coverage.data.objectives.length).toBe(3);
    const course = await hub.intelligence.courseCoverage({ course: 'intro-ai-for-ids' });
    expect(course.data.modules.length).toBe(3);
    const alignment = await hub.intelligence.alignment({ module: 'how-ai-works' });
    expect(alignment.data).toHaveProperty('itemsBelowObjective');
    const trace = await hub.intelligence.trace('LearningMetric', 'mod3-bias-type-difficulty');
    expect(trace.data.nodes.length).toBeGreaterThan(1);
    const attestations = await hub.intelligence.attestations('AssessmentItem', 'AssessmentItem/bias-type-mc');
    expect(attestations.data.summary.attestations).toBeGreaterThan(0);
    const impact = await hub.intelligence.impact('LearningObjective', 'distinguish-ai-approaches');
    expect(impact.data.summary.references).toBeGreaterThan(0);
  });

  it('reads an export under a profile and the slice configuration', async () => {
    const slices = await hub.export.slices();
    expect(slices.data).toHaveProperty('full');
    const exported = await hub.export.read({ profile: 'pseudonymous', slice: 'outcomes-loop' });
    expect(exported.data.armature.profile).toBe('pseudonymous');
    expect(exported.data.documents.length).toBeGreaterThan(0);
  });
});
