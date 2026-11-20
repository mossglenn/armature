import { Hono } from 'hono';
import type { Context } from 'hono';
import { hubOf, storeFor } from '../config';
import { ApiError } from '../errors';
import { BRANCH_NAME, ifMatchFrom, intQuery, readEnvelope, readJson, requireCommit, setEtag } from '../http';
import { activeRequirements, grantOwner, revokeGrantsNaming } from '../grants';
import { blocks, checkTrailers, parseOverrides, requirementsFor, runsOf, verdictsOf, type CheckVerdict } from '../checks';
import { MERGE_REQUEST_TRAILER, withTrailer } from '../trailers';
import { requirePermission } from '../authorization';
import { livesOnMain } from '../classes';
import { commitMessage, registry, REGISTRY_BRANCH, resolveUser, type ResolvedUser } from '../identity';
import { activeWorkspace, closed, newWorkspace, parseLink, requireLink, type WorkspaceDocument } from '../workspaces';
import { isInternalBranch } from '../role';
import { changesOf, idFromIri, isRecord, isUnknownRef, mergeSourceOf, StoreError, type Commit, type ConflictWitness, type Ref, type Store, type WitnessField } from '../store';
import { checkBranch } from '../../operator/check';
import type { Violation } from '../invariants';

/**
 * /api/v1/branches (architecture decision record ADR-0025, decisions 4, 5, 6
 * and 8).
 *
 *   GET  /                      every branch with its head commit
 *   POST /                      { name, from?: { branch } | { commit }, workspace?: { link, linkLabel? } }  → 201; the caller owns it;
 *                               with `workspace`, the branch is a workspace linked to that installation (ADR-0072 decision 2)
 *   GET  /:name                 the head commit
 *   POST /:name/merge           { message, from, dryRun?, overrides? }  three-way merge, checked before it commits; 409 on conflict, 422 on a rule; If-Match pins the target;
 *                               gated by the required checks that apply (409 bring_in_first, 409 checks_pending, 422 checks_failed);
 *                               409 request_required from a workspace or into main, which are merged through a merge request
 *                               (ADR-0072 decision 5; ./mergeRequests.ts); a merge into a workspace carries its link
 *   GET  /:name/changes?since=  changed document ids since a commit
 *   GET  /:name/log?start=&count=  the branch's commits, newest first, paged, read at its head
 *   DELETE /:name               only when another branch holds the head; 409 otherwise
 *
 * No reset, squash or rebase: shared history is never rewritten (decision
 * 6). A branch deletion is the one mutation the store records nowhere, so
 * the hub allows it only when nothing leaves branch-reachable history: the
 * head is in another branch's log or is a merge commit's mergeSource there.
 *
 * Whoever creates a branch owns it (ADR-0068 decision 3): creation writes the
 * caller's `Owner` grant on `main`, as a commit of its own, before the branch
 * exists, and deletion revokes every grant naming the branch before the
 * branch goes, so a failure between the two steps never widens authority
 * (../grants.ts). Both therefore need an identity.
 *
 * A branch created with `workspace` is a workspace (ADR-0072 decisions 1 and
 * 2): its `Workspace` record is written on `main` in the commit that writes
 * the owner's grant, before the branch exists, so a failure between the steps
 * leaves a record for a branch that does not exist, never a workspace's
 * branch without its record. Its parent is the branch it is created from,
 * which is never a workspace (409 `parent_is_workspace`). Deleting a branch
 * closes its record and the open merge requests naming it, in the commit that
 * revokes its grants.
 */
export const branches = new Hono();

const toHead = (commit: Commit | undefined) =>
  commit
    ? {
        commit: commit.id,
        author: commit.author,
        message: commit.message,
        timestamp: commit.timestamp,
        ...(commit.metadata ? { metadata: commit.metadata } : {}),
      }
    : null;

function parseFrom(from: unknown): Ref {
  if (from === undefined) return { branch: 'main' };
  if (isRecord(from)) {
    if (typeof from.branch === 'string' && from.commit === undefined) return { branch: from.branch };
    if (typeof from.commit === 'string' && from.branch === undefined) return { commit: from.commit };
  }
  throw new ApiError(400, 'bad_request', 'from must be { branch } or { commit }');
}

