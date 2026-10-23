/**
 * The Focus page's data (docs/graph-view-plan.md §3.2): the trace mapped onto
 * the drawing, the attestation states it reports, the restriction of the
 * graph to a neighborhood, and the traceable types checked against the hub.
 */
import { CLASS_CATEGORY, CLASS_KEY } from '@armature/types';
import { describe, expect, it } from 'vitest';
import { app } from '../api/app';
import { derive } from './derive';
import { FIXTURE } from './fixture';
import { TRACEABLE, attestationStates, focusOfNeighbors, focusOfTrace, focusPath, restrict } from './focus';

const g = derive(FIXTURE);
const sorted = (s: Iterable<string>) => [...s].sort();

describe('focus', () => {
  it('restricts the drawing to a set of records, recounting what is drawn', () => {
    const r = restrict(g, new Set(['LearningObjective/o1', 'AssessmentItem/i1', 'Assessment/a']));
    expect(sorted(r.nodes.map((n) => n.id))).toEqual(['Assessment/a', 'AssessmentItem/i1', 'LearningObjective/o1']);
    expect(sorted(r.edges.map((e) => e.id))).toEqual(['AssessmentItem/i1|assesses|LearningObjective/o1', 'ItemInstance/p']);
    expect(Object.fromEntries(r.counts)).toEqual({ Assessment: 1, AssessmentItem: 1, LearningObjective: 1, ItemInstance: 1 });
    expect(r.about).toBe(g.about);
  });

  it("reads attestation states from a trace's annotations and ignores the rest", () => {
    const states = attestationStates([
      { id: 'Attestation/x', type: 'Attestation', verdict: 'Affirmed', state: 'Stale' },
      { id: 'DesignNote/n', type: 'DesignNote' },
      { id: 'Attestation/y', type: 'Attestation' },
      'not an annotation',
      null,
    ]);
    expect([...states]).toEqual([['Attestation/x', 'Stale']]);
  });

  it('the focus of a traceable record: the walk lit, its records drawn, its states kept', () => {
    const f = focusOfTrace(g, {
      root: { id: 'LearningMetric/mt' },
      nodes: [{ id: 'LearningMetric/mt' }, { id: 'AssessmentItem/i1' }, { id: 'Assessment/a' }],
      edges: [
        { from: 'LearningMetric/mt', to: 'AssessmentItem/i1' },
        { from: 'AssessmentItem/i1', to: 'Assessment/a', through: { id: 'ItemInstance/p' } },
      ],
      annotations: [{ id: 'Attestation/at', type: 'Attestation', state: 'Current' }],
    });
    expect(f.root).toBe('LearningMetric/mt');
    expect(sorted(f.ids)).toEqual(['Assessment/a', 'AssessmentItem/i1', 'LearningMetric/mt']);
    expect(sorted(f.lit.edges)).toEqual(['ItemInstance/p', 'LearningMetric/mt|subject|AssessmentItem/i1']);
    expect(f.states.get('Attestation/at')).toBe('Current');
  });

  it('the focus of any other record: its neighbors', () => {
    const f = focusOfNeighbors(g, 'DesignNote/note');
    expect(sorted(f.ids)).toEqual(['AssessmentItem/i1', 'DesignNote/note']);
    expect(f.lit.edges.size).toBe(1);
  });

  it('names the Focus page of a record', () => {
    expect(focusPath({ id: 'AssessmentItem/bias type', cls: 'AssessmentItem' })).toBe('/graph/AssessmentItem/bias%20type');
  });

  it('names exactly the types the hub traces from', async () => {
    // One seed record per concrete artifact class (the hub looks the record up
    // before judging its type, so a missing record of any class is a 404).
    const res = await app.request('/api/v1/export?profile=full');
    const { documents } = (await res.json()) as { documents: Array<{ '@id': string; '@type': string }> };
    const artifacts = Object.keys(CLASS_KEY).filter((cls) => (CLASS_CATEGORY as Record<string, string>)[cls] === 'artifact');
    for (const cls of artifacts) {
      const doc = documents.find((d) => d['@type'] === cls);
      expect(doc, `the seed has a ${cls}`).toBeDefined();
      const traced = await app.request(`/api/v1/intelligence/trace/${doc!['@id']}`);
      expect(traced.status, cls).toBe(TRACEABLE.has(cls) ? 200 : 400);
    }
  });
});
