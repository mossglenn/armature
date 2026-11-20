import type { ArmatureClient, MergeResult, RequestHealth } from '@armature/client';
import type { Grant, MergeRequest } from '@armature/types';
import { refusal } from '../authorization';
import { storeOf, type HubConfig } from '../config';
import { ApiError } from '../errors';
import { isActive, type GrantDocument } from '../grants';
import type { UserDocument } from '../identity';
import { createOperatorStore, isUnknownRef, type OperatorStore } from '../store';
import { mirrorMain } from './clone';
import { localCommitsSince, mappingOf } from './commits';
import { emptyPushTable, parentOf, type WorkspaceRecord, type WorkspaceRecords } from './records';
import { fromRemote, ownerClient } from './remote';

/**
 * A workspace's merge request (architecture decision record ADR-0072
 * decisions 5 and 7): how its work leaves it. Where the desktop hub once
 * asked the remote to merge the workspace into `main` (deliver, ADR-0065
 * decision 6), it now opens a `MergeRequest` on the remote from the workspace
 * into its parent, shows what the remote says a merge would meet, and, when
 * the owner may merge into the parent, merges it; otherwise whoever may does,
 * on the remote. The record, its health and every refusal are the remote's,
 * passed on as given (`remote: true`). An open request replaces the dry run
 * of a delivery: its health is the same answer, read whenever asked.
 *
 * Opening and merging refuse while anything is unpushed (409
 * `unpushed_commits`): a request is about what the remote holds. Each holds
 * the workspace's write queue from that check to its last local write, the
 * remote's answers included, as the other actions do (`./bringIn.ts`).
 */

const localOf = (hub: HubConfig, branch: string): OperatorStore => createOperatorStore({ branch }, hub.store());

async function requireNothingUnpushed(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, action: string): Promise<void> {
  const table = (await records.getPush(record.branch)) ?? emptyPushTable();
  const mapping = mappingOf(record, table);
  const unpushed = (await localCommitsSince(storeOf(hub, { branch: record.branch }), record.local)).filter((commit) => !mapping.has(commit.id)).map((commit) => commit.id);
  if (unpushed.length) {
    throw new ApiError(409, 'unpushed_commits', `${unpushed.length} commit(s) of ${record.branch} are not pushed; push before ${action}`, { unpushed });
  }
}

/** What a page shows of a workspace's way out: its parent, the request open into it if there is one, and whether the owner may merge it themselves. */
export interface RequestState {
  workspace: string;
  parent: string;
  request?: MergeRequest;
  /** What a merge would meet, as the remote computed it for this read. */
  health?: RequestHealth;
  /** Whether the owner may merge into the parent on the remote, by its own rule (ADR-0068 decision 4); when not, whoever may merges it there. */
  mayMerge: boolean;
}

/** The one Open request from the workspace into its parent, if any. */
async function openRequestOf(hub: HubConfig, remote: ArmatureClient, record: WorkspaceRecord): Promise<MergeRequest | undefined> {
  return (await fromRemote(hub, () => remote.mergeRequests.list({ source: record.branch, target: parentOf(record), status: 'Open' }))).data[0];
}

/** Whether the owner may merge into `branch` on the remote, judged by the remote's own rule from the grants it shows. */
async function mayMergeInto(hub: HubConfig, remote: ArmatureClient, branch: string): Promise<boolean> {
  const me = (await fromRemote(hub, () => remote.users.me())).data as UserDocument & { grants?: Grant[] };
  const theirs = (await fromRemote(hub, () => remote.documents.list('Grant', { filter: { branch } }))).data as unknown as GrantDocument[];
  const inForce = [...((me.grants ?? []) as GrantDocument[]), ...theirs.filter((grant) => isActive(grant))];
  return refusal({ id: me['@id'], user: me }, { permission: 'merge', branch }, inForce) === undefined;
}

export async function requestState(hub: HubConfig, record: WorkspaceRecord): Promise<RequestState> {
  const remote = await ownerClient(hub, record);
  const parent = parentOf(record);
  const [open, mayMerge] = await Promise.all([openRequestOf(hub, remote, record), mayMergeInto(hub, remote, parent)]);
  if (!open) return { workspace: record.branch, parent, mayMerge };
  const read = (await fromRemote(hub, () => remote.mergeRequests.get(open['@id']))).data;
  return { workspace: record.branch, parent, request: read.request, ...(read.health ? { health: read.health } : {}), mayMerge };
}

