import { Hono, type Context } from 'hono';
import type { InstanceProfile, MergeConflict } from '@armature/client';
import { parseOverrides, runsOf } from '../checks';
import { hubOf, storeFor, type HubConfig } from '../config';
import { ApiError } from '../errors';
import { BRANCH_NAME, readJson } from '../http';
import { isRecord } from '../store';
import { handleFor, handleOf, principalOf, requireClaims, resolveUser } from '../identity';
import { requireActionRoutes } from '../localToken';
import { refuseReservedTrailers } from '../trailers';

export { handleFor, handleOf };

/** A new workspace's name, the part after `<handle>_`: the characters a branch name allows (BRANCH_NAME checks the whole). */
const WORKSPACE_NAME = /^[A-Za-z0-9._-]{1,99}$/;
import { cloneBranch, mirrorMain, type Owner } from '../workspace/clone';
import { MIRROR_BRANCH } from '../role';
import { bringIn, removeWorkspace, unlinkHere } from '../workspace/bringIn';
import { adoptHeld, elsewhere, linkOf, linkState, requireLinkedHere, type LinkState } from '../workspace/links';
import { localCommitsSince, pushWorkspace } from '../workspace/push';
import { PERSONAL_CHECKS, parentOf, type WorkspaceRecord, type WorkspaceRecords } from '../workspace/records';
import { fromRemote, remoteClient, requireRemoteIdentity } from '../workspace/remote';
import { closeRequest, mergeRequest, openRequest, requestState } from '../workspace/requests';
import { ensureSnapshots, fetchRemoteLog, isSnapshotBranch, resolvableCommitsOf } from '../workspace/snapshots';

/**
 * /api/v1/workspace, served by a workspace hub only (ADR-0065;
 * docs/workspace-hub-plan.md §4, §5 and §9), under the `armature/workspace`
 * capability; a remote hub answers 400 `workspace_only`.
 *
 *   GET  /                    the workspaces this hub holds, their records
 *   POST /                    { name, from? } creates <handle>_<name> on the remote
 *                             from `from` (`main` by default), its parent, as a
 *                             workspace linked to this installation, and clones
 *                             it; { link } links one of the owner's workspaces
 *                             that is linked to no computer, and clones it (409
 *                             `held_elsewhere` when it is linked to another:
 *                             linking never takes a workspace over). Mirrors the
 *                             remote's main first. 201 with the record
 *   GET  /elsewhere           the owner's workspaces on the remote that this hub
 *                             does not hold: `unlinked`, each of which can be
 *                             linked here, and `linkedElsewhere`, each with the
 *                             label and time of its link, never the identifier
 *   GET  /:name/status        the record, the local head, the local commits
 *                             since the clone and how many are pushed, the
 *                             snapshots held and declined (plan §8), and the
 *                             remote branch's head and where the remote says the
 *                             workspace is linked, when the remote can be reached
 *   POST /:name/push          { overrides? } replays the unpushed local commits on
 *                             the remote (../workspace/push.ts); the owner's
 *                             action, gated by their personal requirements
 *                             (409 checks_pending, 422 checks_failed)
 *   POST /:name/bring-in      { message? } the remote's merge of the workspace's
 *                             parent into it, read back as one local commit
 *                             (../workspace/bringIn.ts); 409 unpushed_commits
 *   GET  /:name/merge-request the workspace's parent, the request open into it
 *                             with its health as the remote computes it, and
 *                             whether the owner may merge it themselves
 *   POST /:name/merge-request { message } opens the request into the parent
 *                             (../workspace/requests.ts); 409 unpushed_commits,
 *                             the remote's 409 request_open
 *   POST /:name/merge-request/merge   { overrides?, deleteWorkspace? } merges it,
 *                             where the owner may; the remote's refusals as given
 *   POST /:name/merge-request/close   closes it unmerged
 *   POST /:name/unlink        unlinks the workspace from this computer: the
 *                             remote's link cleared and the local copy removed,
 *                             with nothing left to push. For a workspace this hub
 *                             does not hold, { elsewhere: true } unlinks it from
 *                             the other computer, whose commits not yet pushed
 *                             can then no longer be pushed
 *   DELETE /:name             removes the workspace here with nothing left to
 *                             push, and its branch on the remote when the
 *                             remote's rule allows (since 2026-11-07); where the
 *                             branch stays it stays as an unlinked workspace;
 *                             ?discard=<n> gives up n unpushed local commits
 *                             instead, the workspace's files set aside first
 *                             (409 discard_mismatch when n is not what is there;
 *                             since 2026-11-12), and clears the link when the
 *                             remote answers
 *
 * Until 2026-11-20 `POST /` took `{ existing }` to clone any branch, and
 * `POST /:name/deliver` asked the remote to merge the workspace into `main`
 * with a dry run. A workspace is now linked, not cloned, someone else's is
 * read on the instance, and work leaves by a merge request (ADR-0072
 * decisions 4, 5 and 7).
 *
 * Every route but the reads carries the hub's pairing key as
 * `Armature-Local-Token` (../localToken.ts; since 2026-11-03). Push, bring in,
 * the merge request's three actions, unlink and remove are the desktop app's own actions rather than routes a tool
 * may call (ADR-0065 decision 7, note of 2026-10-30); until the program exists
 * (plan §14 step 7) they are served as routes only where the host asks for
 * them, `ARMATURE_WORKSPACE_ACTIONS=routes`, which the `workspace` compose
 * profile and the suites set, and are 403 `forbidden` (`reason:
 * program_action`) elsewhere (decided 2026-11-03; until then the push route
 * was open to any process on loopback, decided 2026-11-01).
 */
