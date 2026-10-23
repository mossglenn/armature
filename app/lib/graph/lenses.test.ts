/**
 * The lenses (docs/graph-view-plan.md §8, §13 PR 4's acceptance): each lens
 * marks the right records and its legend reproduces its read's numbers, on
 * the fixture with hand-written reads and on the seed through the hub.
 */
import type { AlignmentReport, AttestationsReport, CourseCoverageReport, CoverageReport } from '@armature/client';
import { describe, expect, it } from 'vitest';
import { app } from '../api/app';
import { derive, type Doc } from './derive';
import { FIXTURE } from './fixture';
import { DIVERGING, STATE_COLOR, TONE_COLORS, VERDICT_COLOR, applyLens, namedCommits } from './lenses';

const g = derive(FIXTURE);
const sorted = (s: Iterable<string>) => [...s].sort();
const counts = (view: ReturnType<typeof applyLens>) => Object.fromEntries(view.legend.map((e) => [e.label, e.count]));

const declaration = (objective: string, status: CoverageReport['objectives'][number]['coverage']['status'], projected = status): CoverageReport['objectives'][number] => ({
  id: `ModuleObjective/${objective}`, objective: { id: `LearningObjective/${objective}`, type: 'LearningObjective' },
  coverage: { status, items: 0 }, projected: { status: projected, items: 0 }, assessedBy: [],
});
const moduleReport = (id: string, objectives: CoverageReport['objectives']): CoverageReport => ({
  module: { id, type: 'Module' }, thresholds: { fullyAssessedAt: 2, overAssessedAbove: 4 },
  summary: { declared: objectives.length, coverage: { Uncovered: 0, PartiallyAssessed: 0, FullyAssessed: 0, OverAssessed: 0 }, projected: { Uncovered: 0, PartiallyAssessed: 0, FullyAssessed: 0, OverAssessed: 0 }, undeclared: 0 },
  objectives, undeclared: [],
});

describe('the coverage lens', () => {
  const report: CourseCoverageReport = { thresholds: { fullyAssessedAt: 2, overAssessedAbove: 4 }, modules: [moduleReport('Module/m', [declaration('o1', 'PartiallyAssessed', 'FullyAssessed')])] };

  it('tints each declared objective by its verdict and rings the undeclared', () => {
    const view = applyLens(g, { lens: 'coverage', report });
    expect(view.marks.get('LearningObjective/o1')).toEqual({ color: VERDICT_COLOR.PartiallyAssessed, text: 'Partially assessed', style: 'fill' });
    expect(view.marks.get('LearningObjective/o2')).toEqual({ color: TONE_COLORS.neutral, text: 'Not declared', style: 'ring' });
    expect(view.marks.has('AssessmentItem/i1')).toBe(false);
    expect(view.dim).toBeUndefined();
    expect(counts(view)).toEqual({ Uncovered: 0, 'Partially assessed': 1, 'Fully assessed': 0, 'Over-assessed': 0, 'Declared by no module': 1 });
    expect(view.notes[0]).toContain('1 declaration across 1 module');
    expect(view.notes[0]).toContain('delivered figure');
  });

  it('shows the projected figure on request', () => {
    const view = applyLens(g, { lens: 'coverage', report }, { projected: true });
    expect(view.marks.get('LearningObjective/o1')?.text).toBe('Fully assessed');
    expect(counts(view)['Fully assessed']).toBe(1);
    expect(view.notes[0]).toContain('projected figure');
  });

  it('gives an objective declared by two modules the weaker verdict, counting both declarations', () => {
    const two: CourseCoverageReport = { ...report, modules: [...report.modules, moduleReport('Module/m2', [declaration('o1', 'Uncovered')])] };
    const view = applyLens(g, { lens: 'coverage', report: two });
    expect(view.marks.get('LearningObjective/o1')?.text).toBe('Uncovered');
    expect(counts(view)).toMatchObject({ Uncovered: 1, 'Partially assessed': 1 });
  });
});