/**
 * The store records one parent per commit, so a merge commit made by `apply`
 * does not remember which source commit it merged. The hub records it in the
 * commit's JSON metadata, which `apply` accepts and the log returns (platform
 * check V), under the same `armature` namespace the schema uses for its own
 * metadata (ADR-0025 decision 5):
 *
 *     { "armature": { "mergeSource": "<commit-id>" } }
 */
function mergeMetadata(sourceCommit: string): Record<string, unknown> {
  return { armature: { mergeSource: sourceCommit } };
}

/**
 * One entry of a 409 merge report: a field both sides changed, with its three
 * values, or a document both sides inserted with different content (check
 * W2d), which has no field.
 */
type MergeConflict =
  | { id: string; field: string; base: unknown; target: unknown; source: unknown }
  | { id: string; op: 'InsertConflict' };

const LOG_PAGE = 100;
const LOG_PAGES = 50;

/**
 * Every commit from a branch's head or a commit back. The walk stops at
 * LOG_PAGES pages; a history longer than that is refused as such, 500
 * `history_too_long`, rather than read as a shorter one, which would make a
 * merge report no common ancestor or a delete find no holder (the deep
 * review's H3).
 */
async function fullLog(store: Store): Promise<Commit[]> {
  const all: Commit[] = [];
  for (let page = 0; page < LOG_PAGES; page++) {
    const commits = await store.log({ start: page * LOG_PAGE, count: LOG_PAGE });
    all.push(...commits);
    if (commits.length < LOG_PAGE) return all;
  }
  throw new ApiError(500, 'history_too_long', `The history is longer than the ${LOG_PAGE * LOG_PAGES} commits the hub walks`);
}

/**
 * True when `commit` is in the history of `start` (a branch head or a
 * commit): on its log, or brought in by a merge, whose commit names the merged
 * source commit in its metadata (`mergeSourceOf`), followed into that commit's
 * own log at its commit path (check AM1), and so on, so a commit that reached
 * the branch through a review round's merge counts. Each merged commit is
 * walked once.
 */
async function inHistory(commit: string, start: Store): Promise<boolean> {
  const seen = new Set<string>();
  const queue: Store[] = [start];
  for (let next = queue.shift(); next; next = queue.shift()) {
    for (const c of await fullLog(next)) {
      if (c.id === commit) return true;
      const merged = mergeSourceOf(c);
      if (merged === commit) return true;
      if (merged && !seen.has(merged)) {
        seen.add(merged);
        queue.push(start.at({ commit: merged }));
      }
    }
  }
  return false;
}

/**
 * The most recent commit both branches have seen, which `apply` needs as an
 * explicit `before_commit` (platform check P1). Walking the target's log
 * newest first, a commit counts when it is in the source's log, when its
 * merge metadata names a source commit (the target merged the source there),
 * or when a source commit's merge metadata names it (the source merged the
 * target there).
 */
export async function mergeBase(target: Store, source: Store): Promise<string | undefined> {
  const sourceLog = await fullLog(source);
  const sourceIds = new Set(sourceLog.map((commit) => commit.id));
  const mergedBySource = new Set(sourceLog.map(mergeSourceOf).filter((id): id is string => !!id));
  for (const commit of await fullLog(target)) {
    if (sourceIds.has(commit.id)) return commit.id;
    const merged = mergeSourceOf(commit);
    if (merged && sourceIds.has(merged)) return merged;
    if (mergedBySource.has(commit.id)) return commit.id;
  }
  return undefined;
}

/**
 * The first of `candidates` whose history holds `head`: the commit is in its
 * log, or one of its commits merged it (decision 6, branch delete). Every
 * commit on the branch being deleted is an ancestor of its head, so a held
 * head means the whole branch stays reachable. A candidate deleted since the
 * branch list was read holds nothing and is skipped.
 */
async function branchHolding(head: string, candidates: string[], store: Store): Promise<string | undefined> {
  for (const name of candidates) {
    const log = await gone(fullLog(store.at({ branch: name })));
    for (const commit of log ?? []) {
      if (commit.id === head || mergeSourceOf(commit) === head) return name;
    }
  }
  return undefined;
}

/**
 * A read of one branch, or undefined when the branch no longer exists. The
 * branch list and each branch's log are separate store calls, so a branch
 * another request deletes in between must not fail a read about the others.
 */
