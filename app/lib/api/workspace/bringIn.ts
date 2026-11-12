import type { MergeResult } from '@armature/client';
import { storeOf, type HubConfig } from '../config';
import { ApiError } from '../errors';
import { MIRROR_BRANCH } from '../role';
import { createOperatorStore, isUnknownRef, type OperatorStore } from '../store';
import { localCommitsSince, mappingOf } from './commits';
import { settleBringIn, writeMerged, type Merged } from './merged';
import { emptyPushTable, type WorkspaceRecord, type WorkspaceRecords } from './records';
import { fromRemote, ownerClient } from './remote';
import { ensureSnapshots, resolvableCommitsOf } from './snapshots';

/**
 * Bring in `main` and deliver (ADR-0065 decision 6 with its notes;
 * docs/workspace-hub-plan.md §4 and §6): the two merges of the cycle, both
 * the remote's, driven from here as the owner.
 *
 * Bringing in asks the remote to merge `main` into the workspace, with
 * nothing left to push and `If-Match` naming the last commit this hub
 * pushed, so a branch someone else moved is the remote's 412 as it is for a
 * push. The remote checks the merged state before it commits (ADR-0025
 * decision 5, note) and reports a conflict per field, which comes back as
 * the remote gave it; the review is the program's, the resolution ordinary
 * local writes pushed like any other (§6). A clean merge is then read back,
 * the documents it changed at the merge commit, and written into the local
 * branch as one commit the push table maps to the merge commit, so the next
 * push continues from it (`./merged.ts`, which also settles a bring-in the
 * remote merged and this hub did not finish). This is the second route-side use of the
 * operator-side methods (ADR-0062, note of 2026-11-01), bounded like the
 * clone's: the remote already checked these documents, and the local
 * pipeline would refill what the remote decided.
 *
 * Delivering asks the remote to merge the workspace into `main` with the
 * person's message, after `main` has been brought in cleanly, which a dry
 * run of that merge confirms; a maintainer of `main` is needed there (ADR-0068
 * decision 4), and the remote's refusal comes back as given. The workspace
 * may then be deleted, on the remote (allowed, since `main` holds its head)
 * and here, or kept.
 *
 * Removing a workspace (since 2026-11-07, which the first rehearsal of the
 * desktop program found missing: a workspace delivered without deleting it
 * could not be removed, and one abandoned never could) takes it off this
 * machine with nothing left to push, and asks the remote to delete its branch.
 * The remote decides by its own rule (ADR-0025 decision 6): it deletes a
 * branch another branch holds the head of, as `main` does after a delivery,
 * and keeps one with commits no other branch holds (409 `unmerged_branch`),
 * and its authorization refuses a branch the owner may not delete (403). Kept,
 * the branch stays on the remote as the record of that work, cloned again if
 * wanted; the answer says what became of it. A remote that cannot be reached
 * keeps it too, and the local copy goes all the same, since nothing on it is
 * unpushed.
 *
 * Each of the three holds the workspace's write queue (`Store.exclusive`;
 * ADR-0025 decision 7, note of 2026-11-11) from its check that nothing is
 * unpushed to its last local write, the remote's answers included, so a
 * tool's write waits its turn: it lands after what was brought in, or finds
 * the workspace gone, and is never answered 200 and then overwritten or
 * deleted with the branch (the 2026-11-09 review's W3 and W4). The cost is
 * that such a write waits as long as the remote takes to answer. Resolving
 * the caller comes before, in the route.
 *
 * A removal that failed partway (a file another program held) is finished by
 * asking again: a local branch already gone has nothing unpushed and nothing
 * left to delete (the review's W2).
 *
 * A discard (since 2026-11-12; decision 6, note of that day; the 2026-11-09
 * review's W8 and D6) is the way out for a workspace whose commits can never
 * be pushed: a grant revoked, a remote branch deleted, a standing 422, a remote
 * that is gone, a bring-in left unfinished and then overlapped. It is a removal
 * that states how many local commits it gives up, and it is this machine's
 * alone: nothing is asked of the remote, so it needs no network and no
 * sign-in, which the cases it is for often lack. The count is the
 * confirmation: one that differs from what is there is refused (409
 * `discard_mismatch`) and nothing changes. Everything the workspace holds here,
 * its records and its branch's own commit files, is first copied aside
 * (`WorkspaceRecords.setAside`), since these are commits no other branch holds
 * and the only thing in Armature that removes such commits (ADR-0025 decision
 * 6); nothing reads the copy again. The remote's branch, with whatever was
 * pushed, stays as it is; cloned again and removed, it goes by the remote's rule.
 */