describe('the alignment lens', () => {
  const report: AlignmentReport = {
    scope: { objectives: 2, items: 2, activities: 0 },
    itemsBelowObjective: [{ item: { id: 'AssessmentItem/i1' }, objective: { id: 'LearningObjective/o1' }, levelsBelow: 1 }],
    objectivesWithoutItemAtLevel: [{ id: 'LearningObjective/o1' }],
    objectivesWithoutActivity: [{ id: 'LearningObjective/o1' }, { id: 'LearningObjective/o2' }, { id: 'LearningObjective/not-drawn' }],
    itemsWithoutObjective: [{ id: 'AssessmentItem/i2' }],
    unleveled: { objectives: [], items: [{ id: 'AssessmentItem/i2' }] },
  };

  it('rings what is unaligned, joins several concerns on one record, and dims the rest', () => {
    const view = applyLens(g, { lens: 'alignment', report });
    expect(view.marks.get('AssessmentItem/i2')).toEqual({ color: TONE_COLORS.warn, text: 'No objective', style: 'ring' });
    expect(view.marks.get('LearningObjective/o1')).toEqual({ color: TONE_COLORS.warn, text: 'No activity · No item at its level', style: 'ring' });
    expect(view.marks.get('AssessmentItem/i1')).toEqual({ color: TONE_COLORS.bad, text: "Below its objective", style: 'ring' });
    expect(view.marks.has('LearningObjective/not-drawn')).toBe(false);
    expect(view.dim?.has('Module/m')).toBe(true);
    expect(view.dim?.has('LearningObjective/o2')).toBe(false);
  });

  it("counts the read's lists, drawn or not", () => {
    const view = applyLens(g, { lens: 'alignment', report });
    expect(Object.values(counts(view))).toEqual([1, 3, 1, 1]);
    expect(view.notes[1]).toContain('0 objectives, 1 item');
  });
});

describe('the attestations lens', () => {
  it('rings each attested record by the weakest state and counts attestations by state', () => {
    const view = applyLens(g, { lens: 'attestations', states: { 'Attestation/at': 'Stale' }, subjects: 1 });
    expect(view.marks.get('AssessmentItem/i1')).toEqual({ color: STATE_COLOR.Stale, text: 'Stale', style: 'ring' });
    expect(view.dim).toBeUndefined();
    expect(counts(view)).toEqual({ Current: 0, Stale: 1, 'Fragment removed': 0, Unanchored: 0 });
  });

  it('counts an attestation whose state could not be read', () => {
    const view = applyLens(g, { lens: 'attestations', states: {}, subjects: 1 });
    expect(view.marks.size).toBe(0);
    expect(counts(view)['State unread']).toBe(1);
  });
});

