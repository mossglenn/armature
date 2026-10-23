/**
 * The Focus page's data (docs/graph-view-plan.md §3.2): one record's
 * neighborhood as the hub's trace read returns it, mapped onto the drawing
 * the Graph page already derives, so the Focus page is a clean extract of
 * the Graph rather than a second renderer. Pure, like the rest of lib/graph.
 */
import type { DerivedGraph, GraphNode } from './derive';
import { neighbors, traceSelection, type Selection } from './relations';

/**
 * The types the trace read walks from (docs/api.md, `untraceable_type` for
 * any other). focus.test.ts checks this set against the hub, so the panel
 * can disable the Trace relation for a class without a round trip.
 */
export const TRACEABLE: ReadonlySet<string> = new Set([
  'LearningMetric', 'LearningDataset', 'Assessment', 'AssessmentItem', 'LearningObjective', 'LearningNeed', 'DescriptiveEvidence', 'Module', 'LearningActivity',
]);

export const isTraceable = (cls: string): boolean => TRACEABLE.has(cls);

/** What the trace read returns, as much of it as the drawing uses. */
export interface TraceLike {
  root: { id: string };
  nodes: Array<{ id: string }>;
  edges: Array<{ from: string; to: string; through?: { id?: string } | string }>;
  /** Notes, findings and attestations about any node reached; an attestation carries its `state`. */
  annotations: unknown[];
}

/** The attestations' states from a trace's annotations, by attestation id. */
export function attestationStates(annotations: unknown[]): Map<string, string> {
  const states = new Map<string, string>();
  for (const a of annotations) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    if (r.type === 'Attestation' && typeof r.id === 'string' && typeof r.state === 'string') states.set(r.id, r.state);
  }
  return states;
}

export interface Focus {
  root: string;
  /** The records drawn. */
  ids: Set<string>;
  /** The walk itself, lit when nothing is selected. */
  lit: Selection;
  states: Map<string, string>;
}

/** The focus of a traceable record: the trace's nodes, its edges lit, its attestation states. */
export function focusOfTrace(graph: DerivedGraph, trace: TraceLike): Focus {
  const lit = traceSelection(graph, trace);
  const ids = new Set([trace.root.id, ...lit.nodes]);
  return { root: trace.root.id, ids, lit, states: attestationStates(trace.annotations) };
}

/** The focus of any other record: what it references and what references it (plan §3.2). */
export function focusOfNeighbors(graph: DerivedGraph, id: string): Focus {
  const lit = neighbors(graph, id);
  return { root: id, ids: new Set(lit.nodes), lit, states: new Map() };
}

/**
 * The drawing restricted to a set of records: their nodes, the edges between
 * them, the counts recounted over what is drawn (hidden documents and the
 * junctions drawn as edges included, people left out as always).
 */
export function restrict(graph: DerivedGraph, ids: ReadonlySet<string>): DerivedGraph {
  const nodes = graph.nodes.filter((n) => ids.has(n.id));
  const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  const counts = new Map<string, number>();
  const count = (cls: string) => counts.set(cls, (counts.get(cls) ?? 0) + 1);
  for (const n of nodes) count(n.cls);
  for (const e of edges) if (e.junction) count(e.junction['@type']);
  return { ...graph, nodes, edges, counts };
}

/** A record's local part for a route: `AssessmentItem/bias-type-mc` → `bias-type-mc`. */
export const focusPath = (node: Pick<GraphNode, 'id' | 'cls'>): string =>
  `/graph/${node.cls}/${encodeURIComponent(node.id.startsWith(`${node.cls}/`) ? node.id.slice(node.cls.length + 1) : node.id)}`;
