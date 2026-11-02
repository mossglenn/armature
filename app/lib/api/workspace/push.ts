import type { ArmatureClient } from '@armature/client';

import { ApiError } from '../errors';
import { isAgentExternalId, type UserDocument } from '../identity';
import { MIRROR_BRANCH } from '../role';
import { storeOf, type HubConfig } from '../config';
import { changesOf, type Commit, type Store, type TerminusDocument } from '../store';
import {
  AUTHORED_AT_TRAILER,
  RESERVED_TRAILERS,
  trailerValue,
  WORKSPACE_COMMIT_TRAILER,
  WORKSPACE_PART_TRAILER,
  withoutTrailers,
  withTrailer,
} from '../trailers';
import { emptyPushTable, type InFlight, type PushedCommit, type PushTable, type WorkspaceRecord, type WorkspaceRecords } from './records';
import { fromRemote, remoteClient } from './remote';
import { GroupTooLarge, PART_LIMITS, splitIntoParts, type PartLimits } from './split';

/**
 * Push (ADR-0065 decision 5 with its notes; docs/workspace-hub-plan.md §5):
 * each local commit since the last push becomes one batch write on the
 * remote, in order, through the remote's own /api/v1, so every rule and
 * every identity check runs there as for any other write. Nothing here reads
 * or writes the remote's store.
 *
 * The commit table (`push.json`, ../workspace/records.ts) maps each local
 * commit to the remote commit it became; every `asOf` naming a local commit
 * is rewritten to the remote one before the replay, exactly, since the
 * workspace has one writer and replay starts from the base. The message
 * carries the commit's own identifier and time as trailers, the pusher's
 * claims; the hub-written trailers of the local commit are removed, since
 * the remote writes its own. A commit by an agent is replayed as the agent
 * acting for the owner (ADR-0067 decisions 3 and 10). An in-flight marker is
 * written before each request so that a push interrupted after the remote
 * accepted a part is settled on the next push from the remote branch's log
 * (ADR-0066 decision 2, note).
 *
 * What stops a push: 403 `forbidden` before its first commit (the owner may
 * not write the branch on the remote), 412 `precondition_failed` (the branch
 * moved on the remote: someone else with a grant wrote it, or the owner
 * pushed from another machine), 422 `invariant_violation` (a rule the remote
 * has and this hub lacked), each with the progress so far; and 502
 * `remote_unreachable`, after which the marker stays for the next push to
 * settle. Only the workspace hub pushes, as the desktop program's own action
 * (ADR-0065 decision 7, note); the route is the development entry until then.
 */

export interface PushResult {
  workspace: WorkspaceRecord;
  /** The local commits this push replayed, oldest first. */
  pushed: PushedCommit[];
  /** The remote branch's head after the push: the last commit landed, or the last known. */
  remoteHead: string;
  /** True when nothing was left to push. */
  upToDate: boolean;
}

const LOG_PAGE = 100;
/** How far back the remote's log is read for an in-flight part before it is given up as not landed. */
const RECOVERY_PAGES = 50;
const READ_PAGE = 100;

/** The pushes running in this process, one per workspace at a time. */
const running = new Set<string>();

/** The local commits after the clone, newest first; the clone's own commit is not among them. */
export async function localCommitsSince(store: Store, clone: string): Promise<Commit[]> {
  const commits: Commit[] = [];
  for (let start = 0; ; start += LOG_PAGE) {
    const page = await store.log({ start, count: LOG_PAGE });
    const at = page.findIndex((commit) => commit.id === clone);
    if (at >= 0) {
      commits.push(...page.slice(0, at));
      return commits;
    }
    commits.push(...page);
    if (page.length < LOG_PAGE) throw new Error(`The local branch no longer holds its clone commit ${clone}`);
  }
}

/** The local commit → remote commit table as a map, the clone's commit mapping to the base. */
export const mappingOf = (record: WorkspaceRecord, table: PushTable): Map<string, string> =>
  new Map([[record.local, record.base], ...table.commits.map((c): [string, string] => [c.local, c.remote])]);

/**
 * A document as the replay sends it: a copy with the store's nested ids
 * removed (a part's identity is its `fragmentId`, ADR-0033; the remote mints
 * its own) and every `asOf` naming a local commit rewritten to the remote one.
 */
