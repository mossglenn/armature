import { Hono, type Context } from 'hono';
import type { ArmatureClient, InstanceProfile } from '@armature/client';
import type { Grant } from '@armature/types';
import { refusal } from '../authorization';
import { parseOverrides, runsOf } from '../checks';
import { hubOf, storeFor, type HubConfig } from '../config';
import { ApiError } from '../errors';
import { isActive, type GrantDocument } from '../grants';
import { BRANCH_NAME, readJson } from '../http';
import { isRecord } from '../store';
import { handleFor, handleOf, principalOf, requireClaims, resolveUser, type UserDocument } from '../identity';
import { requireActionRoutes } from '../localToken';

export { handleFor, handleOf };

/** A new workspace's name, the part after `<handle>_`: the characters a branch name allows (BRANCH_NAME checks the whole). */
const WORKSPACE_NAME = /^[A-Za-z0-9._-]{1,99}$/;
import { cloneBranch, mirrorMain, type Owner } from '../workspace/clone';
import { MIRROR_BRANCH } from '../role';
import { bringIn, deliver, removeWorkspace } from '../workspace/bringIn';
import { localCommitsSince, pushWorkspace } from '../workspace/push';
import { PERSONAL_CHECKS, type WorkspaceRecord, type WorkspaceRecords } from '../workspace/records';
import { fromRemote, remoteClient, requireRemoteIdentity } from '../workspace/remote';
import { ensureSnapshots, fetchRemoteLog, isSnapshotBranch, resolvableCommitsOf } from '../workspace/snapshots';

/**
 * /api/v1/workspace, served by a workspace hub only (ADR-0065;
 * docs/workspace-hub-plan.md §4, §5 and §9), under the `armature/workspace`
 * capability; a remote hub answers 400 `workspace_only`.
 *
 *   GET  /                    the workspaces this hub holds, their records
 *   POST /                    { name, from? } creates <handle>_<name> on the remote
 *                             from `from` (`main` by default) and clones it;
 *                             { existing } clones a branch the remote already
 *                             has. Mirrors the remote's main first. 201 with the
 *                             record, and a `warning` when the remote says the
 *                             owner may not write the branch (ADR-0068 decision 9)
 *   GET  /:name/status        the record, the local head, the local commits
 *                             since the clone and how many are pushed, the
 *                             snapshots held and declined (plan §8), and the
 *                             remote branch's head when the remote can be reached
 *   POST /:name/push          { overrides? } replays the unpushed local commits on
 *                             the remote (../workspace/push.ts); the owner's
 *                             action, gated by their personal requirements
 *                             (409 checks_pending, 422 checks_failed)
 *   POST /:name/bring-in      { message? } the remote's merge of main into the
 *                             workspace, read back as one local commit
 *                             (../workspace/bringIn.ts); 409 unpushed_commits
 *   POST /:name/deliver       { message, deleteWorkspace?, overrides?, dryRun? }
 *                             the remote's merge of the workspace into main,
 *                             after main was brought in cleanly (409
 *                             bring_in_first); the remote's required checks
 *                             gate it there, and a dry run returns their verdicts
 *   DELETE /:name             removes the workspace here with nothing left to
 *                             push, and its branch on the remote when the
 *                             remote's rule allows (since 2026-11-07);
 *                             ?discard=<n> gives up n unpushed local commits
 *                             instead, on this machine alone, the workspace's
 *                             files set aside first (409 discard_mismatch when
 *                             n is not what is there; since 2026-11-12)
 *
 * Every route but the reads carries the hub's per-launch secret as
 * `Armature-Local-Token` (../localToken.ts; since 2026-11-03). Push, bring in
 * and deliver are the desktop program's own actions rather than routes a tool
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

/** What a workspace's creation says when the remote would refuse the owner's push (ADR-0068 decision 9). */
export interface WorkspaceWarning {
  code: 'forbidden';
  message: string;
  /** The `User` ids holding `Owner` or `Maintainer` of the branch on the remote, who could grant. */
  holders: string[];
}

