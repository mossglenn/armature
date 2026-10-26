/**
 * The Design Graph's derivation (docs/graph-view-plan.md §4, §13 PR 1): the
 * drawing rules on a fixture that has one of every case, and the seed through
 * the hub's export, derived to the drawing the page shows.
 */
import { CLASS_CATEGORY, CLASS_KEY } from '@armature/types';
import { describe, expect, it } from 'vitest';
import { app } from '../api/app';
import { chipsFor, classesIn, derive, junctionLabel, referenceFields, references, type Doc } from './derive';
import { FIXTURE, USER } from './fixture';
import { isAnnotationClass, stageOf } from './stages';

const ids = (xs: Array<{ id: string }>) => xs.map((x) => x.id).sort();
const stage = (g: ReturnType<typeof derive>, id: string) => g.nodes.find((n) => n.id === id)!.stage;

describe('the schema as data', () => {
  it("folds a class's ancestors' reference fields in", () => {
    expect(referenceFields('DesignNote')).toEqual({ createdBy: 'User', subject: 'DesignRecord' });
    expect(referenceFields('ModuleObjective')).toEqual({ module: 'Module', references: 'LearningObjective' });
  });

  it('lists every reference a document makes, a Set as one per target', () => {
    const item = FIXTURE.find((d) => d['@id'] === 'AssessmentItem/i1')!;
    expect(references(item)).toEqual([
      { field: 'assesses', target: 'LearningObjective/o1', type: 'LearningObjective' },
      { field: 'assesses', target: 'LearningObjective/o2', type: 'LearningObjective' },
    ]);
  });

  it('gives every concrete artifact class a stage, and only notes and findings are annotations', () => {
    // CLASS_KEY lists the concrete classes (an abstract class has no key); the
    // artifact ones are drawn, so each needs a column. A new class fails here
    // the way a class without a category fails the generator.
    const artifacts = Object.keys(CLASS_KEY).filter((cls) => (CLASS_CATEGORY as Record<string, string>)[cls] === 'artifact');
    for (const cls of artifacts) expect(stageOf(cls), cls).toBeTypeOf('number');
    expect(artifacts.filter(isAnnotationClass).sort()).toEqual(['DesignFinding', 'DesignNote']);
  });
});

