import { splitId } from './reads';
import type { Doc } from '@/lib/graph/derive';
import type { LensReads } from '@/lib/graph/lenses';
import type { LensName } from '@/lib/graph/state';
import type { viewerHub } from '@/lib/viewer';

/**
 * What the server reads for a lens (docs/graph-view-plan.md §8): the coverage
 * of every module, the alignment read, the attestation state of every attested
 * record (one read per subject, from the export's attestation documents), or
 * the changes on the branch since a commit, with the deleted records read from
 * the export at that commit so the page can draw them as ghosts. The outcomes
 * lens needs no read: the export holds the metrics. A failed read is reported
 * as text; the lens is then shown without its data rather than failing the page.
 */
export interface LensOptions {
  branch?: string;
  ref?: string;
  since?: string;
  fullyAssessedAt?: number;
  overAssessedAbove?: number;
}

export type LensResult = { reads?: LensReads; error?: string };

export async function lensReadsFor(
  hub: ReturnType<typeof viewerHub>,
  lens: LensName | undefined,
  docs: Doc[],
  options: LensOptions,
): Promise<LensResult> {
  if (!lens) return {};
  const at = options.ref ? { ref: options.ref } : { branch: options.branch };
  const failed = (what: string) => (err: unknown): LensResult => ({ error: `${what} could not be read${err instanceof Error && err.message ? ` (${err.message})` : ''}.` });
  switch (lens) {
    case 'coverage':
      return hub.intelligence
        .courseCoverage({ ...at, fullyAssessedAt: options.fullyAssessedAt, overAssessedAbove: options.overAssessedAbove })
        .then((r): LensResult => ({ reads: { lens, report: r.data } }), failed('The coverage read'));
    case 'alignment':
      return hub.intelligence.alignment(at).then((r): LensResult => ({ reads: { lens, report: r.data } }), failed('The alignment read'));
    case 'attestations': {
      // One read per attested record: the hub compares each judged part at two commits.
      const subjects = [...new Set(docs.filter((d) => d['@type'] === 'Attestation').map((d) => d.subject).filter((s): s is string => typeof s === 'string'))];
      const states: Record<string, string> = {};
      const results = await Promise.all(subjects.map(async (id) => {
        const parts = splitId(id);
        if (!parts) return true;
        return hub.intelligence.attestations(parts.type, parts.local, at).then((r) => {
          for (const a of r.data.attestations) states[a.id] = a.state;
          return true;
        }, () => false);
      }));
      const unread = results.filter((ok) => !ok).length;
      return {
        reads: { lens, states, subjects: subjects.length },
        error: unread ? `The attestations of ${unread} of ${subjects.length} records could not be read.` : undefined,
      };
    }
    case 'outcomes':
      return { reads: { lens } };
    case 'changes': {
      if (!options.since) return { reads: undefined, error: undefined };
      if (options.ref) return { error: 'Changes are counted on a branch; this view is at a commit.' };
      const branch = options.branch ?? 'main';
      const changes = await hub.branches.changes(branch, options.since).then((r) => r.data, () => undefined);
      if (!changes) return { error: `What changed on ${branch} since commit ${options.since.slice(0, 10)} could not be read.` };
      const deleted = new Set(changes.changes.filter((c) => c.op === 'delete').map((c) => c.id));
      const ghosts = deleted.size
        ? await hub.export.read({ ref: options.since }).then((r) => (r.data.documents as Doc[]).filter((d) => deleted.has(d['@id']) && d['@type'] !== 'User'), () => [] as Doc[])
        : [];
      return { reads: { lens, since: options.since, changes, ghosts } };
    }
  }
}
