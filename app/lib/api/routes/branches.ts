import { Hono } from 'hono';
import { ApiError } from '../errors';
import { readEnvelope, readJson, requireCommit, setEtag } from '../http';
import { resolveAuthor } from '../identity';
import { createStore, isRecord, StoreError, type Commit, type Ref, type Store, type WitnessField } from '../store';

/**
 * /api/v1/branches (ADR-0025 decisions 4, 5, 6 and 8).
 *
 *   GET  /                      every branch with its head commit
 *   POST /                      { name, from?: { branch } | { commit } }  → 201
 *   GET  /:name                 the head commit
 *   POST /:name/merge           { message, from }  three-way merge; 409 on conflict
 *   GET  /:name/changes?since=  changed document ids since a commit
 *
 * No delete, reset, squash or rebase: shared history is never rewritten
 * (decision 6). Branch delete is reserved for a later phase.
 */
export const branches = new Hono();

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

const toHead = (commit: Commit | undefined) =>
  commit ? { commit: commit.id, author: commit.author, message: commit.message, timestamp: commit.timestamp } : null;

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
 * does not remember which source commit it merged. The hub records it as a
 * git-style trailer on the merge commit's message (ADR-0025 decision 5):
 *
 *     <the caller's reason>
 *
 *     Merge-Source: <commit-id>
 */
const MERGE_SOURCE = 'Merge-Source';

function withMergeTrailer(message: string, sourceCommit: string): string {
  return `${message}\n\n${MERGE_SOURCE}: ${sourceCommit}`;
}

/** The value of one `Key: value` trailer in the block after the last blank line. */
function trailer(message: string, key: string): string | undefined {
  const block = message.split(/\n\s*\n/).pop() ?? '';
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z][A-Za-z-]*):\s*(.+?)\s*$/.exec(line);
    if (match && match[1] === key) return match[2];
  }
  return undefined;
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
 * `Merge-Source` trailer names a source commit (the target merged the source
 * there), or when a source commit's trailer names it (the source merged the
 * target there).
 */
async function mergeBase(target: Store, source: Store): Promise<string | undefined> {
  const sourceLog = await fullLog(source);
  const sourceIds = new Set(sourceLog.map((commit) => commit.id));
  const mergedBySource = new Set(
    sourceLog.map((commit) => trailer(commit.message, MERGE_SOURCE)).filter((id): id is string => !!id)
  );
  for (const commit of await fullLog(target)) {
    if (sourceIds.has(commit.id)) return commit.id;
    const merged = trailer(commit.message, MERGE_SOURCE);
    if (merged && sourceIds.has(merged)) return merged;
    if (mergedBySource.has(commit.id)) return commit.id;
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
  const author = await resolveAuthor(c, target);
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
    message: withMergeTrailer(envelope.message, sourceHead.id),
  });
  if (result.ok) {
    setEtag(c, result.commit);
    return c.json({ commit: result.commit, base, source: sourceHead.id, target: targetHead.id, upToDate: false });
  }

  // The witness carries the base and target values; the source value is read
  // from the source head so the client sees all three sides (decision 5).
  const atSource = target.at({ commit: sourceHead.id });
  const conflicts = await Promise.all(
    result.witnesses.flatMap((witness) =>
      Object.keys(witness)
        .filter((key) => key !== '@id')
        .map(async (field) => {
          const detail = witness[field] as WitnessField;
          let sourceValue: unknown;
          try {
            sourceValue = (await atSource.getDocument(witness['@id'])).document[field];
          } catch {
            sourceValue = undefined;
          }
          return { id: witness['@id'], field, base: detail['@expected'], target: detail['@found'], source: sourceValue };
        })
    )
  );
  throw new ApiError(409, 'merge_conflict', `Merging ${sourceName} into ${targetName} conflicts on ${conflicts.length} field(s)`, {
    base,
    source: sourceHead.id,
    target: targetHead.id,
    conflicts,
  });
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