describe('the outcomes lens', () => {
  it("tints each measured record by its newest metric's value around the median, in the commonest unit", () => {
    const docs: Doc[] = [
      ...FIXTURE,
      { '@id': 'LearningDataset/d2', '@type': 'LearningDataset', label: 'A later pilot', producedBy: 'Assessment/a', administrationDate: '2026-06-01', asOf: 'x' },
      { '@id': 'LearningMetric/mt2', '@type': 'LearningMetric', subject: 'AssessmentItem/i1', derivedFrom: 'LearningDataset/d2', value: 0.9, unit: 'proportion correct', asOf: 'x' },
      { '@id': 'LearningMetric/mt3', '@type': 'LearningMetric', subject: 'AssessmentItem/i2', derivedFrom: 'LearningDataset/d2', value: 0.2, unit: 'proportion correct', asOf: 'x' },
      { '@id': 'LearningMetric/mt4', '@type': 'LearningMetric', subject: 'LearningObjective/o1', derivedFrom: 'LearningDataset/d2', value: 0.55, unit: 'proportion correct', asOf: 'x' },
      { '@id': 'LearningMetric/mt5', '@type': 'LearningMetric', subject: 'Module/m', value: 12, unit: 'minutes', asOf: 'x' },
      { '@id': 'LearningMetric/mt6', '@type': 'LearningMetric', subject: 'Missing/x', value: 1, unit: 'proportion correct', asOf: 'x' },
    ];
    const graph = derive(docs);
    const view = applyLens(graph, { lens: 'outcomes' }, { docs });
    expect(view.units).toEqual(['proportion correct', 'minutes']);
    expect(view.unit).toBe('proportion correct');
    // i1 has two metrics; the later administration (0.9, undated metric on a dated dataset) wins over 0.38.
    expect(view.marks.get('AssessmentItem/i1')).toEqual({ color: DIVERGING.farAbove, text: '0.9 proportion correct', style: 'fill' });
    expect(view.marks.get('AssessmentItem/i2')?.color).toBe(DIVERGING.farBelow);
    expect(view.marks.get('LearningObjective/o1')?.color).toBe(DIVERGING.median);
    expect(view.marks.has('Module/m')).toBe(false);
    expect(view.dim?.has('Module/m')).toBe(true);
    expect(view.dim?.has('LearningDataset/d2')).toBe(false);
    expect(view.dim?.has('LearningMetric/mt5')).toBe(false);
    expect(counts(view)).toEqual({ 'Well below the median': 1, 'Below the median': 0, 'At the median (0.55)': 1, 'Above the median': 0, 'Well above the median': 1 });
    expect(applyLens(graph, { lens: 'outcomes' }, { docs, unit: 'minutes' }).marks.get('Module/m')?.text).toBe('12 minutes');
  });

  it('says so when no metric names a drawn record', () => {
    const docs = FIXTURE.filter((d) => d['@type'] !== 'LearningMetric');
    const view = applyLens(derive(docs), { lens: 'outcomes' }, { docs });
    expect(view.marks.size).toBe(0);
    expect(view.notes[0]).toBe('No metric names a drawn record as its subject.');
  });
});

describe('the changes lens', () => {
  const ghost: Doc = { '@id': 'LearningObjective/gone', '@type': 'LearningObjective', label: 'A retired objective', state: 'Retired' };
  const docs = [...FIXTURE, ghost];
  const graph = derive(docs);
  const reads = {
    lens: 'changes' as const, since: 'abcdefabcdef', ghosts: [ghost],
    changes: {
      branch: 'main', from: 'abcdefabcdef', to: 'zzz',
      changes: [
        { id: 'AssessmentItem/i2', op: 'insert' as const }, { id: 'LearningObjective/o1', op: 'update' as const }, { id: 'LearningObjective/gone', op: 'delete' as const },
        { id: 'ModuleObjective/mo', op: 'insert' as const }, { id: 'User/u', op: 'insert' as const }, { id: 'Attestation/at', op: 'update' as const },
      ],
    },
  };

  it('rings what was added and changed, draws the deleted as ghosts, colors a changed relationship, dims the rest', () => {
    const view = applyLens(graph, reads, { branch: 'round-2' });
    expect(view.marks.get('AssessmentItem/i2')).toEqual({ color: TONE_COLORS.ok, text: 'Added since', style: 'ring' });
    expect(view.marks.get('LearningObjective/o1')).toEqual({ color: TONE_COLORS.warn, text: 'Changed since', style: 'ring' });
    expect(view.marks.get('LearningObjective/gone')).toEqual({ color: TONE_COLORS.neutral, text: 'Deleted since', style: 'ghost' });
    expect([...view.edgeMarks]).toEqual([['ModuleObjective/mo', TONE_COLORS.ok]]);
    expect(sorted(view.dim!)).toContain('Module/m');
    expect(view.dim!.has('AssessmentItem/i2')).toBe(false);
    // People are left out of the counts; relationships are in them.
    expect(counts(view)).toEqual({ 'Added since': 2, 'Changed since': 2, 'Deleted since (drawn as it was)': 1 });
    expect(view.notes[0]).toContain('On round-2 since commit abcdefabcd');
  });

  it('names the commits the records refer to as "since" choices', () => {
    expect(namedCommits(FIXTURE)).toEqual([{ commit: 'abcdefabcdefabcdef', label: 'Attestation at, A pilot and 1 more' }]);
  });
});

