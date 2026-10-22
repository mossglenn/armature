/**
 * The layout (docs/graph-view-plan.md §9.2): dagre left to right with every
 * node pinned to its stage's column, same-stage edges drawn but not ranked,
 * and column headers from the stage table.
 */
import { describe, expect, it } from 'vitest';
import { derive } from './derive';
import { FIXTURE } from './fixture';
import { NODE_WIDTH, layout } from './layout';
import { columnOf } from './stages';

describe('layout', () => {
  it('puts every node in its stage column, whatever its edges', () => {
    const nodes = [
      { id: 'a', stage: 0 }, { id: 'lonely', stage: 0 }, { id: 'pulled', stage: 0 },
      { id: 'b', stage: 1 }, { id: 'c', stage: 1 }, { id: 'd', stage: 3 }, { id: 'e', stage: 3 },
    ];
    const edges = [
      { source: 'a', target: 'b', sameStage: false },
      { source: 'b', target: 'd', sameStage: false },
      { source: 'b', target: 'c', sameStage: true },
      { source: 'a', target: 'd', sameStage: false },
      // A node whose every edge goes far right: a shortest-edges ranker would
      // pull it out of its column (seen on the seed's objectives, 2026-10-22).
      { source: 'pulled', target: 'd', sameStage: false },
      { source: 'pulled', target: 'e', sameStage: false },
    ];
    const { positions, columns } = layout(nodes, edges);
    const x = (id: string) => positions.get(id)!.x;
    expect(x('a')).toBe(x('lonely'));
    expect(x('a')).toBe(x('pulled'));
    expect(x('b')).toBe(x('c'));
    expect(x('d')).toBe(x('e'));
    expect(x('a')).toBeLessThan(x('b'));
    expect(x('b')).toBeLessThan(x('d'));
    expect(columns.map((c) => c.stage)).toEqual([0, 1, 3]);
    expect(columns.map((c) => c.header)).toEqual([columnOf(0), columnOf(1), columnOf(3)]);
    expect(columns[0]).toMatchObject({ x: x('a'), width: NODE_WIDTH });
  });

  it('lays the fixture out in lifecycle order, one header per column', () => {
    const g = derive(FIXTURE);
    const l = layout(g.nodes, g.edges);
    const headers = l.columns.map((c) => c.header);
    expect(new Set(headers).size).toBe(headers.length);
    const x = (id: string) => l.positions.get(id)!.x;
    // Every node of one stage shares a column, and the stages read left to right.
    for (const n of g.nodes) for (const m of g.nodes) if (n.stage === m.stage) expect(x(n.id), `${n.id} and ${m.id}`).toBe(x(m.id));
    expect(x('DescriptiveEvidence/e')).toBeLessThan(x('LearningNeed/n'));
    expect(x('LearningNeed/n')).toBeLessThan(x('LearningObjective/o1'));
    expect(x('LearningObjective/o1')).toBeLessThan(x('AssessmentItem/i1'));
    expect(x('AssessmentItem/i1')).toBeLessThan(x('Assessment/a'));
    expect(x('Assessment/a')).toBeLessThan(x('Module/m'));
    expect(x('Module/m')).toBeLessThan(x('Course/c'));
    expect(x('Course/c')).toBeLessThan(x('LearningDataset/d'));
    expect(x('LearningDataset/d')).toBeLessThan(x('LearningMetric/mt'));
    expect(x('LearningMetric/mt')).toBeLessThan(x('DesignNote/note'));
    expect(l.width).toBeGreaterThan(0);
    expect(l.height).toBeGreaterThan(0);
  });
});