/** Opens the request into the parent with the owner's message; the remote's 409 `request_open` when one is open. */
export function openRequest(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, message: string): Promise<RequestState> {
  return localOf(hub, record.branch).exclusive(async () => {
    await requireNothingUnpushed(hub, records, record, 'opening a merge request');
    const remote = await ownerClient(hub, record);
    const parent = parentOf(record);
    // The remote's requirements, mirrored again for the tools here to read (ADR-0070 decision 8): a plugin reads what the request will be held to.
    await mirrorMain(hub, remote, { id: record.owner, externalId: record.ownerExternalId });
    const request = (await fromRemote(hub, () => remote.mergeRequests.open({ source: record.branch, target: parent, message }))).data;
    const read = (await fromRemote(hub, () => remote.mergeRequests.get(request['@id']))).data;
    return { workspace: record.branch, parent, request: read.request, ...(read.health ? { health: read.health } : {}), mayMerge: await mayMergeInto(hub, remote, parent) };
  });
}

export interface RequestMerged {
  workspace: WorkspaceRecord;
  request: MergeRequest;
  /** The remote's merge into the parent. */
  merged: { commit: string; base: string; source: string; target: string; upToDate: boolean };
  /** The remote's verdicts on its required checks for this merge (ADR-0070 decision 6); absent when none applied. */
  checks?: MergeResult['checks'];
  /** True when the workspace was deleted on the remote and here. */
  deleted: boolean;
}

/**
 * Merges the workspace's open request, as its owner: the remote decides
 * whether they may (403 otherwise, and whoever may merges it there), checks
 * the merge and gates it. `deleteWorkspace` then removes the workspace on the
 * remote, where its parent now holds its head, and here.
 */
export function mergeRequest(
  hub: HubConfig,
  records: WorkspaceRecords,
  record: WorkspaceRecord,
  opts: { overrides?: Array<{ check: string; reason: string }>; deleteWorkspace?: boolean } = {}
): Promise<RequestMerged> {
  return localOf(hub, record.branch).exclusive(async () => {
    const { branch } = record;
    await requireNothingUnpushed(hub, records, record, 'merging');
    const remote = await ownerClient(hub, record);
    // The remote's requirements, mirrored again for the tools here to read (ADR-0070 decision 8); the remote enforces them on the merge below.
    await mirrorMain(hub, remote, { id: record.owner, externalId: record.ownerExternalId });
    const open = await openRequestOf(hub, remote, record);
    if (!open) throw new ApiError(409, 'no_request', `${branch} has no open merge request into ${parentOf(record)}; open one first`, { workspace: branch, parent: parentOf(record) });
    const done = (await fromRemote(hub, () => remote.mergeRequests.merge(open['@id'], opts.overrides?.length ? { overrides: opts.overrides } : {}))).data;
    const result: RequestMerged = {
      workspace: record,
      request: done.request,
      merged: { commit: done.commit, base: done.base, source: done.source, target: done.target, upToDate: done.upToDate },
      ...(done.checks ? { checks: done.checks } : {}),
      deleted: false,
    };
    if (!opts.deleteWorkspace) return result;
    await fromRemote(hub, () => remote.branches.delete(branch));
    try {
      await localOf(hub, branch).deleteBranch(branch);
    } catch (err) {
      if (!isUnknownRef(err)) throw err;
    }
    await records.remove(branch);
    return { ...result, deleted: true };
  });
}

/** Closes the workspace's open request, unmerged. */
export async function closeRequest(hub: HubConfig, record: WorkspaceRecord): Promise<{ workspace: string; request: MergeRequest }> {
  const remote = await ownerClient(hub, record);
  const open = await openRequestOf(hub, remote, record);
  if (!open) throw new ApiError(409, 'no_request', `${record.branch} has no open merge request into ${parentOf(record)}`, { workspace: record.branch, parent: parentOf(record) });
  const closed = (await fromRemote(hub, () => remote.mergeRequests.close(open['@id']))).data;
  return { workspace: record.branch, request: closed.request };
}