/** The workspace's local branch through the operator-side methods, whose `exclusive` is the hub's queue for it. */
const localOf = (hub: HubConfig, branch: string): OperatorStore => createOperatorStore({ branch }, hub.store());

/** Deletes the local branch; one a removal that failed partway already deleted is left as it is. */
async function deleteLocal(hub: HubConfig, branch: string): Promise<void> {
  try {
    await localOf(hub, branch).deleteBranch(branch);
  } catch (err) {
    if (!isUnknownRef(err)) throw err;
  }
}

export interface BringInResult {
  workspace: WorkspaceRecord;
  /** The remote branch's head after the merge: the merge commit, or the last known when up to date. */
  remoteHead: string;
  upToDate: boolean;
  /** The merge, when one was made, and what it brought into the local branch. */
  merge?: { base: string; source: string; target: string };
  broughtIn?: { local: string; documents: number };
}

export interface RemoveResult {
  workspace: WorkspaceRecord;
  /** What became of the branch on the remote: deleted, kept, already absent, or, after a discard, not asked about. */
  remote: 'deleted' | 'kept' | 'absent' | 'untouched';
  /** Why it was kept: commits no other branch holds, the remote's refusal, or no answer. */
  reason?: 'unmerged' | 'forbidden' | 'unreachable';
  /** After a discard: the local commits given up, newest first, and where the workspace's files were set aside in the hub's folder. */
  discarded?: { commits: string[]; setAside?: string };
}

export interface DeliverResult {
  workspace: WorkspaceRecord;
  /** The remote's merge into `main`. */
  delivered: { commit: string; base: string; source: string; target: string; upToDate: boolean };
  /** True when the workspace was deleted on the remote and here. */
  deleted: boolean;
}

/** The local commits the push table does not hold, and whether the local branch is still there; one already gone has none. */
async function unpushedOf(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord): Promise<{ unpushed: string[]; lastRemote: string; gone: boolean }> {
  const table = (await records.getPush(record.branch)) ?? emptyPushTable();
  const mapping = mappingOf(record, table);
  let commits: Awaited<ReturnType<typeof localCommitsSince>>;
  let gone = false;
  try {
    commits = await localCommitsSince(storeOf(hub, { branch: record.branch }), record.local);
  } catch (err) {
    if (!isUnknownRef(err)) throw err;
    commits = [];
    gone = true;
  }
  return { unpushed: commits.filter((commit) => !mapping.has(commit.id)).map((commit) => commit.id), lastRemote: table.commits.at(-1)?.remote ?? record.base, gone };
}

/** The unpushed local commits, refused as such when there are any; a local branch already gone has none. */
async function requireNothingUnpushed(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, action: string): Promise<{ lastRemote: string }> {
  const { unpushed, lastRemote } = await unpushedOf(hub, records, record);
  if (unpushed.length) {
    throw new ApiError(409, 'unpushed_commits', `${unpushed.length} local commit(s) of ${record.branch} are not on the remote; push before ${action}`, { unpushed });
  }
  return { lastRemote };
}

export function bringIn(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, message?: string): Promise<BringInResult> {
  return localOf(hub, record.branch).exclusive(() => bringInHeld(hub, records, record, message));
}

