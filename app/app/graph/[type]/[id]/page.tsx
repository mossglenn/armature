import { HubError } from '@armature/client';
import { notFound } from 'next/navigation';
import { GraphView } from '../../GraphView';
import { readsFor, splitId } from '../../reads';
import { derive, type Doc } from '@/lib/graph/derive';
import { focusOfNeighbors, focusOfTrace, isTraceable } from '@/lib/graph/focus';
import { stateFromQuery } from '@/lib/graph/state';
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
  const focus = traced ? focusOfTrace(graph, traced) : focusOfNeighbors(graph, rootId);
  const initial = stateFromQuery(query);
  const select = initial.select ?? rootId;
  const reads = await readsFor(hub, select, { branch, ref, trace: initial.direction === 'trace' });
  const branchQuery = branch ? `?branch=${encodeURIComponent(branch)}` : ref ? `?ref=${encodeURIComponent(ref)}` : '';

  return (
    <main>
      <GraphView
        docs={docs}
        initial={{ ...initial, select }}
        reads={reads}
        focus={{ root: rootId, ids: [...focus.ids], litNodes: [...focus.lit.nodes], litEdges: [...focus.lit.edges], traced: Boolean(traced) }}
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
