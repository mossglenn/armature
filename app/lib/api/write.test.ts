/**
 * The generic write path and the invariants engine (plan §4 Phase 3).
 *
 * Phase 3's exit criterion: every constraint in CLAUDE.md has a failing and
 * a passing test against the running store. Integration tests like
 * app.test.ts: the container must be up with the seed loaded. Everything
 * is written to one scratch branch created here and deleted afterwards;
 * `main` is untouched.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app';
import { createStore } from './store';

const AUTHOR = 'User/demo-designer';
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const stamp = Date.now().toString(36);
const BRANCH = `test-write-${stamp}`;
const q = `?branch=${BRANCH}`;

const put = (path: string, body: unknown) =>
  app.request(path, { method: 'PUT', headers: HEADERS, body: JSON.stringify(body) });
const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
const get = (path: string) => app.request(path);
const codes = async (res: Response): Promise<string[]> =>
  ((await res.json()).violations as Array<{ code: string }>).map((v) => v.code);
const paths = async (res: Response): Promise<string[]> =>
  ((await res.json()).issues as Array<{ path: string }>).map((i) => i.path);

const OBJECTIVE = 'LearningObjective/identify-ai-limitations';
const MODULE = 'Module/how-ai-works';

/** A valid MultipleChoice item; callers override what they test. */
function item(id: string, overrides: Record<string, unknown> = {}) {
  return {
    '@id': `AssessmentItem/${id}`,
    '@type': 'AssessmentItem',
    label: `Test item ${id}`,
    stem: { '@type': 'TextFragment', fragmentId: 'stem', text: 'Which is true?' },
    options: [
      { '@type': 'ItemOption', fragmentId: 'a', text: 'Alpha', isCorrect: true },
      { '@type': 'ItemOption', fragmentId: 'b', text: 'Beta', isCorrect: false },
      { '@type': 'ItemOption', fragmentId: 'c', text: 'Gamma', isCorrect: false },
    ],
    itemType: 'MultipleChoice',
    status: 'Draft',
    assesses: [OBJECTIVE],
    ...overrides,
  };
}

