/**
 * The layout (docs/graph-view-plan.md §9.2): dagre left to right with every
 * node pinned to its stage's column, same-stage edges drawn but not ranked,
 * and column headers from the stage table.
 */
import { describe, expect, it } from 'vitest';
import { app } from '../api/app';
import { derive, type Doc, type GraphEdge, type GraphNode } from './derive';
import { FIXTURE } from './fixture';
import { NODE_WIDTH, layout, type Layout } from './layout';
import { columnOf } from './stages';

/** Pairs of edges between the same two columns that cross, by their ends' heights (edges sharing an end excluded). */
function crossings(nodes: GraphNode[], edges: GraphEdge[], laid: Layout): number {
  const stage = new Map(nodes.map((n) => [n.id, Math.floor(n.stage)]));
  const y = (id: string) => laid.positions.get(id)!.y;
  const es = edges.filter((e) => !e.sameStage && laid.positions.has(e.source) && laid.positions.has(e.target));
  let count = 0;
  for (let i = 0; i < es.length; i++) {
    for (let j = i + 1; j < es.length; j++) {
      const a = es[i], b = es[j];
      if (stage.get(a.source) !== stage.get(b.source) || stage.get(a.target) !== stage.get(b.target)) continue;
      if (a.source === b.source || a.target === b.target) continue;
      if ((y(a.source) - y(b.source)) * (y(a.target) - y(b.target)) < 0) count++;
    }
  }
  return count;
}

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

describe('the seed', () => {
  it('orders each column by its real edges: few crossings between neighboring columns, a compact drawing', async () => {
    // With the anchor edges weighing as much as real ones (before 2026-10-23)
    // the seed laid out with 24 crossings; with them weighing almost nothing,
    // 8. The bound is half the old figure: dagre's result also depends on the
    // order the store returns documents in, which differs between a fresh
    // seed (CI) and a store with history, so the height (1406 here, 1640 in
    // CI, 1776 before) is not asserted.
    const res = await app.request('/api/v1/export?profile=full');
    expect(res.status).toBe(200);
    const { documents } = (await res.json()) as { documents: Doc[] };
    const g = derive(documents);
    const laid = layout(g.nodes, g.edges);
    expect(crossings(g.nodes, g.edges, laid)).toBeLessThanOrEqual(12);
  });
});
