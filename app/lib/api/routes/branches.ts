import { Hono } from 'hono';
import { ApiError } from '../errors';
import { ifMatchFrom, readEnvelope, readJson, requireCommit, setEtag } from '../http';
import { resolveAuthor } from '../identity';
import {
  createStore,
  idFromIri,
  isRecord,
  StoreError,
  type Commit,
  type Ref,
  type Store,
  type WitnessField,
} from '../store';

/**
 * /api/v1/branches (ADR-0025 decisions 4, 5, 6 and 8).
 *
 *   GET  /                      every branch with its head commit
 *   POST /                      { name, from?: { branch } | { commit } }  → 201
 *   GET  /:name                 the head commit
 *   POST /:name/merge           { message, from }  three-way merge; 409 on conflict
 *   GET  /:name/changes?since=  changed document ids since a commit
 *   DELETE /:name               only when another branch holds the head; 409 otherwise
 *
 * No reset, squash or rebase: shared history is never rewritten (decision
 * 6). A branch deletion is the one mutation the store records nowhere, so
 * the hub allows it only when nothing leaves branch-reachable history: the
 * head is in another branch's log or is a merge commit's mergeSource there.
 */
export const branches = new Hono();

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

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

function mergeSourceOf(commit: Commit): string | undefined {
  const armature = commit.metadata?.armature;
  const value = isRecord(armature) ? armature.mergeSource : undefined;
  return typeof value === 'string' ? value : undefined;
}

async function fullLog(store: Store): Promise<Commit[]> {
  const PAGE = 100;
  const MAX_PAGES = 50;
  const all: Commit[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const commits = await store.log({ start: page * PAGE, count: PAGE });
    all.push(...commits);
    if (commits.length < PAGE) break;
  }
  return all;
}

/**
 * The most recent commit both branches have seen, which `apply` needs as an
 * explicit `before_commit` (platform check P1). Walking the target's log
 * newest first, a commit counts when it is in the source's log, when its
 * merge metadata names a source commit (the target merged the source there),
 * or when a source commit's merge metadata names it (the source merged the
 * target there).
 */