export const workspace = new Hono();

workspace.use('*', async (c, next) => {
  if (hubOf(c).role !== 'workspace') {
    throw new ApiError(400, 'workspace_only', 'The workspace routes are served by a workspace hub; this hub is a remote, where a workspace is a branch');
  }
  await next();
});

function recordsOf(c: Context): WorkspaceRecords {
  const records = hubOf(c).workspaces;
  if (!records) throw new Error('This workspace hub was given no place for its records; app/server.ts gives it ARMATURE_WORKSPACE_DIR');
  return records;
}

/**
 * Why a branch the remote has cannot be cloned under its name, or undefined
 * (the 2026-11-09 review's W9): the names this hub's own folder and store use.
 * A name this hub makes, `<handle>_<name>`, is never one of them. Until
 * 2026-11-16 `main` was refused only by the wording of the mirror's commit
 * messages, a branch named `at.<commit>` cloned into a workspace the list
 * hides, and `lock` and `store.json` met the store's own files as a 500.
 */
function reservedName(branch: string): string | undefined {
  if (branch === MIRROR_BRANCH) return `${MIRROR_BRANCH} is this hub's copy of the instance's ${MIRROR_BRANCH}, which a workspace updates from, and never a workspace itself`;
  if (isSnapshotBranch(branch)) return "a name of that shape holds the instance's state at a commit here";
  if (RESERVED_FILES.has(branch.toLowerCase())) return "the hub's folder keeps a file of that name";
  return undefined;
}

/** The files of a workspace hub's folder beside its branches, lower case since a folder may not tell case apart (`filestore/store.ts`, `lib/workspaceFolder.ts`, `workspace/records.ts`). */
const RESERVED_FILES = new Set(['lock', 'store.json', PERSONAL_CHECKS, 'installation.json']);

/** The longest text kept from a remote's profile; an address or a name is far shorter. */
const PROFILE_TEXT = 2048;

/**
 * The remote's connection profile as this hub keeps it: the fields the profile has, each of the type
 * and within the length it can be, and nothing else the remote put beside them (the 2026-11-09
 * review's W7). A profile without a name is none.
 */
export function profileOf(instance: unknown): InstanceProfile | undefined {
  if (!isRecord(instance)) return undefined;
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value.length > 0 && value.length <= PROFILE_TEXT ? value : undefined);
  const name = text(instance.name);
  if (!name) return undefined;
  const api = text(instance.api);
  const releases = isRecord(instance.program) ? text(instance.program.releases) : undefined;
  return { name, ...(api ? { api } : {}), program: { releases: releases ?? '' } };
}

