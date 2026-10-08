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

    it('enforces @min_cardinality from the schema (constraints 1 and 2)', async () => {
      const noObjective = await put(`/api/v1/documents/AssessmentItem/shape-${stamp}${q}`, {
        message: 'x',
        document: item(`shape-${stamp}`, { assesses: [] }),
      });
      expect(noObjective.status).toBe(400);
      expect(await paths(noObjective)).toContain('assesses');

      const noTarget = await put(`/api/v1/documents/LearningActivity/shape-${stamp}${q}`, {
        message: 'x',
        document: { label: 'Act', targets: [] },
      });
      expect(noTarget.status).toBe(400);
      expect(await paths(noTarget)).toContain('targets');
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
    const G = `ActivityGroup/group-${stamp}`;
    const scaffold = [
      { '@type': 'LearningActivity', '@id': A, label: 'Activity A', targets: [OBJECTIVE] },
      { '@type': 'LearningActivity', '@id': B, label: 'Activity B', targets: [OBJECTIVE] },
      { '@type': 'ActivityGroup', '@id': G, label: 'Group' },
    ];

    it('rejects one sequence used by an activity link and a group link of the same module', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [
          ...scaffold,
          { '@type': 'ModuleActivityLink', module: MODULE, activity: A, sequence: 1 },
          { '@type': 'ModuleActivityGroupLink', module: MODULE, group: G, sequence: 1 },
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
          { '@type': 'ModuleActivityLink', module: MODULE, activity: A, sequence: 1 },
          { '@type': 'ModuleActivityGroupLink', module: MODULE, group: G, sequence: 2 },
        ],
      });
      expect(res.status).toBe(200);
      expect((await res.json()).ids).toHaveLength(5);
    });

    it('rejects a sequence reused within a group, and a group nested in a group', async () => {
      const dup = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [
          { '@type': 'ActivityGroupMember', group: G, activity: A, sequence: 1 },
          { '@type': 'ActivityGroupMember', group: G, activity: B, sequence: 1 },
        ],
      });
      expect(await codes(dup)).toEqual(['duplicate_sequence', 'duplicate_sequence']);

      const nested = await post(`/api/v1/documents${q}`, {
        message: 'x',
        documents: [{ '@type': 'ActivityGroupMember', group: G, activity: G, sequence: 3 }],
      });
      expect(nested.status).toBe(422);
      expect(await codes(nested)).toEqual(['reference_class']);
    });

    it('accepts members with distinct sequences', async () => {
      const res = await post(`/api/v1/documents${q}`, {
        message: 'Fill the group',
        documents: [
          { '@type': 'ActivityGroupMember', group: G, activity: A, sequence: 1 },
          { '@type': 'ActivityGroupMember', group: G, activity: B, sequence: 2 },
        ],
      });
      expect(res.status).toBe(200);
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
  });
  describe('constraint 7: coverage is computed in the commit that changes it (ADR-0029)', () => {
    const OBJECTIVE_2 = 'LearningObjective/describe-model-training';
    let moduleId = '';
    let assessmentId = '';
    let declarationId = '';

    const declaration = async () => (await get(`/api/v1/documents/${declarationId}${q}`)).json();
    const lastCommitOf = async (id: string) =>
      ((await (await get(`/api/v1/documents/${id}/history${q}&count=1&diff=false`)).json()).entries[0] as { commit: string }).commit;
    // Placements are Hash-keyed on (assessment, implements): no client id, and
    // writing the same pair again is a replace of that placement.
    const placement = (itemId: string, sequence: number, status: string, assessment: unknown = assessmentId) => ({
      '@type': 'ItemInstance',
      sequence,
      pointValue: 1,
      randomize: false,
      status,
      assessment,
      implements: `AssessmentItem/${itemId}`,
    });
    const write = (message: string, documents: unknown[]) => post(`/api/v1/documents${q}`, { message, documents });
    const expectCoverage = async (coverageStatus: string, projectedCoverageStatus: string) => {
      const d = await declaration();
      expect(d.coverageStatus).toBe(coverageStatus);
      expect(d.projectedCoverageStatus).toBe(projectedCoverageStatus);
    };

    it('rejects a computed field sent by a client with 400, naming the field', async () => {
      const res = await write('x', [
        { '@type': 'ModuleObjective', module: MODULE, references: OBJECTIVE_2, role: 'Supporting', coverageStatus: 'FullyAssessed' },
      ]);
      expect(res.status).toBe(400);
      const { issues } = await res.json();
      expect(issues).toHaveLength(1);
      expect(issues[0].path).toBe('coverageStatus');
      expect(issues[0].message).toContain('computed');
    });

    it('fills both fields on a declaration of a module minted in the same write', async () => {
      const res = await write('A module, its assessment and one declared objective', [
        { '@type': 'Module', '@capture': 'm', label: `Coverage module ${stamp}`, course: 'Course/intro-ai-for-ids' },
        { '@type': 'Assessment', '@capture': 'a', label: 'Coverage check', randomize: false, module: { '@ref': 'm' } },
        { '@type': 'ModuleObjective', module: { '@ref': 'm' }, references: OBJECTIVE_2, role: 'Primary' },
      ]);
      expect(res.status).toBe(200);
      [moduleId, assessmentId, declarationId] = (await res.json()).ids;
      expect(moduleId).toMatch(/^Module\//);
      await expectCoverage('Uncovered', 'Uncovered');
    });

    it('an approved bank item that nobody has placed covers nothing', async () => {
      const res = await put(`/api/v1/documents/AssessmentItem/cov-a-${stamp}${q}`, {
        message: 'Author item a',
        document: item(`cov-a-${stamp}`, { status: 'Approved', assesses: [OBJECTIVE_2] }),
      });
      expect(res.status).toBe(200);
      await expectCoverage('Uncovered', 'Uncovered');
    });

    it('a Draft placement moves the projected figure only, in the same commit', async () => {
      const res = await write('Place item a, not yet cleared', [placement(`cov-a-${stamp}`, 1, 'Draft')]);
      expect(res.status).toBe(200);
      const { commit } = await res.json();
      await expectCoverage('Uncovered', 'PartiallyAssessed');
      expect(await lastCommitOf(declarationId)).toBe(commit);
      expect(res.headers.get('etag')).toBe(`"${commit}"`);
    });

    it('clearing the placement delivers it', async () => {
      const res = await write('Clear the placement', [placement(`cov-a-${stamp}`, 1, 'Approved')]);
      expect(res.status).toBe(200);
      await expectCoverage('PartiallyAssessed', 'PartiallyAssessed');
    });

    it('two distinct items are FullyAssessed; the same item in a second assessment counts once', async () => {
      const second = await write('Author and place item b', [
        item(`cov-b-${stamp}`, { status: 'Approved', assesses: [OBJECTIVE_2] }),
        placement(`cov-b-${stamp}`, 2, 'Approved'),
      ]);
      expect(second.status).toBe(200);
      await expectCoverage('FullyAssessed', 'FullyAssessed');

      const again = await write('A second assessment that places item a too', [
        { '@type': 'Assessment', '@capture': 'a2', label: 'Coverage recheck', randomize: false, module: moduleId },
        placement(`cov-a-${stamp}`, 1, 'Approved', { '@ref': 'a2' }),
      ]);
      expect(again.status).toBe(200);
      await expectCoverage('FullyAssessed', 'FullyAssessed');
    });

    it('above the threshold it is OverAssessed', async () => {
      const ids = ['c', 'd', 'e'].map((x) => `cov-${x}-${stamp}`);
      const res = await write('Three more items, all placed', [
        ...ids.map((id) => item(id, { status: 'Approved', assesses: [OBJECTIVE_2] })),
        ...ids.map((id, i) => placement(id, 3 + i, 'Approved')),
      ]);
      expect(res.status).toBe(200);
      await expectCoverage('OverAssessed', 'OverAssessed');
    });

    it('retiring an item removes it from both figures', async () => {
      const res = await put(`/api/v1/documents/AssessmentItem/cov-e-${stamp}${q}`, {
        message: 'Retire item e',
        document: item(`cov-e-${stamp}`, { status: 'Retired', assesses: [OBJECTIVE_2] }),
      });
      expect(res.status).toBe(200);
      await expectCoverage('FullyAssessed', 'FullyAssessed');
    });

    it('dropping the objective from an item recomputes the declaration', async () => {
      const res = await put(`/api/v1/documents/AssessmentItem/cov-d-${stamp}${q}`, {
        message: 'Item d assesses another objective now',
        document: item(`cov-d-${stamp}`, { status: 'Approved', assesses: [OBJECTIVE] }),
      });
      expect(res.status).toBe(200);
      await expectCoverage('FullyAssessed', 'FullyAssessed'); // a, b and c remain: three distinct items
    });

    it('moving an assessment to another module recomputes both modules in one commit', async () => {
      const before = await (await get(`/api/v1/documents/ModuleObjective${q}&module=${MODULE}&references=${OBJECTIVE_2}`)).json();
      expect(before).toHaveLength(1);
      expect(before[0].coverageStatus).toBe('Uncovered');

      const res = await put(`/api/v1/documents/${assessmentId}${q}`, {
        message: 'Move the first assessment to How AI Works',
        document: { label: 'Coverage check', randomize: false, module: MODULE },
      });
      expect(res.status).toBe(200);
      const { commit } = await res.json();

      // The test module keeps item a through its second assessment only.
      await expectCoverage('PartiallyAssessed', 'PartiallyAssessed');
      // How AI Works gains a, b and c (d assesses another objective, e is Retired).
      const after = await (await get(`/api/v1/documents/ModuleObjective${q}&module=${MODULE}&references=${OBJECTIVE_2}`)).json();
      expect(after[0].coverageStatus).toBe('FullyAssessed');
      expect(await lastCommitOf(after[0]['@id'])).toBe(commit);
      expect(await lastCommitOf(declarationId)).toBe(commit);
    });

    it('rejects a client id on a Hash-keyed type with 400', async () => {
      const res = await write('x', [{ '@id': `ItemInstance/mine-${stamp}`, ...placement(`cov-a-${stamp}`, 9, 'Draft') }]);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('bad_id');
    });
  });
});