function forReplay(doc: TerminusDocument, mapping: Map<string, string>): TerminusDocument {
  const copy = (value: unknown, top: boolean): unknown => {
    if (Array.isArray(value)) return value.map((v) => copy(v, false));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === '@id' && !top) continue;
        out[k] = copy(v, false);
      }
      return out;
    }
    return value;
  };
  const out = copy(doc, true) as TerminusDocument;
  if (typeof out.asOf === 'string' && mapping.has(out.asOf)) out.asOf = mapping.get(out.asOf);
  return out;
}

/**
 * The documents one local commit wrote, read at that commit, as the replay
 * sends them. A `User` the local pipeline carried onto the branch is left
 * out: the remote carries its own (ADR-0032 decision 5). A deletion cannot
 * happen through the API, so none is expected.
 */
async function documentsOf(local: Store, commit: Commit, mapping: Map<string, string>): Promise<TerminusDocument[]> {
  if (!commit.parent) throw new Error(`Local commit ${commit.id} has no parent`);
  const changes = changesOf(await local.diff(commit.parent, commit.id));
  const deleted = changes.filter((change) => change.op === 'delete').map((change) => change.id);
  if (deleted.length) throw new Error(`Local commit ${commit.id} deletes ${deleted.join(', ')}, which no route of the API does; a push cannot replay it`);
  const at = local.at({ commit: commit.id });
  const ids = changes.map((change) => change.id);
  const documents: TerminusDocument[] = [];
  for (let i = 0; i < ids.length; i += READ_PAGE) {
    documents.push(...(await at.getDocuments(ids.slice(i, i + READ_PAGE))).documents);
  }
  return documents.filter((doc) => doc['@type'] !== 'User').map((doc) => forReplay(doc, mapping));
}

/** The replayed message: the local one without the hub's own trailers, with the push's. */
function replayMessage(commit: Commit): string {
  const message = withTrailer(withoutTrailers(commit.message, RESERVED_TRAILERS), `${WORKSPACE_COMMIT_TRAILER}: ${commit.id}`);
  return withTrailer(message, `${AUTHORED_AT_TRAILER}: ${new Date(commit.timestamp * 1000).toISOString()}`);
}

/**
 * The client a local commit is replayed with: the owner's, or for a commit
 * an agent made here, the owner's with the agent named (ADR-0067 decision 3),
 * so the remote records the agent as author and the owner in its own
 * trailer. A commit by any other person cannot be pushed as the owner.
 */
async function clientFor(hub: HubConfig, record: WorkspaceRecord, author: string): Promise<ArmatureClient> {
  if (author === record.owner) return remoteClient(hub, record.ownerExternalId);
  const { document } = await storeOf(hub, { branch: MIRROR_BRANCH }).getDocument(author);
  const user = document as UserDocument;
  if (!isAgentExternalId(user.externalId)) {
    throw new ApiError(403, 'forbidden', `Local commit by ${user.externalId}, not this workspace's owner, cannot be pushed as the owner`, {
      permission: 'write',
      branch: record.branch,
      owner: record.ownerExternalId,
    });
  }
  return remoteClient(hub, record.ownerExternalId, user.externalId);
}

/** The commit's part trailer, or none for a commit sent whole. */
const partTrailer = (part: number, total: number): string | undefined => (total > 1 ? `${WORKSPACE_PART_TRAILER}: ${part}/${total}` : undefined);

/**
 * Whether an in-flight request landed: the remote branch's log, from its head
 * back to the commit the request was conditioned on, holds a commit carrying
 * this hub's trailer for that local commit and part. The remote commit when
 * it did, undefined when it did not.
 */
async function landedCommit(hub: HubConfig, client: ArmatureClient, branch: string, marker: InFlight): Promise<string | undefined> {
  const head = await fromRemote(hub, () => client.branches.head(branch));
  if (head.data.head.commit === marker.ifMatch) return undefined;
  const expectedPart = partTrailer(marker.part, marker.total)?.split(': ')[1];
  for (let page = 0; page < RECOVERY_PAGES; page++) {
    const log = await fromRemote(hub, () => client.branches.log(branch, { start: page * LOG_PAGE, count: LOG_PAGE }));
    for (const commit of log.data.commits) {
      if (commit.commit === marker.ifMatch) return undefined;
      if (trailerValue(commit.message, WORKSPACE_COMMIT_TRAILER) !== marker.local) continue;
      if (trailerValue(commit.message, WORKSPACE_PART_TRAILER) === expectedPart) return commit.commit;
    }
    if (log.data.commits.length < LOG_PAGE) return undefined;
  }
  return undefined;
}

