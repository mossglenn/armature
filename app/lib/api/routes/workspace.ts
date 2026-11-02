import { Hono, type Context } from 'hono';
import type { ArmatureClient } from '@armature/client';
import type { Grant } from '@armature/types';
import { refusal } from '../authorization';
import { hubOf, storeFor, type HubConfig } from '../config';
import { ApiError } from '../errors';
import { isActive, type GrantDocument } from '../grants';
import { BRANCH_NAME, readJson } from '../http';
import { handleOf, principalOf, requireClaims, resolveUser, type UserDocument } from '../identity';

export { handleOf };
import { cloneBranch, mirrorMain, type Owner } from '../workspace/clone';
import { localCommitsSince, pushWorkspace } from '../workspace/push';
import type { WorkspaceRecord, WorkspaceRecords } from '../workspace/records';
import { fromRemote, remoteClient } from '../workspace/remote';

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
 *                             since the clone and how many are pushed, and the
 *                             remote branch's head when the remote can be reached
 *   POST /:name/push          replays the unpushed local commits on the remote
 *                             (../workspace/push.ts); the owner's action
 *
 * Bring in and deliver come at the plan's step 4. Push, bring in and deliver
 * are the desktop program's own actions rather than routes a tool may call
 * (ADR-0065 decision 7, note of 2026-10-30); until the program exists (plan
 * §14 step 7) the push route is the development entry and the `workspace`
 * compose profile's, on loopback under `header`, where any process already
 * writes as the owner (decided 2026-11-01).
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
  const branch = typeof existing === 'string' ? existing : `${handleOf(externalId)}_${name as string}`;
  if (!BRANCH_NAME.test(branch)) {
    throw new ApiError(400, 'bad_name', `The workspace's branch, ${branch}, must match ${BRANCH_NAME.source}`);
  }
  const records = recordsOf(c);
  if (await records.get(branch)) throw new ApiError(409, 'workspace_exists', `This hub already holds the workspace ${branch}`);

  // The remote is the registry: the owner is whoever it resolves the caller to.
  const remote = remoteClient(hub, externalId);
  const me = await fromRemote(hub, () => remote.users.me());
  const owner: Owner = { id: me.data['@id'], externalId };

  await mirrorMain(hub, remote, owner);
  const start = typeof from === 'string' ? from : 'main';
  if (typeof name === 'string') await fromRemote(hub, () => remote.branches.create(branch, { branch: start }));
  // A branch this hub just created is the owner's (ADR-0068 decision 3); an existing one may not be.
  const warning = typeof existing === 'string' ? await writeWarning(hub, remote, me.data as UserDocument & { grants?: Grant[] }, branch) : undefined;
  const { base, local } = await cloneBranch(hub, remote, owner, branch);

  const record: WorkspaceRecord = {
    branch,
    remote: hub.remote ?? '',
    owner: owner.id,
    ownerExternalId: externalId,
    ...(typeof name === 'string' ? { from: start } : {}),
    base,
    local,
    clonedAt: new Date().toISOString(),
  };
  await records.put(record);
  return c.json({ ...record, ...(warning ? { warning } : {}) }, 201);
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

  let remote: { head: string; moved: boolean } | { reachable: false };
  try {
    const summary = await fromRemote(hub, () => remoteClient(hub, record.ownerExternalId).branches.head(record.branch));
    const remoteHead = summary.commit ?? summary.data.head.commit;
    remote = { head: remoteHead, moved: remoteHead !== lastKnown };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'remote_unreachable') remote = { reachable: false };
    else throw err;
  }
  return c.json({ workspace: record, head: head?.id, localCommits, pushed, unpushed: localCommits - pushed, remote });
});

workspace.post('/:name/push', async (c) => {
  const { name } = c.req.param();
  const record = await recordOf(c, name);
  const who = await resolveUser(c);
  const principal = principalOf(who);
  if (principal.id !== record.owner) {
    throw new ApiError(403, 'forbidden', `${principal.user.externalId} may not push ${name}: this workspace is ${record.ownerExternalId}'s`, {
      permission: 'push',
      branch: record.branch,
      owner: record.ownerExternalId,
    });
  }
  return c.json(await pushWorkspace(hubOf(c), recordsOf(c), record));
});
