import type { ArmatureClient } from '@armature/client';
import type { ClassName } from '@armature/types';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';
import { canonical } from '../fragments';
import { MIRROR_BRANCH } from '../role';
import { changesOf, createOperatorStore, isRecord, type Commit, type OperatorStore, type TerminusDocument } from '../store';
import { localCommitsSince } from './commits';
import type { BringingIn, PushedCommit, PushTable, WorkspaceRecord, WorkspaceRecords } from './records';
import { fromRemote } from './remote';

/**
 * The remote's merge of `main` into a workspace, written here: the documents
 * it changed as one local commit the push table maps to the merge commit
 * (`./bringIn.ts` says why outside the pipeline), and the settling of a
 * bring-in that did not finish.
 *
 * A bring-in is three steps that cannot be one: the remote merges, this hub
 * reads back what changed, and writes it with the table's entry. Until
 * 2026-11-11 a connection dropped after the first, or a process ended between
 * them, left the remote one commit ahead of a table that did not know it, and
 * every later bring-in and push was the remote's 412 with no way on (the
 * 2026-11-09 review's W4, "related"; its W8 counts it among the workspaces
 * that can never be pushed). So a marker, `bringingIn` in `push.json`, is
 * written before the request, as push writes `inFlight`: the remote commit the
 * merge was conditioned on and the local head it was made over. It gains the
 * merge commit when the remote answers and goes when the entry is written or
 * the remote refuses. A marker still there is settled by the next bring-in or
 * push, before anything else, here:
 *
 * - With no merge commit, the remote is asked: its branch still at the
 *   commit named means the merge never landed, and the marker goes. Otherwise
 *   the commit directly after it in the remote's log is the merge when it
 *   carries a merge's metadata; any other commit is someone else's write, the
 *   merge was refused for it, and the marker goes, leaving the 412 a moved
 *   branch has always been.
 * - With the merge commit, what it changed is read and written as the
 *   bring-in would have. A local commit made since the marker that holds
 *   exactly those documents is that write, ended before its entry, and is
 *   taken as it is: by its content, never its message, which a tool could
 *   write (`./records.ts`).
 * - Local commits a tool made since the marker stay where they are, unpushed,
 *   and what the merge changed is written after them, which leaves the same
 *   documents as the remote will hold once they are pushed after the merge,
 *   provided none of them changed a document the merge changed. Where one
 *   did, the two orders differ on that document and no merge runs here to say
 *   how (ADR-0065 decision 3): 409 `unpushed_commits` naming the documents,
 *   the marker kept. That workspace is as stuck as it was before the marker
 *   existed, and waits for the review's D6.
 *
 * Everything here runs holding the workspace's write queue.
 */

const typeOf = (id: string): ClassName => id.split('/')[0] as ClassName;
const LOG_PAGE = 100;
/** How far back the remote's log is read for the commit a marker names, as push's recovery reads it. */
const RECOVERY_PAGES = 50;

/** The message of the local commit holding what a merge changed. */
const broughtInMessage = (record: WorkspaceRecord, merge: string) => `Bring in ${MIRROR_BRANCH} from ${record.remote}: remote commit ${merge}`;

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

/** Whether a local commit wrote exactly these documents: the same ids, each the same but for the store's nested ids. */
async function wroteExactly(local: OperatorStore, commit: Commit, documents: readonly TerminusDocument[]): Promise<boolean> {
  if (!commit.parent || !documents.length) return false;
  const ids = changesOf(await local.diff(commit.parent, commit.id)).map((change) => change.id);
  if (ids.length !== documents.length) return false;
  const held = new Map((await local.at({ commit: commit.id }).getDocuments(ids)).documents.map((doc) => [doc['@id'], canonical(doc)]));
  return documents.every((doc) => held.get(doc['@id']) === canonical(doc));
}

export interface Merged {
  /** The remote's merge commit. */
  remote: string;
  /** The local commit the table maps to it. */
  local: string;
  documents: TerminusDocument[];
}

