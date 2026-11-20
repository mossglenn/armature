import { Hono } from 'hono';
import { storeFor } from '../config';
import { ApiError } from '../errors';
import { requirePermission } from '../authorization';
import { BRANCH_NAME, readJson, setEtag } from '../http';
import { principalOf, registry, REGISTRY_BRANCH, resolveUser } from '../identity';
import { isRecord } from '../store';
import { activeWorkspace, heldElsewhere, linkedTo, newWorkspace, parseLink, unlinked, workspacesAt, writeRecords, type WorkspaceDocument } from '../workspaces';

/**
 * /api/v1/workspaces, on a remote hub (architecture decision record ADR-0072
 * decisions 2, 4, 6 and 7): the records on `main` that make a branch a
 * workspace, linked to one installation of the desktop app. A workspace is
 * *created* by `POST /branches` with `workspace` (./branches.ts); these routes
 * read the records and move a workspace between computers, in two steps.
 *
 *   GET  /?owner=me|<User id>&linked=true|false&status=Active|Closed
 *                           the records: one person's, or with no `owner`
 *                           everyone's, which an administrator may list;
 *                           `Active` ones unless `status` says otherwise
 *   GET  /:branch           the `Active` record naming the branch; 404 when
 *                           the branch is not a workspace
 *   POST /                  { branch, parent?, link, linkLabel? } records a
 *                           branch that already exists as a workspace linked
 *                           to that installation: the desktop app's record for
 *                           a workspace it held before this (decision 7). The
 *                           caller is the branch's Owner; `parent` is `main`
 *                           when absent. 201, or 200 when that record exists
 *   POST /:branch/link      { link, linkLabel? } links an unlinked workspace
 *                           to that installation; 409 `held_elsewhere` when it
 *                           is linked to another, since linking never takes a
 *                           workspace over. Its owner
 *   POST /:branch/unlink    clears the link, from the linked computer or from
 *                           anywhere: for a computer that is lost, broken or
 *                           out of reach. That computer's commits not yet
 *                           pushed can no longer be pushed (409 `not_linked`).
 *                           Its owner, or an administrator
 *
 * A record is on `main` and readable there like any document, its `link`
 * included: the identifier is no secret, it guards against mistakes
 * (decision 2). The refusals of decision 3 name the label and the time,
 * never the identifier (../workspaces.ts).
 *
 * Each change is one marked commit on `main` by the caller, made in the
 * workspace's own branch queue so two computers linking at once are told
 * apart: the second finds the first's link and is refused.
 */
export const workspaces = new Hono();

const boolOf = (value: string | undefined, name: string): boolean | undefined => {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new ApiError(400, 'bad_query', `${name} is true or false`);
};

workspaces.get('/', async (c) => {
  const who = await resolveUser(c);
  const me = principalOf(who).id;
  const ownerParam = c.req.query('owner');
  const owner = ownerParam === undefined ? undefined : ownerParam === 'me' ? me : ownerParam;
  const linked = boolOf(c.req.query('linked'), 'linked');
  const status = c.req.query('status') ?? 'Active';
  if (status !== 'Active' && status !== 'Closed') throw new ApiError(400, 'bad_query', 'status is Active or Closed');
  await requirePermission(c, who, { permission: 'list_workspaces', ...(owner ? { owner } : {}) });
  const { workspaces: records, commit } = await workspacesAt(registry(c));
  const listed = records
    .filter((record) => record.status === status && (owner === undefined || record.owner === owner) && (linked === undefined || (record.link !== undefined) === linked))
    .sort((a, b) => a.branch.localeCompare(b.branch));
  setEtag(c, commit);
  return c.json(listed);
});

workspaces.get('/:branch', async (c) => {
  const { branch } = c.req.param();
  await resolveUser(c);
  const record = await activeWorkspace(registry(c), branch);
  if (!record) throw new ApiError(404, 'not_found', `${branch} is not a workspace: no Active Workspace record names it`);
  return c.json(record);
});

/** The record a route acts on, read inside the branch's queue; 404 when the branch is not a workspace. */
async function recordOf(main: ReturnType<typeof registry>, branch: string): Promise<WorkspaceDocument> {
  const record = await activeWorkspace(main, branch);
  if (!record) throw new ApiError(404, 'not_found', `${branch} is not a workspace: no Active Workspace record names it`);
  return record;
}

