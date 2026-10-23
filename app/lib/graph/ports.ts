/**
 * Ports: where each edge attaches to its nodes (2026-10-23). With one handle
 * per side, every edge leaving a node departs from one point and every edge
 * arriving converges on one, so a fan or a bundle is indistinguishable just
 * where the reader looks. Each node instead gets one source port per
 * outgoing edge along its right edge and one target port per incoming edge
 * along its left edge, ordered by where the other end sits (top to bottom),
 * so edges leave and arrive as separate strands that do not cross at the
 * node. Pure over the laid-out positions; the node draws as many handles as
 * it has ports and the edge names its two.
 */

export interface EdgePorts {
  sourceHandle: string;
  targetHandle: string;
}

export interface NodePorts {
  /** Outgoing edges, on the right edge. */
  sources: number;
  /** Incoming edges, on the left edge. */
  targets: number;
}

export interface Ports {
  edge: Map<string, EdgePorts>;
  node: Map<string, NodePorts>;
}

export const sourceHandle = (index: number): string => `out-${index}`;
export const targetHandle = (index: number): string => `in-${index}`;

interface Point {
  x: number;
  y: number;
}

/**
 * Assigns ports. At a source, outgoing edges take ports top to bottom by the
 * target's y (then x, then id); at a target, incoming edges by the source's.
 * An edge whose end is not laid out keeps the default handle.
 */
export function assignPorts(
  edges: ReadonlyArray<{ id: string; source: string; target: string }>,
  positions: ReadonlyMap<string, Point>,
): Ports {
  const byOther = (a: { other: Point; id: string }, b: { other: Point; id: string }) =>
    a.other.y - b.other.y || a.other.x - b.other.x || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const outgoing = new Map<string, Array<{ id: string; other: Point }>>();
  const incoming = new Map<string, Array<{ id: string; other: Point }>>();
  for (const e of edges) {
    const s = positions.get(e.source);
    const t = positions.get(e.target);
    if (!s || !t) continue;
    (outgoing.get(e.source) ?? outgoing.set(e.source, []).get(e.source)!).push({ id: e.id, other: t });
    (incoming.get(e.target) ?? incoming.set(e.target, []).get(e.target)!).push({ id: e.id, other: s });
  }

  const edge = new Map<string, EdgePorts>();
  const node = new Map<string, NodePorts>();
  const portsOf = (id: string) => node.get(id) ?? node.set(id, { sources: 0, targets: 0 }).get(id)!;
  for (const [id, list] of outgoing) {
    list.sort(byOther);
    portsOf(id).sources = list.length;
    list.forEach((e, i) => {
      edge.set(e.id, { sourceHandle: sourceHandle(i), targetHandle: targetHandle(0) });
    });
  }
  for (const [id, list] of incoming) {
    list.sort(byOther);
    portsOf(id).targets = list.length;
    list.forEach((e, i) => {
      edge.get(e.id)!.targetHandle = targetHandle(i);
    });
  }
  return { edge, node };
}

/** A port's position along its edge as a fraction of the node's height: evenly spaced with margins, the single port centered. */
export const portOffset = (index: number, count: number): number => (index + 1) / (count + 1);