describe('deriving the drawing', () => {
  const g = derive(FIXTURE);

  it('draws every artifact as a node and no person or junction', () => {
    expect(ids(g.nodes)).toEqual([
      'Assessment/a', 'AssessmentItem/i1', 'AssessmentItem/i2', 'Course/c', 'DescriptiveEvidence/e', 'DesignNote/note',
      'LearningDataset/d', 'LearningMetric/mt', 'LearningNeed/n', 'LearningObjective/o1', 'LearningObjective/o2', 'Module/m',
    ]);
    expect(g.counts.get('User')).toBe(1);
    expect(g.counts.get('ItemInstance')).toBe(1);
  });

  it('draws a junction with two references as a labeled edge carrying the document', () => {
    const declaration = g.edges.find((e) => e.id === 'ModuleObjective/mo')!;
    expect(declaration).toMatchObject({ source: 'LearningObjective/o1', target: 'Module/m', kind: 'junction', label: 'Primary · #1', sameStage: false });
    expect(declaration.junction?.['@type']).toBe('ModuleObjective');
    expect(g.edges.find((e) => e.id === 'ItemInstance/p')).toMatchObject({ source: 'AssessmentItem/i1', target: 'Assessment/a', label: 'Approved · #1' });
    expect(g.edges.find((e) => e.id === 'NeedEvidenceLink/ne')).toMatchObject({ source: 'DescriptiveEvidence/e', target: 'LearningNeed/n', label: 'High' });
  });

  it('marks an edge between two records of one stage, so the layout can leave it out of the ranking', () => {
    expect(g.edges.find((e) => e.id === 'PrerequisiteRecord/pr')).toMatchObject({ kind: 'junction', sameStage: true, label: 'Required' });
  });

  it('draws an attestation as a chip on its subject, never as a node or an edge', () => {
    expect(g.nodes.some((n) => n.id === 'Attestation/at')).toBe(false);
    expect(g.edges.some((e) => e.id === 'Attestation/at')).toBe(false);
    const item = g.nodes.find((n) => n.id === 'AssessmentItem/i1')!;
    expect(item.chips).toContainEqual(expect.objectContaining({ text: 'Affirmed · one part', tone: 'ok' }));
    expect(item.chips.map((c) => c.text)).toEqual(['Approved', 'Analyze', 'Affirmed · one part']);
  });

  it('draws a reference on an artifact as a plain edge, one per target, along the lifecycle', () => {
    const assesses = g.edges.filter((e) => e.via.from === 'AssessmentItem/i1' && e.via.field === 'assesses');
    expect(assesses.map((e) => [e.source, e.target, e.kind, e.label])).toEqual([
      ['LearningObjective/o1', 'AssessmentItem/i1', 'reference', 'assesses'],
      ['LearningObjective/o2', 'AssessmentItem/i1', 'reference', 'assesses'],
    ]);
    expect(g.edges.find((e) => e.via.field === 'generatedBy')).toMatchObject({ source: 'LearningNeed/n', target: 'LearningObjective/o1' });
    expect(g.edges.find((e) => e.via.field === 'subject' && e.via.from === 'LearningMetric/mt')).toMatchObject({ source: 'AssessmentItem/i1', target: 'LearningMetric/mt' });
  });

  it("draws a note's reference as an annotation edge and reports a target that is not there", () => {
    expect(g.edges.find((e) => e.via.from === 'DesignNote/note')).toMatchObject({ source: 'AssessmentItem/i1', target: 'DesignNote/note', kind: 'annotation' });
    expect(g.unresolved).toEqual([{ id: 'DesignNote/note', field: 'subject', target: 'Missing/x' }]);
  });

  it('points every edge from an earlier stage to a later one, or marks it sameStage', () => {
    for (const e of g.edges) {
      const [s, t] = [stage(g, e.source), stage(g, e.target)];
      if (e.sameStage) expect(s).toBe(t);
      else expect(s, e.id).toBeLessThan(t);
    }
  });

  it('never draws a person: no edge for createdBy or attestedBy', () => {
    expect(g.edges.some((e) => e.via.field === 'createdBy' || e.via.field === 'attestedBy')).toBe(false);
    expect(g.referencedBy.get(USER)).toBeUndefined();
  });

  it('lists what is about a record and what references it', () => {
    expect(ids(g.about.get('AssessmentItem/i1')!.map((d) => ({ id: d['@id'] })))).toEqual(['Attestation/at', 'DesignNote/note']);
    expect(g.referencedBy.get('LearningObjective/o1')).toEqual([
      { id: 'PrerequisiteRecord/pr', field: 'prerequisite' },
      { id: 'AssessmentItem/i1', field: 'assesses' },
      { id: 'ModuleObjective/mo', field: 'references' },
    ]);
  });

  it('gives a record the chips its fields say', () => {
    const metric = FIXTURE.find((d) => d['@id'] === 'LearningMetric/mt')!;
    expect(chipsFor(metric)).toEqual([
      { text: '0.38 proportion correct', tone: 'mono' },
      { text: 'as of abcdefabcd', tone: 'mono', title: 'Read the design at this commit', ref: 'abcdefabcdefabcdef' },
    ]);
    expect(chipsFor({ '@id': 'AssessmentItem/x', '@type': 'AssessmentItem', status: 'Draft' })).toEqual([{ text: 'Draft', tone: 'warn' }]);
    expect(junctionLabel({ '@id': 'LessonActivityLink/x', '@type': 'LessonActivityLink' })).toBe('LessonActivityLink');
  });

  it('lists the classes present in lifecycle order, people left out', () => {
    const classes = classesIn(g.counts);
    expect(classes[0]).toMatchObject({ cls: 'DescriptiveEvidence', count: 1, category: 'artifact' });
    expect(classes.map((c) => c.cls)).not.toContain('User');
    expect(classes.find((c) => c.cls === 'ModuleObjective')).toMatchObject({ category: 'relationship', count: 1 });
    const artifactStages = classes.filter((c) => c.category === 'artifact').map((c) => c.stage);
    expect(artifactStages).toEqual([...artifactStages].sort((a, b) => a - b));
  });
});