async function gone<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (err) {
    if (isUnknownRef(err)) return undefined;
    throw err;
  }
}


branches.get('/', async (c) => {
  const store = storeFor(c, { branch: 'main' });
  const role = hubOf(c).role;
  // A workspace hub's snapshots of the remote (plan §8) are the clone's own, not branches a tool works on.
  const names = (await store.listBranches()).filter((name) => !isInternalBranch(role, name));
  // A branch deleted after the list was read is left out (see `gone`).
  const list = await Promise.all(
    names.map(async (name) => {
      const read = await gone(store.at({ branch: name }).head().then((head) => ({ head })));
      return read && { name, head: toHead(read.head) };
    })
  );
  return c.json(list.filter((b) => b !== undefined));
});

branches.post('/', async (c) => {
  const body = await readJson(c);
  const name = body.name;
  if (typeof name !== 'string' || !BRANCH_NAME.test(name)) {
    throw new ApiError(400, 'bad_name', 'name must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$');
  }
  const from = parseFrom(body.from);
  const link = body.workspace === undefined ? undefined : parseLink(body.workspace, 'workspace');
  // A workspace has a parent, the branch it takes updates from and sends its work to, so it is created from a branch.
  if (link && !('branch' in from)) throw new ApiError(400, 'bad_request', 'A workspace is created from a branch, its parent, not from a commit (ADR-0072 decision 1)');
  const who = await resolveUser(c);
  await requirePermission(c, who, { permission: 'create', branch: name });
  const store = storeFor(c, { branch: 'main' });
  if ('commit' in from) await requireCommit(store, from.commit);
  // In the new branch's queue, so a second creation of the name finds the first
  // finished: the grant is keyed over the name, and a loser taking its grant
  // back would take the winner's (ADR-0025 decision 7, note of 2026-11-06).
  await store.at({ branch: name }).exclusive(async () => {
    // Both checked before the grant is written, so the usual refusals write
    // nothing on main; the store's own refusals below cover a second hub.
    const names = await store.listBranches();
    if (names.includes(name)) throw new ApiError(409, 'branch_exists', `Branch ${name} already exists`);
    if ('branch' in from && !names.includes(from.branch)) throw new ApiError(404, 'unknown_ref', `No branch ${from.branch}`);
    const alongside = [];
    if (link && 'branch' in from) {
      const parent = await activeWorkspace(store, from.branch);
      if (parent) {
        throw new ApiError(409, 'parent_is_workspace', `${from.branch} is a workspace; a workspace is created from a branch, which is then its parent (ADR-0072 decision 1)`, { parent: from.branch });
      }
      alongside.push(newWorkspace(who, name, from.branch, link));
    }
    // A record left Active for this name by a creation that failed between its steps would make the new branch that workspace: closed here.
    const stale = await activeWorkspace(store, name);
    if (stale) alongside.push(closed(stale));
    await grantOwner(store, who, name, alongside);
    try {
      await store.createBranch(name, from);
    } catch (err) {
      // The grant is taken back, so no one owns a branch they did not make.
      await revokeGrantsNaming(who, name, 'Branch not created', { main: store }).catch(() => undefined);
      if (err instanceof StoreError && err.kind === 'exists') {
        throw new ApiError(409, 'branch_exists', `Branch ${name} already exists`);
      }
      throw err;
    }
  });
  const head = await store.at({ branch: name }).head();
  setEtag(c, head?.id);
  return c.json({ name, from, head: toHead(head), ...(link && 'branch' in from ? { workspace: { parent: from.branch, linked: true } } : {}) }, 201);
});

branches.get('/:name', async (c) => {
  const { name } = c.req.param();
  const head = await storeFor(c, { branch: name }).head();
  if (!head) throw new ApiError(404, 'not_found', `Branch ${name} has no commits`);
  setEtag(c, head.id);
  return c.json({ name, head: toHead(head) });
});

