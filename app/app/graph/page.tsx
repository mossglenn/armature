import { HubError } from '@armature/client';
import { notFound } from 'next/navigation';
import { GraphView } from './GraphView';
import { lensReadsFor } from './lensReads';
import { readsFor } from './reads';
import type { Doc } from '@/lib/graph/derive';
import { stateFromQuery } from '@/lib/graph/state';
import { hubPublicUrl, viewerHub } from '@/lib/viewer';

/**
 * The Design Graph (docs/graph-view-plan.md §3.1): every record on a branch at
 * a commit, drawn in lifecycle columns with every relationship as an edge.
 * This page reads the graph from the hub (`GET /api/v1/export`, one call,
 * the commit in its ETag), leaves the people out, and hands the documents to
 * the client view, which derives and lays out the drawing. When `?select=`
 * names a record, the page also reads what the panel cannot derive: its
 * attestation state, its history, and the trace when `?related=trace`. When
 * `?lens=` names a lens (plan §8), the page reads what the lens needs
 * (lensReads.ts). The browser never calls the hub (lib/viewer.ts). `?branch=`
 * or `?ref=` chooses the state; `?select=`, `?related=`, `?depth=`, `?hide=`,
 * `?edges=nodes`, `?lens=` with its parameters and `?figure=1` reproduce a
 * reader's view from the URL alone.
 */
export const dynamic = 'force-dynamic';

type Query = Record<string, string | undefined>;

export default async function GraphPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const { branch, ref } = query;
  const at = ref ? { ref } : { branch };
  const hub = viewerHub();
  const { data, commit } = await hub.export.read(at).catch((err: unknown) => {
    if (err instanceof HubError && err.status === 404) notFound();
    throw err;
  });
  const exported = (data.documents as Doc[]).filter((d) => d['@type'] !== 'User');
  const initial = stateFromQuery(query);
  const [reads, lens] = await Promise.all([
    readsFor(hub, initial.select, { branch, ref, trace: initial.direction === 'trace' }),
    lensReadsFor(hub, initial.lens, exported, { branch, ref, since: initial.since, fullyAssessedAt: initial.fullyAssessedAt, overAssessedAbove: initial.overAssessedAbove }),
  ]);
  // The changes lens draws the records deleted since the commit as ghosts, read from the export at that commit.
  const ghosts = lens.reads?.lens === 'changes' ? lens.reads.ghosts : [];
  const docs = ghosts.length ? [...exported, ...ghosts] : exported;
  const branchQuery = branch ? `?branch=${encodeURIComponent(branch)}` : ref ? `?ref=${encodeURIComponent(ref)}` : '';

  return (
    <main>
      <GraphView
        docs={docs}
        ghostIds={ghosts.map((g) => g['@id'])}
        initial={initial}
        reads={reads}
        lensReads={lens.reads}
        lensError={lens.error}
        branch={branch ?? 'main'}
        atRef={ref}
        commit={commit}
        publicHub={hubPublicUrl()}
        branchQuery={branchQuery}
      />
    </main>
  );
}
