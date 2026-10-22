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
  it("finds no below-level item in the seed, the objectives Module 1's activities leave out, and the Draft item no one has aligned", async () => {
    const body = await json('/api/v1/intelligence/alignment');
    expect(body.scope).toEqual({ objectives: 7, items: 7, activities: 3 });
    expect(body.itemsBelowObjective).toEqual([]);
    expect(body.objectivesWithoutItemAtLevel.map((o: { id: string }) => o.id)).toEqual(['LearningObjective/describe-model-training']);
    expect(ids(body.objectivesWithoutActivity).sort()).toEqual([
      'LearningObjective/distinguish-bias-types',
      'LearningObjective/evaluate-ai-objectives',
      'LearningObjective/evaluate-appropriate-use',
      'LearningObjective/identify-ai-limitations',
      'LearningObjective/write-effective-prompts',
    ]);
    expect(ids(body.itemsWithoutObjective)).toEqual(['AssessmentItem/training-loop-mc']);
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
    expect(body.summary.byType).toEqual({ AssessmentItem: 1, LearningActivity: 1, ModuleObjective: 1, PrerequisiteRecord: 2 });
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

  it('lists an item that assesses nothing, bank-wide and within the module it is placed in (ADR-0060)', async () => {
    const itemId = `AssessmentItem/unaligned-${stamp}`;
    const before = await json(`/api/v1/intelligence/alignment${q}`);
    const write = await post(`/api/v1/documents${q}`, {
      message: 'An imported item nobody has aligned yet, placed in the Module 2 check',
      documents: [
        {
          '@id': itemId,
          '@type': 'AssessmentItem',
          label: 'Unaligned item',
          stem: { '@type': 'TextFragment', fragmentId: 'stem', text: 'Which is true?' },
          options: [
            { '@type': 'ItemOption', fragmentId: 'a', text: 'Alpha', isCorrect: true },
            { '@type': 'ItemOption', fragmentId: 'b', text: 'Beta', isCorrect: false },
          ],
          itemType: 'MultipleChoice',
          status: 'Draft',
        },
        { '@type': 'ItemInstance', sequence: 99, pointValue: 1, randomize: false, status: 'Draft', assessment: 'Assessment/mod2-assessment', implements: itemId },
      ],
    });
    expect(write.status).toBe(200);

    const bankWide = await json(`/api/v1/intelligence/alignment${q}`);
    expect(ids(bankWide.itemsWithoutObjective).sort()).toEqual([...ids(before.itemsWithoutObjective), itemId].sort());
    expect(bankWide.scope.items).toBe(before.scope.items); // it assesses nothing, so it is in no objective's scope

    const placedIn = await json(`/api/v1/intelligence/alignment${q}&module=Module/ai-in-learning-design`);
    expect(ids(placedIn.itemsWithoutObjective)).toEqual([itemId]);
    const elsewhere = await json(`/api/v1/intelligence/alignment${q}&module=Module/how-ai-works`);
    expect(elsewhere.itemsWithoutObjective).toEqual([]);
  });

  it('shows an item\'s formative use in the trace and impact, and keeps it out of coverage (ADR-0061)', async () => {
    const ACT = `LearningActivity/lecture-${stamp}`;
    const objective = 'LearningObjective/identify-ai-limitations';
    const before = await json(`/api/v1/intelligence/coverage/how-ai-works${q}`);
    const write = await post(`/api/v1/documents${q}`, {
      message: 'Lecture 1 polls the room with the hallucination item',
      documents: [
        { '@type': 'LearningActivity', '@id': ACT, label: 'Lecture 1', targets: [objective] },
        // 3: the seed's own Module 1 content holds 1 and 2 (constraint 3)
        { '@type': 'ModuleActivityLink', module: 'Module/how-ai-works', activity: ACT, sequence: 3 },
        { '@type': 'ActivityItemLink', activity: ACT, item: 'AssessmentItem/hallucination-mc', sequence: 1 },
      ],
    });
    expect(write.status).toBe(200);
    const [, , linkId] = (await write.json()).ids as string[];

    const trace = await json(`/api/v1/intelligence/trace/AssessmentItem/hallucination-mc${q}`);
    expect(ids(trace.nodes)).toContain(ACT);
    expect(trace.edges).toContainEqual({ from: 'AssessmentItem/hallucination-mc', to: ACT, via: 'activity', through: linkId });
    const context = trace.edges.find((e: { from: string; via: string }) => e.from === ACT && e.via === 'module');
    expect(context).toMatchObject({ to: 'Module/how-ai-works' });
    expect(context.through).toMatch(/^ModuleActivityLink\//);

    const impact = await json(`/api/v1/intelligence/impact/AssessmentItem/hallucination-mc${q}`);
    const use = impact.references.find((r: { id: string }) => r.id === linkId);
    expect(use).toMatchObject({ type: 'ActivityItemLink', field: 'item' });
    expect(use.within).toEqual([expect.objectContaining({ field: 'activity', id: ACT })]);

    const after = await json(`/api/v1/intelligence/coverage/how-ai-works${q}`);
    const count = (body: { objectives: Array<{ objective: { id: string }; projected: { items: number } }> }) =>
      body.objectives.find((o) => o.objective.id === objective)!.projected.items;
    expect(count(after)).toBe(count(before));
  });

  it('traces a metric back through its dataset and assessment to the objectives and the module (Narrative 1)', async () => {
    const delivered = (await get(`/api/v1/branches/${BRANCH}`)).headers.get('etag')!.replace(/"/g, '');
    const write = await post(`/api/v1/documents${q}`, {
      message: 'Spring cohort results for the Module 1 check',
      documents: [
        { '@type': 'LearningDataset', '@capture': 'ds', label: 'Spring cohort, Module 1 check', cohort: 'Spring', producedBy: 'Assessment/mod1-assessment' },
        { '@type': 'LearningMetric', label: 'Item 1 p-value', collectedAt: '2026-06-01T00:00:00Z', source: 'LMS export', value: 0.42, unit: 'proportion correct', derivedFrom: { '@ref': 'ds' }, subject: 'AssessmentItem/hallucination-mc' },
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

    // The state the cohort met (ADR-0057): the metric and its dataset name the
    // commit the write started from, and the module's coverage is read there.
    expect(body.root.asOf).toBe(delivered);
    expect(body.nodes.find((n: { type: string }) => n.type === 'LearningDataset').asOf).toBe(delivered);
    const atDelivery = await get(`/api/v1/intelligence/coverage/how-ai-works?ref=${body.root.asOf}`);
    expect(atDelivery.status).toBe(200);
    expect(atDelivery.headers.get('etag')).toBe(`"${delivered}"`);

    // An item statistic names the item it measures (ADR-0058): the trace hops
    // to it directly, the item's trace reaches the metric, and the list route
    // finds the item's metrics.
    expect(body.edges).toContainEqual({ from: metricId, to: 'AssessmentItem/hallucination-mc', via: 'subject' });
    const fromItem = await json(`/api/v1/intelligence/trace/AssessmentItem/hallucination-mc${q}`);
    expect(fromItem.edges).toContainEqual({ from: 'AssessmentItem/hallucination-mc', to: metricId, via: 'subject' });
    const metrics = await json(`/api/v1/documents/LearningMetric${q}&subject=AssessmentItem/hallucination-mc`);
    expect(ids(metrics.map((m: { '@id': string }) => ({ id: m['@id'] })))).toEqual([metricId]);
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

/**
 * Phase 5's exit criterion (ADR-0028 decision 7): an attestation written on a
 * branch at commit A is reported stale after a write at commit B touches the
 * same fragment, without the plugin computing anything. The attestations are
 * made on a review branch (CoQui's round) and merged into a second branch, so
 * the commit they name is not in the target's history (platform check AB6);
 * the change is then made on the target.
 */
describe('GET /api/v1/intelligence/attestations/:type/:id (Phase 5 exit criterion)', () => {
  const ROUND = `test-attest-round-${stamp}`;
  const TARGET = `test-attest-target-${stamp}`;
  const ITEM = `AssessmentItem/attested-${stamp}`;
  const put = (path: string, body: unknown) =>
    app.request(path, { method: 'PUT', headers: HEADERS, body: JSON.stringify(body) });
  const itemDoc = (options: Array<[string, string, boolean]>) => ({
    label: 'Attested item',
    stem: { '@type': 'TextFragment', fragmentId: 'stem', text: 'Which statement about language models is true?' },
    options: options.map(([fragmentId, text, isCorrect]) => ({ '@type': 'ItemOption', fragmentId, text, isCorrect })),
    itemType: 'MultipleChoice',
    status: 'InReview',
    assesses: ['LearningObjective/identify-ai-limitations'],
  });
  const original: Array<[string, string, boolean]> = [
    ['a', 'They can state falsehoods fluently.', true],
    ['b', 'They check facts before answering.', false],
    ['c', 'They never repeat training text.', false],
  ];
  const stateOf = (body: { attestations: Array<{ fragmentId?: string; claimRef?: string; state: string }> }) =>
    Object.fromEntries(body.attestations.map((a) => [a.claimRef ?? a.fragmentId ?? 'item', a.state]));
  let attestedAt: string;

  beforeAll(async () => {
    for (const name of [ROUND, TARGET]) {
      expect((await post('/api/v1/branches', { name, from: { branch: 'main' } })).status).toBe(201);
    }
    expect((await put(`/api/v1/documents/${ITEM}?branch=${ROUND}`, { message: 'Item for review', document: itemDoc(original) })).status).toBe(200);
    const res = await post(`/api/v1/documents?branch=${ROUND}`, {
      message: 'Round 1 verdicts',
      documents: [
        { '@type': 'Attestation', subject: ITEM, fragmentId: 'b', claimRef: 'grid:distractor-b', claimText: 'Option b is plausible but wrong.', verdict: 'Affirmed' },
        { '@type': 'Attestation', subject: ITEM, fragmentId: 'a', claimRef: 'grid:key-a', claimText: 'Option a is the correct answer.', verdict: 'Affirmed' },
        { '@type': 'Attestation', subject: ITEM, fragmentId: 'c', verdict: 'Affirmed' },
        { '@type': 'Attestation', subject: ITEM, verdict: 'Affirmed', reason: 'Ready for placement.' },
      ],
    });
    expect(res.status).toBe(200);
    attestedAt = (await res.json()).commit;
    expect((await post(`/api/v1/branches/${TARGET}/merge`, { from: ROUND, message: 'Merge round 1' })).status).toBe(200);
  });

  afterAll(async () => {
    const store = createStore({ branch: 'main' });
    for (const name of [ROUND, TARGET]) await store.deleteBranch(name).catch(() => undefined);
  });

  it('reports every verdict Current after the merge, comparing against the round commit', async () => {
    const body = await json(`/api/v1/intelligence/attestations/AssessmentItem/attested-${stamp}?branch=${TARGET}`);
    expect(body.subject).toMatchObject({ id: ITEM, type: 'AssessmentItem' });
    expect(body.summary).toEqual({ attestations: 4, byState: { Current: 4, Stale: 0, FragmentRemoved: 0, Unanchored: 0 } });
    expect(stateOf(body)).toEqual({ 'grid:distractor-b': 'Current', 'grid:key-a': 'Current', c: 'Current', item: 'Current' });
    const b = body.attestations.find((a: { claimRef?: string }) => a.claimRef === 'grid:distractor-b');
    expect(b).toMatchObject({ fragmentId: 'b', claimText: 'Option b is plausible but wrong.', verdict: 'Affirmed', attestedBy: 'User/demo-designer' });
    expect(b.asOf).not.toBe(attestedAt); // the head the write started from: the item's commit
  });

  it('reports the changed fragment Stale, the untouched one Current, a removed one FragmentRemoved, and the whole item Stale', async () => {
    const revised: Array<[string, string, boolean]> = [
      ['a', 'They can state falsehoods fluently.', true],
      ['b', 'They verify every claim against a database.', false],
    ];
    expect((await put(`/api/v1/documents/${ITEM}?branch=${TARGET}`, { message: 'Revise b, drop c', document: itemDoc(revised) })).status).toBe(200);
    const body = await json(`/api/v1/intelligence/attestations/AssessmentItem/attested-${stamp}?branch=${TARGET}`);
    expect(stateOf(body)).toEqual({ 'grid:distractor-b': 'Stale', 'grid:key-a': 'Current', c: 'FragmentRemoved', item: 'Stale' });
    expect(body.summary.byState).toEqual({ Current: 1, Stale: 2, FragmentRemoved: 1, Unanchored: 0 });
  });

  it('is unaffected by a reorder, by fragmentId, and leaves the round branch Current', async () => {
    const reordered: Array<[string, string, boolean]> = [
      ['b', 'They verify every claim against a database.', false],
      ['a', 'They can state falsehoods fluently.', true],
    ];
    expect((await put(`/api/v1/documents/${ITEM}?branch=${TARGET}`, { message: 'Reorder', document: itemDoc(reordered) })).status).toBe(200);
    const target = await json(`/api/v1/intelligence/attestations/AssessmentItem/attested-${stamp}?branch=${TARGET}`);
    expect(stateOf(target)['grid:key-a']).toBe('Current');
    const round = await json(`/api/v1/intelligence/attestations/AssessmentItem/attested-${stamp}?branch=${ROUND}`);
    expect(round.summary.byState.Current).toBe(4);
    const atA = await json(`/api/v1/intelligence/attestations/AssessmentItem/attested-${stamp}?ref=${attestedAt}`);
    expect(atA.summary.byState.Current).toBe(4);
  });

  it('carries the verdicts and their state in the trace from the item', async () => {
    const body = await json(`/api/v1/intelligence/trace/AssessmentItem/attested-${stamp}?branch=${TARGET}`);
    const attestations = body.annotations.filter((a: { type: string }) => a.type === 'Attestation');
    expect(attestations).toHaveLength(4);
    expect(attestations.find((a: { claimRef?: string }) => a.claimRef === 'grid:distractor-b')).toMatchObject({ subject: ITEM, state: 'Stale' });
  });

  it("reads the seed's attestation Current on main, and shows it in the item's trace", async () => {
    const body = await json('/api/v1/intelligence/attestations/AssessmentItem/bias-type-mc');
    expect(body.summary.byState).toEqual({ Current: 1, Stale: 0, FragmentRemoved: 0, Unanchored: 0 });
    expect(body.attestations[0]).toMatchObject({
      fragmentId: 'bias-type-mc-opt-a',
      claimRef: 'seed:key-is-correct',
      verdict: 'Affirmed',
      attestedBy: 'User/demo-reviewer',
      state: 'Current',
    });
    const trace = await json('/api/v1/intelligence/trace/AssessmentItem/bias-type-mc');
    expect(trace.annotations.filter((x: { type: string }) => x.type === 'Attestation')).toHaveLength(1);
  });

  it('takes no attester parameter and is 404 for an unknown subject', async () => {
    const unknown = await get(`/api/v1/intelligence/attestations/AssessmentItem/nope-${stamp}?branch=${TARGET}`);
    expect(unknown.status).toBe(404);
  });
});

describe('Narrative 1 on the seed (Phase 6, ADR-0063)', () => {
  it('traces the pilot difficulty of the bias item back to its module, and reads coverage as delivered at the dataset asOf', async () => {
    const body = await json('/api/v1/intelligence/trace/LearningMetric/mod3-bias-type-difficulty');
    expect(body.root).toMatchObject({ type: 'LearningMetric', value: 0.38, unit: 'proportion correct' });
    const byType = (type: string) => body.nodes.filter((n: { type: string }) => n.type === type);
    expect(byType('LearningDataset').map((n: { id: string }) => n.id)).toEqual(['LearningDataset/mod3-spring-pilot']);
    expect(byType('Assessment').map((n: { id: string }) => n.id)).toEqual(['Assessment/mod3-assessment']);
    // The walk goes through the assessment to every item the cohort met, not only the metric's subject.
    expect(byType('AssessmentItem').map((n: { id: string }) => n.id)).toEqual(
      expect.arrayContaining(['AssessmentItem/bias-type-mc', 'AssessmentItem/effective-prompt-mc', 'AssessmentItem/appropriate-use-mc'])
    );
    expect(byType('LearningObjective').map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining(['LearningObjective/distinguish-bias-types']));
    // The prompt item is reused in Module 2's assessment, so its module is reached too (item reuse, Section 12.5).
    expect(byType('Module').map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining(['Module/risks-and-ethics', 'Module/ai-in-learning-design']));

    // "Adequate when": the dataset names the commit the cohort met (ADR-0057); coverage reads there.
    const asOf = byType('LearningDataset')[0].asOf as string;
    expect(asOf).toMatch(/^[a-z0-9]+$/);
    expect(body.root.asOf).toBe(asOf);
    const coverage = await json(`/api/v1/intelligence/coverage/risks-and-ethics?ref=${asOf}`);
    const bias = coverage.objectives.find((o: { objective: { id: string } }) => o.objective.id === 'LearningObjective/distinguish-bias-types');
    expect(bias.coverage).toEqual({ status: 'PartiallyAssessed', items: 1 });
    expect(bias.assessedBy.map((i: { id: string }) => i.id)).toEqual(['AssessmentItem/bias-type-mc']);

    // The item's statistics are metrics about it (ADR-0058), listed by subject.
    const stats = await json('/api/v1/documents/LearningMetric?subject=AssessmentItem/bias-type-mc');
    expect(stats.map((m: { '@id': string }) => m['@id'])).toEqual(['LearningMetric/mod3-bias-type-difficulty']);

    // The dataset names both its sources (ADR-0063): the assessment here and the LMS activity.
    const dataset = await json('/api/v1/documents/LearningDataset/mod3-spring-pilot');
    expect(dataset.producedBy).toBe('Assessment/mod3-assessment');
    expect(dataset.externalRefs[0]).toMatchObject({ system: 'xAPI' });
  });
});