/** The conflicts of a failed apply, each with the source's value read from the source head. */
async function conflictsOf(witnesses: ConflictWitness[], atSource: Store): Promise<MergeConflict[]> {
  // A per-field witness carries the base and target values; the source value
  // is read from the source head so the client sees all three sides (decision
  // 5). An InsertConflict witness means both sides inserted the same id with
  // different content (check W2d, ADR-0032 decision 8); it names the document
  // and no field.
  return Promise.all(
    witnesses.flatMap((witness): Promise<MergeConflict>[] => {
      if (witness['@op'] === 'InsertConflict') {
        return [Promise.resolve({ id: idFromIri(String(witness['@id_already_exists'] ?? '')), op: 'InsertConflict' as const })];
      }
      const id = witness['@id'] ?? '';
      return Object.keys(witness)
        .filter((key) => key !== '@id')
        .map(async (field) => {
          const detail = witness[field] as WitnessField;
          let sourceValue: unknown;
          try {
            sourceValue = (await atSource.getDocument(id)).document[field];
          } catch {
            sourceValue = undefined;
          }
          return { id, field, base: detail['@expected'], target: detail['@found'], source: sourceValue };
        });
    })
  );
}

/**
 * A merge is checked before it commits (decision 5, note of 2026-10-30; the
 * deep review's B3): the source is applied onto a transient branch cut at the
 * target's head, the operator's repair pattern (ADR-0062), the invariants
 * engine runs over the whole result, and only a result that breaks no rule
 * is applied onto the target, so two clean branches can no longer merge into
 * a violation. The transient branch is deleted on every outcome. `apply`
 * ignores a data-version precondition (platform check AK), so the target's
 * head is read again just before the second apply and a branch that moved is
 * 409 `branch_moved`. That read and the apply are in the target's write queue
 * (ADR-0025 decision 7, note of 2026-11-06), so nothing of this hub's lands
 * between them; the check stays outside it, since it takes seconds and a dry
 * run commits nothing, and writers should not wait on either. With `dryRun`,
 * the conflicts and the violations are returned and nothing is committed.
 * `If-Match` pins the target head the caller inspected (the review's H3).
 *
 * **The gate** (ADR-0070 decisions 6 and 7; since 2026-11-15). When
 * `CheckRequirement`s in force apply to the merge (those naming the target,
 * those locked, by `fromPrefix`), then for each `Required` one:
 *
 * 1. the source must hold the target's head, so that the merged state is the
 *    source's head and a verdict on that commit is a verdict on what lands;
 *    409 `bring_in_first` otherwise, before the check is run. Commits on the
 *    target that changed only records kept on `main` alone do not count
 *    (`designMoved`, since 2026-11-20): no branch writes those, and a merge
 *    request's own opening is one;
 * 2. a run by the requirement's reporter under its current `paramsHash` must
 *    exist at the source's head; 409 `checks_pending` otherwise;
 * 3. that run must conclude `pass` or `neutral`; 422 `checks_failed`
 *    otherwise, which is answered before `checks_pending` when both hold,
 *    since waiting will not help.
 *
 * `overrides: [{ check, reason }]` lets whoever may perform the merge take a
 * requirement on themselves, a locked one an administrator. The merge commit
 * records one `Armature-Check` trailer per requirement that applied and one
 * `Armature-Check-Override` per override used, so what a merge relied on
 * outlives the runs. A merge no requirement applies to behaves as before, and
 * its answer carries no `checks`.
 *
 * A merge whose source is `main` is not gated (decided 2026-11-15, Amos;
 * ADR-0070's note of that date): that merge is how a branch brings `main`
 * in, which step 1 asks of every gated merge, and its target's head is never
 * in `main`, so the gate would refuse the one action that satisfies it. What
 * `main` holds passed the gate into `main`.
 */
/** What a merge is asked to do, once the route that takes it has judged the caller. */
export interface MergeOptions {
  target: string;
  source: string;
  /** The merge commit's message, as the caller or the request gave it; the hub adds its trailers. */
  message: string;
  dryRun: boolean;
  overrides: ReadonlyMap<string, string>;
  /** The `MergeRequest` this merge is made through, by id, written on the commit as `Armature-Merge-Request` (ADR-0072 decision 5). */
  request?: string;
}

/** What a merge, or a dry run of one, found; the route's answer. */
export interface MergeOutcome {
  /** The commit the answer is about: the merge commit, or the target's head when nothing was merged. */
  etag: string;
  body: Record<string, unknown> & { base: string; source: string; target: string; upToDate: boolean; commit?: string };
}