async function bringInHeld(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, message?: string): Promise<BringInResult> {
  const { branch } = record;
  const remote = await ownerClient(hub, record);
  // A bring-in that did not finish is settled first (./merged.ts): what the remote merged then is written
  // here before anything is counted as unpushed or asked of the remote again.
  const settled = await settleBringIn(hub, records, record, remote);
  const { lastRemote } = await requireNothingUnpushed(hub, records, record, 'bringing in main');
  const local = localOf(hub, branch);
  const table = (await records.getPush(branch)) ?? emptyPushTable();
  // The marker, before the request: the remote may merge and its answer, or the read-back, not arrive.
  table.bringingIn = { ifMatch: lastRemote, localHead: (await local.head())?.id ?? record.local, sentAt: new Date().toISOString() };
  await records.putPush(branch, table);
  let merged: MergeResult;
  try {
    merged = (
      await fromRemote(hub, () => remote.branches.merge(branch, { from: MIRROR_BRANCH, message: message ?? `Bring in ${MIRROR_BRANCH}`, ifMatch: lastRemote }))
    ).data;
  } catch (err) {
    if (err instanceof ApiError && err.code !== 'remote_unreachable') {
      // The remote answered, so nothing was merged: the marker goes.
      delete table.bringingIn;
      await records.putPush(branch, table);
    }
    throw err; // unreachable: the marker stays, and the next bring-in or push settles it from the remote's log
  }
  if (merged.upToDate || !merged.commit) {
    delete table.bringingIn;
    await records.putPush(branch, table);
    // Nothing new now; what an earlier bring-in merged and this one finished writing is still reported.
    return settled ? broughtIn(hub, records, record, remote, settled) : { workspace: record, remoteHead: lastRemote, upToDate: true };
  }
  table.bringingIn.merged = merged.commit;
  await records.putPush(branch, table);
  const written = await writeMerged(hub, records, record, remote, table);
  return { ...(await broughtIn(hub, records, record, remote, written)), merge: { base: merged.base, source: merged.source, target: merged.target } };
}

/** The answer for a merge written here, its snapshots taken. */
async function broughtIn(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, remote: Awaited<ReturnType<typeof ownerClient>>, written: Merged): Promise<BringInResult> {
  const table = (await records.getPush(record.branch)) ?? emptyPushTable();
  // A brought-in record may name an older commit this hub lacks (a dataset
  // merged from main): its snapshot is taken now, as at the clone (plan §8).
  await ensureSnapshots(hub, records, record, remote, written.documents, resolvableCommitsOf(record, table.commits));
  return { workspace: record, remoteHead: written.remote, upToDate: false, broughtIn: { local: written.local, documents: written.documents.length } };
}

export function deliver(
  hub: HubConfig,
  records: WorkspaceRecords,
  record: WorkspaceRecord,
  opts: { message: string; deleteWorkspace?: boolean }
): Promise<DeliverResult> {
  return localOf(hub, record.branch).exclusive(() => deliverHeld(hub, records, record, opts));
}

async function deliverHeld(
  hub: HubConfig,
  records: WorkspaceRecords,
  record: WorkspaceRecord,
  opts: { message: string; deleteWorkspace?: boolean }
): Promise<DeliverResult> {
  const { branch } = record;
  await requireNothingUnpushed(hub, records, record, 'delivering');
  const remote = await ownerClient(hub, record);
  // main brought in cleanly: the merge of main into the workspace has nothing left to do.
  const preview: MergeResult = (await fromRemote(hub, () => remote.branches.merge(branch, { from: MIRROR_BRANCH, message: 'preview', dryRun: true }))).data;
  if (!preview.upToDate) {
    throw new ApiError(409, 'bring_in_first', `${MIRROR_BRANCH} has moved since ${branch} last brought it in; bring it in, resolve what it reports, then deliver`, {
      conflicts: preview.conflicts ?? [],
      violations: preview.violations ?? [],
    });
  }
  const delivered: MergeResult = (await fromRemote(hub, () => remote.branches.merge(MIRROR_BRANCH, { from: branch, message: opts.message }))).data;
  const result: DeliverResult = {
    workspace: record,
    delivered: { commit: delivered.commit ?? '', base: delivered.base, source: delivered.source, target: delivered.target, upToDate: delivered.upToDate },
    deleted: false,
  };
  if (!opts.deleteWorkspace) return result;
  await fromRemote(hub, () => remote.branches.delete(branch));
  await deleteLocal(hub, branch);
  await records.remove(branch);
  return { ...result, deleted: true };
}

