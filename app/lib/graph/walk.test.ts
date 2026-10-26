/**
 * The Walkthrough (docs/graph-view-plan.md §7.2): the seed's trace from the
 * metric walked to its ten steps, a walk from an item and from an objective
 * starting further along, and the coverage and changes steps filled from
 * reads.
 */
import type { CoverageReport } from '@armature/client';
import { describe, expect, it } from 'vitest';
import { app } from '../api/app';
import { derive, type Doc } from './derive';
import { buildWalk, completeWalk, type WalkTrace } from './walk';

async function seed() {
  const exported = (await (await app.request('/api/v1/export?profile=full')).json()) as { documents: Doc[] };
  const traced = (await (await app.request('/api/v1/intelligence/trace/LearningMetric/mod3-bias-type-difficulty')).json()) as WalkTrace;
  const docs = exported.documents.filter((d) => d['@type'] !== 'User');
  return { docs, byId: new Map<string, Doc>(docs.map((d) => [d['@id'], d])), graph: derive(docs), trace: traced };
}

describe('the walk', () => {
  it("walks the seed's metric to its ten steps, from the result to the evidence", async () => {
    const { graph, byId, trace } = await seed();
    const walk = buildWalk(graph, trace, byId);
    expect(walk.steps.map((s) => s.kind)).toEqual(['root', 'dataset', 'assessment', 'item', 'objective', 'module', 'coverage', 'changes', 'need', 'evidence']);
    expect(walk.steps.map((s) => s.nodes)).toEqual([
      ['LearningMetric/mod3-bias-type-difficulty'],
      ['LearningDataset/mod3-spring-pilot'],
      ['Assessment/mod3-assessment'],
      ['AssessmentItem/bias-type-mc'],
      ['LearningObjective/distinguish-bias-types'],
      ['Module/risks-and-ethics'],
      ['Module/risks-and-ethics', 'LearningObjective/distinguish-bias-types'],
      [],
      ['LearningNeed/conceptual-gap'],
      ['DescriptiveEvidence/survey-ai-concepts'],
    ]);
    expect(walk).toMatchObject({ module: 'Module/risks-and-ethics', objective: 'LearningObjective/distinguish-bias-types', asOf: (trace.root as { asOf?: string }).asOf });
    expect(walk.steps[0].text[0]).toBe('0.38 proportion correct on Identifying training data bias, Spring 2026 pilot, 2026-05-14.');
    expect(walk.steps[2].text[0]).toBe('4 items were placed in Module 3 Capstone Assessment; 3 placements were approved.');
    expect(walk.steps[3].text[1]).toMatch(/^Attested Affirmed on part bias-type-mc-opt-a by demo-reviewer: ".*". The verdict is Current/);
    expect(walk.steps[5].text[0]).toMatch(/^Risks and Ethical Use declares Distinguish Bias Types as Primary \(#1\)/);
    expect(walk.steps[8].continuation).toBe(true);
    expect(walk.steps[9].text.at(-1)).toMatch(/^The loop closes/);
    // Each step's edges are drawn edges to the walk so far; the item step walks the placement.
    expect(walk.steps[3].edges).toContain(trace.edges.find((e) => e.to === 'AssessmentItem/bias-type-mc' && e.via === 'implements')!.through);
    expect(walk.steps[1].edges).toEqual(['LearningMetric/mod3-bias-type-difficulty|derivedFrom|LearningDataset/mod3-spring-pilot']);
  });

  it('starts further along for a root further along the lifecycle', async () => {
    const { graph, byId } = await seed();
    const traceOf = async (path: string) => (await (await app.request(path)).json()) as WalkTrace;
    const item = await traceOf('/api/v1/intelligence/trace/AssessmentItem/bias-type-mc');
    const walk = buildWalk(graph, item, byId);
    expect(walk.steps.map((s) => s.kind)).toEqual(['root', 'objective', 'module', 'coverage', 'need', 'evidence']);
    expect(walk.asOf).toBeUndefined();
    const objective = await traceOf('/api/v1/intelligence/trace/LearningObjective/distinguish-bias-types');
    expect(buildWalk(graph, objective, byId).steps.map((s) => s.kind)).toEqual(['root', 'module', 'coverage', 'need', 'evidence']);
  });

  it('fills the coverage and changes steps from the reads', async () => {
    const { graph, byId, trace } = await seed();
    const walk = buildWalk(graph, trace, byId);
    const figure = (items: number, status: CoverageReport['objectives'][number]['coverage']['status']) => ({ status, items });
    const report = (items: number): CoverageReport => ({
      module: { id: 'Module/risks-and-ethics', type: 'Module' },
      thresholds: { fullyAssessedAt: 2, overAssessedAbove: 4 },
      summary: { declared: 1, coverage: { Uncovered: 0, PartiallyAssessed: 1, FullyAssessed: 0, OverAssessed: 0 }, projected: { Uncovered: 0, PartiallyAssessed: 1, FullyAssessed: 0, OverAssessed: 0 }, undeclared: 0 },
      objectives: [{ id: 'ModuleObjective/x', objective: { id: 'LearningObjective/distinguish-bias-types', type: 'LearningObjective' }, coverage: figure(items, items >= 2 ? 'FullyAssessed' : 'PartiallyAssessed'), projected: figure(items, items >= 2 ? 'FullyAssessed' : 'PartiallyAssessed'), assessedBy: [] }],
      undeclared: [],
    });
    const done = completeWalk(walk, {
      coverageThen: report(1), coverageNow: report(2), branch: 'main',
      changes: { from: walk.asOf!, to: 'head', changes: [{ id: 'LearningMetric/mod3-bias-type-difficulty', op: 'insert' }, { id: 'AssessmentItem/bias-type-mc', op: 'update' }, { id: 'DesignNote/gone', op: 'delete' }] },
    }, byId);
    const coverage = done.steps.find((s) => s.kind === 'coverage')!;
    expect(coverage.text[0]).toMatch(/^When the cohort met the design \(commit [0-9a-z]{10}\), Distinguish Bias Types was partially assessed in Risks and Ethical Use: 1 eligible item\.$/);
    expect(coverage.text[1]).toBe('Today it is fully assessed: 2 eligible items.');
    const changes = done.steps.find((s) => s.kind === 'changes')!;
    expect(changes.text[0]).toMatch(/^Since commit [0-9a-z]{10} on main: 1 record added \(1 LearningMetric\), 1 record changed \(1 AssessmentItem\), 1 record deleted\./);
    expect(changes).toMatchObject({ added: ['LearningMetric/mod3-bias-type-difficulty'], changed: ['AssessmentItem/bias-type-mc'], gone: ['DesignNote/gone'] });
    expect(changes.nodes).toEqual(['LearningMetric/mod3-bias-type-difficulty', 'AssessmentItem/bias-type-mc']);
  });

  it("tells the seed's revision from the hub's own reads: the item the cohort did not meet, then and now", async () => {
    const { graph, byId, trace } = await seed();
    const walk = buildWalk(graph, trace, byId);
    const read = async <T,>(path: string) => (await (await app.request(path)).json()) as T;
    const done = completeWalk(walk, {
      coverageThen: await read<CoverageReport>(`/api/v1/intelligence/coverage/risks-and-ethics?ref=${walk.asOf}`),
      coverageNow: await read<CoverageReport>('/api/v1/intelligence/coverage/risks-and-ethics'),
      changes: await read(`/api/v1/branches/main/changes?since=${walk.asOf}`),
      branch: 'main',
    }, byId);
    const assessment = done.steps.find((s) => s.kind === 'assessment')!;
    expect(assessment.text[0]).toMatch(/^4 items are placed in Module 3 Capstone Assessment today, 3 of them approved\. 1 was placed after the cohort's commit \([0-9a-z]{10}\), so the cohort met 3\.$/);
    const coverage = done.steps.find((s) => s.kind === 'coverage')!;
    expect(coverage.text[0]).toMatch(/was partially assessed in Risks and Ethical Use: 1 eligible item\.$/);
    expect(coverage.text[1]).toBe('Today it is fully assessed: 2 eligible items (Identifying training data bias, Telling output bias from training data bias).');
    const changes = done.steps.find((s) => s.kind === 'changes')!;
    expect(changes.added).toEqual(expect.arrayContaining(['DesignFinding/bias-objective-rests-on-one-item', 'AssessmentItem/output-bias-mc']));
  });

  it('leaves the assessment step alone when nothing was placed after the commit', async () => {
    const { graph, byId, trace } = await seed();
    const walk = buildWalk(graph, trace, byId);
    const done = completeWalk(walk, { changes: { from: walk.asOf!, to: 'head', changes: [] }, branch: 'main' }, byId);
    expect(done.steps.find((s) => s.kind === 'assessment')!.text).toEqual(walk.steps.find((s) => s.kind === 'assessment')!.text);
  });

  it('says so when the reads are missing', async () => {
    const { graph, byId, trace } = await seed();
    const done = completeWalk(buildWalk(graph, trace, byId), {}, byId);
    expect(done.steps.find((s) => s.kind === 'coverage')!.text[0]).toMatch(/could not be made there/);
    expect(done.steps.find((s) => s.kind === 'changes')!.text[0]).toMatch(/at a commit/);
  });
});