/**
 * What a merge of one head into another would meet, kept by the two heads: a
 * request's health is read each time someone looks (ADR-0072 decision 5), and
 * the check behind it makes and deletes a branch and runs every rule over
 * the result, seconds of work that give the same answer while neither head
 * moves. Only a dry run reads it; a merge that commits checks again. The
 * required checks' verdicts are never kept: a run may be posted at any moment.
 */
const DRY_RUNS = new Map<string, { conflicts: MergeConflict[]; violations: Violation[] }>();
const DRY_RUNS_KEPT = 500;

/**
 * The merge itself (the doc comment above the route says what it checks and
 * in what order), for the two routes that merge: `POST /branches/:name/merge`
 * and `POST /merge-requests/:id/merge` (./mergeRequests.ts). The caller has
 * resolved `who` and judged whether they may; this judges only the overrides
 * they name.
 */
export async function mergeBranches(c: Context, who: ResolvedUser, opts: MergeOptions): Promise<MergeOutcome> {
  const { target: targetName, source: sourceName, dryRun, overrides } = opts;
  const target = storeFor(c, { branch: targetName });
  const author = who.id;
  const source = target.at({ branch: sourceName });
  const [targetHead, sourceHead] = await Promise.all([target.head(), source.head()]);
  if (!targetHead) throw new ApiError(404, 'not_found', `Branch ${targetName} has no commits`);
  if (!sourceHead) throw new ApiError(404, 'not_found', `Branch ${sourceName} has no commits`);
  const ifMatch = ifMatchFrom(c);
  if (ifMatch && ifMatch !== targetHead.id) {
    throw new ApiError(412, 'precondition_failed', `Branch ${targetName} has moved since commit ${ifMatch}`, { expected: ifMatch, current: targetHead.id });
  }

  const base = await mergeBase(target, source);
  if (!base) throw new ApiError(409, 'no_common_ancestor', `${sourceName} and ${targetName} share no commit`);
  const sides = { base, source: sourceHead.id, target: targetHead.id };
  if (base === sourceHead.id) {
    return { etag: targetHead.id, body: { commit: targetHead.id, ...sides, upToDate: true, ...(dryRun ? { dryRun: true, conflicts: [], violations: [] } : {}) } };
  }

  // The gate's requirements, read once; a merge from main is how a branch brings main in, and is not gated.
  const required = sourceName === REGISTRY_BRANCH ? [] : requirementsFor((await activeRequirements(registry(c))).requirements, targetName, sourceName);
  for (const [check] of overrides) {
    const named = required.filter((r) => r.check === check && r.level !== 'Advisory');
    if (!named.length) throw new ApiError(400, 'bad_request', `overrides names ${check}, which no required check of this merge is`, { check });
    await requirePermission(c, who, { permission: 'override_check', branch: targetName, check, locked: named.some((r) => r.locked === true) });
  }
  const verdicts = (): CheckVerdict[] => verdictsOf(required, runsOf(c), sourceHead.id, overrides);
  // Step 1: a verdict on the source's head is a verdict on what lands only when the source holds the target's design.
  const gated = required.some((r) => r.level !== 'Advisory' && !overrides.has(String(r.check)));
  const bringInFirst = gated && base !== targetHead.id && (await designMoved(target, base, targetHead.id));
  if (bringInFirst && !dryRun) {
    throw new ApiError(409, 'bring_in_first', `${targetName} has commits ${sourceName} does not hold, and this merge has required checks; merge ${targetName} into ${sourceName}, let the checks run on the result, then merge`, {
      ...sides,
      checks: verdicts(),
    });
  }

  // The check, on a transient branch cut at the target's head.
  let conflicts: MergeConflict[] = [];
  let violations: Violation[] = [];
  // Commit identifiers are the store's own random ones, so the three name one merge in whatever database.
  const dryRunKey = `${base}|${sourceHead.id}|${targetHead.id}`;
  const kept = dryRun ? DRY_RUNS.get(dryRunKey) : undefined;
  if (kept) ({ conflicts, violations } = kept);
  else {
    const transientName = `operator-merge-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
    await target.createBranch(transientName, { commit: targetHead.id });
    try {
      const tried = await target.apply(transientName, { base, source: sourceHead.id, author, message: 'merge check' });
      if (!tried.ok) conflicts = await conflictsOf(tried.witnesses, target.at({ commit: sourceHead.id }));
      else violations = (await checkBranch(target.at({ branch: transientName }))).violations;
    } finally {
      await target.deleteBranch(transientName).catch(() => undefined);
    }
    if (dryRun) {
      if (DRY_RUNS.size >= DRY_RUNS_KEPT) DRY_RUNS.delete(DRY_RUNS.keys().next().value as string);
      DRY_RUNS.set(dryRunKey, { conflicts, violations });
    }
  }
  if (dryRun) {
    return { etag: targetHead.id, body: { ...sides, upToDate: false, dryRun: true, conflicts, violations, ...(required.length ? { checks: verdicts(), bringInFirst } : {}) } };
  }
  if (conflicts.length) {
    throw new ApiError(409, 'merge_conflict', `Merging ${sourceName} into ${targetName} conflicts on ${conflicts.length} field(s)`, { ...sides, conflicts });
  }
  if (violations.length) {
    throw new ApiError(422, 'invariant_violation', `Merging ${sourceName} into ${targetName} would break ${violations.length} rule(s); ${targetName} is unchanged`, {
      ...sides,
      violations,
    });
  }

  // Steps 2 and 3, read as late as may be so that a run posted during the check counts.
  const found = verdicts();
  const stopping = found.filter(blocks);
  if (stopping.some((v) => v.conclusion !== 'pending')) {
    const failed = stopping.filter((v) => v.conclusion !== 'pending').map((v) => v.check);
    throw new ApiError(422, 'checks_failed', `Merging ${sourceName} into ${targetName} needs ${failed.join(', ')} to pass at ${sourceHead.id}; ${targetName} is unchanged`, { ...sides, failed, checks: found });
  }
  if (stopping.length) {
    const pending = stopping.map((v) => v.check);
    throw new ApiError(409, 'checks_pending', `Merging ${sourceName} into ${targetName} waits for ${pending.join(', ')} to report on ${sourceHead.id}`, { ...sides, pending, checks: found });
  }
  // The hub's trailers: what the gate relied on, and the request the merge was made through (ADR-0070 decision 7; ADR-0072 decision 5).
  const trailers = [...checkTrailers(found), ...(opts.request ? [`${MERGE_REQUEST_TRAILER}: ${opts.request}`] : [])];
  const message = trailers.reduce(withTrailer, commitMessage(who, opts.message));

  // The checked result lands only on the head it was checked against (check AK: apply takes no precondition).
  const result = await target.exclusive(async () => {
    const now = await target.head();
    if (now?.id !== targetHead.id) {
      throw new ApiError(409, 'branch_moved', `Branch ${targetName} received commit ${now?.id} during the merge check; retry`, { checked: targetHead.id, current: now?.id });
    }
    return target.apply(targetName, {
      base,
      source: sourceHead.id,
      author,
      message,
      metadata: mergeMetadata(sourceHead.id),
    });
  });
  if (!result.ok) {
    // A second hub or the operator tools landed a commit between the read above and the apply.
    const conflictsNow = await conflictsOf(result.witnesses, target.at({ commit: sourceHead.id }));
    throw new ApiError(409, 'merge_conflict', `Merging ${sourceName} into ${targetName} conflicts on ${conflictsNow.length} field(s)`, { ...sides, conflicts: conflictsNow });
  }
  return { etag: result.commit, body: { commit: result.commit, ...sides, upToDate: false, ...(found.length ? { checks: found } : {}) } };
}

/**
 * Whether the target holds design the source lacks: whether anything changed between `base` and the target's head
 * other than the records kept on `main` alone (`livesOnMain`: grants, requirements, users, workspace records,
 * merge requests). A branch never writes those, so they cannot conflict with it or change what a check judged
 * at its head; and since 2026-11-20 opening a merge request is itself a commit on `main`, so a gate that asked
 * the source to hold `main`'s head would refuse every request into `main` at the moment it was opened
 * (decided in building ADR-0072; ADR-0070's note of 2026-11-20).
 */
async function designMoved(target: Store, base: string, head: string): Promise<boolean> {
  return changesOf(await target.diff(base, head)).some((change) => !livesOnMain(change.id.split('/')[0]));
}

/**
 * Which merges are made through a merge request and never directly (ADR-0072
 * decision 5): every merge from a workspace, so its owner has one way to send
 * work anywhere, and every merge into `main`, from anything, since `main` is
 * the project's official state and a request records who asked and who
 * decided. Two stay direct: between branches other than `main`, for clients
 * that write while connected, and a workspace's update from its parent, a
 * merge into the workspace and its owner's own. A dry run commits nothing and
 * is always answered.
 */
export async function requestRequired(c: Context, source: string, target: string): Promise<{ reason: 'into_main' | 'from_workspace'; workspace?: WorkspaceDocument } | undefined> {
  if (hubOf(c).role !== 'remote') return undefined;
  if (target === REGISTRY_BRANCH) return { reason: 'into_main' };
  const workspace = await activeWorkspace(registry(c), source);
  return workspace ? { reason: 'from_workspace', workspace } : undefined;
}

branches.post('/:name/merge', async (c) => {
  const { name: targetName } = c.req.param();
  const envelope = await readEnvelope(c);
  const sourceName = envelope.from;
  if (typeof sourceName !== 'string' || !sourceName) {
    throw new ApiError(400, 'bad_request', 'from must name the branch to merge');
  }
  if (sourceName === targetName) throw new ApiError(400, 'bad_request', 'A branch cannot be merged into itself');
  const dryRun = envelope.dryRun === true;
  if (envelope.dryRun !== undefined && typeof envelope.dryRun !== 'boolean') throw new ApiError(400, 'bad_request', 'dryRun must be a boolean');
  const overrides = parseOverrides(envelope.overrides);

  const who = await resolveUser(c);
  await requirePermission(c, who, { permission: 'merge', branch: targetName });
  if (!dryRun) {
    const needed = await requestRequired(c, sourceName, targetName);
    if (needed) {
      throw new ApiError(
        409,
        'request_required',
        needed.reason === 'into_main'
          ? `A merge into ${REGISTRY_BRANCH} is made through a merge request, which records who asked and who decided; open one from ${sourceName} (POST /merge-requests), then merge it (ADR-0072 decision 5)`
          : `${sourceName} is a workspace, and a workspace's work leaves it through a merge request; open one into ${targetName} (POST /merge-requests), then merge it (ADR-0072 decision 5)`,
        { source: sourceName, target: targetName, reason: needed.reason }
      );
    }
    // A merge into a workspace is its update from its parent, and a write to its branch: it carries the link (decision 3).
    await requireLink(c, targetName, 'merges into it');
  }
  const { etag, body } = await mergeBranches(c, who, { target: targetName, source: sourceName, message: envelope.message, dryRun, overrides });
  setEtag(c, etag);
  return c.json(body);
});

