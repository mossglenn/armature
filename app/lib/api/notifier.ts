/**
 * The process-local notifier of the event feed (architecture decision record
 * ADR-0070 decision 2): what wakes a request held open on `GET /events`.
 *
 * Every commit of the API runs inside `Store.exclusive`, the hub's write queue
 * (`queue.test.ts` lists the modules and holds them to it), so both stores
 * call `committed` when a piece of queued work ends, and that one place covers
 * every module that commits. It carries no payload: a woken request reads the
 * branch heads again and derives its events from the store's logs, so a wake
 * with nothing behind it (work that refused, another hub's store in the same
 * process) costs one quiet read and is otherwise harmless. A second hub on the
 * same store and the operator tools are not in this process and wake no one;
 * their commits are served at the next request, at most one wait later.
 *
 * One change is not a commit: the owner's `checks.json` on a workspace hub,
 * which the feed tells as `requirement.changed` with `personal` (since
 * 2026-11-25). The desktop program's core, which writes the file and hosts the
 * hub in the same process, calls `changed` after writing it; a hand edit wakes
 * no one and is told at the next request.
 *
 * `generation` closes the gap between a request's read and its wait: a
 * request notes the generation before it reads, and `nextCommit` returns at
 * once when the generation has moved since.
 */
let generation = 0;
const waiting = new Set<() => void>();

/** The count of wakes so far; read before a read of the heads, passed to `nextCommit` after it. */
export const generationNow = (): number => generation;

/** Wakes every waiting request. Called by the stores when work in the write queue ends. */
export function committed(): void {
  generation++;
  for (const wake of [...waiting]) wake();
}

/** Wakes every waiting request for a change the feed tells that is no commit: the host's write of `checks.json`. */
export const changed = committed;

/**
 * Resolves when something has committed since `since`, when `ms` have passed,
 * or when `signal` aborts (the client went away), whichever is first.
 */
export function nextCommit(since: number, ms: number, signal?: AbortSignal): Promise<void> {
  if (generation !== since || ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiting.delete(done);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    waiting.add(done);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** How many requests are waiting; for the tests. */
export const waitingCount = (): number => waiting.size;