describe('the seed', () => {
  const read = async <T,>(path: string): Promise<T> => {
    const res = await app.request(path);
    expect(res.status, path).toBe(200);
    return (await res.json()) as T;
  };
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  it("the coverage lens's legend is the coverage read's own counts, both figures", async () => {
    const { documents } = await read<{ documents: Doc[] }>('/api/v1/export?profile=full');
    const graph = derive(documents);
    const report = await read<CourseCoverageReport>('/api/v1/intelligence/coverage');
    for (const projected of [false, true]) {
      const view = applyLens(graph, { lens: 'coverage', report }, { projected });
      const expected = report.modules.reduce((acc, m) => {
        for (const [k, v] of Object.entries(m.summary[projected ? 'projected' : 'coverage'])) acc[k] = (acc[k] ?? 0) + v;
        return acc;
      }, {} as Record<string, number>);
      const legend = counts(view);
      expect(legend.Uncovered).toBe(expected.Uncovered);
      expect(legend['Partially assessed']).toBe(expected.PartiallyAssessed);
      expect(legend['Fully assessed']).toBe(expected.FullyAssessed);
      expect(legend['Over-assessed']).toBe(expected.OverAssessed);
      expect(sum(expected)).toBe(report.modules.reduce((n, m) => n + m.summary.declared, 0));
    }
    const objectives = graph.nodes.filter((n) => n.cls === 'LearningObjective');
    expect(objectives.every((n) => applyLens(graph, { lens: 'coverage', report }).marks.has(n.id))).toBe(true);
  });

  it("the alignment lens's legend is the alignment read's lists", async () => {
    const { documents } = await read<{ documents: Doc[] }>('/api/v1/export?profile=full');
    const report = await read<AlignmentReport>('/api/v1/intelligence/alignment');
    const view = applyLens(derive(documents), { lens: 'alignment', report });
    expect(Object.values(counts(view))).toEqual([
      report.itemsWithoutObjective.length, report.objectivesWithoutActivity.length, report.objectivesWithoutItemAtLevel.length, report.itemsBelowObjective.length,
    ]);
    expect(view.marks.get('AssessmentItem/training-loop-mc')?.text).toBe('No objective');
  });

  it("the attestations lens marks the seed's attested item Current", async () => {
    const { documents } = await read<{ documents: Doc[] }>('/api/v1/export?profile=full');
    const report = await read<AttestationsReport>('/api/v1/intelligence/attestations/AssessmentItem/bias-type-mc');
    const states = Object.fromEntries(report.attestations.map((a) => [a.id, a.state]));
    const view = applyLens(derive(documents), { lens: 'attestations', states, subjects: 1 });
    expect(view.marks.get('AssessmentItem/bias-type-mc')?.text).toBe('Current');
    expect(counts(view).Current).toBe(report.summary.byState.Current);
  });

  it("the outcomes lens tints the two items the pilot measured and the changes lens counts what the seed's later commits added", async () => {
    const { documents } = await read<{ documents: Doc[] }>('/api/v1/export?profile=full');
    const graph = derive(documents);
    const outcomes = applyLens(graph, { lens: 'outcomes' }, { docs: documents });
    expect(outcomes.unit).toBe('proportion correct');
    expect(sorted(outcomes.marks.keys())).toEqual(['AssessmentItem/bias-type-mc', 'AssessmentItem/effective-prompt-mc']);
    const since = namedCommits(documents)[0].commit;
    const changes = await read<{ changes: Array<{ id: string; op: string }> }>(`/api/v1/branches/main/changes?since=${since}`);
    const view = applyLens(graph, { lens: 'changes', since, changes: { branch: 'main', from: since, to: '', changes: changes.changes as never }, ghosts: [] });
    const added = changes.changes.filter((c) => c.op === 'insert' && !c.id.startsWith('User/')).length;
    expect(counts(view)['Added since']).toBe(added);
    expect(view.marks.get('LearningDataset/mod3-spring-pilot')?.text).toBe('Added since');
  });
});