/**
 * A workspace is worked with through the remote it was cloned from. The program lets the remote change
 * only while no workspace exists, which it can judge for the folder in use alone: a folder set aside,
 * a connection made elsewhere and the folder pointed at again leaves a hub over another remote's
 * workspaces (the 2026-11-09 review's W10). Its actions are refused here, 409 `other_remote`, before
 * anything is asked of a remote that never held the branch. A removal is the way out, beside connecting
 * to the first remote again: it removes such a workspace here alone, its remote answered `untouched`,
 * with `discard` when it holds commits that were never pushed (`workspace/bringIn.ts`).
 */
function requireItsRemote(hub: HubConfig, record: WorkspaceRecord, action: string): void {
  if (record.remote === (hub.remote ?? '')) return;
  throw new ApiError(
    409,
    'other_remote',
    `${record.branch} was created from the instance at ${record.remote}, and this hub is connected to ${hub.remote}; connect to ${record.remote} to ${action} it, or remove it from this computer`,
    { workspace: record.branch, clonedFrom: record.remote, remote: hub.remote }
  );
}

workspace.get('/', async (c) => c.json(await recordsOf(c).list()));

/**
 * The owner's workspaces on the remote that are not on this computer, for the two lists the app shows
 * (ADR-0072 decision 7). A read of the remote as the caller, like the status; a tool may ask.
 */
workspace.get('/elsewhere', async (c) => {
  const hub = hubOf(c);
  const { externalId } = await requireClaims(c);
  await requireRemoteIdentity(hub, { externalId });
  const remote = remoteClient(hub, externalId);
  const me = await fromRemote(hub, () => remote.users.me());
  await adoptHeld(hub, recordsOf(c), remote, { id: me.data['@id'] });
  return c.json(await elsewhere(hub, recordsOf(c), remote));
});

workspace.post('/', async (c) => {
  const body = await readJson(c);
  const { name, from, link } = body;
  if (body.existing !== undefined) {
    throw new ApiError(400, 'bad_request', 'A workspace of yours is linked to this computer, and no other branch is copied to it: send link with the name of one of your workspaces that is linked to no computer (ADR-0072 decision 4)');
  }
  if ((name === undefined) === (link === undefined)) {
    throw new ApiError(400, 'bad_request', 'Send either name (and optionally from) for a new workspace, or link to link one of your workspaces to this computer');
  }
  if (link !== undefined && from !== undefined) {
    throw new ApiError(400, 'bad_request', 'from applies to a new workspace; a workspace that is linked keeps its parent');
  }
  for (const [key, value] of Object.entries({ name, from, link })) {
    if (value !== undefined && typeof value !== 'string') throw new ApiError(400, 'bad_request', `${key} must be a string`);
  }

  const hub = hubOf(c);
  const { externalId } = await requireClaims(c);
  const records = recordsOf(c);
  const checkBranch = async (branch: string) => {
    if (!BRANCH_NAME.test(branch)) {
      throw new ApiError(400, 'bad_name', `The workspace's branch, ${branch}, must match ${BRANCH_NAME.source}`);
    }
    const reserved = reservedName(branch);
    if (reserved) throw new ApiError(400, 'bad_name', `${branch} cannot be a workspace: ${reserved}`, { reserved: true });
    if (await records.get(branch)) throw new ApiError(409, 'workspace_exists', `This hub already holds the workspace ${branch}`);
  };
  // A new workspace's name is checked before the remote is asked, so a bad one is refused offline too;
  // the whole branch name waits for the remote's record of the person, whose email gives the handle.
  if (typeof link === 'string') await checkBranch(link);
  else if (!WORKSPACE_NAME.test(name as string)) {
    throw new ApiError(400, 'bad_name', `The workspace's name, ${name as string}, must match ${WORKSPACE_NAME.source}`);
  }
  const installation = linkOf(hub);

  // The remote is the registry: the owner is whoever it resolves the caller to,
  // and under a token that must be the person this request names (remote.ts).
  await requireRemoteIdentity(hub, { externalId });
  const remote = remoteClient(hub, externalId);
  const me = await fromRemote(hub, () => remote.users.me());
  const owner: Owner = { id: me.data['@id'], externalId };
  const branch = typeof link === 'string' ? link : `${handleFor({ externalId, email: me.data.email })}_${name as string}`;
  if (typeof link !== 'string') await checkBranch(branch);

  await mirrorMain(hub, remote, owner);
  // The workspaces this hub held before workspaces were linked are recorded on the remote at this contact (ADR-0072 decision 7).
  await adoptHeld(hub, records, remote, owner);
  const start = typeof from === 'string' ? from : 'main';
  // From here in the branch's write queue (ADR-0025 decision 7, note of 2026-11-11): a second request for
  // the same workspace waits, then finds the record, rather than replacing a clone half made; a tool's
  // write to the branch waits for the clone to finish. The mirror's queue was taken and left above.
  const made = await storeFor(c, { branch }).exclusive(async () => {
    await checkBranch(branch);
    // Created on the remote as a workspace linked to this installation, or linked to it there: the remote's
    // record first, then the copy here. A link whose clone does not finish is completed by linking again.
    let parent = start;
    if (typeof name === 'string') await fromRemote(hub, () => remote.branches.create(branch, { branch: start }, { workspace: installation }));
    else parent = (await fromRemote(hub, () => remote.workspaces.link(branch, installation))).data.parent;
    const { base, local, documents } = await cloneBranch(hub, remote, owner, branch);
    // The remote's profile, kept so this hub's GET /discover can name the instance offline (docs/desktop-program-plan.md §8).
    const instance = profileOf((await fromRemote(hub, () => remote.discover())).data.instance);

    const record: WorkspaceRecord = {
      branch,
      remote: hub.remote ?? '',
      owner: owner.id,
      ownerExternalId: externalId,
      from: parent,
      base,
      local,
      clonedAt: new Date().toISOString(),
      ...(instance ? { instance } : {}),
      link: installation.link,
    };
    await records.put(record);
    // What the clone holds beyond the base (plan §8, §16 question 3): the
    // remote's log back to the branch's beginning, and the state at each older
    // commit a cloned record names. After the record, so an interruption here
    // leaves a workspace whose next bring-in completes them.
    await records.putLog(branch, await fetchRemoteLog(hub, remote, branch, base));
    const snapshots = await ensureSnapshots(hub, records, record, remote, documents, resolvableCommitsOf(record, []));
    return { ...record, snapshots: snapshots.commits };
  });
  return c.json(made, 201);
});