/**
 * Writes what the merge commit named in the marker changed, and the table's
 * entry for it, and takes the marker away. `table` is the caller's copy,
 * changed in place and saved.
 */
export async function writeMerged(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, remote: ArmatureClient, table: PushTable): Promise<Merged> {
  const marker = table.bringingIn;
  if (!marker?.merged) throw new Error(`No merge of ${record.branch} is waiting to be written`);
  const { branch } = record;
  const local = createOperatorStore({ branch }, hub.store());
  const documents = await changedDocuments(hub, remote, branch, marker.ifMatch, marker.merged);
  // Oldest first: what has been committed here since the marker was written.
  const since = (await localCommitsSince(local, marker.localHead)).reverse();
  let localCommit = marker.localHead;
  if (since.length && (await wroteExactly(local, since[0], documents))) {
    localCommit = since[0].id;
  } else {
    if (since.length && documents.length) {
      const theirs = new Set(changesOf(await local.diff(marker.localHead, since[since.length - 1].id)).map((change) => change.id));
      const overlapping = documents.map((doc) => doc['@id']).filter((id) => theirs.has(id));
      if (overlapping.length) {
        throw new ApiError(
          409,
          'unpushed_commits',
          `The remote merged ${MIRROR_BRANCH} into ${branch} (commit ${marker.merged}) and this hub did not finish reading it back; ${since.length} local commit(s) made since changed ${overlapping.length} document(s) that merge changed too, and no merge runs here to reconcile them`,
          { unpushed: since.map((commit) => commit.id), merged: marker.merged, overlapping }
        );
      }
    }
    if (documents.length) {
      ({ commit: localCommit } = await local.putDocuments(documents, { author: record.owner, message: broughtInMessage(record, marker.merged), create: true }));
    }
  }
  const entry: PushedCommit = { local: localCommit, remote: marker.merged, parts: 0, broughtIn: true, pushedAt: new Date().toISOString() };
  table.commits.push(entry);
  delete table.bringingIn;
  await records.putPush(branch, table);
  return { remote: entry.remote, local: localCommit, documents };
}

const isMerge = (commit: { metadata?: Record<string, unknown> }): boolean => {
  const armature = commit.metadata?.armature;
  return isRecord(armature) && typeof armature.mergeSource === 'string';
};

/** The commit directly after `since` in the remote branch's log, when the log holds `since` within reach. */
async function commitAfter(hub: HubConfig, remote: ArmatureClient, branch: string, since: string): Promise<{ commit: string; metadata?: Record<string, unknown> } | undefined> {
  let newer: { commit: string; metadata?: Record<string, unknown> } | undefined;
  for (let page = 0; page < RECOVERY_PAGES; page++) {
    const log = (await fromRemote(hub, () => remote.branches.log(branch, { start: page * LOG_PAGE, count: LOG_PAGE }))).data.commits;
    for (const commit of log) {
      if (commit.commit === since) return newer;
      newer = commit;
    }
    if (log.length < LOG_PAGE) return undefined;
  }
  return undefined;
}

/**
 * Settles a bring-in that did not finish, when the table holds its marker:
 * what was written, or undefined when there was no marker or the merge never
 * landed. A remote that cannot be reached leaves the marker for the next time.
 */
export async function settleBringIn(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, remote: ArmatureClient): Promise<Merged | undefined> {
  const table = await records.getPush(record.branch);
  const marker: BringingIn | undefined = table?.bringingIn;
  if (!table || !marker) return undefined;
  if (!marker.merged) {
    const after = await commitAfter(hub, remote, record.branch, marker.ifMatch);
    if (!after || !isMerge(after)) {
      delete table.bringingIn;
      await records.putPush(record.branch, table);
      return undefined;
    }
    marker.merged = after.commit;
    await records.putPush(record.branch, table);
  }
  return writeMerged(hub, records, record, remote, table);
}