/** A refusal from the remote with this push's progress added, and for a 412 what moved on the remote. */
async function explained(err: ApiError, hub: HubConfig, client: ArmatureClient, record: WorkspaceRecord, pushed: PushedCommit[], at: { local: string; part: number; total: number }, since: string): Promise<ApiError> {
  const details: Record<string, unknown> = { ...err.details, pushed, at };
  if (err.status === 412) {
    try {
      details.moved = (await fromRemote(hub, () => client.branches.changes(record.branch, since))).data.changes;
    } catch {
      // The explanation is best effort; the refusal stands without it.
    }
  }
  return new ApiError(err.status, err.code, err.message, details);
}

export async function pushWorkspace(hub: HubConfig, records: WorkspaceRecords, record: WorkspaceRecord, limits: PartLimits = PART_LIMITS): Promise<PushResult> {
  const { branch } = record;
  if (running.has(branch)) throw new ApiError(409, 'push_in_progress', `A push of ${branch} is already running on this hub`);
  running.add(branch);
  try {
    const local = storeOf(hub, { branch });
    const table = (await records.getPush(branch)) ?? emptyPushTable();
    const mapping = mappingOf(record, table);
    let lastRemote = table.commits.at(-1)?.remote ?? record.base;
    const pushed: PushedCommit[] = [];
    const save = () => records.putPush(branch, table);

    // A request that may be on the wire from an interrupted push: landed or not.
    let resume: { local: string; landed: string[] } | undefined;
    if (table.inFlight) {
      const marker = table.inFlight;
      const landed = await landedCommit(hub, remoteClient(hub, record.ownerExternalId), branch, marker);
      const parts = landed ? [...marker.landed, landed] : marker.landed;
      if (landed && marker.part === marker.total) {
        const entry = { local: marker.local, remote: landed, parts: marker.total, pushedAt: new Date().toISOString() };
        table.commits.push(entry);
        mapping.set(marker.local, landed);
        pushed.push(entry);
      } else {
        resume = { local: marker.local, landed: parts };
      }
      lastRemote = parts.at(-1) ?? lastRemote;
      delete table.inFlight;
      await save();
    }

    const pending = (await localCommitsSince(local, record.local)).reverse().filter((commit) => !mapping.has(commit.id));
    for (const commit of pending) {
      const client = await clientFor(hub, record, commit.author);
      const message = replayMessage(commit);
      let parts: TerminusDocument[][];
      try {
        parts = splitIntoParts(await documentsOf(local, commit, mapping), limits);
      } catch (err) {
        if (!(err instanceof GroupTooLarge)) throw err;
        throw new ApiError(422, 'group_too_large', `Local commit ${commit.id} cannot be pushed: ${err.message}`, { local: commit.id, documents: err.ids, pushed });
      }
      const landed = resume?.local === commit.id ? resume.landed : [];
      resume = undefined;
      for (let part = landed.length + 1; part <= parts.length; part++) {
        const at = { local: commit.id, part, total: parts.length };
        table.inFlight = { ...at, ifMatch: lastRemote, landed: [...landed], sentAt: new Date().toISOString() };
        await save();
        const trailer = partTrailer(part, parts.length);
        let result: { commit: string };
        try {
          result = (
            await fromRemote(hub, () =>
              client.documents.batch({ branch, message: trailer ? withTrailer(message, trailer) : message, documents: parts[part - 1], ifMatch: lastRemote })
            )
          ).data;
        } catch (err) {
          if (err instanceof ApiError && err.code !== 'remote_unreachable') {
            // The remote answered, so the request did not land: the marker goes.
            delete table.inFlight;
            await save();
            throw await explained(err, hub, client, record, pushed, at, lastRemote);
          }
          throw err; // the marker stays: the next push settles it from the remote's log
        }
        landed.push(result.commit);
        lastRemote = result.commit;
      }
      const entry = { local: commit.id, remote: lastRemote, parts: parts.length, pushedAt: new Date().toISOString() };
      table.commits.push(entry);
      mapping.set(commit.id, lastRemote);
      delete table.inFlight;
      await save();
      pushed.push(entry);
    }
    return { workspace: record, pushed, remoteHead: lastRemote, upToDate: pending.length === 0 && pushed.length === 0 };
  } finally {
    running.delete(branch);
  }
}
