/**
 * The relations from a selected node (docs/graph-view-plan.md §5.3): neighbors,
 * upstream and downstream to a depth, and the hub's trace mapped onto the
 * drawing.
 */
import { describe, expect, it } from 'vitest';
import { derive } from './derive';
import { FIXTURE } from './fixture';
import { neighbors, reach, traceSelection } from './relations';

const g = derive(FIXTURE);
const sorted = (s: Set<string>) => [...s].sort();

describe('relations', () => {
  it('neighbors: the record, its edges and the records one edge away', () => {
    const s = neighbors(g, 'AssessmentItem/i1');
    expect(sorted(s.nodes)).toEqual([
      'Assessment/a', 'AssessmentItem/i1', 'DesignNote/note', 'LearningMetric/mt', 'LearningObjective/o1', 'LearningObjective/o2',
    ]);
    expect(s.edges.has('ItemInstance/p')).toBe(true);
    expect(s.edges.has('ModuleObjective/mo')).toBe(false);
  });

  it('downstream follows the lifecycle; upstream walks against it', () => {
    const down = reach(g, 'LearningObjective/o1', 'downstream', 1);
    expect(sorted(down.nodes)).toEqual(['AssessmentItem/i1', 'LearningObjective/o1', 'Module/m']);
    const up = reach(g, 'Module/m', 'upstream', Infinity);
    expect(sorted(up.nodes)).toEqual([
      'Assessment/a', 'AssessmentItem/i1', 'DescriptiveEvidence/e', 'LearningNeed/n', 'LearningObjective/o1', 'LearningObjective/o2', 'Module/m',
    ]);
    expect(up.nodes.has('Course/c')).toBe(false);
  });

  it('a depth bounds the walk', () => {
    const one = reach(g, 'Module/m', 'upstream', 1);
    expect(sorted(one.nodes)).toEqual(['Assessment/a', 'LearningObjective/o1', 'Module/m']);
  });

  it('maps the trace read onto the drawing: a junction passed through is its edge, a reference its edge by ends', () => {
    const s = traceSelection(g, {
      nodes: [{ id: 'LearningMetric/mt' }, { id: 'AssessmentItem/i1' }, { id: 'Assessment/a' }, { id: 'Hidden/x' }],
      edges: [
        { from: 'LearningMetric/mt', to: 'AssessmentItem/i1' },
        { from: 'AssessmentItem/i1', to: 'Assessment/a', through: { id: 'ItemInstance/p' } },
      ],
    });
    expect(sorted(s.nodes)).toEqual(['Assessment/a', 'AssessmentItem/i1', 'LearningMetric/mt']);
    expect(sorted(s.edges)).toEqual(['ItemInstance/p', 'LearningMetric/mt|subject|AssessmentItem/i1']);
  });
});
