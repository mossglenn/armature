/**
 * The design-intelligence reads (plan §4 Phase 4; architecture decision
 * record ADR-0029 for coverage).
 *
 * Integration tests like app.test.ts: the container must be up with the seed
 * loaded. Reads run against `main`; the cases that need documents the seed
 * lacks (a below-level item, a dataset and a metric for Narrative 1) write
 * them to one scratch branch created here and deleted afterwards.
 *
 * Phase 4's exit criterion: both PROJECT_CONTEXT narratives walk on seed
 * data using only intelligence routes. Narrative 2 (design time) is the
 * coverage and alignment reads; Narrative 1 (outcomes to design) is the trace
 * from a metric back to the module that declared the objective.
 *
 * Coverage is computed on read and never stored (ADR-0056), so the walk of a
 * declaration through every verdict is a sequence of writes and reads here,
 * not a write-pipeline test.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app';
import { createStore } from './store';

const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const stamp = Date.now().toString(36);
const BRANCH = `test-intel-${stamp}`;
const q = `?branch=${BRANCH}`;

const get = (path: string) => app.request(path);
const post = (path: string, body: unknown) =>
  app.request(path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
const json = async (path: string) => {
  const res = await get(path);
  expect(res.status).toBe(200);
  return res.json();
};
const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id);

describe('GET /api/v1/intelligence/coverage/:moduleId', () => {
  it('computes both verdicts with their counts and the items behind each, with the commit in ETag', async () => {
    const res = await get('/api/v1/intelligence/coverage/how-ai-works');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[a-z0-9]+"$/);
    const body = await res.json();
    expect(body.module).toMatchObject({ id: 'Module/how-ai-works', type: 'Module', label: 'How AI Systems Work' });
    expect(body.thresholds).toEqual({ fullyAssessedAt: 2, overAssessedAbove: 4 });
    expect(body.summary).toEqual({
      declared: 3,
      coverage: { Uncovered: 2, PartiallyAssessed: 1, FullyAssessed: 0, OverAssessed: 0 },
      projected: { Uncovered: 1, PartiallyAssessed: 2, FullyAssessed: 0, OverAssessed: 0 },
      undeclared: 0,
    });
    expect(body.objectives.map((o: { objective: { id: string } }) => o.objective.id)).toEqual([
      'LearningObjective/distinguish-ai-approaches',
      'LearningObjective/describe-model-training',
      'LearningObjective/identify-ai-limitations',
    ]);
    const limitations = body.objectives[2];
    expect(limitations.coverage).toEqual({ status: 'Uncovered', items: 0 });
    expect(limitations.projected).toEqual({ status: 'PartiallyAssessed', items: 1 });
    expect(limitations.assessedBy).toHaveLength(1);
    expect(limitations.assessedBy[0]).toMatchObject({
      id: 'AssessmentItem/hallucination-mc',
      status: 'Draft',
      bloomsLevel: 'Remember',
      eligibility: 'projected',
    });
    expect(limitations.assessedBy[0].placements[0]).toMatchObject({ assessment: 'Assessment/mod1-assessment', status: 'Draft' });
    expect(body.objectives[1].assessedBy).toEqual([]);
    expect(body.objectives[0].assessedBy[0].eligibility).toBe('delivered');
  });

  it('reports objectives the module assesses without declaring', async () => {
    const body = await json('/api/v1/intelligence/coverage/risks-and-ethics');
    expect(body.summary.undeclared).toBe(1);
    expect(body.undeclared[0].objective.id).toBe('LearningObjective/write-effective-prompts');
    expect(ids(body.undeclared[0].assessedBy)).toEqual(['AssessmentItem/effective-prompt-mc']);
  });

  it('reads at a commit with ref=', async () => {
    const first = await get('/api/v1/intelligence/coverage/how-ai-works');
    const commit = first.headers.get('etag')!.replace(/"/g, '');
    const res = await get(`/api/v1/intelligence/coverage/how-ai-works?ref=${commit}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBe(`"${commit}"`);
  });

  it('is 404 for an unknown module', async () => {
    const res = await get('/api/v1/intelligence/coverage/no-such-module');
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('not_found');
  });

  it('applies the caller\'s thresholds and refuses an incoherent cut', async () => {
    const generous = await json('/api/v1/intelligence/coverage/how-ai-works?fullyAssessedAt=1');
    expect(generous.thresholds).toEqual({ fullyAssessedAt: 1, overAssessedAbove: 4 });
    expect(generous.objectives[0].coverage.status).toBe('FullyAssessed');
    const bad = await get('/api/v1/intelligence/coverage/how-ai-works?fullyAssessedAt=3&overAssessedAbove=2');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('bad_query');
  });

  it('covers a whole course in one read', async () => {
    const body = await json('/api/v1/intelligence/coverage?course=Course/intro-ai-for-ids');
    expect(body.course.id).toBe('Course/intro-ai-for-ids');
    expect(body.modules.map((m: { module: { id: string } }) => m.module.id)).toEqual([
      'Module/how-ai-works',
      'Module/ai-in-learning-design',
      'Module/risks-and-ethics',
    ]);
    const declared = body.modules.reduce((n: number, m: { summary: { declared: number } }) => n + m.summary.declared, 0);
    expect(declared).toBe(7);
    expect(body.modules[2].summary.undeclared).toBe(1);
  });
});

describe('GET /api/v1/intelligence/alignment', () => {
  it('finds no below-level item in the seed and every objective without an activity', async () => {
    const body = await json('/api/v1/intelligence/alignment');
    expect(body.scope).toEqual({ objectives: 7, items: 6, activities: 0 });
    expect(body.itemsBelowObjective).toEqual([]);
    expect(body.objectivesWithoutItemAtLevel.map((o: { id: string }) => o.id)).toEqual(['LearningObjective/describe-model-training']);
    expect(body.objectivesWithoutActivity).toHaveLength(7);
    expect(body.unleveled).toEqual({ objectives: [], items: [] });
  });

  it('scopes to a module', async () => {
    const body = await json('/api/v1/intelligence/alignment?module=Module/how-ai-works');
    expect(body.scope.module.id).toBe('Module/how-ai-works');
    expect(body.scope.objectives).toBe(3);
    expect(body.scope.items).toBe(2);
  });
});

describe('GET /api/v1/intelligence/trace/:type/:id', () => {
  it('walks an item up to its evidence and down to its module, with the finding about it', async () => {
    const body = await json('/api/v1/intelligence/trace/AssessmentItem/hallucination-mc');
    expect(body.root.id).toBe('AssessmentItem/hallucination-mc');
    const nodeIds = ids(body.nodes);
    expect(nodeIds).toEqual(expect.arrayContaining([
      'LearningObjective/identify-ai-limitations',
      'LearningNeed/conceptual-gap',
      'DescriptiveEvidence/survey-ai-concepts',
      'Assessment/mod1-assessment',
      'Module/how-ai-works',
    ]));
    const evidence = body.edges.find((e: { to: string }) => e.to === 'DescriptiveEvidence/survey-ai-concepts');
    expect(evidence).toMatchObject({ from: 'LearningNeed/conceptual-gap', via: 'evidence', confidence: 'High' });
    expect(evidence.through).toMatch(/^NeedEvidenceLink\//);
    const placement = body.edges.find((e: { via: string }) => e.via === 'assessment');
    expect(placement).toMatchObject({ to: 'Assessment/mod1-assessment', status: 'Draft' });
    expect(ids(body.annotations)).toContain('DesignFinding/hallucination-stem-cues-answer');
    const finding = body.annotations.find((a: { id: string }) => a.id === 'DesignFinding/hallucination-stem-cues-answer');
    expect(finding.subject).toEqual(['AssessmentItem/hallucination-mc']);
    expect(finding.regarding).toBe('LearningObjective/identify-ai-limitations');
  });

  it('walks evidence down to the items that rest on it', async () => {
    const body = await json('/api/v1/intelligence/trace/DescriptiveEvidence/survey-ai-concepts');
    const nodeIds = ids(body.nodes);
    expect(nodeIds).toContain('LearningNeed/conceptual-gap');
    expect(nodeIds).toContain('LearningObjective/distinguish-bias-types');
    expect(nodeIds).toContain('AssessmentItem/bias-type-mc');
    expect(nodeIds).toContain('Module/risks-and-ethics');
  });

  it('does not continue through a module', async () => {
    const body = await json('/api/v1/intelligence/trace/AssessmentItem/distinguish-ai-mc');
    const nodeIds = ids(body.nodes);
    expect(nodeIds).toContain('Module/how-ai-works');
    expect(nodeIds).not.toContain('LearningObjective/describe-model-training');
  });

  it('refuses a type off the lifecycle', async () => {
    const res = await get('/api/v1/intelligence/trace/DesignNote/item6-authoring-rationale');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('untraceable_type');
  });
});

describe('GET /api/v1/intelligence/impact/:type/:id', () => {
  it('lists everything that references an objective, with what each junction sits in', async () => {
    const body = await json('/api/v1/intelligence/impact/LearningObjective/distinguish-ai-approaches');
    expect(body.document.id).toBe('LearningObjective/distinguish-ai-approaches');
    expect(body.summary.byType).toEqual({ AssessmentItem: 1, ModuleObjective: 1, PrerequisiteRecord: 2 });
    const declaration = body.references.find((r: { type: string }) => r.type === 'ModuleObjective');
    expect(declaration.field).toBe('references');
    expect(declaration.within).toEqual([expect.objectContaining({ field: 'module', id: 'Module/how-ai-works', label: 'How AI Systems Work' })]);
    expect(body.references.filter((r: { type: string }) => r.type === 'PrerequisiteRecord').every((r: { field: string }) => r.field === 'prerequisite')).toBe(true);
    expect(body.references.find((r: { type: string }) => r.type === 'AssessmentItem')).toMatchObject({ id: 'AssessmentItem/distinguish-ai-mc', field: 'assesses' });
  });

  it('shows the placements and the note that would need review if an item changed', async () => {
    const body = await json('/api/v1/intelligence/impact/AssessmentItem/appropriate-use-mc');
    expect(body.summary.byType).toEqual({ DesignNote: 1, ItemInstance: 1 });
    const placement = body.references.find((r: { type: string }) => r.type === 'ItemInstance');
    expect(placement.within).toEqual([expect.objectContaining({ field: 'assessment', id: 'Assessment/mod3-assessment' })]);
  });

  it('is 404 for an id under another type', async () => {
    const res = await get('/api/v1/intelligence/impact/Module/distinguish-ai-mc');
    expect(res.status).toBe(404);
  });
});

describe('on a scratch branch: alignment mismatches and Narrative 1', () => {
  beforeAll(async () => {
    const res = await post('/api/v1/branches', { name: BRANCH, from: { branch: 'main' } });
    expect(res.status).toBe(201);
  });

  afterAll(async () => {
    await createStore({ branch: 'main' }).deleteBranch(BRANCH).catch(() => undefined);
  });

  it('reports an item whose level is below the objective it assesses', async () => {
    const write = await post(`/api/v1/documents${q}`, {
      message: 'A recall item on an Evaluate objective',
      documents: [{
        '@id': `AssessmentItem/recall-${stamp}`,
        '@type': 'AssessmentItem',
        label: 'Recall item',
        stem: { '@type': 'TextFragment', fragmentId: 'stem', text: 'Which is true?' },
        options: [
          { '@type': 'ItemOption', fragmentId: 'a', text: 'Alpha', isCorrect: true },
          { '@type': 'ItemOption', fragmentId: 'b', text: 'Beta', isCorrect: false },
        ],
        itemType: 'MultipleChoice',
        status: 'Draft',
        bloomsLevel: 'Remember',
        assesses: ['LearningObjective/evaluate-appropriate-use'],
      }],
    });
    expect(write.status).toBe(200);
    const body = await json(`/api/v1/intelligence/alignment${q}&module=Module/risks-and-ethics`);
    expect(body.itemsBelowObjective).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ id: `AssessmentItem/recall-${stamp}`, bloomsLevel: 'Remember' }),
        objective: expect.objectContaining({ id: 'LearningObjective/evaluate-appropriate-use', bloomsLevel: 'Evaluate' }),
        levelsBelow: 4,
      }),
    ]);
  });

  it('traces a metric back through its dataset and assessment to the objectives and the module (Narrative 1)', async () => {
    const write = await post(`/api/v1/documents${q}`, {
      message: 'Spring cohort results for the Module 1 check',
      documents: [
        { '@type': 'LearningDataset', '@capture': 'ds', label: 'Spring cohort, Module 1 check', cohort: 'Spring', producedBy: 'Assessment/mod1-assessment' },
        { '@type': 'LearningMetric', label: 'Item 1 p-value', collectedAt: '2026-06-01T00:00:00Z', source: 'LMS export', value: 0.42, unit: 'proportion correct', derivedFrom: { '@ref': 'ds' } },
      ],
    });
    expect(write.status).toBe(200);
    const [, metricId] = (await write.json()).ids;
    const body = await json(`/api/v1/intelligence/trace/${metricId}${q}`);
    expect(body.root).toMatchObject({ type: 'LearningMetric', value: 0.42, unit: 'proportion correct' });
    const nodeIds = ids(body.nodes);
    expect(nodeIds).toEqual(expect.arrayContaining([
      'Assessment/mod1-assessment',
      'AssessmentItem/distinguish-ai-mc',
      'AssessmentItem/hallucination-mc',
      'LearningObjective/distinguish-ai-approaches',
      'LearningObjective/identify-ai-limitations',
      'LearningNeed/conceptual-gap',
      'DescriptiveEvidence/survey-ai-concepts',
      'Module/how-ai-works',
    ]));
    const declaration = body.edges.find((e: { from: string; to: string }) => e.from === 'LearningObjective/identify-ai-limitations' && e.to === 'Module/how-ai-works');
    expect(declaration).toMatchObject({ via: 'module', role: 'Primary' });
  });

  describe('a declaration walked through every verdict by writes and reads (ADR-0029 decisions 1 to 3)', () => {
    const OBJECTIVE_2 = 'LearningObjective/describe-model-training';
    let moduleId = '';
    let assessmentId = '';
    let assessment2Id = '';
    let beforeMove = '';

    const item = (id: string, status: string) => ({
      '@id': `AssessmentItem/${id}`,
      '@type': 'AssessmentItem',
      label: `Item ${id}`,
      stem: { '@type': 'TextFragment', fragmentId: 'stem', text: 'Which is true?' },
      options: [
        { '@type': 'ItemOption', fragmentId: 'a', text: 'Alpha', isCorrect: true },
        { '@type': 'ItemOption', fragmentId: 'b', text: 'Beta', isCorrect: false },
      ],
      itemType: 'MultipleChoice',
      status,
      assesses: [OBJECTIVE_2],
    });
    // Placements are Hash-keyed on (assessment, implements): no client id, and
    // writing the same pair again replaces that placement.
    const placement = (itemId: string, sequence: number, status: string, assessment: unknown = assessmentId) => ({
      '@type': 'ItemInstance', sequence, pointValue: 1, randomize: false, status, assessment, implements: `AssessmentItem/${itemId}`,
    });
    const write = async (message: string, documents: unknown[]) => {
      const res = await post(`/api/v1/documents${q}`, { message, documents });
      expect(res.status).toBe(200);
      return res.json();
    };
    const expectCoverage = async (coverage: string, projected: string, extra = '') => {
      const body = await json(`/api/v1/intelligence/coverage/${moduleId.replace(/^Module\//, '')}${q}${extra}`);
      const row = body.objectives.find((o: { objective: { id: string } }) => o.objective.id === OBJECTIVE_2);
      expect(row.coverage.status).toBe(coverage);
      expect(row.projected.status).toBe(projected);
      return row;
    };

    it('a module minted with its assessment and declaration starts Uncovered', async () => {
      const { ids } = await write('A module, its assessment and one declared objective', [
        { '@type': 'Module', '@capture': 'm', label: `Coverage module ${stamp}`, course: 'Course/intro-ai-for-ids' },
        { '@type': 'Assessment', '@capture': 'a', label: 'Coverage check', randomize: false, module: { '@ref': 'm' } },
        { '@type': 'ModuleObjective', module: { '@ref': 'm' }, references: OBJECTIVE_2, role: 'Primary' },
      ]);
      [moduleId, assessmentId] = ids;
      const row = await expectCoverage('Uncovered', 'Uncovered');
      expect(row.coverage.items).toBe(0);
    });

    it('an approved bank item that nobody has placed covers nothing', async () => {
      await write('Author item a', [item(`cov-a-${stamp}`, 'Approved')]);
      await expectCoverage('Uncovered', 'Uncovered');
    });

    it('a Draft placement moves the projected figure only', async () => {
      await write('Place item a, not yet cleared', [placement(`cov-a-${stamp}`, 1, 'Draft')]);
      const row = await expectCoverage('Uncovered', 'PartiallyAssessed');
      expect(row.assessedBy[0]).toMatchObject({ id: `AssessmentItem/cov-a-${stamp}`, eligibility: 'projected' });
    });

    it('clearing the placement delivers it', async () => {
      await write('Clear the placement', [placement(`cov-a-${stamp}`, 1, 'Approved')]);
      await expectCoverage('PartiallyAssessed', 'PartiallyAssessed');
    });

    it('two distinct items are FullyAssessed; the same item in a second assessment counts once', async () => {
      await write('Author and place item b', [item(`cov-b-${stamp}`, 'Approved'), placement(`cov-b-${stamp}`, 2, 'Approved')]);
      await expectCoverage('FullyAssessed', 'FullyAssessed');
      const { ids } = await write('A second assessment that places item a too', [
        { '@type': 'Assessment', '@capture': 'a2', label: 'Coverage recheck', randomize: false, module: moduleId },
        placement(`cov-a-${stamp}`, 1, 'Approved', { '@ref': 'a2' }),
      ]);
      [assessment2Id] = ids;
      const row = await expectCoverage('FullyAssessed', 'FullyAssessed');
      expect(row.coverage.items).toBe(2);
      expect(row.assessedBy.find((i: { id: string }) => i.id === `AssessmentItem/cov-a-${stamp}`).placements).toHaveLength(2);
    });

    it('above the threshold it is OverAssessed, and a different cut says otherwise', async () => {
      const names = ['c', 'd', 'e'].map((x) => `cov-${x}-${stamp}`);
      await write('Three more items, all placed', [
        ...names.map((id) => item(id, 'Approved')),
        ...names.map((id, i) => placement(id, 3 + i, 'Approved')),
      ]);
      const row = await expectCoverage('OverAssessed', 'OverAssessed');
      expect(row.coverage.items).toBe(5);
      await expectCoverage('FullyAssessed', 'FullyAssessed', '&overAssessedAbove=5');
    });

    it('retiring an item and re-aligning another both drop them from the count', async () => {
      await write('Retire item e', [item(`cov-e-${stamp}`, 'Retired')]);
      await expectCoverage('FullyAssessed', 'FullyAssessed');
      await write('Item d assesses another objective now', [{ ...item(`cov-d-${stamp}`, 'Approved'), assesses: ['LearningObjective/identify-ai-limitations'] }]);
      const row = await expectCoverage('FullyAssessed', 'FullyAssessed');
      expect(row.coverage.items).toBe(3); // a, b, c
    });

    it('moving an assessment moves its items to the other module\'s coverage', async () => {
      const before = await json(`/api/v1/intelligence/coverage/how-ai-works${q}`);
      expect(before.objectives.find((o: { objective: { id: string } }) => o.objective.id === OBJECTIVE_2).coverage.status).toBe('Uncovered');
      beforeMove = (await (await get(`/api/v1/branches/${BRANCH}`)).json()).head.commit;
      const res = await app.request(`/api/v1/documents/${assessmentId}${q}`, {
        method: 'PUT',
        headers: HEADERS,
        body: JSON.stringify({ message: 'Move the first assessment to How AI Works', document: { label: 'Coverage check', randomize: false, module: 'Module/how-ai-works' } }),
      });
      expect(res.status).toBe(200);
      // The test module keeps item a through its second assessment only.
      await expectCoverage('PartiallyAssessed', 'PartiallyAssessed');
      const after = await json(`/api/v1/intelligence/coverage/how-ai-works${q}`);
      expect(after.objectives.find((o: { objective: { id: string } }) => o.objective.id === OBJECTIVE_2).coverage).toEqual({ status: 'FullyAssessed', items: 3 });
      expect(assessment2Id).toMatch(/^Assessment\//);
    });

    it('reads the declaration as it was at the commit before the move: nothing stored, so nothing stale', async () => {
      expect(beforeMove).toMatch(/^[a-z0-9]+$/);
      const then = await json(`/api/v1/intelligence/coverage/${moduleId.replace(/^Module\//, '')}?ref=${beforeMove}`);
      expect(then.objectives[0].coverage).toEqual({ status: 'FullyAssessed', items: 3 });
      const now = await json(`/api/v1/intelligence/coverage/${moduleId.replace(/^Module\//, '')}${q}`);
      expect(now.objectives[0].coverage).toEqual({ status: 'PartiallyAssessed', items: 1 });
    });
  });
});
