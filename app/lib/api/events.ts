import { randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import { paramsHash, parsePersonalChecks } from './checks';
import { ApiError } from './errors';
import { CommitMemo } from './memo';
import { changesOf, isRecord, isUnknownRef, mergeSourceOf, type Commit, type Store } from './store';
import { trailerValue, WORKSPACE_COMMIT_TRAILER } from './trailers';

/**
 * The event feed (architecture decision record ADR-0070 decision 2): what
 * changed since a cursor, derived from the store's commit logs.
 *
 * The hub keeps no event log. Every event but `hub.started` is a commit the
 * store already holds, or a branch appearing in or vanishing from its list of
 * branches, so the feed is a reading of the store and survives a restart with
 * nothing to back up or to drift. The cursor is what makes that possible: it
 * holds, for every branch, the commit the client has been told about up to,
 * and a request compares it with the branches as they stand:
 *
 * - a branch whose head moved is read back to the commit the cursor holds for
 *   it, and each commit on the way is a `commit` event, or a `merge` when it
 *   carries the merge route's metadata;
 * - a branch the cursor lacks is `branch.created`, and its own commits are
 *   those back to the first one another branch already accounted for;
 * - a branch the cursor holds and the store lacks is `branch.deleted`;
 * - a commit on `main` that changed a `CheckRequirement` is also
 *   `requirement.changed`, naming the records;
 * - a cursor minted by another life of the hub is answered `hub.started`
 *   first: the check runs, held in memory, are gone, and plugins report again
 *   on the heads they care about (decision 3);
 * - on a workspace hub, a change to the owner's personal requirements
 *   (`checks.json`, decision 8) is `requirement.changed` with `personal`, no
 *   commit and no branch, naming the requirements added, changed or removed as
 *   the push gate names them (`checks.json#<check>`), or `invalid` when the
 *   file can no longer be read as requirements (since 2026-11-25). The file
 *   changes without a commit, so the cursor holds a short hash of each
 *   requirement in it, and a request compares them with the file as it is.
 *   The desktop program's core wakes held requests when it writes the file
 *   (`../desktop/core.ts`); a hand edit is told at the next answer.
 *
 * Within a branch the events follow its log. Across branches they are ordered
 * by the commits' timestamps, which is advisory: the file-backed store stamps
 * to the millisecond (platform check AQ).
 *
 * An event names what a plugin needs to decide whether to act, never the
 * documents: those are read through `/branches/:name/changes`, `/log` and
 * `/export`. The author is the commit's, as the log gives it (open question
 * 4), and the feed takes no filter on one (decision 11).
 *
 * **What the feed does not report** (chosen in the build, 2026-11-15): the
 * commits written to a branch between a client's last request and that
 * branch's deletion, and so nothing at all of a branch made and deleted
 * between two requests. A deleted branch's log is gone (check AQ4); its
 * commits stay held by the branch that merged it, whose `merge` event names
 * the source commit, and a client that knew the branch is told
 * `branch.deleted`. A plugin that follows the feed is woken by each commit and
 * misses none of this; one that was away finds what stands.
 */

export const EVENT_TYPES = ['commit', 'merge', 'branch.created', 'branch.deleted', 'requirement.changed', 'hub.started'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** The most events one answer carries; a client behind by more asks again with the cursor it was given. */
export const EVENTS_PAGE = 100;
/** How long a request is held open when nothing has changed, in seconds. */
export const EVENTS_WAIT = 30;
/** How many commits behind on one branch a cursor may be; past it the cursor is 400 `cursor_too_old` and the client starts again from the heads. */
export const EVENTS_BACKLOG = 1000;

/** The types the `branch` filter applies to; `requirement.changed` and `hub.started` pass it, since they bind every branch. */
const BRANCH_SCOPED: ReadonlySet<EventType> = new Set(['commit', 'merge', 'branch.created', 'branch.deleted']);
const MAIN = 'main';
const LOG_PAGE = 100;

export interface FeedEvent {
  type: EventType;
  /** The branch the event is about; absent on `hub.started` and a `personal` `requirement.changed`, `main` on any other, where the records live. */
  branch?: string;
  /**
   * `commit`, `merge`, `requirement.changed` but a `personal` one: the commit. `branch.created`: the commit the branch started from, absent
   * when it started from nothing. `branch.deleted`: the last commit of the branch this client was told about.
   */
  commit?: string;
  parent?: string;
  /** The commit's author as the log gives it, `User/<id>`. */
  author?: string;
  /** The store's stamp of the commit, seconds; the order across branches, advisory. */
  timestamp?: number;
  /** On a `merge`: the source commit merged. */
  mergeSource?: string;
  /** When the commit is a push's replay: the workspace hub's commit it replays (`Armature-Workspace-Commit`). */
  workspaceCommit?: string;
  /** How many documents the commit changed, by class. Absent on a branch's first commit. */
  changed?: Record<string, number>;
  /**
   * On `requirement.changed`: the ids of the `CheckRequirement`s the commit wrote or deleted; with `personal`, the
   * personal requirements added, changed or removed in `checks.json`, as `checks.json#<check>`.
   */
  requirements?: string[];
  /** On `requirement.changed`: the change is to the owner's personal requirements in `checks.json`, on a workspace hub; no commit. */
  personal?: true;
  /** With `personal`: the file can no longer be read as requirements, so every push is refused until it is put right. */
  invalid?: true;
  /** On `hub.started`: when this life of the hub began, ISO 8601. */
  startedAt?: string;
}

/**
 * One life of a hub, as the feed names it: a cursor minted by another is
 * answered `hub.started`. One per app (`createApp`), as the run store is,
 * since the runs are what a restart loses.
 */
export class EventFeed {
  readonly id = randomUUID().slice(0, 8);
  readonly startedAt = new Date().toISOString();
}

declare module 'hono' {
  interface ContextVariableMap {
    /** This hub's life, for the feed's `hub.started` (`createApp`). */
    feed?: EventFeed;
  }
}

/** The feed of the hub serving this request. */
export function feedOf(c: Context): EventFeed {
  const feed = c.get('feed');
  if (!feed) throw new Error('No event feed on the request; mount the routes through createApp');
  return feed;
}

/**
 * What a client has been told: the hub's life that said it, the newest stamp
 * among the commits it holds, and for each branch the commit told up to (an
 * empty string for a branch told of before its first commit). On a workspace
 * hub also the personal requirements as told: a short hash of each, by what
 * makes it one (its check, workspace and prefix), or `invalid` for a file
 * that could not be read as requirements; absent in a cursor from a hub older
 * than 2026-11-25, which is taken as told up to now. Opaque to clients, who
 * pass back the text they were given.
 */
export interface Cursor {
  v: 1;
  hub: string;
  t: number;
  heads: Record<string, string>;
  personal?: PersonalDigest;
}

/** The personal requirements as a cursor holds them. */
export type PersonalDigest = Record<string, string> | 'invalid';

/**
 * The digest of `checks.json`'s text: each requirement's hash (12 hexadecimal digits of the canonical form's
 * SHA-256, enough to tell one state of a requirement from the next) under the key that makes it one, as the
 * desktop program's editor does (`../desktop/checks.ts`); a key repeated in a file written by hand keeps both
 * states in one hash.
 */
export function personalDigest(text: string | undefined): PersonalDigest {
  let requirements;
  try {
    requirements = parsePersonalChecks(text);
  } catch (err) {
    if (err instanceof ApiError && err.code === 'personal_checks_invalid') return 'invalid';
    throw err;
  }
  const grouped = new Map<string, unknown[]>();
  for (const r of requirements) {
    const key = JSON.stringify([r.check, r.branch ?? null, r.fromPrefix ?? null]);
    grouped.set(key, [...(grouped.get(key) ?? []), r]);
  }
  return Object.fromEntries([...grouped].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, states]) => [key, paramsHash(states).slice(7, 19)]));
}

