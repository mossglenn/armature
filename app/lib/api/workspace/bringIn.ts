import type { ArmatureClient, MergeResult } from '@armature/client';
import type { ClassName } from '@armature/types';
import { storeOf, type HubConfig } from '../config';
import { ApiError } from '../errors';
import { MIRROR_BRANCH } from '../role';
import { createOperatorStore, type TerminusDocument } from '../store';
import { localCommitsSince, mappingOf } from './push';
import { emptyPushTable, type PushedCommit, type WorkspaceRecord, type WorkspaceRecords } from './records';
import { fromRemote, remoteClient } from './remote';

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
 * push continues from it. This is the second route-side use of the
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
 */

export interface BringInResult {
  workspace: WorkspaceRecord;
  /** The remote branch's head after the merge: the merge commit, or the last known when up to date. */
  remoteHead: string;
  upToDate: boolean;
  /** The merge, when one was made, and what it brought into the local branch. */
  merge?: { base: string; source: string; target: string };
  broughtIn?: { local: string; documents: number };
}

export interface DeliverResult {
  workspace: WorkspaceRecord;
  /** The remote's merge into `main`. */
  delivered: { commit: string; base: string; source: string; target: string; upToDate: boolean };
  /** True when the workspace was deleted on the remote and here. */
  deleted: boolean;
}

/** The unpushed local commits, refused as such when there are any. */
async function requireNothingUnpushed(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, action: string): Promise<{ lastRemote: string }> {
  const table = (await records.getPush(record.branch)) ?? emptyPushTable();
  const mapping = mappingOf(record, table);
  const unpushed = (await localCommitsSince(storeOf(hub, { branch: record.branch }), record.local)).filter((commit) => !mapping.has(commit.id));
  if (unpushed.length) {
    throw new ApiError(409, 'unpushed_commits', `${unpushed.length} local commit(s) of ${record.branch} are not on the remote; push before ${action}`, {
      unpushed: unpushed.map((commit) => commit.id),
    });
  }
  return { lastRemote: table.commits.at(-1)?.remote ?? record.base };
}

const typeOf = (id: string): ClassName => id.split('/')[0] as ClassName;

/** The documents the remote branch changed between two of its commits, read at the later one. */
async function changedDocuments(hub: HubConfig, remote: ArmatureClient, branch: string, since: string, at: string): Promise<TerminusDocument[]> {
  const { changes } = (await fromRemote(hub, () => remote.branches.changes(branch, since))).data;
  const deleted = changes.filter((change) => change.op === 'delete');
  if (deleted.length) {
    throw new Error(`The remote's merge deleted ${deleted.map((d) => d.id).join(', ')}, which no route of the API does; bringing it in is not supported`);
  }
  const documents: TerminusDocument[] = [];
  for (const change of changes) {
    documents.push((await fromRemote(hub, () => remote.documents.get(typeOf(change.id), change.id, { ref: at }))).data as unknown as TerminusDocument);
  }
  return documents;
}

export async function bringIn(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, message?: string): Promise<BringInResult> {
  const { branch } = record;
  const { lastRemote } = await requireNothingUnpushed(hub, records, record, 'bringing in main');
  const remote = remoteClient(hub, record.ownerExternalId);
  const merged: MergeResult = (
    await fromRemote(hub, () => remote.branches.merge(branch, { from: MIRROR_BRANCH, message: message ?? `Bring in ${MIRROR_BRANCH}`, ifMatch: lastRemote }))
  ).data;
  if (merged.upToDate || !merged.commit) return { workspace: record, remoteHead: lastRemote, upToDate: true };

  // What the merge changed, read at the merge commit and written here as one
  // commit, outside the pipeline: the remote decided these documents.
  const documents = await changedDocuments(hub, remote, branch, lastRemote, merged.commit);
  const local = createOperatorStore({ branch }, hub.store());
  let localCommit = (await local.head())?.id ?? record.local;
  if (documents.length) {
    ({ commit: localCommit } = await local.putDocuments(documents, {
      author: record.owner,
      message: `Bring in ${MIRROR_BRANCH} from ${record.remote}: remote commit ${merged.commit}`,
      create: true,
    }));
  }
  const table = (await records.getPush(branch)) ?? emptyPushTable();
  const entry: PushedCommit = { local: localCommit, remote: merged.commit, parts: 0, broughtIn: true, pushedAt: new Date().toISOString() };
  table.commits.push(entry);
  await records.putPush(branch, table);
  return {
    workspace: record,
    remoteHead: merged.commit,
    upToDate: false,
    merge: { base: merged.base, source: merged.source, target: merged.target },
    broughtIn: { local: localCommit, documents: documents.length },
  };
}

export async function deliver(
  hub: HubConfig,
  records: WorkspaceRecords,
  record: WorkspaceRecord,
  opts: { message: string; deleteWorkspace?: boolean }
): Promise<DeliverResult> {
  const { branch } = record;
  await requireNothingUnpushed(hub, records, record, 'delivering');
  const remote = remoteClient(hub, record.ownerExternalId);
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
  await createOperatorStore({ branch }, hub.store()).deleteBranch(branch);
  await records.remove(branch);
  return { ...result, deleted: true };
}
