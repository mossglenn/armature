import { HubError } from '@armature/client';
import { notFound } from 'next/navigation';
import { GraphView } from './GraphView';
import type { Doc } from '@/lib/graph/derive';
import { stateFromQuery } from '@/lib/graph/state';
import { hubPublicUrl, viewerHub } from '@/lib/viewer';

/**
 * The Design Graph (docs/graph-view-plan.md §3.1): every record on a branch at
 * a commit, drawn in lifecycle columns with every relationship as an edge.
 * This page reads the graph from the hub (`GET /api/v1/export`, one call,
 * the commit in its ETag), leaves the people out, and hands the documents to
 * the client view, which derives and lays out the drawing. The browser never
 * calls the hub (lib/viewer.ts). `?branch=` or `?ref=` chooses the state;
 * `?select=`, `?related=`, `?depth=`, `?hide=` and `?edges=nodes` reproduce a
 * reader's view from the URL alone.
 */
export const dynamic = 'force-dynamic';

type Query = Record<string, string | undefined>;

export default async function GraphPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const { branch, ref } = query;
  const at = ref ? { ref } : { branch };
  const { data, commit } = await viewerHub()
    .export.read(at)
    .catch((err: unknown) => {
      if (err instanceof HubError && err.status === 404) notFound();
      throw err;
    });
  const docs = (data.documents as Doc[]).filter((d) => d['@type'] !== 'User');
  const branchQuery = branch ? `?branch=${encodeURIComponent(branch)}` : ref ? `?ref=${encodeURIComponent(ref)}` : '';

  return (
    <main>
      <GraphView
        docs={docs}
        initial={stateFromQuery(query)}
        branch={ref ? `(commit ${ref.slice(0, 12)})` : (branch ?? 'main')}
        commit={commit}
        publicHub={hubPublicUrl()}
        branchQuery={branchQuery}
      />
    </main>
  );
}