async function recordOf(c: Context, name: string): Promise<WorkspaceRecord> {
  const record = await recordsOf(c).get(name);
  if (!record) throw new ApiError(404, 'not_found', `This hub holds no workspace ${name}`);
  return record;
}

/** Where the workspace stands against its parent on the remote: whether an update from the parent would bring anything, and whether it would merge. */
interface ParentState {
  branch: string;
  /** The parent's latest commit on the remote (since 2026-11-21, issue #170). */
  head: string;
  /** The starting point: the latest commit the parent and the workspace's branch on the remote share (since 2026-11-21, issue #169). */
  base: string;
  /** True when the parent holds commits the workspace's branch on the remote does not. */
  behind: boolean;
  /** When behind: how many documents an update would bring, where the remote says. */
  documents?: number;
  /** When behind: how many records an update would be refused for, zero when it would merge. */
  conflicts?: number;
  /** When behind: what the update would be refused for, each field with its three values, as the update's own 409 would list them; empty when it would merge (since 2026-11-21, issue #169). */
  conflicting?: MergeConflict[];
}

/**
 * The remote's own answer, a dry run of the merge an update makes (the parent
 * into the workspace's branch), which the remote keeps by the three commits, so
 * asking again costs a read. Absent when the remote would not say (the parent
 * is gone, an older remote): the status is what is known, and a page then
 * leaves the action open. Answers issues #169 and #170 for a tool: where the
 * parent is, whether it has moved, and what an update from it would meet.
 *
 * The conflicts are served from this read and never kept (decided 2026-11-20,
 * against #169's proposal of the last refusal kept until an update goes
 * through): they are what an update would meet now, so they cannot go stale,
 * nothing clears them, and a tool reads them whether or not anyone tried the
 * update, or whether the tool was open when someone did. Offline there is no
 * list, as there is no `parent`; the update cannot be made offline either.
 */