function sameDigest(a: PersonalDigest, b: PersonalDigest): boolean {
  if (a === 'invalid' || b === 'invalid') return a === b;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** The ids the push gate gives the personal requirements a change touched: `checks.json#<check>`, each once, sorted. */
function personalChanges(before: Record<string, string>, after: Record<string, string>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const checks = new Set<string>();
  for (const key of keys) if (before[key] !== after[key]) checks.add(`checks.json#${(JSON.parse(key) as [string])[0]}`);
  return [...checks].sort();
}

export const encodeCursor = (cursor: Cursor): string => Buffer.from(JSON.stringify(cursor)).toString('base64url');

export function decodeCursor(text: string): Cursor {
  const bad = () => new ApiError(400, 'bad_cursor', 'since is not a cursor this hub gave; ask without it for a cursor at the present');
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!isRecord(value) || value.v !== 1 || typeof value.hub !== 'string' || typeof value.t !== 'number' || !isRecord(value.heads)) throw bad();
  if (!Object.values(value.heads).every((id) => typeof id === 'string')) throw bad();
  const personal = value.personal;
  if (personal !== undefined && personal !== 'invalid' && !(isRecord(personal) && Object.values(personal).every((hash) => typeof hash === 'string'))) throw bad();
  return {
    v: 1,
    hub: value.hub,
    t: value.t,
    heads: { ...(value.heads as Record<string, string>) },
    ...(personal !== undefined ? { personal: personal === 'invalid' ? 'invalid' : { ...(personal as Record<string, string>) } } : {}),
  };
}