/**
 * The store's branch DELETE takes no concurrency token, so the check that
 * another branch holds the head and the deletion itself are separate calls.
 * Both run in the branch's write queue (ADR-0025 decision 7, note of
 * 2026-11-06), so a write of this hub's lands before the check or finds the
 * branch gone, and is never told 200 and lost. For a second hub or the
 * operator tools, two things narrow the window: the caller may pin the head it
 * inspected with If-Match (412 when the branch has moved since), and the head
 * is read again immediately before the delete (409 branch_moved). A commit
 * landing between that final read and the store's delete would still be lost;
 * the window is one request wide and the commit stays readable by id (T2).
 * Candidates are searched main first, the usual holder, and the walk stops
 * at the first hit; each log is capped by fullLog.
 */
branches.delete('/:name', async (c) => {
  const { name } = c.req.param();
  if (name === 'main') throw new ApiError(400, 'protected_branch', 'main is never deleted (ADR-0025 decision 6)');
  const who = await resolveUser(c);
  const store = storeFor(c, { branch: 'main' });
  return store.at({ branch: name }).exclusive(async () => {
    const names = await store.listBranches();
    if (!names.includes(name)) throw new ApiError(404, 'unknown_ref', `No branch ${name}`);
    await requirePermission(c, who, { permission: 'delete', branch: name });
    // A linked workspace's branch is deleted from the computer it is linked to; one linked nowhere, by whoever may delete it (../workspaces.ts).
    await requireLink(c, name, 'deletes it', { allowUnlinked: true });
    const target = store.at({ branch: name });
    const head = await target.head();
    const ifMatch = ifMatchFrom(c);
    if (ifMatch && ifMatch !== head?.id) {
      throw new ApiError(412, 'precondition_failed', `Branch ${name} has moved since commit ${ifMatch}`, {
        expected: ifMatch,
        current: head?.id,
      });
    }
    let heldBy: string | undefined;
    if (head) {
      const candidates = ['main', ...names.filter((n) => n !== name && n !== 'main')];
      heldBy = await branchHolding(head.id, candidates, store);
      if (!heldBy) {
        throw new ApiError(
          409,
          'unmerged_branch',
          `Branch ${name} has commits no other branch holds; merge it first, or keep it as the record of that work (ADR-0025 decision 6)`,
          { head: head.id }
        );
      }
      const now = await target.head();
      if (now?.id !== head.id) {
        throw new ApiError(409, 'branch_moved', `Branch ${name} received commit ${now?.id} during the check; retry`, {
          checked: head.id,
          current: now?.id,
        });
      }
    }
    // Grants first, then the branch (ADR-0068 decision 3, note): a failure here
    // leaves a branch nobody owns, which check reports, never one anyone may write.
    await revokeGrantsNaming(who, name, 'Branch deleted', { main: store });
    await store.deleteBranch(name);
    return c.json({ deleted: name, head: head?.id ?? null, heldBy: heldBy ?? null });
  });
});