async function parentState(hub: HubConfig, client: ReturnType<typeof remoteClient>, record: WorkspaceRecord): Promise<ParentState | undefined> {
  const parent = parentOf(record);
  try {
    const dry = (await fromRemote(hub, () => client.branches.merge(record.branch, { from: parent, message: `Update from ${parent}`, dryRun: true }))).data;
    // The dry run's sides: `source` is the parent's head, `base` the commit the two share.
    const where = { branch: parent, head: dry.source, base: dry.base };
    // Behind only by records kept on `main` alone (a grant, a merge request) is not behind: nothing of the design waits.
    if (dry.upToDate || dry.brings === 0) return { ...where, behind: false };
    const conflicting = dry.conflicts ?? [];
    // A conflict is one field, and a record can conflict on several: the count is of records, as documented since 2026-11-20.
    return { ...where, behind: true, ...(dry.brings !== undefined ? { documents: dry.brings } : {}), conflicts: new Set(conflicting.map((c) => c.id)).size, conflicting };
  } catch (err) {
    if (err instanceof ApiError && err.code !== 'remote_unreachable') return undefined;
    throw err;
  }
}

workspace.get('/:name/status', async (c) => {
  const { name } = c.req.param();
  const hub = hubOf(c);
  const record = await recordOf(c, name);
  const store = storeFor(c, { branch: record.branch });
  const head = await store.head();
  const localCommits = (await localCommitsSince(store, record.local)).length;
  const table = await recordsOf(c).getPush(record.branch);
  const pushed = table?.commits.length ?? 0;
  const lastKnown = table?.commits.at(-1)?.remote ?? record.base;
  const snapshots = (await recordsOf(c).getSnapshots(record.branch))?.commits ?? [];

  let remote: { head: string; moved: boolean; link: LinkState; linkLabel?: string; linkedAt?: string; parent?: ParentState } | { reachable: false; reason?: 'signed_out' | 'issuer_unreachable' | 'other_remote' };
  try {
    // A workspace cloned from another remote than this hub's has no remote to ask here (requireItsRemote).
    if (record.remote !== (hub.remote ?? '')) throw new ApiError(409, 'other_remote', `${record.branch} was created from the instance at ${record.remote}`);
    const client = remoteClient(hub, record.ownerExternalId);
    const summary = await fromRemote(hub, () => client.branches.head(record.branch));
    // The body's head, not the ETag: a proxy in front of the remote can alter the ETag (remoteCommit in workspace/remote.ts), the body it cannot.
    const remoteHead = summary.data.head.commit;
    // Where the remote says the workspace is linked (ADR-0072 decision 3): `elsewhere` or `unlinked` means this
    // computer's push will be refused, which a page says before the person meets it. `none`: a workspace made
    // before workspaces were linked, not yet recorded on the remote.
    const linked = await linkState(hub, client, record.branch);
    const where = linked.state === 'elsewhere' ? { ...(linked.record?.linkLabel ? { linkLabel: linked.record.linkLabel } : {}), ...(linked.record?.linkedAt ? { linkedAt: linked.record.linkedAt } : {}) } : {};
    const parent = await parentState(hub, client, record);
    remote = { head: remoteHead, moved: remoteHead !== lastKnown, link: linked.state, ...where, ...(parent ? { parent } : {}) };
  } catch (err) {
    // The status is what this hub knows of the workspace, and it knows it offline: a remote that cannot be
    // asked is said as such, never a failure of the read. That holds for the credential too: under oidc a
    // person who is offline has no token to ask with (503 `issuer_unreachable`), and one who is signed out
    // has none at all (401 `signed_out`), and until 2026-11-15 either failed the whole status, so the
    // program's page had nothing to show of the commits waiting here (the 2026-11-09 review's P1).
    if (err instanceof ApiError && err.code === 'remote_unreachable') remote = { reachable: false };
    else if (err instanceof ApiError && (err.code === 'signed_out' || err.code === 'issuer_unreachable' || err.code === 'other_remote')) remote = { reachable: false, reason: err.code };
    else throw err;
  }
  return c.json({
    workspace: record,
    head: head?.id,
    localCommits,
    pushed,
    unpushed: localCommits - pushed,
    snapshots: { budget: hub.snapshotBudget, held: snapshots.filter((s) => s.held).map((s) => s.commit), declined: snapshots.filter((s) => !s.held) },
    remote,
  });
});

