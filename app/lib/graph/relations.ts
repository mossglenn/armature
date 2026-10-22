/**
 * The relations from a selected node (docs/graph-view-plan.md §5.3), computed
 * over the derived graph in the viewer: what lights up when a record is
 * selected, the rest dimmed. Edges point along the lifecycle (derive.ts), so
 * "upstream" walks against them toward evidence and "downstream" along them
 * toward the course and the outcomes, dbt's `+node` and `node+`. The trace
 * relation is the hub's read mapped onto the drawing (`traceSelection`).
 */
import type { DerivedGraph, GraphEdge } from './derive';

export interface Selection {
  nodes: Set<string>;
  edges: Set<string>;
}

export type Direction = 'upstream' | 'downstream' | 'both';

function index(graph: DerivedGraph) {
  const out = new Map<string, GraphEdge[]>();
  const into = new Map<string, GraphEdge[]>();
  for (const e of graph.edges) {
    (out.get(e.source) ?? out.set(e.source, []).get(e.source)!).push(e);
    (into.get(e.target) ?? into.set(e.target, []).get(e.target)!).push(e);
  }
  return { out, into };
}

/** The node, its edges, and the records one edge away. */
export function neighbors(graph: DerivedGraph, id: string): Selection {
  return reach(graph, id, 'both', 1);
}

/**
 * Everything reachable from the node in a direction, to a depth (Infinity for
 * all). Depth 1 in both directions is `neighbors`.
 */
export function reach(graph: DerivedGraph, id: string, direction: Direction, depth: number): Selection {
  const { out, into } = index(graph);
  const nodes = new Set<string>([id]);
  const edges = new Set<string>();
  let frontier = [id];
  for (let d = 0; d < depth && frontier.length; d++) {
    const next: string[] = [];
    for (const n of frontier) {
      const steps: Array<[GraphEdge[] | undefined, (e: GraphEdge) => string]> = [];
      if (direction !== 'upstream') steps.push([out.get(n), (e) => e.target]);
      if (direction !== 'downstream') steps.push([into.get(n), (e) => e.source]);
      for (const [list, other] of steps) {
        for (const e of list ?? []) {
          edges.add(e.id);
          const o = other(e);
          if (!nodes.has(o)) {
            nodes.add(o);
            next.push(o);
          }
        }
      }
    }
    frontier = next;
  }
  return { nodes, edges };
}

/**
 * The hub's trace read mapped onto the drawing: its node ids are the drawn
 * node ids; an edge `through` a junction names the junction, which is the
 * junction edge's id; an edge without one is a reference edge found by its
 * ends. Ids the drawing does not hold (a hidden class) are left out.
 */
export function traceSelection(
  graph: DerivedGraph,
  trace: { nodes: Array<{ id: string }>; edges: Array<{ from: string; to: string; through?: { id?: string } | string }> },
): Selection {
  const drawn = new Set(graph.nodes.map((n) => n.id));
  const nodes = new Set([...trace.nodes.map((n) => n.id)].filter((id) => drawn.has(id)));
  const edgeIds = new Set(graph.edges.map((e) => e.id));
  const byEnds = new Map(graph.edges.map((e) => [`${e.source}|${e.target}`, e.id]));
  const edges = new Set<string>();
  for (const e of trace.edges) {
    const through = typeof e.through === 'string' ? e.through : e.through?.id;
    if (through && edgeIds.has(through)) {
      edges.add(through);
      continue;
    }
    const id = byEnds.get(`${e.from}|${e.to}`) ?? byEnds.get(`${e.to}|${e.from}`);
    if (id) edges.add(id);
  }
  return { nodes, edges };
}
