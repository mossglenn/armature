import { HubError } from '@armature/client';
import { notFound } from 'next/navigation';
import { GraphView } from '../../GraphView';
import { readsFor, splitId } from '../../reads';
import { derive, type Doc } from '@/lib/graph/derive';
import { focusOfNeighbors, focusOfTrace, isTraceable } from '@/lib/graph/focus';
import { stateFromQuery } from '@/lib/graph/state';
import { buildWalk, completeWalk, type Walk, type WalkTrace } from '@/lib/graph/walk';
import { hubPublicUrl, viewerHub } from '@/lib/viewer';

/**
 * The Focus page (docs/graph-view-plan.md §3.2): one record and its
 * neighborhood as the trace read returns it (`GET /intelligence/trace`), the
 * walk lit, the annotations the read reports (attestations with their state)
 * on the records they are about, the root outlined. The drawing is the
 * Graph's own, restricted to the trace's records, so the two pages read the
 * same way. For a type the trace read does not walk from, the page shows what
 * the record references and what references it. The panel opens on the root.
 */
export const dynamic = 'force-dynamic';

type Query = Record<string, string | undefined>;

/** The walk for a traceable root, its coverage and changes steps filled from the hub (quietly: a failed read leaves a step saying so). */
async function walkFor(
  hub: ReturnType<typeof viewerHub>, graph: ReturnType<typeof derive>, traced: WalkTrace | undefined,
  byId: Map<string, Doc>, at: { branch?: string; ref?: string },
): Promise<Walk | undefined> {
  if (!traced) return undefined;
  const walk = buildWalk(graph, traced, byId);
  const quiet = async <T,>(p: Promise<{ data: T }>): Promise<T | undefined> => p.then((r) => r.data).catch(() => undefined);
  const now = at.ref ? { ref: at.ref } : { branch: at.branch };
  const [coverageThen, coverageNow, changes] = await Promise.all([
    walk.module && walk.asOf ? quiet(hub.intelligence.coverage(walk.module, { ref: walk.asOf })) : undefined,
    walk.module ? quiet(hub.intelligence.coverage(walk.module, now)) : undefined,
    walk.asOf && !at.ref ? quiet(hub.branches.changes(at.branch ?? 'main', walk.asOf)) : undefined,
  ]);
  return completeWalk(walk, { coverageThen, coverageNow, changes, branch: at.ref ? undefined : (at.branch ?? 'main') }, byId);
}

export default async function FocusPage({ params, searchParams }: { params: Promise<{ type: string; id: string }>; searchParams: Promise<Query> }) {
  const [{ type, id: local }, query] = await Promise.all([params, searchParams]);
  const rootId = `${type}/${decodeURIComponent(local)}`;
  const parts = splitId(rootId);
  if (!parts) notFound();

  const { branch, ref } = query;
  const at = ref ? { ref } : { branch };
  const hub = viewerHub();
  const notFoundOn404 = (err: unknown) => {
    if (err instanceof HubError && err.status === 404) notFound();
    throw err;
  };
  const [{ data, commit }, traced] = await Promise.all([
    hub.export.read(at).catch(notFoundOn404),
    isTraceable(parts.type) ? hub.intelligence.trace(parts.type, parts.local, at).then((r) => r.data).catch(notFoundOn404) : Promise.resolve(undefined),
  ]);
  const docs = (data.documents as Doc[]).filter((d) => d['@type'] !== 'User');
  const root = docs.find((d) => d['@id'] === rootId);
  if (!root) notFound();

  // Derived here once to name the neighborhood; the client derives again to draw it.
  const graph = derive(docs);
  const byId = new Map(docs.map((d) => [d['@id'], d]));
  const focus = traced ? focusOfTrace(graph, traced) : focusOfNeighbors(graph, rootId);
  const initial = stateFromQuery(query);
  const walkStep = Number(query.walk) >= 1 ? Math.floor(Number(query.walk)) : undefined;
  // The Walkthrough (plan §7): built for every traceable root, so "Walk" needs
  // no reload; its two hub-read steps are filled here.
  const walk = await walkFor(hub, graph, traced, byId, { branch, ref });
  const select = walkStep ? undefined : (initial.select ?? rootId);
  const reads = await readsFor(hub, select, { branch, ref, trace: initial.direction === 'trace' });
  const branchQuery = branch ? `?branch=${encodeURIComponent(branch)}` : ref ? `?ref=${encodeURIComponent(ref)}` : '';

  return (
    <main>
      <GraphView
        docs={docs}
        initial={{ ...initial, select }}
        reads={reads}
        focus={{ root: rootId, ids: [...focus.ids], litNodes: [...focus.lit.nodes], litEdges: [...focus.lit.edges], traced: Boolean(traced) }}
        walk={walk}
        walkStep={walk && walkStep ? Math.min(walkStep, walk.steps.length) : undefined}
        states={Object.fromEntries(focus.states)}
        branch={branch ?? 'main'}
        atRef={ref}
        commit={commit}
        publicHub={hubPublicUrl()}
        branchQuery={branchQuery}
      />
    </main>
  );
}