branches.get('/:name/changes', async (c) => {
  const { name } = c.req.param();
  const since = c.req.query('since');
  if (!since) throw new ApiError(400, 'since_required', 'Pass since=<commit>');
  const store = storeFor(c, { branch: name });
  const [head] = await Promise.all([store.head(), requireCommit(store, since, 'since commit')]);
  if (!head) throw new ApiError(404, 'not_found', `Branch ${name} has no commits`);
  // Changes since a commit the branch never held would be a diff between two
  // unrelated states labeled as its changes (the deep review's H3). Walked
  // from the head read above, so the answer is about that head.
  if (!(await inHistory(since, store.at({ commit: head.id })))) {
    throw new ApiError(400, 'not_an_ancestor', `Commit ${since} is not in the history of branch ${name}`);
  }
  const changes = changesOf(await store.diff(since, head.id));
  setEtag(c, head.id);
  return c.json({ branch: name, from: since, to: head.id, changes });
});

/**
 * The branch's commits, newest first (the workspace hub plan's §12, item 19;
 * ADR-0025 decision 8). The head is resolved first and the log read from its
 * commit path (platform check AM1), so a commit landing mid-read changes
 * nothing and the ETag names the head every entry is under (the deep
 * review's B1). A page is at most one store page. Messages are as stored,
 * trailers included (check AJ): a workspace hub's push recovery reads its own
 * `Armature-Workspace-Commit` trailers here (ADR-0066 decision 2, note).
 */
