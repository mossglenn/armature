import { Hono, type Context } from 'hono';
import { hubOf, storeFor } from '../config';
import { ApiError } from '../errors';
import { BRANCH_NAME, readJson } from '../http';
import { requireClaims } from '../identity';
import { cloneBranch, mirrorMain, type Owner } from '../workspace/clone';
import type { WorkspaceRecord, WorkspaceRecords } from '../workspace/records';
import { fromRemote, remoteClient } from '../workspace/remote';

/**
 * /api/v1/workspace, served by a workspace hub only (ADR-0065;
 * docs/workspace-hub-plan.md §4 and §9), under the `armature/workspace`
 * capability; a remote hub answers 400 `workspace_only`.
 *
 *   GET  /                    the workspaces this hub holds, their records
 *   POST /                    { name, from? } creates <handle>_<name> on the remote
 *                             from `from` (`main` by default) and clones it;
 *                             { existing } clones a branch the remote already
 *                             has. Mirrors the remote's main first. 201 with the
 *                             record
 *   GET  /:name/status        the record, the local head, the local commits
 *                             since the clone, and the remote branch's head
 *                             when the remote can be reached
 *
 * Push, bring in and deliver come at the plan's steps 3 and 4, as the desktop
 * program's own actions rather than routes a tool may call (ADR-0065
 * decision 7, note of 2026-10-30).
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
 * The short handle a workspace's branch name begins with: the external
 * identifier's local part, in the characters a branch name allows. A naming
 * convention, not ownership, which is a grant on the remote (ADR-0068).
 */
export function handleOf(externalId: string): string {
  const local = externalId.split('@')[0].replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return local || 'user';
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
  return c.json(record, 201);
});

workspace.get('/:name/status', async (c) => {
  const { name } = c.req.param();
  const hub = hubOf(c);
  const record = await recordsOf(c).get(name);
  if (!record) throw new ApiError(404, 'not_found', `This hub holds no workspace ${name}`);

  // The local commits since the clone, newest first back to the clone's own.
  const store = storeFor(c, { branch: record.branch });
  const head = await store.head();
  let localCommits = 0;
  for (let start = 0; ; start += 100) {
    const page = await store.log({ start, count: 100 });
    const at = page.findIndex((commit) => commit.id === record.local);
    if (at >= 0) {
      localCommits += at;
      break;
    }
    localCommits += page.length;
    if (page.length < 100) throw new Error(`The local branch ${record.branch} no longer holds its clone commit ${record.local}`);
  }

  let remote: { head: string; moved: boolean } | { reachable: false };
  try {
    const summary = await fromRemote(hub, () => remoteClient(hub, record.ownerExternalId).branches.head(record.branch));
    const remoteHead = summary.commit ?? summary.data.head.commit;
    remote = { head: remoteHead, moved: remoteHead !== record.base };
  } catch (err) {
    if (err instanceof ApiError && err.code === 'remote_unreachable') remote = { reachable: false };
    else throw err;
  }
  return c.json({ workspace: record, head: head?.id, localCommits, remote });
});