workspaces.post('/', async (c) => {
  const body = await readJson(c);
  const { branch, parent: given, ...rest } = body;
  if (typeof branch !== 'string' || !BRANCH_NAME.test(branch)) throw new ApiError(400, 'bad_name', 'branch must name the branch to record as a workspace');
  if (branch === REGISTRY_BRANCH) throw new ApiError(400, 'bad_request', `${REGISTRY_BRANCH} is never a workspace`);
  if (given !== undefined && (typeof given !== 'string' || !BRANCH_NAME.test(given))) throw new ApiError(400, 'bad_name', 'parent must name a branch');
  const parent = (given as string | undefined) ?? REGISTRY_BRANCH;
  const link = parseLink(rest, 'The body');
  const who = await resolveUser(c);
  await requirePermission(c, who, { permission: 'adopt_workspace', branch });
  const main = registry(c);
  const made = await storeFor(c, { branch }).exclusive(async () => {
    const names = await main.listBranches();
    if (!names.includes(branch)) throw new ApiError(404, 'unknown_ref', `No branch ${branch}`);
    if (!names.includes(parent)) throw new ApiError(404, 'unknown_ref', `No branch ${parent}, named as the parent`);
    const existing = await activeWorkspace(main, branch);
    if (existing) {
      // Asked again by the installation that holds it: the record stands. From anywhere else, the workspace is not taken over.
      if (existing.link === link.link) return { record: existing, created: false };
      if (existing.link !== undefined) throw heldElsewhere(existing, 'writes it');
      throw new ApiError(409, 'workspace_exists', `${branch} is already a workspace, linked to no computer; link it (POST /workspaces/${branch}/link)`, { workspace: branch });
    }
    if (parent === branch || (await activeWorkspace(main, parent))) {
      throw new ApiError(409, 'parent_is_workspace', `${parent} cannot be the parent of ${branch}: a parent is a branch, never a workspace (ADR-0072 decision 1)`, { parent });
    }
    const record = newWorkspace(who, branch, parent, link);
    const { commit } = await writeRecords(main, who, [record], `Workspace record for branch ${branch}, linked by ${who.user.externalId}`);
    return { record, created: true, commit };
  });
  if (made.commit) setEtag(c, made.commit);
  return c.json(made.record, made.created ? 201 : 200);
});

workspaces.post('/:branch/link', async (c) => {
  const { branch } = c.req.param();
  const link = parseLink(await readJson(c), 'The body');
  const who = await resolveUser(c);
  const main = registry(c);
  // Judged on the record as read now; read again in the queue, where another computer's link may have landed first.
  await requirePermission(c, who, { permission: 'link_workspace', workspace: branch, owner: (await recordOf(main, branch)).owner });
  const result = await storeFor(c, { branch }).exclusive(async () => {
    const record = await recordOf(main, branch);
    if (record.owner !== principalOf(who).id) throw new ApiError(403, 'forbidden', `${who.user.externalId} may not: linking the workspace ${branch} needs its owner (ADR-0068 decision 4)`, { permission: 'link_workspace', workspace: branch });
    if (record.link !== undefined) {
      // Linking never takes a workspace over (decision 4): its owner unlinks it first, from there or from elsewhere.
      if (record.link !== link.link) throw heldElsewhere(record, 'writes it');
      if ((record.linkLabel ?? undefined) === link.linkLabel) return { record };
    }
    const next = linkedTo(record, link);
    const { commit } = await writeRecords(main, who, [next], `Workspace ${branch} linked to a computer by ${who.user.externalId}`);
    return { record: next, commit };
  });
  if (result.commit) setEtag(c, result.commit);
  return c.json(result.record);
});

workspaces.post('/:branch/unlink', async (c) => {
  const { branch } = c.req.param();
  // The body is optional and holds nothing the hub reads: the confirmation is the client's.
  const raw = (await c.req.text()).trim();
  if (raw) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      body = undefined;
    }
    if (!isRecord(body)) throw new ApiError(400, 'bad_request', 'The body, when there is one, must be a JSON object');
  }
  const who = await resolveUser(c);
  const main = registry(c);
  await requirePermission(c, who, { permission: 'unlink_workspace', workspace: branch, owner: (await recordOf(main, branch)).owner });
  const result = await storeFor(c, { branch }).exclusive(async () => {
    const record = await recordOf(main, branch);
    if (record.link === undefined) return { record, unlinked: false };
    const next = unlinked(record);
    const { commit } = await writeRecords(main, who, [next], `Workspace ${branch} unlinked from its computer by ${who.user.externalId}`);
    return { record: next, unlinked: true, commit, was: { ...(record.linkLabel ? { linkLabel: record.linkLabel } : {}), ...(record.linkedAt ? { linkedAt: record.linkedAt } : {}) } };
  });
  if (result.commit) setEtag(c, result.commit);
  return c.json({ workspace: result.record, unlinked: result.unlinked, ...(result.was ? { was: result.was } : {}) });
});