/** The workspace, and the caller as its owner or an agent acting for them; anyone else is 403 naming the owner. */
async function ownedWorkspace(c: Context, action: 'push' | 'bring-in' | 'merge-request' | 'unlink' | 'remove'): Promise<WorkspaceRecord> {
  const { name } = c.req.param();
  const record = await recordOf(c, name);
  const who = await resolveUser(c);
  const principal = principalOf(who);
  if (principal.id !== record.owner) {
    throw new ApiError(403, 'forbidden', `${principal.user.externalId} may not ${action} ${name}: this workspace is ${record.ownerExternalId}'s`, {
      permission: action,
      branch: record.branch,
      owner: record.ownerExternalId,
    });
  }
  return record;
}

/** A body that may be absent: a bare POST is `{}`. */
async function optionalJson(c: Context): Promise<Record<string, unknown>> {
  const raw = (await c.req.text()).trim();
  if (!raw) return {};
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new ApiError(400, 'bad_request', 'The body must be a JSON object');
  }
  if (!isRecord(body)) throw new ApiError(400, 'bad_request', 'The body must be a JSON object');
  return body;
}

workspace.post('/:name/push', async (c) => {
  requireActionRoutes(c, 'push');
  const record = await adoptFirst(c, await ownedWorkspace(c, 'push'));
  requireItsRemote(hubOf(c), record, 'push');
  await requireHere(c, record, 'push');
  // `overrides` sets the owner's personal requirements aside for this push, each with a reason (ADR-0070 decision 8).
  const overrides = parseOverrides((await optionalJson(c)).overrides);
  return c.json(await pushWorkspace(hubOf(c), recordsOf(c), record, { runs: runsOf(c), overrides }));
});

workspace.post('/:name/bring-in', async (c) => {
  requireActionRoutes(c, 'bring-in');
  const record = await adoptFirst(c, await ownedWorkspace(c, 'bring-in'));
  requireItsRemote(hubOf(c), record, 'update');
  await requireHere(c, record, 'update it');
  // The body is optional: a bare POST brings main in with the default message.
  const body = await optionalJson(c);
  if (body.message !== undefined && typeof body.message !== 'string') throw new ApiError(400, 'bad_request', 'message must be a string');
  return c.json(await bringIn(hubOf(c), recordsOf(c), record, body.message as string | undefined));
});

/** The workspaces this hub held before workspaces were linked, recorded on the remote before an action that needs the record (ADR-0072 decision 7). */
async function adoptFirst(c: Context, record: WorkspaceRecord): Promise<WorkspaceRecord> {
  if (record.link !== undefined || record.remote !== (hubOf(c).remote ?? '')) return record;
  const hub = hubOf(c);
  await requireRemoteIdentity(hub, { id: record.owner, externalId: record.ownerExternalId });
  await adoptHeld(hub, recordsOf(c), remoteClient(hub, record.ownerExternalId), { id: record.owner });
  return (await recordsOf(c).get(record.branch)) ?? record;
}

/** An action of this computer's needs the workspace linked to it, or not yet recorded on the remote (`requireLinkedHere`). */
async function requireHere(c: Context, record: WorkspaceRecord, doing: string): Promise<void> {
  const hub = hubOf(c);
  await requireLinkedHere(hub, remoteClient(hub, record.ownerExternalId), record.branch, doing);
}

// A read of the remote as the owner, like the status: a tool may ask, to show where the work is.
workspace.get('/:name/merge-request', async (c) => {
  const record = await recordOf(c, c.req.param('name'));
  requireItsRemote(hubOf(c), record, 'read the merge request of');
  return c.json(await requestState(hubOf(c), record));
});

workspace.post('/:name/merge-request', async (c) => {
  requireActionRoutes(c, 'merge-request');
  const record = await adoptFirst(c, await ownedWorkspace(c, 'merge-request'));
  requireItsRemote(hubOf(c), record, 'open a merge request for');
  await requireHere(c, record, 'open its merge request');
  const body = await readJson(c);
  if (typeof body.message !== 'string' || !body.message.trim()) throw new ApiError(400, 'message_required', 'A merge request needs a message saying what it holds and why; it becomes the merge commit\'s (ADR-0025)');
  refuseReservedTrailers(body.message);
  return c.json(await openRequest(hubOf(c), recordsOf(c), record, body.message.trim()), 201);
});