/**
 * The transient branches the hub and the operator tools make and delete
 * within one action: a merge's check (`routes/branches.ts`) and a repair
 * (`operator/repair.ts`). They are no one's work and never reach the feed.
 */
export const isTransientBranch = (name: string): boolean => /^operator-(merge-)?[a-z0-9]+-[0-9a-f]{8}$/.test(name);

export interface FeedOptions {
  /** Branches left out besides the transient ones: a workspace hub's snapshots. */
  hidden?: (name: string) => boolean;
  types?: ReadonlySet<EventType>;
  branch?: string;
  limit?: number;
  /** On a workspace hub: reads the text of `checks.json`, undefined when there is none, so that a change to it is told. */
  personal?: () => Promise<string | undefined>;
}

const tooOld = (branch: string) =>
  new ApiError(400, 'cursor_too_old', `The cursor is more than ${EVENTS_BACKLOG} commits behind on ${branch}; ask without since for a cursor at the present, and read what was missed from the logs`, { branch });

/** A read of one branch, or undefined when it was deleted since the list was read. */
async function unlessGone<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (err) {
    if (isUnknownRef(err)) return undefined;
    throw err;
  }
}

/**
 * The commits from `head` back, newest first, up to the first one `stop`
 * accepts, which is returned as `base` and is not among them; no `base` when
 * the log ran out first.
 */
async function back(store: Store, branch: string, head: string, stop: (commit: Commit, walked: number) => boolean | Promise<boolean>): Promise<{ own: Commit[]; base?: Commit }> {
  const at = store.at({ commit: head });
  const own: Commit[] = [];
  for (let start = 0; ; start += LOG_PAGE) {
    const page = await at.log({ start, count: LOG_PAGE });
    for (const commit of page) {
      if (await stop(commit, own.length)) return { own, base: commit };
      if (own.length >= EVENTS_BACKLOG) throw tooOld(branch);
      own.push(commit);
    }
    if (page.length < LOG_PAGE) return { own };
  }
}

/** What a commit changed: the count of documents by class, and the requirements among them. Kept by commit, which never changes. */
interface Changed {
  changed: Record<string, number>;
  requirements: string[];
}
const changes = new CommitMemo<Changed>(2000);