branches.get('/:name/log', async (c) => {
  const { name } = c.req.param();
  const start = intQuery(c, 'start', 0);
  const count = intQuery(c, 'count', 20);
  if (count > LOG_PAGE) throw new ApiError(400, 'bad_query', `count is at most ${LOG_PAGE}`);
  const store = storeFor(c, { branch: name });
  const head = await store.head();
  if (!head) throw new ApiError(404, 'not_found', `Branch ${name} has no commits`);
  const at = store.at({ commit: head.id });
  setEtag(c, head.id);
  // On a workspace hub a workspace's log continues past the clone with the
  // remote branch's log kept at the clone, from the base back (plan §16
  // question 3), so history offline reaches the branch's beginning.
  const kept = hubOf(c).role === 'workspace' ? await hubOf(c).workspaces?.getLog(name) : undefined;
  if (!kept) {
    const commits = await at.log({ start, count });
    return c.json({ branch: name, head: head.id, start, count, commits: commits.map(toHead) });
  }
  const local: Commit[] = [];
  for (let from = 0; ; from += LOG_PAGE) {
    const page = await at.log({ start: from, count: LOG_PAGE });
    local.push(...page);
    if (page.length < LOG_PAGE) break;
  }
  const all = [...local.map(toHead), ...kept.commits];
  return c.json({ branch: name, head: head.id, start, count, commits: all.slice(start, start + count) });
});
