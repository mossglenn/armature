import { Hono, type Context } from 'hono';
import { requirePermission } from '../authorization';
import { blocks, parseOverrides, type CheckVerdict } from '../checks';
import { storeFor } from '../config';
import { ApiError } from '../errors';
import { BRANCH_NAME, readEnvelope, setEtag } from '../http';
import { principalOf, registry, resolveUser, type ResolvedUser } from '../identity';
import { isRecord, isUnknownRef, StoreError, type Store } from '../store';
import { MERGE_REQUEST_TRAILER, trailerValue } from '../trailers';
import { activeWorkspace, decided, mergeRequestsAt, mintId, writeRecords, type MergeRequestDocument } from '../workspaces';
import { mergeBranches } from './branches';

/**
 * /api/v1/merge-requests, on a remote hub, under the capability
 * `armature/merge-requests` (architecture decision record ADR-0072 decisions
 * 5 and 6): the record that someone asked for one branch to be merged into
 * another, and of who decided.
 *
 *   POST /                { source, target, message }  opens one; 201. Whoever
 *                         may write the source; for a workspace, its owner
 *   GET  /?target=&source=&status=   lists them; any resolved identity
 *   GET  /:id             the record and, while it is Open, its health: what a
 *                         merge would meet at both heads as they are now
 *   POST /:id/merge       { overrides? }  merges it: the merge route's work,
 *                         gated as any merge (ADR-0070 decision 6). Whoever
 *                         may merge into the target
 *   POST /:id/close       closes it unmerged. Its opener, its source's owner,
 *                         or whoever may merge into its target
 *
 * Every merge from a workspace, and every merge into `main`, is made here;
 * the merge route refuses either made directly (409 `request_required`).
 * Whoever may merge into the target may open and merge at once, and the
 * request is still the record. No review is asked before a merge: a required
 * check can add one (decision 5).
 *
 * **Health is a read** (ADR-0056). Nothing of it is stored: the merge route's
 * dry run is run at the two heads and reports `conflicts` and `violations`,
 * the merge gate reports `checks`, and `mergeable` is true when all three are
 * clear and there is something to merge. A client learns when to look again
 * from the event feed, which reports commits on the source, on the target, and
 * on `main`, where a request's own changes are commits. The hub notifies no
 * one.
 *
 * A request is `MergeRequest` on `main`, written only here, each change one
 * marked commit by the caller. The merge commit carries
 * `Armature-Merge-Request: <id>` (../trailers.ts), and the record becomes
 * `Merged` with that commit in the commit on `main` that follows it. Should
 * the hub stop between the two, the request is still `Open` over a merge
 * that happened: merging it again finds the commit by its trailer and
 * records it, and makes no second merge.
 */
export const mergeRequests = new Hono();

const localId = (id: string): string => (id.startsWith('MergeRequest/') ? id.slice('MergeRequest/'.length) : id);

async function requestOf(main: Store, id: string): Promise<MergeRequestDocument> {
  try {
    const { document } = await main.getDocument(`MergeRequest/${localId(id)}`);
    if (document['@type'] === 'MergeRequest') return document as MergeRequestDocument;
  } catch (err) {
    if (!(err instanceof StoreError && err.kind === 'not_found')) throw err;
  }
  throw new ApiError(404, 'not_found', `No merge request ${id}`);
}

/** A branch name from a body, as a merge names one. */
function branchName(value: unknown, field: string): string {
  if (typeof value !== 'string' || !BRANCH_NAME.test(value)) throw new ApiError(400, 'bad_request', `${field} must name a branch`);
  return value;
}