async function changedBy(store: Store, commit: Commit): Promise<Changed | undefined> {
  if (!commit.parent) return undefined;
  const kept = changes.get(commit.id);
  if (kept) return kept;
  // A parent this hub does not hold (a clone's first commit) has no difference to read.
  const diff = await unlessGone(store.diff(commit.parent, commit.id));
  if (diff === undefined) return undefined;
  const result: Changed = { changed: {}, requirements: [] };
  for (const { id } of changesOf(diff)) {
    const type = id.slice(0, id.indexOf('/'));
    result.changed[type] = (result.changed[type] ?? 0) + 1;
    if (type === 'CheckRequirement') result.requirements.push(id);
  }
  result.requirements.sort();
  changes.set(commit.id, result);
  return result;
}

/**
 * The events since `since`, and the cursor after them. With no cursor there
 * are none: the answer is a cursor at the present, from which a client
 * follows. `store` is any store of the hub's database; the branch it is bound
 * to is not read.
 */
export async function eventsSince(store: Store, feed: EventFeed, since: Cursor | undefined, opts: FeedOptions = {}): Promise<{ events: FeedEvent[]; cursor: Cursor }> {
  const limit = opts.limit ?? EVENTS_PAGE;
  const names = (await store.listBranches()).filter((name) => !isTransientBranch(name) && !opts.hidden?.(name)).sort();
  // In the order of the names, so that the same state is the same cursor text.
  const read = await Promise.all(names.map((name) => unlessGone(store.at({ branch: name }).head())));
  const heads = new Map<string, Commit>();
  names.forEach((name, i) => {
    const head = read[i];
    if (head) heads.set(name, head);
  });
  const personal = opts.personal ? personalDigest(await opts.personal()) : undefined;
  const present = (): Cursor => ({
    v: 1,
    hub: feed.id,
    t: Math.max(since?.t ?? 0, ...[...heads.values()].map((head) => head.timestamp)),
    heads: Object.fromEntries([...heads].map(([name, head]) => [name, head.id])),
    ...(personal !== undefined ? { personal } : {}),
  });
  if (!since) return { events: [], cursor: present() };

  const cursor: Cursor = { v: 1, hub: since.hub, t: since.t, heads: { ...since.heads }, ...(personal !== undefined ? { personal } : {}) };
  const events: FeedEvent[] = [];
  const wanted = (type: EventType, branch?: string): boolean =>
    (!opts.types || opts.types.has(type)) && (opts.branch === undefined || !BRANCH_SCOPED.has(type) || branch === opts.branch);
  const emit = (event: FeedEvent) => {
    if (wanted(event.type, event.branch)) events.push(event);
  };

  if (since.hub !== feed.id) {
    emit({ type: 'hub.started', startedAt: feed.startedAt });
    cursor.hub = feed.id;
  }

  // The owner's personal requirements, which change without a commit: told before the commits, since they bind what
  // a plugin runs at every head. A cursor that holds none (an older hub's) takes the file as told.
  const toldPersonal = since.personal;
  if (personal !== undefined && toldPersonal !== undefined && !sameDigest(toldPersonal, personal)) {
    const requirements = personalChanges(toldPersonal === 'invalid' ? {} : toldPersonal, personal === 'invalid' ? {} : personal);
    emit({ type: 'requirement.changed', personal: true, requirements, ...(personal === 'invalid' ? { invalid: true as const } : {}) });
  }

  // The branches the cursor knows, each read back to the commit it holds for them.
  const told = new Set(Object.values(since.heads));
  const seen = new Set<string>();
  const commits: Array<{ branch: string; commit: Commit }> = [];
  const fresh: string[] = [];
  for (const [name, head] of heads) {
    const known = since.heads[name];
    if (known === undefined) {
      fresh.push(name);
      continue;
    }
    if (known === head.id) continue;
    // A branch deleted and made again under its name does not hold the cursor's commit. The log is read to its end
    // looking for it, unless it is long: then the commit's own time says where to stop.
    let floor: number | undefined;
    let remade = false;
    const { own, base } = await back(store, name, head.id, async (commit, walked) => {
      if (commit.id === known) return true;
      if (known === '') return false;
      if (walked === LOG_PAGE) {
        floor = (await store.getCommit(known))?.timestamp;
        if (floor === undefined) return (remade = true);
      }
      if (floor !== undefined && commit.timestamp < floor) return (remade = true);
      return false;
    });
    if (remade || (known !== '' && !base)) {
      emit({ type: 'branch.deleted', branch: name, commit: known });
      delete cursor.heads[name];
      fresh.push(name);
      continue;
    }
    for (const commit of own) seen.add(commit.id);
    commits.push(...own.reverse().map((commit) => ({ branch: name, commit })));
  }

  // The branches it does not: each is told of at once, so that every branch listed is in the next cursor, and its own
  // commits are those back to the first one a known branch accounts for. Such a branch was made after the last
  // request, so a commit of its own is stamped no earlier than anything the cursor holds; on a tie the commit is
  // taken as the branch's own, which on the file-backed store can repeat a commit already told of, never lose one.
  for (const name of fresh.sort()) {
    const head = heads.get(name)!;
    const { own, base } = await back(store, name, head.id, (commit) => seen.has(commit.id) || told.has(commit.id) || commit.timestamp < since.t);
    for (const commit of own) seen.add(commit.id);
    emit({ type: 'branch.created', branch: name, ...(base ? { commit: base.id } : {}) });
    cursor.heads[name] = base?.id ?? '';
    commits.push(...own.reverse().map((commit) => ({ branch: name, commit })));
  }

  // The commits, each branch's in its log's order, across branches by stamp (a stable sort keeps the first).
  commits.sort((a, b) => a.commit.timestamp - b.commit.timestamp);
  const needsDiff = ({ branch, commit }: { branch: string; commit: Commit }): boolean =>
    wanted(mergeSourceOf(commit) ? 'merge' : 'commit', branch) || (branch === MAIN && wanted('requirement.changed'));
  let next = 0;
  for (; next < commits.length && events.length < limit; ) {
    const chunk = commits.slice(next, next + 8);
    const diffs = await Promise.all(chunk.map((entry) => (needsDiff(entry) ? changedBy(store, entry.commit) : undefined)));
    for (let i = 0; i < chunk.length && events.length < limit; i++, next++) {
      const { branch, commit } = chunk[i];
      const merged = mergeSourceOf(commit);
      const workspaceCommit = trailerValue(commit.message, WORKSPACE_COMMIT_TRAILER);
      emit({
        type: merged ? 'merge' : 'commit',
        branch,
        commit: commit.id,
        ...(commit.parent ? { parent: commit.parent } : {}),
        author: commit.author,
        timestamp: commit.timestamp,
        ...(merged ? { mergeSource: merged } : {}),
        ...(workspaceCommit ? { workspaceCommit } : {}),
        ...(diffs[i] ? { changed: diffs[i]!.changed } : {}),
      });
      if (branch === MAIN && diffs[i]?.requirements.length) {
        emit({ type: 'requirement.changed', branch, commit: commit.id, requirements: diffs[i]!.requirements });
      }
      cursor.heads[branch] = commit.id;
      cursor.t = Math.max(cursor.t, commit.timestamp);
    }
  }
  if (next < commits.length) return { events, cursor };

  // Everything told: the branches that are gone, last, after the merges that hold them.
  for (const [name, known] of Object.entries(cursor.heads)) {
    if (!heads.has(name)) emit({ type: 'branch.deleted', branch: name, ...(known ? { commit: known } : {}) });
  }
  return { events, cursor: present() };
}
