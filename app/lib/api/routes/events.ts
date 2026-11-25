import { Hono } from 'hono';
import { hubOf, storeFor } from '../config';
import { ApiError } from '../errors';
import { decodeCursor, encodeCursor, EVENT_TYPES, EVENTS_PAGE, EVENTS_WAIT, eventsSince, feedOf, type EventType } from '../events';
import { BRANCH_NAME, intQuery } from '../http';
import { REGISTRY_BRANCH, resolveUser } from '../identity';
import { generationNow, nextCommit } from '../notifier';
import { isInternalBranch } from '../role';

/**
 * /api/v1/events (architecture decision record ADR-0070 decision 2; since
 * 2026-11-15). Both roles serve it: a plugin on a person's machine follows
 * the workspace hub on loopback as it would a remote.
 *
 *   GET /?since=<cursor>&types=&branch=&wait=&limit=
 *       → { events, cursor }
 *
 * Pulled, never pushed: the hub calls nothing outside itself. With no
 * `since` the answer is at once, no events and a cursor at the present; a
 * client keeps the cursor and asks again with it. With one, the answer is what
 * changed since, oldest first, at most `limit` events (100, the most); when
 * nothing has, the request is held open up to `wait` seconds (30, the most and
 * the default; 0 answers at once) and returns as soon as something commits
 * through this hub (../notifier.ts). Every answer carries the cursor to ask
 * with next, also when it carries no event. `types` is a comma-separated list
 * of the event types wanted; `branch` keeps the events of one branch, with
 * `requirement.changed` and `hub.started`, which concern every branch. On a
 * workspace hub a change to the owner's `checks.json` is told too, as
 * `requirement.changed` with `personal` (since 2026-11-25); the host wakes
 * held requests when it writes the file, and a hand edit is told at the next
 * answer.
 *
 * The feed is derived from the store's logs on every request (../events.ts),
 * so it reads at no one commit and carries no ETag. Any identity that may
 * read may read it; it takes no filter on an author (decision 11).
 */
export const events = new Hono();

events.get('/', async (c) => {
  await resolveUser(c);
  const since = c.req.query('since');
  const branch = c.req.query('branch');
  if (branch !== undefined && !BRANCH_NAME.test(branch)) throw new ApiError(400, 'bad_query', 'branch is not a branch name');
  const named = c.req.query('types')?.split(',').map((type) => type.trim()).filter(Boolean);
  const unknown = named?.filter((type) => !(EVENT_TYPES as readonly string[]).includes(type)) ?? [];
  if (unknown.length) throw new ApiError(400, 'bad_query', `types names ${unknown.join(', ')}; the event types are ${EVENT_TYPES.join(', ')}`);
  const wait = intQuery(c, 'wait', EVENTS_WAIT);
  if (wait > EVENTS_WAIT) throw new ApiError(400, 'bad_query', `wait is at most ${EVENTS_WAIT} seconds`);
  const limit = intQuery(c, 'limit', EVENTS_PAGE);
  if (limit < 1 || limit > EVENTS_PAGE) throw new ApiError(400, 'bad_query', `limit is between 1 and ${EVENTS_PAGE}`);

  const store = storeFor(c, { branch: REGISTRY_BRANCH });
  const hub = hubOf(c);
  const role = hub.role;
  const records = role === 'workspace' ? hub.workspaces : undefined;
  const options = {
    hidden: (name: string) => isInternalBranch(role, name),
    ...(named?.length ? { types: new Set(named as EventType[]) } : {}),
    ...(branch !== undefined ? { branch } : {}),
    limit,
    // On a workspace hub, the owner's checks.json, whose changes are told as requirement.changed with personal (since 2026-11-25).
    ...(records ? { personal: () => records.getChecks() } : {}),
  };
  const feed = feedOf(c);
  const signal = c.req.raw.signal;
  const deadline = Date.now() + wait * 1000;
  let cursor = since ? decodeCursor(since) : undefined;
  for (;;) {
    // Noted before the read, so a commit landing during it ends the wait below at once.
    const generation = generationNow();
    const page = await eventsSince(store, feed, cursor, options);
    const left = deadline - Date.now();
    if (!cursor || page.events.length || left <= 0 || signal.aborted) {
      return c.json({ events: page.events, cursor: encodeCursor(page.cursor) });
    }
    // Nothing the caller asked for: the cursor moves past what was filtered out, and the request waits.
    cursor = page.cursor;
    await nextCommit(generation, left, signal);
  }
});