mergeRequests.post('/', async (c) => {
  // The message is the merge commit's, so it is held to what any write's is: present, and without the hub's own trailers.
  const envelope = await readEnvelope(c);
  for (const key of Object.keys(envelope)) {
    if (!['source', 'target', 'message'].includes(key)) throw new ApiError(400, 'bad_request', `A merge request takes source, target and message; ${key} is none of them`);
  }
  const source = branchName(envelope.source, 'source');
  const target = branchName(envelope.target, 'target');
  if (source === target) throw new ApiError(400, 'bad_request', 'A request merges one branch into another');
  const who = await resolveUser(c);
  const main = registry(c);
  const names = await main.listBranches();
  for (const name of [source, target]) if (!names.includes(name)) throw new ApiError(404, 'unknown_ref', `No branch ${name}`);
  const workspace = await activeWorkspace(main, source);
  await requirePermission(c, who, { permission: 'open_request', branch: source, ...(workspace ? { owner: workspace.owner } : {}) });
  if (await activeWorkspace(main, target)) {
    throw new ApiError(409, 'target_is_workspace', `${target} is a workspace, which takes nothing but its own push; a request's target is a branch (ADR-0072 decision 5)`, { target });
  }
  // In the source's queue, so two openings of the same pair are told apart: the second finds the first.
  const opened = await storeFor(c, { branch: source }).exclusive(async () => {
    const open = (await mergeRequestsAt(main)).requests.find((r) => r.status === 'Open' && r.source === source && r.target === target);
    if (open) {
      throw new ApiError(409, 'request_open', `${open['@id']} already asks for ${source} to be merged into ${target}; merge or close it, or read it for what a merge would meet`, { request: open['@id'], source, target });
    }
    const request = {
      '@id': mintId('MergeRequest'),
      '@type': 'MergeRequest',
      source,
      target,
      openedBy: principalOf(who).id,
      message: envelope.message,
      status: 'Open',
    } as MergeRequestDocument;
    const { commit } = await writeRecords(main, who, [request], `Merge request opened by ${who.user.externalId}: ${source} into ${target}`);
    return { request, commit };
  });
  setEtag(c, opened.commit);
  return c.json(opened.request, 201);
});

mergeRequests.get('/', async (c) => {
  await resolveUser(c);
  const { source, target, status, ...other } = c.req.query();
  const unknown = Object.keys(other)[0];
  if (unknown) throw new ApiError(400, 'bad_query', `Merge requests are listed by source, target and status; ${unknown} is none of them`);
  if (status !== undefined && !['Open', 'Merged', 'Closed'].includes(status)) throw new ApiError(400, 'bad_query', 'status is Open, Merged or Closed');
  const { requests, commit } = await mergeRequestsAt(registry(c));
  setEtag(c, commit);
  return c.json(requests.filter((r) => (source === undefined || r.source === source) && (target === undefined || r.target === target) && (status === undefined || r.status === status)));
});

/** What a merge of an Open request would meet, at both heads as they are now. */
export interface RequestHealth {
  /** True when there is something to merge and nothing stands in its way. */
  mergeable: boolean;
  /** The target already holds the source's head: nothing to merge. */
  upToDate: boolean;
  /** A branch the request names is gone; nothing else is then known. */
  missing?: 'source' | 'target';
  base?: string;
  source?: string;
  target?: string;
  conflicts: unknown[];
  violations: unknown[];
  /** The merge gate's verdicts, when required checks apply (ADR-0070 decision 6). */
  checks: CheckVerdict[];
  /** The target has commits the source lacks and required checks apply: the source updates from the target first. */
  bringInFirst: boolean;
}

async function healthOf(c: Context, who: ResolvedUser, request: MergeRequestDocument): Promise<RequestHealth> {
  const none = { mergeable: false, upToDate: false, conflicts: [], violations: [], checks: [], bringInFirst: false };
  const names = await registry(c).listBranches();
  if (!names.includes(request.source)) return { ...none, missing: 'source' };
  if (!names.includes(request.target)) return { ...none, missing: 'target' };
  let found: Awaited<ReturnType<typeof mergeBranches>>['body'];
  try {
    ({ body: found } = await mergeBranches(c, who, { target: request.target, source: request.source, message: request.message, dryRun: true, overrides: new Map() }));
  } catch (err) {
    // A branch deleted between the list and the read.
    if (isUnknownRef(err)) return { ...none, missing: 'source' };
    throw err;
  }
  const conflicts = (found.conflicts as unknown[] | undefined) ?? [];
  const violations = (found.violations as unknown[] | undefined) ?? [];
  const checks = (found.checks as CheckVerdict[] | undefined) ?? [];
  const bringInFirst = found.bringInFirst === true;
  return {
    mergeable: !found.upToDate && !conflicts.length && !violations.length && !bringInFirst && !checks.some(blocks),
    upToDate: found.upToDate,
    base: found.base,
    source: found.source,
    target: found.target,
    conflicts,
    violations,
    checks,
    bringInFirst,
  };
}