/**
 * Whether the owner may write the branch on the remote, read before the work
 * rather than after: the owner's grants (`GET /users/me`) and the branch's
 * (`Grant` on `main` filtered by `branch`), judged by the remote's own rule.
 * A warning, not a refusal: the workspace is made either way.
 */
async function writeWarning(hub: HubConfig, remote: ArmatureClient, me: UserDocument & { grants?: Grant[] }, branch: string): Promise<WorkspaceWarning | undefined> {
  const theirs = (await fromRemote(hub, () => remote.documents.list('Grant', { filter: { branch } }))).data as unknown as GrantDocument[];
  const inForce = [...((me.grants ?? []) as GrantDocument[]), ...theirs.filter((grant) => isActive(grant))];
  const why = refusal({ id: me['@id'], user: me }, { permission: 'write', branch }, inForce);
  if (why === undefined) return undefined;
  const holders = [...new Set(theirs.filter((grant) => isActive(grant) && (grant.role === 'Owner' || grant.role === 'Maintainer')).map((grant) => grant.user))];
  return {
    code: 'forbidden',
    message: `${me.externalId} may not: ${why} on the remote. The workspace is made and can be read and worked in; its push will be refused until a grant is made (ADR-0068 decision 9)`,
    holders,
  };
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
const RESERVED_FILES = new Set(['lock', 'store.json', PERSONAL_CHECKS]);

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

workspace.post('/', async (c) => {
  const body = await readJson(c);
  const { name, from, existing } = body;
  if ((name === undefined) === (existing === undefined)) {
    throw new ApiError(400, 'bad_request', 'Send either name (and optionally from) for a new workspace, or existing to clone a branch the remote has');
  }
  if (existing !== undefined && from !== undefined) {
    throw new ApiError(400, 'bad_request', 'from applies to a new workspace; an existing branch is cloned as it is');
  }
  for (const [key, value] of Object.entries({ name, from, existing })) {
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
  if (typeof existing === 'string') await checkBranch(existing);
  else if (!WORKSPACE_NAME.test(name as string)) {
    throw new ApiError(400, 'bad_name', `The workspace's name, ${name as string}, must match ${WORKSPACE_NAME.source}`);
  }

  // The remote is the registry: the owner is whoever it resolves the caller to,
  // and under a token that must be the person this request names (remote.ts).
  await requireRemoteIdentity(hub, { externalId });
  const remote = remoteClient(hub, externalId);
  const me = await fromRemote(hub, () => remote.users.me());
  const owner: Owner = { id: me.data['@id'], externalId };
  const branch = typeof existing === 'string' ? existing : `${handleFor({ externalId, email: me.data.email })}_${name as string}`;
  if (typeof existing !== 'string') await checkBranch(branch);

  await mirrorMain(hub, remote, owner);
  const start = typeof from === 'string' ? from : 'main';
  // From here in the branch's write queue (ADR-0025 decision 7, note of 2026-11-11): a second request for
  // the same workspace waits, then finds the record, rather than replacing a clone half made; a tool's
  // write to the branch waits for the clone to finish. The mirror's queue was taken and left above.
  const made = await storeFor(c, { branch }).exclusive(async () => {
    await checkBranch(branch);
    if (typeof name === 'string') await fromRemote(hub, () => remote.branches.create(branch, { branch: start }));
    // A branch this hub just created is the owner's (ADR-0068 decision 3); an existing one may not be.
    const warning = typeof existing === 'string' ? await writeWarning(hub, remote, me.data as UserDocument & { grants?: Grant[] }, branch) : undefined;
    const { base, local, documents } = await cloneBranch(hub, remote, owner, branch);
    // The remote's profile, kept so this hub's GET /discover can name the instance offline (docs/desktop-program-plan.md §8).
    const instance = profileOf((await fromRemote(hub, () => remote.discover())).data.instance);

    const record: WorkspaceRecord = {
      branch,
      remote: hub.remote ?? '',
      owner: owner.id,
      ownerExternalId: externalId,
      ...(typeof name === 'string' ? { from: start } : {}),
      base,
      local,
      clonedAt: new Date().toISOString(),
      ...(instance ? { instance } : {}),
    };
    await records.put(record);
    // What the clone holds beyond the base (plan §8, §16 question 3): the
    // remote's log back to the branch's beginning, and the state at each older
    // commit a cloned record names. After the record, so an interruption here
    // leaves a workspace whose next bring-in completes them.
    await records.putLog(branch, await fetchRemoteLog(hub, remote, branch, base));
    const snapshots = await ensureSnapshots(hub, records, record, remote, documents, resolvableCommitsOf(record, []));
    return { ...record, snapshots: snapshots.commits, ...(warning ? { warning } : {}) };
  });
  return c.json(made, 201);
});

async function recordOf(c: Context, name: string): Promise<WorkspaceRecord> {
  const record = await recordsOf(c).get(name);
  if (!record) throw new ApiError(404, 'not_found', `This hub holds no workspace ${name}`);
  return record;
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

  let remote: { head: string; moved: boolean } | { reachable: false; reason?: 'signed_out' | 'issuer_unreachable' | 'other_remote' };
  try {
    // A workspace cloned from another remote than this hub's has no remote to ask here (requireItsRemote).
    if (record.remote !== (hub.remote ?? '')) throw new ApiError(409, 'other_remote', `${record.branch} was cloned from ${record.remote}`);
    const summary = await fromRemote(hub, () => remoteClient(hub, record.ownerExternalId).branches.head(record.branch));
    // The body's head, not the ETag: a proxy in front of the remote can alter the ETag (remoteCommit in workspace/remote.ts), the body it cannot.
    const remoteHead = summary.data.head.commit;
    remote = { head: remoteHead, moved: remoteHead !== lastKnown };
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
async function ownedWorkspace(c: Context, action: 'push' | 'bring-in' | 'deliver' | 'remove'): Promise<WorkspaceRecord> {
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
  const record = await ownedWorkspace(c, 'push');
  requireItsRemote(hubOf(c), record, 'push');
  // `overrides` sets the owner's personal requirements aside for this push, each with a reason (ADR-0070 decision 8).
  const overrides = parseOverrides((await optionalJson(c)).overrides);
  return c.json(await pushWorkspace(hubOf(c), recordsOf(c), record, { runs: runsOf(c), overrides }));
});

workspace.post('/:name/bring-in', async (c) => {
  requireActionRoutes(c, 'bring-in');
  const record = await ownedWorkspace(c, 'bring-in');
  requireItsRemote(hubOf(c), record, 'update');
  // The body is optional: a bare POST brings main in with the default message.
  const body = await optionalJson(c);
  if (body.message !== undefined && typeof body.message !== 'string') throw new ApiError(400, 'bad_request', 'message must be a string');
  return c.json(await bringIn(hubOf(c), recordsOf(c), record, body.message as string | undefined));
});

workspace.post('/:name/deliver', async (c) => {
  requireActionRoutes(c, 'deliver');
  const record = await ownedWorkspace(c, 'deliver');
  requireItsRemote(hubOf(c), record, 'merge');
  const body = await readJson(c);
  if (typeof body.message !== 'string' || !body.message.trim()) throw new ApiError(400, 'message_required', 'A delivery needs a message saying why (ADR-0025)');
  if (body.deleteWorkspace !== undefined && typeof body.deleteWorkspace !== 'boolean') throw new ApiError(400, 'bad_request', 'deleteWorkspace must be a boolean');
  if (body.dryRun !== undefined && typeof body.dryRun !== 'boolean') throw new ApiError(400, 'bad_request', 'dryRun must be a boolean');
  // The remote's gate is the remote's to judge: the overrides are checked for shape here and passed on.
  const overrides = [...parseOverrides(body.overrides)].map(([check, reason]) => ({ check, reason }));
  return c.json(
    await deliver(hubOf(c), recordsOf(c), record, { message: body.message.trim(), deleteWorkspace: body.deleteWorkspace === true, overrides, dryRun: body.dryRun === true })
  );
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