/**
 * Removes the workspace from this hub, and its branch from the remote when the remote's rule allows.
 * With `discard`, the number of local commits the caller gives up, it is a discard instead: this
 * machine's alone, the workspace's files set aside first.
 */
export function removeWorkspace(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, opts: { discard?: number } = {}): Promise<RemoveResult> {
  return localOf(hub, record.branch).exclusive(() => (opts.discard === undefined ? removeHeld(hub, records, record) : discardHeld(hub, records, record, opts.discard)));
}

/** A stamp for a set-aside folder's name: the time to the second, in the characters every file system takes. */
const stampOf = (when: Date): string => when.toISOString().replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '');

async function discardHeld(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, stated: number): Promise<RemoveResult> {
  const { branch } = record;
  const { unpushed, gone } = await unpushedOf(hub, records, record);
  // A discard that failed after the branch was deleted is finished by asking again, as a removal is:
  // the commits were set aside then, and nothing is left to count.
  if (gone) {
    await records.remove(branch);
    return { workspace: record, remote: 'untouched', discarded: { commits: [] } };
  }
  // The count is the confirmation: what the person was shown they would lose is what is there now. A
  // tool's write since, or a push that landed, makes it another question, asked again.
  if (unpushed.length !== stated) {
    throw new ApiError(
      409,
      'discard_mismatch',
      unpushed.length
        ? `${branch} holds ${unpushed.length} local commit(s) that are not on the remote, not the ${stated} this discard names; nothing was removed`
        : `${branch} holds no local commit that is not on the remote, so there is nothing to discard; remove it without discard`,
      { unpushed, stated }
    );
  }
  // An unfinished bring-in's marker goes with the push table, set aside like the rest; nothing is asked of the remote.
  const setAside = await records.setAside(branch, stampOf(new Date()));
  await deleteLocal(hub, branch);
  await records.remove(branch);
  return { workspace: record, remote: 'untouched', discarded: { commits: unpushed, setAside } };
}

async function removeHeld(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord): Promise<RemoveResult> {
  const { branch } = record;
  await requireNothingUnpushed(hub, records, record, 'removing it');
  let outcome: Pick<RemoveResult, 'remote' | 'reason'> = { remote: 'deleted' };
  try {
    const remote = await ownerClient(hub, record);
    await fromRemote(hub, () => remote.branches.delete(branch));
  } catch (err) {
    if (!(err instanceof ApiError)) throw err;
    // The remote's own refusals and silence keep its branch; a refusal of this hub's credential
    // (remote_identity, signed_out) is the person's to fix, and stops the removal.
    const fromTheRemote = err.details?.remote === true;
    if (err.code === 'remote_unreachable') outcome = { remote: 'kept', reason: 'unreachable' };
    else if (fromTheRemote && err.code === 'unmerged_branch') outcome = { remote: 'kept', reason: 'unmerged' };
    else if (fromTheRemote && err.code === 'forbidden') outcome = { remote: 'kept', reason: 'forbidden' };
    else if (fromTheRemote && err.status === 404) outcome = { remote: 'absent' };
    else throw err;
  }
  await deleteLocal(hub, branch);
  await records.remove(branch);
  return { workspace: record, ...outcome };
}