workspace.post('/:name/merge-request/merge', async (c) => {
  requireActionRoutes(c, 'merge-request');
  const record = await ownedWorkspace(c, 'merge-request');
  requireItsRemote(hubOf(c), record, 'merge');
  await requireHere(c, record, 'merge its request');
  const body = await optionalJson(c);
  if (body.deleteWorkspace !== undefined && typeof body.deleteWorkspace !== 'boolean') throw new ApiError(400, 'bad_request', 'deleteWorkspace must be a boolean');
  // The remote's gate is the remote's to judge: the overrides are checked for shape here and passed on.
  const overrides = [...parseOverrides(body.overrides)].map(([check, reason]) => ({ check, reason }));
  return c.json(await mergeRequest(hubOf(c), recordsOf(c), record, { overrides, deleteWorkspace: body.deleteWorkspace === true }));
});

workspace.post('/:name/merge-request/close', async (c) => {
  requireActionRoutes(c, 'merge-request');
  const record = await ownedWorkspace(c, 'merge-request');
  requireItsRemote(hubOf(c), record, 'close the merge request of');
  await requireHere(c, record, 'close its merge request');
  return c.json(await closeRequest(hubOf(c), record));
});

/**
 * Unlink (ADR-0072 decision 4). A workspace this hub holds is unlinked *from this computer*: the remote's link
 * cleared, the local copy removed, nothing left to push. One it does not hold is the owner's on the remote,
 * linked to another computer, and is unlinked *from the other computer* only with `{ elsewhere: true }`, the
 * caller's statement that it knows which of the two it asks: that computer's commits not yet pushed can then no
 * longer be pushed.
 */
workspace.post('/:name/unlink', async (c) => {
  requireActionRoutes(c, 'unlink');
  const hub = hubOf(c);
  const { name } = c.req.param();
  const body = await optionalJson(c);
  if (body.elsewhere !== undefined && typeof body.elsewhere !== 'boolean') throw new ApiError(400, 'bad_request', 'elsewhere must be a boolean');
  const held = await recordsOf(c).get(name);
  if (held) {
    if (body.elsewhere === true) throw new ApiError(409, 'workspace_here', `${name} is on this computer; unlink it from this computer, without elsewhere`, { workspace: name });
    const record = await adoptFirst(c, await ownedWorkspace(c, 'unlink'));
    requireItsRemote(hub, record, 'unlink');
    return c.json(await unlinkHere(hub, recordsOf(c), record));
  }
  if (!BRANCH_NAME.test(name)) throw new ApiError(400, 'bad_name', `${name} is not a workspace's name`);
  if (body.elsewhere !== true) throw new ApiError(404, 'not_found', `This hub holds no workspace ${name}; to unlink one from the other computer, send elsewhere: true`);
  const { externalId } = await requireClaims(c);
  await requireRemoteIdentity(hub, { externalId });
  const unlinked = (await fromRemote(hub, () => remoteClient(hub, externalId).workspaces.unlink(name))).data;
  return c.json({ workspace: name, unlinked: unlinked.unlinked, elsewhere: true, ...(unlinked.was ? { was: unlinked.was } : {}) });
});

workspace.delete('/:name', async (c) => {
  requireActionRoutes(c, 'remove');
  const record = await ownedWorkspace(c, 'remove');
  // `discard=<n>`: the removal gives up n local commits that are not on the remote, and says so.
  const raw = c.req.query('discard');
  const discard = raw === undefined ? undefined : Number(raw);
  if (discard !== undefined && (!/^[1-9]\d*$/.test(raw ?? '') || !Number.isSafeInteger(discard))) {
    throw new ApiError(400, 'bad_query', 'discard is the number of commits not pushed to give up, a whole number of at least 1');
  }
  return c.json(await removeWorkspace(hubOf(c), recordsOf(c), record, { discard }));
});
