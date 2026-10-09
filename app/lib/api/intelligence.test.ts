/**
 * The design-intelligence reads (plan §4 Phase 4; ADR-0029 for coverage).
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
  it('reports the stored verdicts, the counts and the items behind each, with the commit in ETag', async () => {
    const res = await get('/api/v1/intelligence/coverage/how-ai-works');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toMatch(/^"[a-z0-9]+"$/);
    const body = await res.json();
    expect(body.module).toMatchObject({ id: 'Module/how-ai-works', type: 'Module', label: 'How AI Systems Work' });
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
    expect(limitations.coverageStatus).toBe('Uncovered');
    expect(limitations.projectedCoverageStatus).toBe('PartiallyAssessed');
    expect(limitations.stale).toBeUndefined();
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
    expect(declaration).toMatchObject({ via: 'module', role: 'Primary', status: 'Uncovered' });
  });
});
