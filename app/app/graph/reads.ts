import { CLASS_CATEGORY, type ClassName } from '@armature/types';
import type { AttestationsReport, HistoryResult, TraceReport } from '@armature/client';
import { isTraceable } from '@/lib/graph/focus';
import type { viewerHub } from '@/lib/viewer';

/**
 * What the server reads for a selected record (docs/graph-view-plan.md §6):
 * attestation state (the hub compares the judged part at two commits), the
 * record's history (on a branch; a view at a commit has none), and the trace
 * when the Trace relation is chosen. Each read is optional: a failure leaves
 * its field out and the panel says so, rather than failing the page.
 */
export interface SelectedReads {
  id: string;
  attestations?: AttestationsReport;
  history?: HistoryResult;
  trace?: TraceReport;
}

export function splitId(id: string): { type: ClassName; local: string } | undefined {
  const slash = id.indexOf('/');
  if (slash <= 0) return undefined;
  const type = id.slice(0, slash);
  return type in CLASS_CATEGORY ? { type: type as ClassName, local: id.slice(slash + 1) } : undefined;
}

export async function readsFor(
  hub: ReturnType<typeof viewerHub>,
  id: string | undefined,
  options: { branch?: string; ref?: string; trace: boolean },
): Promise<SelectedReads | undefined> {
  if (!id) return undefined;
  const parts = splitId(id);
  if (!parts) return { id };
  const at = options.ref ? { ref: options.ref } : { branch: options.branch };
  const quiet = async <T>(p: Promise<{ data: T }>): Promise<T | undefined> => p.then((r) => r.data).catch(() => undefined);
  const [attestations, history, trace] = await Promise.all([
    quiet(hub.intelligence.attestations(parts.type, parts.local, at)),
    options.ref ? Promise.resolve(undefined) : quiet(hub.documents.history(parts.type, parts.local, { branch: options.branch, diff: false })),
    options.trace && isTraceable(parts.type) ? quiet(hub.intelligence.trace(parts.type, parts.local, at)) : Promise.resolve(undefined),
  ]);
  return { id, attestations, history, trace };
}
