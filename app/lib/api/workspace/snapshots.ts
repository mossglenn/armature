import type { ArmatureClient } from '@armature/client';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';
import { createOperatorStore, type TerminusDocument } from '../store';
import { COMMIT_ID, fromRemote, remoteCommitOf } from './remote';
import { emptySnapshots, type RemoteLog, type RemoteLogEntry, type SnapshotRecord, type Snapshots, type WorkspaceRecord, type WorkspaceRecords } from './records';

/**
 * What a clone holds beyond the base (docs/workspace-hub-plan.md §8; §16
 * question 3, decided 2026-10-30; ADR-0066 decision 2): the remote's state at
 * each older commit a cloned or brought-in record names in `asOf`, and the
 * remote branch's log back to its beginning.
 *
 * A snapshot is the remote's full export at that commit, loaded into a local
 * branch named `at.<commit>` as the clone loads the base, so that constraints
 * 13 and 16, the attestation staleness read and every read at that ref work
 * offline (`./store.ts` resolves the commit to the branch). Snapshots are
 * taken most-referenced first within a budget per workspace
 * (`ARMATURE_SNAPSHOTS`); a commit beyond it is recorded as declined, and a
 * read at it is forwarded to the remote when online. Subject-only snapshots
 * for the commits beyond the budget (the plan's first recommendation) wait
 * for a bank that exceeds it.
 *
 * With the clone this is the third module of the API that reaches the
 * operator-side methods (ADR-0062, ADR-0031 decision 4, notes): it reproduces
 * the remote's export at a commit, which the write pipeline cannot do. Bounded
 * like the clone's: into this hub's own store, from its configured remote,
 * never from a request body.
 */

const SNAPSHOT_PREFIX = 'at.';
/** The local branch holding the remote's state at a commit. A workspace's branch is `<handle>_<name>`, which never matches. */
export const snapshotBranch = (commit: string): string => `${SNAPSHOT_PREFIX}${commit}`;
export const isSnapshotBranch = (name: string): boolean => /^at\.[a-z0-9]+$/.test(name);

/**
 * The distinct commits the documents name in `asOf`, with how many name each. A value that is no commit
 * identifier (`COMMIT_ID`, bounded) names no snapshot: until 2026-11-16 one longer than a branch name
 * allows reached the store as a branch to create and surfaced as its raw refusal, after the workspace's
 * record was written (the 2026-11-09 review's W7).
 */
export function asOfCommitsOf(documents: readonly TerminusDocument[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const doc of documents) {
    const asOf = doc.asOf;
    if (typeof asOf === 'string' && COMMIT_ID.test(asOf)) counts.set(asOf, (counts.get(asOf) ?? 0) + 1);
  }
  return counts;
}

/**
 * Brings a workspace's snapshots up to date with what `documents` name:
 * the commits not already held, resolvable (the base, a pushed or brought-in
 * commit, in `resolvable`) or declined are fetched most-referenced first
 * while the budget allows, each into its branch; the rest are recorded as
 * declined with the reason. Idempotent: a branch already in the store is not
 * loaded again, so a clone interrupted here is completed by the next call.
 * Returns the records as written.
 */
export async function ensureSnapshots(
  hub: HubConfig,
  records: WorkspaceRecords,
  record: WorkspaceRecord,
  remote: ArmatureClient,
  documents: readonly TerminusDocument[],
  resolvable: ReadonlySet<string>
): Promise<Snapshots> {
  const snapshots = (await records.getSnapshots(record.branch)) ?? emptySnapshots();
  const known = new Map(snapshots.commits.map((s) => [s.commit, s]));
  const wanted = asOfCommitsOf(documents);
  for (const [commit, references] of wanted) {
    const held = known.get(commit);
    if (held) held.references = Math.max(held.references, references);
  }
  const candidates = [...wanted]
    .filter(([commit]) => !known.has(commit) && !resolvable.has(commit))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!candidates.length) {
    if (wanted.size) await records.putSnapshots(record.branch, snapshots);
    return snapshots;
  }

  const store = createOperatorStore({ branch: record.branch }, hub.store());
  let room = Math.max(0, hub.snapshotBudget - snapshots.commits.filter((s) => s.held).length);
  for (const [commit, references] of candidates) {
    let entry: SnapshotRecord;
    if (room <= 0) {
      entry = { commit, references, held: false, reason: 'budget' };
    } else {
      try {
        entry = await loadSnapshot(hub, store, remote, commit);
        entry.references = references;
        room -= 1;
      } catch (err) {
        if (!(err instanceof ApiError) || err.code === 'remote_unreachable') throw err;
        // The remote refused the export at this commit (it has no such commit, or the caller may not read it).
        entry = { commit, references, held: false, reason: err.code };
      }
    }
    snapshots.commits.push(entry);
    // Written after each one, so an interruption keeps what landed.
    await records.putSnapshots(record.branch, snapshots);
  }
  return snapshots;
}