mergeRequests.get('/:id', async (c) => {
  const who = await resolveUser(c);
  const request = await requestOf(registry(c), c.req.param('id'));
  return c.json({ request, ...(request.status === 'Open' ? { health: await healthOf(c, who, request) } : {}) });
});

/** How far back a target's log is read for the merge commit of a request found merged and still Open. */
const TRAILER_SEARCH = 100;

/** A body that may be absent: a bare POST is `{}`. */
async function optionalBody(c: Context): Promise<Record<string, unknown>> {
  const raw = (await c.req.text()).trim();
  if (!raw) return {};
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    body = undefined;
  }
  if (!isRecord(body)) throw new ApiError(400, 'bad_request', 'The body, when there is one, must be a JSON object');
  return body;
}

const requireOpen = (request: MergeRequestDocument): void => {
  if (request.status !== 'Open') {
    throw new ApiError(409, 'request_decided', `${request['@id']} is ${request.status}; a decided request is not decided again. Open a new one`, {
      request: request['@id'],
      status: request.status,
      ...(request.mergeCommit ? { mergeCommit: request.mergeCommit } : {}),
    });
  }
};

mergeRequests.post('/:id/merge', async (c) => {
  const body = await optionalBody(c);
  const overrides = parseOverrides(body.overrides);
  const who = await resolveUser(c);
  const main = registry(c);
  const request = await requestOf(main, c.req.param('id'));
  await requirePermission(c, who, { permission: 'merge', branch: request.target });
  requireOpen(request);
  const names = await main.listBranches();
  for (const name of [request.source, request.target]) {
    if (!names.includes(name)) throw new ApiError(409, 'branch_gone', `Branch ${name}, which ${request['@id']} names, no longer exists; close the request`, { request: request['@id'], branch: name });
  }
  const { etag, body: merged } = await mergeBranches(c, who, { target: request.target, source: request.source, message: request.message, dryRun: false, overrides, request: request['@id'] });
  let mergeCommit = merged.commit;
  if (merged.upToDate) {
    // Nothing to merge now. Either this request was merged and the hub stopped before it recorded so, which the
    // target's log shows by the trailer, or the target came to hold the source's head some other way.
    const log = await storeFor(c, { branch: request.target }).log({ count: TRAILER_SEARCH });
    mergeCommit = log.find((commit) => trailerValue(commit.message, MERGE_REQUEST_TRAILER) === request['@id'])?.id;
    if (!mergeCommit) {
      throw new ApiError(409, 'nothing_to_merge', `${request.target} already holds everything on ${request.source}, so there is nothing for ${request['@id']} to merge; close it, or push more work to ${request.source}`, {
        request: request['@id'],
        base: merged.base,
        source: merged.source,
        target: merged.target,
      });
    }
  }
  const record = decided(request, who, { status: 'Merged', mergeCommit: mergeCommit as string });
  await writeRecords(main, who, [record], `Merge request merged by ${who.user.externalId}: ${request.source} into ${request.target} at ${mergeCommit}`);
  setEtag(c, etag);
  return c.json({ ...merged, commit: mergeCommit, request: record });
});

mergeRequests.post('/:id/close', async (c) => {
  await optionalBody(c);
  const who = await resolveUser(c);
  const main = registry(c);
  const request = await requestOf(main, c.req.param('id'));
  const workspace = await activeWorkspace(main, request.source);
  await requirePermission(c, who, {
    permission: 'close_request',
    branch: request.target,
    source: request.source,
    openedBy: request.openedBy,
    ...(workspace ? { owner: workspace.owner } : {}),
  });
  requireOpen(request);
  const record = decided(request, who, { status: 'Closed' });
  const { commit } = await writeRecords(main, who, [record], `Merge request closed by ${who.user.externalId}: ${request.source} into ${request.target}, not merged`);
  setEtag(c, commit);
  return c.json({ request: record });
});
