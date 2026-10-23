/**
 * The Design Graph's layout (docs/graph-view-plan.md §9.2): dagre, left to
 * right, with every node pinned to its lifecycle stage's column.
 *
 * dagre has no option to fix a node's rank: its rankers only bound a rank from
 * below (an edge's `minlen`) and then place nodes to shorten edges, so a node
 * whose edges all go right drifts right (an objective landed in the items'
 * column, 2026-10-22). The columns therefore come from an invisible anchor
 * chain that bounds every node from both sides: one anchor per distinct stage
 * value plus a terminal one, chained in order at `minlen: 2`, with an
 * invisible edge from a stage's anchor to each of its nodes and from each
 * node to the next anchor. A node of stage s then sits exactly one rank after
 * its anchor, whatever the ranker does. Every drawn edge already points from
 * an earlier stage to a later one (derive.ts), so no real edge contradicts the
 * chain. The one exception, an edge between two records of one stage (a
 * prerequisite between objectives), would; such edges are marked `sameStage`
 * and are drawn but not given to dagre. The anchors take
 * ranks of their own, so the rank separation is half the gap wanted between
 * columns. If this ever proves brittle, the fallback is a layered layout of
 * our own (columns by stage, order within a column by barycenter sweeps),
 * which the stage table has already done most of the work for.
 *
 * Node sizes are fixed, so the layout needs no measurement and runs on the
 * server; the client receives positions.
 */
import dagre from '@dagrejs/dagre';
import { columnOf, shortColumnOf } from './stages';

export const NODE_WIDTH = 232;
export const NODE_HEIGHT = 72;

export interface Position {
  x: number;
  y: number;
}

export interface Column {
  /** The integer stage the column header names. */
  stage: number;
  header: string;
  /** The header's short form, for a column too narrow for the name (lib/graph/headers). */
  short: string;
  x: number;
  width: number;
}

export interface Layout {
  positions: Map<string, Position>;
  columns: Column[];
  width: number;
  height: number;
}

export interface LayoutOptions {
  nodeSeparation?: number;
  rankSeparation?: number;
}

const ANCHOR = '__stage__';

export function layout(
  nodes: ReadonlyArray<{ id: string; stage: number }>,
  edges: ReadonlyArray<{ source: string; target: string; sameStage: boolean }>,
  options: LayoutOptions = {},
): Layout {
  const g = new dagre.graphlib.Graph({ multigraph: true });
  // Half the gap wanted between columns: the anchors take a rank each.
  g.setGraph({ rankdir: 'LR', nodesep: options.nodeSeparation ?? 16, ranksep: (options.rankSeparation ?? 64) / 2, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const stages = [...new Set(nodes.map((n) => n.stage))].sort((a, b) => a - b);
  const anchorId = (i: number) => `${ANCHOR}${i}`;
  const anchorOf = new Map(stages.map((stage, i) => [stage, i]));
  for (let i = 0; i <= stages.length; i++) {
    g.setNode(anchorId(i), { width: 1, height: 1 });
    if (i > 0) g.setEdge(anchorId(i - 1), anchorId(i), { minlen: 2 }, `${ANCHOR}chain-${i}`);
  }
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    const i = anchorOf.get(n.stage)!;
    g.setEdge(anchorId(i), n.id, {}, `${ANCHOR}from-${n.id}`);
    g.setEdge(n.id, anchorId(i + 1), {}, `${ANCHOR}to-${n.id}`);
  }
  const ids = new Set(nodes.map((n) => n.id));
  edges.forEach((e, i) => {
    if (e.sameStage || !ids.has(e.source) || !ids.has(e.target)) return;
    g.setEdge(e.source, e.target, {}, `e${i}`);
  });

  dagre.layout(g);

  const positions = new Map<string, Position>();
  for (const n of nodes) {
    const p = g.node(n.id);
    positions.set(n.id, { x: p.x - NODE_WIDTH / 2, y: p.y - NODE_HEIGHT / 2 });
  }

  // Columns: one per integer stage, spanning the nodes whose stage has that
  // integer part (a fractional stage is a sub-column under the same header).
  const byColumn = new Map<number, { min: number; max: number }>();
  for (const n of nodes) {
    const p = positions.get(n.id)!;
    const stage = Math.floor(n.stage);
    const range = byColumn.get(stage) ?? { min: Infinity, max: -Infinity };
    range.min = Math.min(range.min, p.x);
    range.max = Math.max(range.max, p.x + NODE_WIDTH);
    byColumn.set(stage, range);
  }
  const columns: Column[] = [...byColumn]
    .sort(([a], [b]) => a - b)
    .map(([stage, r]) => ({ stage, header: columnOf(stage), short: shortColumnOf(stage), x: r.min, width: r.max - r.min }));

  const graph = g.graph();
  return { positions, columns, width: graph.width ?? 0, height: graph.height ?? 0 };
}