/**
 * The remote's export at `commit`, loaded into its snapshot branch unless the
 * branch already holds it. In the snapshot branch's own write queue (ADR-0025
 * decision 7, note of 2026-11-11), so two workspaces naming one commit load it
 * once; work holding that queue takes no other.
 */
async function loadSnapshot(hub: HubConfig, store: ReturnType<typeof createOperatorStore>, remote: ArmatureClient, commit: string): Promise<SnapshotRecord> {
  const branch = snapshotBranch(commit);
  const at = store.at({ branch });
  return at.exclusive(async () => {
    if ((await store.listBranches()).includes(branch)) {
      const { documents } = await at.allDocuments();
      return { commit, references: 0, held: true, documents: documents.length, fetchedAt: new Date().toISOString() };
    }
    const exported = await fromRemote(hub, () => remote.export.read({ ref: commit, profile: 'full' }));
    const documents = exported.data.documents as unknown as TerminusDocument[];
    await store.createEmptyBranch(branch);
    await at.replaceSchema(exported.data.schema as Record<string, unknown>[], {
      author: 'system',
      message: `Snapshot of ${hub.remote ?? 'the remote'} at ${commit}: schema`,
    });
    if (documents.length) {
      await at.insertDocuments(documents, { author: 'system', message: `Snapshot of ${hub.remote ?? 'the remote'} at ${commit}` });
    }
    return { commit, references: 0, held: true, documents: documents.length, fetchedAt: new Date().toISOString() };
  });
}

/** The remote log's page size, the route's maximum. */
const LOG_PAGE = 100;
/** The pages read at most, as the remote's own walk and push's recovery stop (`LOG_PAGES`, `RECOVERY_PAGES`). */
const LOG_PAGES = 50;

/**
 * The remote branch's log, read page by page, kept from the base back:
 * entries newer than the base (someone wrote the branch between the export
 * and this read) are dropped, so the log and the clone describe one state.
 *
 * What the remote answers is checked before it is kept (the 2026-11-09
 * review's W6 and W7). The read ends after LOG_PAGES pages: a history longer
 * than that is kept to there, its newest 5,000 commits, and a read past it
 * is the remote's when online. A page that repeats a commit already read is a
 * remote, or a proxy in front of it, that ignores `start`, which until
 * 2026-11-16 was read forever: 502 `remote_error`, `reason: log_repeats`. A
 * log that does not hold the base describes some other state than the clone:
 * 502 `remote_error`, `reason: log_without_base`; until then the whole of it
 * was kept as if it began at the base.
 */
export async function fetchRemoteLog(hub: HubConfig, remote: ArmatureClient, branch: string, base: string): Promise<RemoteLog> {
  const commits: RemoteLogEntry[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < LOG_PAGES; page++) {
    const entries = (await fromRemote(hub, () => remote.branches.log(branch, { start: page * LOG_PAGE, count: LOG_PAGE }))).data.commits;
    if (!Array.isArray(entries)) throw new ApiError(502, 'remote_error', `The remote at ${hub.remote} answered the log of ${branch} without its commits`, { remote: true });
    for (const c of entries) {
      const commit = remoteCommitOf(hub, c?.commit, `the log of ${branch}`);
      if (seen.has(commit)) {
        throw new ApiError(
          502,
          'remote_error',
          `The remote at ${hub.remote} answered the log of ${branch} with commit ${commit} twice; it, or a proxy in front of it, does not page the log (start is ignored)`,
          { remote: true, reason: 'log_repeats', commit }
        );
      }
      seen.add(commit);
      commits.push({ commit, author: String(c.author ?? ''), message: String(c.message ?? ''), timestamp: Number(c.timestamp) || 0 });
    }
    if (entries.length < LOG_PAGE) break;
  }
  const from = commits.findIndex((c) => c.commit === base);
  if (from < 0) {
    throw new ApiError(502, 'remote_error', `The remote at ${hub.remote} answered the log of ${branch} without ${base}, the commit this hub cloned it at`, {
      remote: true,
      reason: 'log_without_base',
      base,
    });
  }
  return { head: base, commits: commits.slice(from) };
}

/** The remote commits a workspace resolves without a snapshot: its base and every commit its push table maps. */
export const resolvableCommitsOf = (record: WorkspaceRecord, pushed: readonly { remote: string }[]): Set<string> =>
  new Set([record.base, ...pushed.map((c) => c.remote)]);