describe('generic write path and invariants (Phase 3)', () => {
  beforeAll(async () => {
    const res = await post('/api/v1/branches', { name: BRANCH, from: { branch: 'main' } });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    await createStore({ branch: 'main' }).deleteBranch(BRANCH).catch(() => undefined);
  });

  describe('shape: generated Zod schemas', () => {
    it('rejects an unknown field with the path', async () => {
      const res = await put(`/api/v1/documents/LearningNeed/shape-${stamp}${q}`, {
        message: 'x',
        document: { label: 'Need', rationale: 'r', colour: 'blue' },
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_document');
    });

    it('rejects a bad enum value and a missing required field', async () => {
      const res = await put(`/api/v1/documents/AssessmentItem/shape-${stamp}${q}`, {
        message: 'x',
        document: item(`shape-${stamp}`, { status: 'Published', label: undefined }),
      });
      expect(res.status).toBe(400);
      const found = await paths(res);
      expect(found).toContain('status');
      expect(found).toContain('label');
    });

    it('accepts an item that assesses nothing (ADR-0060) and enforces @min_cardinality on an activity (constraint 2)', async () => {
      // Rule 1 was retired by ADR-0060: an item may exist before it is aligned,
      // whether `assesses` is empty or absent. The store returns no field for an
      // empty Set, so a reader treats a missing `assesses` as none.
      const noObjective = await put(`/api/v1/documents/AssessmentItem/shape-${stamp}${q}`, {
        message: 'An item from a bank nobody has aligned yet',
        document: item(`shape-${stamp}`, { assesses: [] }),
      });
      expect(noObjective.status).toBe(200);
      const stored = await (await get(`/api/v1/documents/AssessmentItem/shape-${stamp}${q}`)).json();
      expect(stored.assesses ?? []).toEqual([]);
      const { assesses: _omitted, ...withoutField } = item(`shape-${stamp}`);
      void _omitted;
      const absent = await put(`/api/v1/documents/AssessmentItem/shape-${stamp}${q}`, { message: 'x', document: withoutField });
      expect(absent.status).toBe(200);

      const noTarget = await put(`/api/v1/documents/LearningActivity/shape-${stamp}${q}`, {
        message: 'x',
        document: { label: 'Act', targets: [] },
      });
      expect(noTarget.status).toBe(400);
      expect(await paths(noTarget)).toContain('targets');
    });

    it('reports each unknown key at its own path; a ModuleObjective carries design intent only (ADR-0056)', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ '@type': 'ModuleObjective', module: MODULE, references: OBJECTIVE, role: 'Supporting', coverageStatus: 'FullyAssessed' }],
      });
      expect(res.status).toBe(400);
      const { issues } = await res.json();
      expect(issues).toEqual([{ index: 0, path: 'coverageStatus', message: 'coverageStatus is not a field of ModuleObjective' }]);
    });

    it('rejects a batch document whose @type is not writable', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ '@type': 'User', displayName: 'x', externalId: 'y' }],
      });
      expect(res.status).toBe(400);
      expect(await paths(res)).toEqual(['@type']);
    });
  });

  describe('constraint 0: reference class and existence', () => {
    const note = (subject: unknown[]) => ({ label: 'Note', rationale: 'Because', subject });

    it('rejects a reference to a document of the wrong class', async () => {
      const res = await put(`/api/v1/documents/DesignNote/ref-${stamp}${q}`, {
        message: 'x',
        document: note([AUTHOR]),
      });
      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe('invariant_violation');
    });

    it('names the field and the classes involved', async () => {
      const res = await put(`/api/v1/documents/DesignNote/ref-${stamp}${q}`, { message: 'x', document: note([AUTHOR]) });
      const [violation] = (await res.json()).violations;
      expect(violation.code).toBe('reference_class');
      expect(violation.field).toBe('subject[0]');
      expect(violation.message).toContain('DesignRecord');
      expect(violation.message).toContain('User');
    });

    it('rejects a reference to a document that does not exist', async () => {
      const res = await put(`/api/v1/documents/DesignNote/ref-${stamp}${q}`, {
        message: 'x',
        document: note(['Module/no-such-module']),
      });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['unknown_reference']);
    });

    it('accepts an artifact and a junction as DesignRecord subjects', async () => {
      const junctions = await (await get(`/api/v1/documents/ModuleObjective${q}&module=${MODULE}`)).json();
      expect(junctions.length).toBeGreaterThan(0);
      const res = await put(`/api/v1/documents/DesignNote/ref-${stamp}${q}`, {
        message: 'Attach a note',
        document: note([MODULE, junctions[0]['@id']]),
      });
      expect(res.status).toBe(200);
    });
  });

  describe('constraint 12: an id held by another type', () => {
    it('is a 409 before the store sees it', async () => {
      // Ids carry no type to the hub (ADR-0024 decision 2), so the clash is a
      // batch document naming an id another type already holds.
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ '@type': 'Course', '@id': MODULE, label: 'Clobber' }],
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe('type_conflict');
      expect(body.existingType).toBe('Module');
    });

    it('surfaces the store refusing a new id whose prefix is not its type as a 400', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ '@type': 'Course', '@id': `Module/new-${stamp}`, label: 'Mislabelled' }],
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('bad_id');
    });
  });

  describe('AssessmentItem: fragments, options and readiness (constraints 8, 9, 10)', () => {
    const path = `/api/v1/documents/AssessmentItem/item-${stamp}${q}`;

    it('rejects a duplicate fragmentId across stem and options', async () => {
      const bad = item(`item-${stamp}`);
      bad.options[1].fragmentId = 'stem';
      const res = await put(path, { message: 'x', document: bad });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['duplicate_fragment_id']);
    });

    it('rejects duplicate option text', async () => {
      const bad = item(`item-${stamp}`);
      bad.options[2].text = 'Alpha';
      const res = await put(path, { message: 'x', document: bad });
      expect(await codes(res)).toEqual(['duplicate_option_text']);
    });

    it('rejects a MultipleChoice item with two correct options', async () => {
      const bad = item(`item-${stamp}`);
      bad.options[1].isCorrect = true;
      const res = await put(path, { message: 'x', document: bad });
      expect(await codes(res)).toEqual(['correct_option_count']);
    });

    it('rejects a TrueFalse item with three options', async () => {
      const res = await put(path, { message: 'x', document: item(`item-${stamp}`, { itemType: 'TrueFalse' }) });
      expect(await codes(res)).toEqual(['option_count']);
    });

    it('accepts a well-formed item, sets createdBy, and lists it by status', async () => {
      const res = await put(path, { message: 'Author a test item', document: item(`item-${stamp}`) });
      expect(res.status).toBe(200);
      const stored = await (await get(path)).json();
      expect(stored.createdBy).toBe(AUTHOR);
      expect(stored.options).toHaveLength(3);

      const drafts = await (await get(`/api/v1/documents/AssessmentItem${q}&status=Draft`)).json();
      const ids = drafts.map((d: { '@id': string }) => d['@id']);
      expect(ids).toContain(`AssessmentItem/item-${stamp}`);
      expect(ids).toContain('AssessmentItem/hallucination-mc');
    });

    it('refuses to send an item back to Draft while a placement of it is Approved', async () => {
      const approved = await (await get(`/api/v1/documents/AssessmentItem/evaluate-objective-mc${q}`)).json();
      expect(approved.status).toBe('Approved');
      const res = await put(`/api/v1/documents/AssessmentItem/evaluate-objective-mc${q}`, {
        message: 'Reopen',
        document: { ...approved, status: 'Draft' },
      });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['instance_ahead_of_item']);
    });
  });

  describe('ItemInstance: sequence and readiness (constraints 5 and 10)', () => {
    const instance = (overrides: Record<string, unknown>) => ({
      '@type': 'ItemInstance',
      sequence: 7,
      pointValue: 1,
      randomize: true,
      status: 'Approved',
      assessment: 'Assessment/mod1-assessment',
      implements: 'AssessmentItem/bias-type-mc',
      ...overrides,
    });

    it('rejects a sequence already used in the assessment', async () => {
      const res = await post(`/api/v1/documents${q}`, { message: 'x', documents: [instance({ sequence: 2 })] });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['duplicate_sequence']);
    });

    it('rejects an Approved placement of a Draft item', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [instance({ assessment: 'Assessment/mod2-assessment', implements: 'AssessmentItem/hallucination-mc', sequence: 9 })],
      });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['instance_ahead_of_item']);
    });

    it('accepts a new placement and mints its Hash id', async () => {
      const res = await post(`/api/v1/documents${q}`, { message: 'Place the item', documents: [instance({})] });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ids).toHaveLength(1);
      expect(body.ids[0]).toMatch(/^ItemInstance\//);
    });

    it('recognises a replace by Hash key fields, so its own sequence is not a clash', async () => {
      const before = await (await get(`/api/v1/documents/ItemInstance${q}&assessment=Assessment/mod1-assessment`)).json();
      const seeded = before.find((d: { implements: string }) => d.implements === 'AssessmentItem/hallucination-mc');
      expect(seeded.sequence).toBe(2);

      const res = await post(`/api/v1/documents${q}`, {
        message: 'Reweight the placement',
        documents: [instance({ implements: 'AssessmentItem/hallucination-mc', sequence: 2, pointValue: 3, status: 'Draft' })],
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ids).toEqual([seeded['@id']]);

      const after = await (await get(`/api/v1/documents/ItemInstance${q}&assessment=Assessment/mod1-assessment`)).json();
      expect(after).toHaveLength(before.length);
      expect(after.find((d: { '@id': string }) => d['@id'] === seeded['@id']).pointValue).toBe(3);
    });
  });

  describe('module content sequencing (constraints 3, 4 and 6)', () => {
    const A = `LearningActivity/act-a-${stamp}`;
    const B = `LearningActivity/act-b-${stamp}`;
    const G = `Lesson/lesson-${stamp}`;
    const scaffold = [
      { '@type': 'LearningActivity', '@id': A, label: 'Activity A', targets: [OBJECTIVE] },
      { '@type': 'LearningActivity', '@id': B, label: 'Activity B', targets: [OBJECTIVE] },
      { '@type': 'Lesson', '@id': G, label: 'Lesson' },
    ];

    it('rejects one sequence used by an activity link and a lesson link of the same module', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [
          ...scaffold,
          { '@type': 'ModuleActivityLink', module: MODULE, activity: A, sequence: 1 },
          { '@type': 'ModuleLessonLink', module: MODULE, lesson: G, sequence: 1 },
        ],
      });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['duplicate_sequence', 'duplicate_sequence']);
    });

    it('accepts distinct sequences across the shared namespace', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'Sequence the module',
        documents: [
          ...scaffold,
          // 11 and 12: the seed's own Module 1 content holds 1 and 2
          { '@type': 'ModuleActivityLink', module: MODULE, activity: A, sequence: 11 },
          { '@type': 'ModuleLessonLink', module: MODULE, lesson: G, sequence: 12 },
        ],
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ids).toHaveLength(5);
    });

    it('rejects a sequence reused within a lesson, and a lesson nested in a lesson', async () => {
      const dup = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [
          { '@type': 'LessonActivityLink', lesson: G, activity: A, sequence: 1 },
          { '@type': 'LessonActivityLink', lesson: G, activity: B, sequence: 1 },
        ],
      });
      expect(await codes(dup)).toEqual(['duplicate_sequence', 'duplicate_sequence']);

      const nested = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ '@type': 'LessonActivityLink', lesson: G, activity: G, sequence: 3 }],
      });
      expect(nested.status).toBe(422);
      expect(await codes(nested)).toEqual(['reference_class']);
    });

    it('accepts members with distinct sequences', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'Fill the lesson',
        documents: [
          { '@type': 'LessonActivityLink', lesson: G, activity: A, sequence: 1 },
          { '@type': 'LessonActivityLink', lesson: G, activity: B, sequence: 2 },
        ],
      });
      expect(res.status).toBe(200);
    });
  });

  describe('formative use of items in activities (constraint 17, ADR-0061)', () => {
    const ACT = `LearningActivity/poll-${stamp}`;
    const activity = { '@type': 'LearningActivity', '@id': ACT, label: 'Lecture 3 polls', targets: [OBJECTIVE] };
    const ITEM_A = 'AssessmentItem/hallucination-mc';
    const ITEM_B = 'AssessmentItem/bias-type-mc';

    it('rejects two uses at one position in an activity, and a use of something that is not an item', async () => {
      const dup = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [
          activity,
          { '@type': 'ActivityItemLink', activity: ACT, item: ITEM_A, sequence: 1 },
          { '@type': 'ActivityItemLink', activity: ACT, item: ITEM_B, sequence: 1 },
        ],
      });
      expect(dup.status).toBe(422);
      expect(await codes(dup)).toEqual(['duplicate_sequence', 'duplicate_sequence']);

      const notAnItem = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [activity, { '@type': 'ActivityItemLink', activity: ACT, item: OBJECTIVE, sequence: 1 }],
      });
      expect(notAnItem.status).toBe(422);
      expect(await codes(notAnItem)).toEqual(['reference_class']);
    });

    it('accepts ordered and unordered uses, and writing the same pair again replaces the use', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'Poll the room twice in lecture 3',
        documents: [
          activity,
          { '@type': 'ActivityItemLink', activity: ACT, item: ITEM_A, sequence: 1 },
          { '@type': 'ActivityItemLink', activity: ACT, item: ITEM_B },
        ],
      });
      expect(res.status).toBe(200);
      const [, first] = (await res.json()).ids as string[];
      expect(first).toMatch(/^ActivityItemLink\//);

      const again = await post(`/api/v1/documents${q}`, {
        message: 'Move the first poll',
        documents: [{ '@type': 'ActivityItemLink', activity: ACT, item: ITEM_A, sequence: 5 }],
      });
      expect(again.status).toBe(200);
      expect((await again.json()).ids).toEqual([first]);
      const uses = await (await get(`/api/v1/documents/ActivityItemLink${q}&activity=${ACT}`)).json();
      expect(uses).toHaveLength(2);
      expect(uses.find((u: { '@id': string }) => u['@id'] === first).sequence).toBe(5);
    });
  });

  describe('DesignFinding: dismissal needs a rationale (constraint 11)', () => {
    const finding = (overrides: Record<string, unknown>) => ({
      label: 'Stem cues the answer',
      finding: 'The stem repeats the key.',
      subject: ['AssessmentItem/hallucination-mc'],
      status: 'Dismissed',
      ...overrides,
    });
    const path = `/api/v1/documents/DesignFinding/finding-${stamp}${q}`;

    it('rejects Dismissed without resolutionRationale', async () => {
      const res = await put(path, { message: 'x', document: finding({}) });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['rationale_required']);
    });

    it('accepts Dismissed with one', async () => {
      const res = await put(path, { message: 'Dismiss', document: finding({ resolutionRationale: 'Reviewed; the cue is intended.' }) });
      expect(res.status).toBe(200);
    });
  });

  describe('asOf: records name the state they refer to (constraint 13, ADR-0057)', () => {
    const headOf = async () => (await get(`/api/v1/branches/${BRANCH}`)).headers.get('etag')!.replace(/"/g, '');
    const finding = (overrides: Record<string, unknown> = {}) => ({
      label: 'Stem is ambiguous',
      finding: 'Two readings of the stem.',
      subject: ['AssessmentItem/hallucination-mc'],
      status: 'Open',
      ...overrides,
    });
    const path = `/api/v1/documents/DesignFinding/asof-${stamp}${q}`;
    const dataset = { '@type': 'LearningDataset', '@capture': 'ds', label: 'Spring cohort', producedBy: 'Assessment/mod1-assessment' };
    const metric = (overrides: Record<string, unknown> = {}) => ({
      '@type': 'LearningMetric',
      label: 'Pass rate',
      collectedAt: '2026-06-01T00:00:00Z',
      source: 'LMS export',
      value: 0.8,
      unit: 'proportion',
      derivedFrom: { '@ref': 'ds' },
      ...overrides,
    });

    it('fills asOf with the head the write started from, and keeps it on replace', async () => {
      const before = await headOf();
      const created = await put(path, { message: 'Report', document: finding() });
      expect(created.status).toBe(200);
      const after = (await created.json()).commit;
      expect(after).not.toBe(before);
      expect((await (await get(`/api/v1/documents/DesignFinding/asof-${stamp}${q}`)).json()).asOf).toBe(before);

      const addressed = await put(path, { message: 'Address', document: finding({ status: 'Addressed', resolutionRationale: 'Stem rewritten.' }) });
      expect(addressed.status).toBe(200);
      expect((await (await get(`/api/v1/documents/DesignFinding/asof-${stamp}${q}`)).json()).asOf).toBe(before);
    });

    it('rejects a supplied asOf that is not a commit', async () => {
      for (const asOf of ['nosuchcommit0000000000000000000', 'not/a commit']) {
        const res = await put(path, { message: 'x', document: finding({ asOf }) });
        expect(res.status).toBe(422);
        expect(await codes(res)).toEqual(['unknown_commit']);
      }
    });

    it('rejects a supplied asOf at which the subject does not exist, and accepts one at which it does', async () => {
      const before = await headOf();
      const made = await put(`/api/v1/documents/AssessmentItem/asof-item-${stamp}${q}`, { message: 'Add item', document: item(`asof-item-${stamp}`) });
      expect(made.status).toBe(200);
      const withItem = (await made.json()).commit;
      const subject = [`AssessmentItem/asof-item-${stamp}`];

      const early = await put(path, { message: 'x', document: finding({ subject, regarding: OBJECTIVE, asOf: before }) });
      expect(early.status).toBe(422);
      const body = await early.json();
      expect(body.violations).toEqual([expect.objectContaining({ code: 'absent_at_commit', field: 'subject[0]' })]);

      const right = await put(path, { message: 'Judged at the item', document: finding({ subject, regarding: OBJECTIVE, asOf: withItem }) });
      expect(right.status).toBe(200);
    });

    it('accepts an earlier commit of the same branch as asOf, as a workspace push names one (ADR-0065)', async () => {
      // A workspace hub replays local commits in order; a record written offline at an older local
      // commit arrives naming the remote commit that commit became, behind the head it is written on.
      const first = await put(`/api/v1/documents/AssessmentItem/asof-early-${stamp}${q}`, { message: 'Add item', document: item(`asof-early-${stamp}`) });
      expect(first.status).toBe(200);
      const earlier = (await first.json()).commit;
      const second = await put(`/api/v1/documents/AssessmentItem/asof-early2-${stamp}${q}`, { message: 'Add another', document: item(`asof-early2-${stamp}`) });
      expect(second.status).toBe(200);
      const head = (await second.json()).commit;

      const replayed = await app.request(`/api/v1/documents/DesignFinding/asof-early-f-${stamp}${q}`, {
        method: 'PUT',
        headers: { ...HEADERS, 'If-Match': `"${head}"` },
        body: JSON.stringify({ message: 'Judged at the first item', document: finding({ subject: [`AssessmentItem/asof-early-${stamp}`], regarding: OBJECTIVE, asOf: earlier }) }),
      });
      expect(replayed.status).toBe(200);
      expect((await (await get(`/api/v1/documents/DesignFinding/asof-early-f-${stamp}${q}`)).json()).asOf).toBe(earlier);
    });

    it('validates a kept asOf against the subjects of the replace', async () => {
      // The finding now names withItem; a replace adding a subject created after it fails.
      const later = await put(`/api/v1/documents/AssessmentItem/asof-later-${stamp}${q}`, { message: 'Add item', document: item(`asof-later-${stamp}`) });
      expect(later.status).toBe(200);
      const res = await put(path, {
        message: 'x',
        document: finding({ subject: [`AssessmentItem/asof-item-${stamp}`, `AssessmentItem/asof-later-${stamp}`] }),
      });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['absent_at_commit']);
    });

    it('fills a finding about a subject created in the same write, but refuses a supplied asOf for it', async () => {
      const before = await headOf();
      const documents = [
        { ...item(`asof-batch-${stamp}`), '@capture': 'it' },
        { '@type': 'DesignFinding', ...finding({ subject: [{ '@ref': 'it' }] }) },
      ];
      const filled = await post(`/api/v1/documents${q}`, { message: 'Item and finding', documents });
      expect(filled.status).toBe(200);
      const [, findingId] = (await filled.json()).ids;
      expect((await (await get(`/api/v1/documents/${findingId}${q}`)).json()).asOf).toBe(before);

      const supplied = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [
          { ...item(`asof-batch2-${stamp}`), '@capture': 'it' },
          { '@type': 'DesignFinding', ...finding({ subject: [{ '@ref': 'it' }], asOf: before }) },
        ],
      });
      expect(supplied.status).toBe(422);
      expect(await codes(supplied)).toEqual(['absent_at_commit']);
    });

    it("copies a dataset's asOf onto a metric derived from it, and rejects a metric that disagrees", async () => {
      const before = await headOf();
      const ok = await post(`/api/v1/documents${q}`, { message: 'Results', documents: [dataset, metric()] });
      expect(ok.status).toBe(200);
      const [dsId, metricId] = (await ok.json()).ids;
      expect((await (await get(`/api/v1/documents/${dsId}${q}`)).json()).asOf).toBe(before);
      expect((await (await get(`/api/v1/documents/${metricId}${q}`)).json()).asOf).toBe(before);

      // The dataset is filled with the current head; the metric names an older commit.
      const bad = await post(`/api/v1/documents${q}`, { message: 'x', documents: [dataset, metric({ asOf: before })] });
      expect(bad.status).toBe(422);
      expect(await codes(bad)).toEqual(['as_of_disagrees']);

      // A historical import names the commit on both.
      const historical = await post(`/api/v1/documents${q}`, {
        message: 'Import',
        documents: [{ ...dataset, asOf: before }, metric({ asOf: before })],
      });
      expect(historical.status).toBe(200);
    });

    it("checks a metric's subject at its asOf, including one copied from a stored dataset (ADR-0058)", async () => {
      const administered = await post(`/api/v1/documents${q}`, { message: 'Administration', documents: [{ ...dataset, '@capture': undefined, '@id': `LearningDataset/stats-${stamp}` }] });
      expect(administered.status).toBe(200);
      const datasetId = `LearningDataset/stats-${stamp}`;
      const late = await put(`/api/v1/documents/AssessmentItem/stats-late-${stamp}${q}`, { message: 'Item added after', document: item(`stats-late-${stamp}`) });
      expect(late.status).toBe(200);

      const stat = (subject: string) => metric({ label: 'p-value', unit: 'proportion correct', value: 0.5, derivedFrom: datasetId, subject });
      const tooLate = await post(`/api/v1/documents${q}`, { message: 'x', documents: [stat(`AssessmentItem/stats-late-${stamp}`)] });
      expect(tooLate.status).toBe(422);
      expect((await tooLate.json()).violations).toEqual([expect.objectContaining({ code: 'absent_at_commit', field: 'subject' })]);

      const ok = await post(`/api/v1/documents${q}`, { message: 'Item statistic', documents: [stat('AssessmentItem/hallucination-mc')] });
      expect(ok.status).toBe(200);
      const stored = await (await get(`/api/v1/documents/${(await ok.json()).ids[0]}${q}`)).json();
      expect(stored.subject).toBe('AssessmentItem/hallucination-mc');

      // The statistics no longer live on the item.
      const onItem = await put(`/api/v1/documents/AssessmentItem/stats-late-${stamp}${q}`, { message: 'x', document: item(`stats-late-${stamp}`, { difficultyIndex: 0.5 }) });
      expect(onItem.status).toBe(400);
    });

    it('takes If-Match as the head', async () => {
      const head = await headOf();
      const res = await app.request(`/api/v1/documents/DesignFinding/asof-ifm-${stamp}${q}`, {
        method: 'PUT',
        headers: { ...HEADERS, 'If-Match': `"${head}"` },
        body: JSON.stringify({ message: 'Report', document: finding() }),
      });
      expect(res.status).toBe(200);
      expect((await (await get(`/api/v1/documents/DesignFinding/asof-ifm-${stamp}${q}`)).json()).asOf).toBe(head);
    });
  });

  describe('batch writes with @capture and @ref', () => {
    it('attaches a note to a junction minted in the same request', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'Declare and annotate an objective',
        documents: [
          {
            '@type': 'ModuleObjective',
            '@capture': 'mo',
            module: MODULE,
            references: 'LearningObjective/write-effective-prompts',
            role: 'Supporting',
          },
          { '@type': 'DesignNote', label: 'Why supporting', rationale: 'Prompting is practised here, assessed later.', subject: [{ '@ref': 'mo' }] },
        ],
      });
      expect(res.status).toBe(200);
      const { ids, commit } = await res.json();
      expect(ids).toHaveLength(2);
      expect(ids[0]).toMatch(/^ModuleObjective\//);
      expect(ids[1]).toMatch(/^DesignNote\//);
      expect(res.headers.get('etag')).toBe(`"${commit}"`);

      const note = await (await get(`/api/v1/documents/${ids[1]}${q}`)).json();
      expect(note.subject).toEqual([ids[0]]);
      expect(note.createdBy).toBe(AUTHOR);
    });

    it('rejects a @ref to a capture the write does not declare', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ '@type': 'DesignNote', label: 'Dangling', rationale: 'r', subject: [{ '@ref': 'nope' }] }],
      });
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['unknown_capture']);
    });

    it('rejects an empty batch and a duplicate id within one', async () => {
      const empty = await post(`/api/v1/documents${q}`, { message: 'x', documents: [] });
      expect(empty.status).toBe(400);
      const dup = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [
          { '@type': 'Course', '@id': `Course/dup-${stamp}`, label: 'One' },
          { '@type': 'Course', '@id': `Course/dup-${stamp}`, label: 'Two' },
        ],
      });
      expect(dup.status).toBe(400);
      expect((await dup.json()).error).toBe('duplicate_id');
    });
  });

  describe('Attestation and part references (constraints 14, 15, 16; ADR-0028)', () => {
    const ITEM = `AssessmentItem/att-${stamp}`;
    const headOf = async () => (await get(`/api/v1/branches/${BRANCH}`)).headers.get('etag')!.replace(/"/g, '');
    const attest = (overrides: Record<string, unknown> = {}) => ({ '@type': 'Attestation', subject: ITEM, verdict: 'Affirmed', ...overrides });
    const write = (...documents: unknown[]) => post(`/api/v1/documents${q}`, { message: 'Attest', documents });
    const read = async (id: string) => (await get(`/api/v1/documents/${id}${q}`)).json();

    beforeAll(async () => {
      const res = await put(`/api/v1/documents/${ITEM}${q}`, { message: 'Item to attest', document: item(`att-${stamp}`) });
      expect(res.status).toBe(200);
    });

    let endorsement: string;

    it('records an endorsement without a claim: hub-minted id, attestedBy the caller, asOf the head', async () => {
      const before = await headOf();
      const res = await write(attest());
      expect(res.status).toBe(200);
      endorsement = (await res.json()).ids[0];
      expect(endorsement).toMatch(/^Attestation\/[0-9a-f]{64}$/);
      expect(await read(endorsement)).toMatchObject({ subject: ITEM, verdict: 'Affirmed', attestedBy: AUTHOR, asOf: before });
    });

    it('replaces it under the same key with a new verdict, refilling asOf (decision 5)', async () => {
      const before = await headOf();
      const res = await write(attest({ verdict: 'Declined', reason: 'Option c is also defensible.' }));
      expect(res.status).toBe(200);
      expect((await res.json()).ids).toEqual([endorsement]);
      const now = await read(endorsement);
      expect(now).toMatchObject({ verdict: 'Declined', asOf: before });
      expect(now.claimRef).toBeUndefined();
    });

    it('keeps a claim verdict and a part verdict beside the endorsement', async () => {
      const res = await write(
        attest({ claimRef: 'grid:key-correct', claimText: 'Option a is the only correct answer.' }),
        attest({ fragmentId: 'b' })
      );
      expect(res.status).toBe(200);
      const minted: string[] = (await res.json()).ids;
      expect(new Set([...minted, endorsement]).size).toBe(3);
      const list = await (await get(`/api/v1/documents/Attestation${q}&subject=${ITEM}`)).json();
      expect(list).toHaveLength(3);
    });

    it('refuses half a claim (constraint 14)', async () => {
      for (const half of [{ claimRef: 'grid:x' }, { claimText: 'Option a is correct.' }]) {
        const res = await write(attest(half));
        expect(res.status).toBe(422);
        expect(await codes(res)).toEqual(['claim_incomplete']);
      }
    });

    it('refuses an attestedBy naming someone else, and accepts one naming the caller (constraint 15)', async () => {
      const other = await write(attest({ fragmentId: 'c', attestedBy: 'User/someone-else' }));
      expect(other.status).toBe(422);
      expect(await codes(other)).toContain('attester_not_caller');
      const self = await write(attest({ fragmentId: 'c', attestedBy: AUTHOR }));
      expect(self.status).toBe(200);
    });

    it('refuses an attestation written with its subject, which asOf could not hold', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ ...item(`att-new-${stamp}`), '@capture': 'it' }, attest({ subject: { '@ref': 'it' } })],
      });
      expect(res.status).toBe(422);
      expect(await codes(res)).toContain('subject_in_same_write');
    });

    it('refuses a client-supplied id: the key is the identity', async () => {
      const res = await put(`/api/v1/documents/Attestation/mine-${stamp}${q}`, { message: 'x', document: attest({ fragmentId: 'a' }) });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('bad_id');
    });

    it('refuses a fragmentId the subject lacks (constraint 16)', async () => {
      const res = await write(attest({ fragmentId: 'zz' }));
      expect(res.status).toBe(422);
      expect(await codes(res)).toEqual(['unknown_fragment']);
    });

    it('checks the part at a supplied asOf, and after the write when asOf is filled', async () => {
      const withC = await headOf();
      const dropped = item(`att-${stamp}`);
      dropped.options = dropped.options.slice(0, 2);
      expect((await put(`/api/v1/documents/${ITEM}${q}`, { message: 'Drop option c', document: dropped })).status).toBe(200);

      const filled = await write(attest({ fragmentId: 'c', claimRef: 'grid:distractor', claimText: 'Option c is plausible.' }));
      expect(filled.status).toBe(422);
      expect(await codes(filled)).toEqual(['unknown_fragment']);
      const atC = await write(attest({ fragmentId: 'c', claimRef: 'grid:distractor', claimText: 'Option c is plausible.', asOf: withC }));
      expect(atC.status).toBe(200);
    });

    it('gives notes and findings a part of one subject (constraint 16)', async () => {
      const two = await write({ '@type': 'DesignNote', label: 'Why b', rationale: 'b tests a misconception.', subject: [ITEM, 'AssessmentItem/hallucination-mc'], fragmentId: 'b' });
      expect(two.status).toBe(422);
      expect(await codes(two)).toEqual(['fragment_needs_one_subject']);
      const missing = await write({ '@type': 'DesignFinding', label: 'Ambiguous', finding: 'Reads two ways.', subject: [ITEM], fragmentId: 'zz', status: 'Open' });
      expect(missing.status).toBe(422);
      expect(await codes(missing)).toEqual(['unknown_fragment']);
      const ok = await write(
        { '@type': 'DesignNote', label: 'Why b', rationale: 'b tests a misconception.', subject: [ITEM], fragmentId: 'b' },
        { '@type': 'DesignFinding', label: 'Ambiguous', finding: 'Option b reads two ways.', subject: [ITEM], fragmentId: 'b', status: 'Open' }
      );
      expect(ok.status).toBe(200);
    });

    it('refuses to list attestations by attester (ADR-0021)', async () => {
      const res = await get(`/api/v1/documents/Attestation${q}&attestedBy=${AUTHOR}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('person_filter_refused');
    });
  });

  describe('list', () => {
    it('filters by a field, rejects an unknown one, and 404s an unknown type', async () => {
      const approved = await get(`/api/v1/documents/AssessmentItem${q}&status=Approved`);
      expect(approved.status).toBe(200);
      expect(approved.headers.get('etag')).toMatch(/^"[a-z0-9]+"$/);
      const statuses = new Set((await approved.json()).map((d: { status: string }) => d.status));
      expect([...statuses]).toEqual(['Approved']);

      expect((await get(`/api/v1/documents/AssessmentItem${q}&colour=red`)).status).toBe(400);
      expect((await get(`/api/v1/documents/Widget${q}`)).status).toBe(404);
    });

    it('reads boolean and numeric query values only in their exact lexical forms', async () => {
      const error = async (path: string) => {
        const res = await get(path);
        return res.status === 400 ? (await res.json()).error : res.status;
      };
      expect(await error(`/api/v1/documents/ItemInstance${q}&randomize=false`)).toBe(200);
      expect(await error(`/api/v1/documents/ItemInstance${q}&randomize=yes`)).toBe('bad_query');
      expect(await error(`/api/v1/documents/ItemInstance${q}&sequence=2`)).toBe(200);
      expect(await error(`/api/v1/documents/ItemInstance${q}&sequence=1e1`)).toBe('bad_query');
      expect(await error(`/api/v1/documents/ItemInstance${q}&sequence=two`)).toBe('bad_query');
      expect(await error(`/api/v1/documents/LearningMetric${q}&value=0.38`)).toBe(200);
      expect(await error(`/api/v1/documents/LearningMetric${q}&value=.38`)).toBe('bad_query');
      expect(await error(`/api/v1/documents/LearningObjective${q}&count=1e1`)).toBe('bad_query');
      expect(await error(`/api/v1/documents/${OBJECTIVE}/history${q}&diff=maybe`)).toBe('bad_query');
    });

    // The store answers these with a 500 (platform check Y); the hub filters them.
    const idsOf = async (res: Response) => ((await res.json()) as Array<{ '@id': string }>).map((d) => d['@id']);

    it('filters on a Set reference by membership', async () => {
      const all = (await (await get(`/api/v1/documents/AssessmentItem${q}`)).json()) as Array<{ '@id': string; assesses?: string[] }>;
      const expected = all.filter((d) => (d.assesses ?? []).includes(OBJECTIVE)).map((d) => d['@id']);
      expect(expected.length).toBeGreaterThan(1);
      const res = await get(`/api/v1/documents/AssessmentItem${q}&assesses=${OBJECTIVE}`);
      expect(res.status).toBe(200);
      expect((await idsOf(res)).sort()).toEqual(expected.sort());
    });

    it('filters on an Optional enum, combined with a store filter, and pages after filtering', async () => {
      const all = (await (await get(`/api/v1/documents/LearningObjective${q}`)).json()) as Array<{ '@id': string; bloomsLevel?: string; state: string }>;
      const level = all.find((d) => d.bloomsLevel)!.bloomsLevel!;
      const expected = all.filter((d) => d.bloomsLevel === level && d.state === 'Active').map((d) => d['@id']);
      expect(expected.length).toBeGreaterThan(0);
      const res = await get(`/api/v1/documents/LearningObjective${q}&bloomsLevel=${level}&state=Active`);
      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toMatch(/^"[a-z0-9]+"$/);
      const found = await idsOf(res);
      expect([...found].sort()).toEqual([...expected].sort());
      const second = await get(`/api/v1/documents/LearningObjective${q}&bloomsLevel=${level}&state=Active&skip=1&count=1`);
      expect(await idsOf(second)).toEqual(found.slice(1, 2));
    });

    it('refuses to list by who made a document (ADR-0021)', async () => {
      const res = await get(`/api/v1/documents/Module${q}&createdBy=${AUTHOR}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('person_filter_refused');
    });
  });
  describe('external references and attachments (constraints 18 and 19; ADR-0030)', () => {
    const sha = 'ab'.repeat(32);
    const image = (overrides: Record<string, unknown> = {}) => ({
      '@type': 'Attachment',
      store: 'Git',
      storeUri: 'https://example.edu/course-assets.git',
      revision: 'c0ffee1',
      path: 'img/bias-types.png',
      contentHash: sha,
      hashAlgorithm: 'sha-256',
      mediaType: 'image/png',
      ...overrides,
    });
    const picture = (fragmentId: string, isCorrect: boolean, hash = sha) => ({
      '@type': 'ItemOption',
      fragmentId,
      isCorrect,
      attachments: [image({ contentHash: hash })],
    });
    const textOption = (fragmentId: string, text: string, isCorrect: boolean) => ({ '@type': 'ItemOption', fragmentId, text, isCorrect });

    it('an objective names its CASE competency and reads it back', async () => {
      const id = `LearningObjective/ext-${stamp}`;
      const res = await put(`/api/v1/documents/${id}${q}`, {
        message: 'Align with the state framework',
        document: {
          label: 'Explain how training data shapes model behavior',
          state: 'Active',
          externalRefs: [{ '@type': 'ExternalRef', system: 'CASE', identifier: 'https://case.example.edu/ims/case/v1p0/CFItems/4f2c', label: 'AI.2.1' }],
        },
      });
      expect(res.status).toBe(200);
      const doc = await (await get(`/api/v1/documents/${id}${q}`)).json();
      expect(doc.externalRefs).toHaveLength(1);
      expect(doc.externalRefs[0]).toMatchObject({ system: 'CASE', identifier: 'https://case.example.edu/ims/case/v1p0/CFItems/4f2c', label: 'AI.2.1' });
    });

    it('refuses a versioned store without a revision and a malformed hash, both at once (constraint 18)', async () => {
      const res = await put(`/api/v1/documents/AssessmentItem/att-bad-${stamp}${q}`, {
        message: 'x',
        document: item(`att-bad-${stamp}`, { attachments: [image({ revision: undefined }), image({ contentHash: 'not-hex' })] }),
      });
      expect(res.status).toBe(422);
      const found = await codes(res);
      expect(found).toContain('revision_required');
      expect(found).toContain('hash_malformed');
      expect(found).toHaveLength(2);
    });

    it('accepts an option that is a picture, and an attachment whose algorithm the hub does not know', async () => {
      const id = `att-pic-${stamp}`;
      const res = await put(`/api/v1/documents/AssessmentItem/${id}${q}`, {
        message: 'A picture option',
        document: item(id, {
          options: [picture('pic', true), textOption('b', 'Beta', false)],
          attachments: [image({ store: 'Other', storeUri: 'lore://assets.example.edu', revision: undefined, hashAlgorithm: 'lore-v1', contentHash: 'ZZ-not-hex', role: 'source' })],
        }),
      });
      expect(res.status).toBe(200);
      const doc = await (await get(`/api/v1/documents/AssessmentItem/${id}${q}`)).json();
      expect(doc.options[0].text).toBeUndefined();
      expect(doc.options[0].attachments[0]).toMatchObject({ store: 'Git', contentHash: sha, revision: 'c0ffee1' });
      expect(doc.attachments[0]).toMatchObject({ hashAlgorithm: 'lore-v1', role: 'source' });
    });

    it('refuses a fragment with neither text nor an attachment (constraint 19); two pictures are not duplicate text, two equal texts still are (constraint 9)', async () => {
      const empty = await put(`/api/v1/documents/AssessmentItem/att-empty-${stamp}${q}`, {
        message: 'x',
        document: item(`att-empty-${stamp}`, { options: [{ '@type': 'ItemOption', fragmentId: 'a', isCorrect: true }, textOption('b', 'Beta', false)] }),
      });
      expect(empty.status).toBe(422);
      expect(await codes(empty)).toEqual(['empty_fragment']);

      const twoPictures = await put(`/api/v1/documents/AssessmentItem/att-two-${stamp}${q}`, {
        message: 'Two picture options',
        document: item(`att-two-${stamp}`, { options: [picture('p1', true), picture('p2', false, 'cd'.repeat(32))] }),
      });
      expect(twoPictures.status).toBe(200);

      const dup = await put(`/api/v1/documents/AssessmentItem/att-dup-${stamp}${q}`, {
        message: 'x',
        document: item(`att-dup-${stamp}`, { options: [textOption('a', 'Same', true), textOption('b', 'Same', false)] }),
      });
      expect(dup.status).toBe(422);
      expect(await codes(dup)).toEqual(['duplicate_option_text']);
    });

    it('a new revision of a picture makes the attestation on that option stale (ADR-0028)', async () => {
      const id = `att-stale-${stamp}`;
      const ITEM = `AssessmentItem/${id}`;
      const doc = item(id, { options: [picture('pic', true), textOption('b', 'Beta', false)] });
      expect((await put(`/api/v1/documents/${ITEM}${q}`, { message: 'Item with a picture', document: doc })).status).toBe(200);
      const attest = await post(`/api/v1/documents${q}`, {
        message: 'The picture shows the right chart',
        documents: [{ '@type': 'Attestation', subject: ITEM, fragmentId: 'pic', verdict: 'Affirmed' }],
      });
      expect(attest.ok).toBe(true);
      const read = async () => (await (await get(`/api/v1/intelligence/attestations/${ITEM}${q}`)).json()).attestations[0].state;
      expect(await read()).toBe('Current');

      const reexported = item(id, { options: [picture('pic', true, 'ef'.repeat(32)), textOption('b', 'Beta', false)] });
      expect((await put(`/api/v1/documents/${ITEM}${q}`, { message: 'Re-exported the chart at a new revision', document: reexported })).status).toBe(200);
      expect(await read()).toBe('Stale');
    });
  });
  describe('outcome records name their source (constraint 20; ADR-0063)', () => {
    const xapi = { '@type': 'ExternalRef', system: 'xAPI', identifier: 'https://lms.example.edu/xapi/activities/pilot-quiz' };

    it('refuses a dataset with neither producedBy nor an external reference, and accepts either', async () => {
      const bare = await put(`/api/v1/documents/LearningDataset/src-bare-${stamp}${q}`, {
        message: 'x',
        document: { label: 'Scores from somewhere', cohort: 'Pilot' },
      });
      expect(bare.status).toBe(422);
      expect(await codes(bare)).toEqual(['dataset_without_source']);

      const imported = await put(`/api/v1/documents/LearningDataset/src-ext-${stamp}${q}`, {
        message: 'Imported from the LMS',
        document: { label: 'Pilot quiz results', cohort: 'Pilot', externalRefs: [xapi] },
      });
      expect(imported.status).toBe(200);

      const produced = await put(`/api/v1/documents/LearningDataset/src-prod-${stamp}${q}`, {
        message: 'Produced by an assessment here',
        document: { label: 'Module 1 check results', producedBy: 'Assessment/mod1-assessment' },
      });
      expect(produced.status).toBe(200);
    });

    it('refuses a metric with neither derivedFrom nor an external reference, and accepts a benchmark that names its study', async () => {
      const base = { label: 'Pass rate', collectedAt: '2026-06-01T00:00:00Z', source: 'Benchmark report', value: 0.7, unit: 'proportion' };
      const bare = await put(`/api/v1/documents/LearningMetric/src-bare-${stamp}${q}`, { message: 'x', document: base });
      expect(bare.status).toBe(422);
      expect(await codes(bare)).toEqual(['metric_without_source']);

      const benchmark = await put(`/api/v1/documents/LearningMetric/src-ext-${stamp}${q}`, {
        message: 'A published benchmark',
        document: { ...base, externalRefs: [{ '@type': 'ExternalRef', system: 'Other', identifier: 'doi:10.1000/example.2026.17', label: 'Sector benchmark 2026' }] },
      });
      expect(benchmark.status).toBe(200);
    });
  });

  describe('commit messages keep their trailers (ADR-0065 decision 5; check AJ)', () => {
    it('returns a message ending in trailers byte for byte from the history route', async () => {
      // The workspace hub's push writes its trailers into the message, since the document API
      // ignores commit metadata (check V4); a reader of process data must get back what was written.
      const message = [
        'Reword the stem',
        '',
        'Armature-Workspace-Commit: 4f1c2a9e0b7d',
        'Armature-Authored-At: 2026-10-30T12:00:00.000Z',
        'Armature-Workspace-Part: 1/2',
      ].join('\n');
      const id = `LearningNeed/trailers-${stamp}`;
      const res = await post(`/api/v1/documents${q}`, {
        message,
        documents: [{ '@type': 'LearningNeed', '@id': id, label: 'Need', rationale: 'Pushed from a workspace' }],
      });
      expect(res.status).toBe(200);
      const history = await (await get(`/api/v1/documents/${id}/history${q}`)).json();
      expect(history.entries[0].message).toBe(message);
    });
  });
});