describe('options', () => {
  it('a hidden class takes its edges with it, and still counts', () => {
    const g = derive(FIXTURE, { hidden: ['AssessmentItem'] });
    expect(g.nodes.some((n) => n.cls === 'AssessmentItem')).toBe(false);
    expect(g.edges.some((e) => e.source.startsWith('AssessmentItem/') || e.target.startsWith('AssessmentItem/'))).toBe(false);
    expect(g.edges.some((e) => e.id === 'ItemInstance/p')).toBe(false);
    expect(g.edges.some((e) => e.id === 'ModuleObjective/mo')).toBe(true);
    expect(g.counts.get('AssessmentItem')).toBe(2);
  });

  it('a hidden junction class removes its edges and nothing else', () => {
    const g = derive(FIXTURE, { hidden: ['ModuleObjective'] });
    expect(g.edges.some((e) => e.id === 'ModuleObjective/mo')).toBe(false);
    expect(g.nodes).toHaveLength(derive(FIXTURE).nodes.length);
  });

  it("junctions as nodes: the store's view, each between its ends with its own edges", () => {
    const g = derive(FIXTURE, { junctionsAsEdges: false });
    const declaration = g.nodes.find((n) => n.id === 'ModuleObjective/mo')!;
    expect(declaration).toMatchObject({ cls: 'ModuleObjective', label: 'Primary · #1', annotation: false });
    expect(declaration.stage).toBeGreaterThan(stage(g, 'LearningObjective/o1'));
    expect(declaration.stage).toBeLessThan(stage(g, 'Module/m'));
    expect(g.edges.filter((e) => e.via.from === 'ModuleObjective/mo').map((e) => [e.source, e.target, e.label])).toEqual([
      ['ModuleObjective/mo', 'Module/m', 'module'],
      ['LearningObjective/o1', 'ModuleObjective/mo', 'references'],
    ]);
    expect(g.nodes.some((n) => n.id === 'Attestation/at')).toBe(true);
    expect(g.nodes.find((n) => n.id === 'AssessmentItem/i1')!.chips.map((c) => c.text)).not.toContain('Affirmed · one part');
  });
});

describe('the seed', () => {
  it('derives to the drawing the page shows: 39 records, 27 junction edges, every edge along the lifecycle', async () => {
    const res = await app.request('/api/v1/export?profile=full');
    expect(res.status).toBe(200);
    const { documents } = (await res.json()) as { documents: Doc[] };
    const g = derive(documents);
    expect(g.nodes).toHaveLength(39);
    expect(g.edges.filter((e) => e.kind === 'junction')).toHaveLength(27);
    expect(g.unresolved).toEqual([]);
    expect(g.nodes.some((n) => n.cls === 'User')).toBe(false);
    const bias = g.nodes.find((n) => n.id === 'AssessmentItem/bias-type-mc')!;
    expect(bias.chips.map((c) => c.text)).toEqual(['Approved', 'Analyze', 'Affirmed · one part']);
    for (const e of g.edges) {
      const [s, t] = [stage(g, e.source), stage(g, e.target)];
      if (e.sameStage) expect(s).toBe(t);
      else expect(s, e.id).toBeLessThan(t);
    }
    // Narrative 1's metric reaches its item by a reference edge and its dataset by another.
    expect(g.edges.find((e) => e.via.from === 'LearningMetric/mod3-bias-type-difficulty' && e.via.field === 'subject'))
      .toMatchObject({ source: 'AssessmentItem/bias-type-mc' });
    expect(g.about.get('AssessmentItem/bias-type-mc')?.map((d) => d['@type'])).toContain('Attestation');
  });
});