async function mergeBase(target: Store, source: Store): Promise<string | undefined> {
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
 * head means the whole branch stays reachable.
 */
async function branchHolding(head: string, candidates: string[], store: Store): Promise<string | undefined> {
  for (const name of candidates) {
    for (const commit of await fullLog(store.at({ branch: name }))) {
      if (commit.id === head || mergeSourceOf(commit) === head) return name;
    }
  }
  return undefined;
}

type ChangeOp = 'insert' | 'delete' | 'update';

function idOf(value: unknown): string {
  return isRecord(value) && typeof value['@id'] === 'string' ? value['@id'] : '';
}

/** One entry of a branch-level diff → the document id and what happened to it (check R1). */
function changeOf(entry: unknown): { id: string; op: ChangeOp } {
  const e = isRecord(entry) ? entry : {};
  if (e['@op'] === 'Insert') return { id: idOf(e['@insert']), op: 'insert' };
  if (e['@op'] === 'Delete') return { id: idOf(e['@delete']), op: 'delete' };
  return { id: idOf(e), op: 'update' };
}

branches.get('/', async (c) => {
  const store = createStore({ branch: 'main' });
  const names = await store.listBranches();
  const list = await Promise.all(
    names.map(async (name) => ({ name, head: toHead(await store.at({ branch: name }).head()) }))
  );
  return c.json(list);
});

branches.post('/', async (c) => {
  const body = await readJson(c);
  const name = body.name;
  if (typeof name !== 'string' || !NAME.test(name)) {
    throw new ApiError(400, 'bad_name', 'name must match ^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$');
  }
  const from = parseFrom(body.from);
  const store = createStore({ branch: 'main' });
  if ('commit' in from) await requireCommit(store, from.commit);
  try {
    await store.createBranch(name, from);
  } catch (err) {
    if (err instanceof StoreError && /exist/i.test(err.type)) {
      throw new ApiError(409, 'branch_exists', `Branch ${name} already exists`);
    }
    throw err;
  }
  const head = await store.at({ branch: name }).head();
  setEtag(c, head?.id);
  return c.json({ name, from, head: toHead(head) }, 201);
});

branches.get('/:name', async (c) => {
  const { name } = c.req.param();
  const head = await createStore({ branch: name }).head();
  if (!head) throw new ApiError(404, 'not_found', `Branch ${name} has no commits`);
  setEtag(c, head.id);
  return c.json({ name, head: toHead(head) });
});

branches.post('/:name/merge', async (c) => {
  const { name: targetName } = c.req.param();
  const envelope = await readEnvelope(c);
  const sourceName = envelope.from;
  if (typeof sourceName !== 'string' || !sourceName) {
    throw new ApiError(400, 'bad_request', 'from must name the branch to merge');
  }
  if (sourceName === targetName) throw new ApiError(400, 'bad_request', 'A branch cannot be merged into itself');

  const target = createStore({ branch: targetName });
  const author = await resolveAuthor(c);
  const source = target.at({ branch: sourceName });
  const [targetHead, sourceHead] = await Promise.all([target.head(), source.head()]);
  if (!targetHead) throw new ApiError(404, 'not_found', `Branch ${targetName} has no commits`);
  if (!sourceHead) throw new ApiError(404, 'not_found', `Branch ${sourceName} has no commits`);

  const base = await mergeBase(target, source);
  if (!base) throw new ApiError(409, 'no_common_ancestor', `${sourceName} and ${targetName} share no commit`);
  if (base === sourceHead.id) {
    setEtag(c, targetHead.id);
    return c.json({ commit: targetHead.id, base, source: sourceHead.id, target: targetHead.id, upToDate: true });
  }

  const result = await target.apply(targetName, {
    base,
    source: sourceHead.id,
    author,
    message: envelope.message,
    metadata: mergeMetadata(sourceHead.id),
  });
  if (result.ok) {
    setEtag(c, result.commit);
    return c.json({ commit: result.commit, base, source: sourceHead.id, target: targetHead.id, upToDate: false });
  }

  // A per-field witness carries the base and target values; the source value
  // is read from the source head so the client sees all three sides (decision
  // 5). An InsertConflict witness means both sides inserted the same id with
  // different content (check W2d, ADR-0032 decision 8); it names the document
  // and no field.
  const atSource = target.at({ commit: sourceHead.id });
  const conflicts: MergeConflict[] = await Promise.all(
    result.witnesses.flatMap((witness): Promise<MergeConflict>[] => {
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
  throw new ApiError(409, 'merge_conflict', `Merging ${sourceName} into ${targetName} conflicts on ${conflicts.length} field(s)`, {
    base,
    source: sourceHead.id,
    target: targetHead.id,
    conflicts,
  });
});

/**
 * The store's branch DELETE takes no concurrency token, so the check that
 * another branch holds the head and the deletion itself are separate calls.
 * Two things narrow that window: the caller may pin the head it inspected
 * with If-Match (412 when the branch has moved since), and the head is read
 * again immediately before the delete (409 branch_moved). A commit landing
 * between that final read and the store's delete would still be lost; the
 * window is one request wide and the commit stays readable by id (T2).
 * Candidates are searched main first, the usual holder, and the walk stops
 * at the first hit; each log is capped by fullLog.
 */
branches.delete('/:name', async (c) => {
  const { name } = c.req.param();
  if (name === 'main') throw new ApiError(400, 'protected_branch', 'main is never deleted (ADR-0025 decision 6)');
  await resolveAuthor(c);
  const store = createStore({ branch: 'main' });
  const names = await store.listBranches();
  if (!names.includes(name)) throw new ApiError(404, 'unknown_ref', `No branch ${name}`);
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
  await store.deleteBranch(name);
  return c.json({ deleted: name, head: head?.id ?? null, heldBy: heldBy ?? null });
});

branches.get('/:name/changes', async (c) => {
  const { name } = c.req.param();
  const since = c.req.query('since');
  if (!since) throw new ApiError(400, 'since_required', 'Pass since=<commit>');
  const store = createStore({ branch: name });
  const [head] = await Promise.all([store.head(), requireCommit(store, since, 'since commit')]);
  if (!head) throw new ApiError(404, 'not_found', `Branch ${name} has no commits`);
  const entries = await store.diff(since, head.id);
  const changes = (Array.isArray(entries) ? entries : []).map(changeOf).filter((change) => change.id);
  setEtag(c, head.id);
  return c.json({ branch: name, from: since, to: head.id, changes });
});
