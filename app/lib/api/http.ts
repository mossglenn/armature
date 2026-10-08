import type { Context } from 'hono';
import { ApiError } from './errors';
import { isRecord, type Commit, type Ref, type Store } from './store';

/**
 * Request and response conventions shared by the route groups (ADR-0025):
 * refs come from `?branch=` or `?ref=`, concurrency tokens travel in `ETag`
 * and `If-Match` as bare commit ids, and every write body is an envelope
 * with a required `message`.
 */

/** `?branch=` or `?ref=` (a commit id), never both; `main` when neither. */
export function refFromQuery(c: Context): Ref {
  const branch = c.req.query('branch');
  const ref = c.req.query('ref');
  if (branch && ref) throw new ApiError(400, 'ambiguous_ref', 'Pass either branch or ref, not both');
  if (ref) return { commit: ref };
  return { branch: branch || 'main' };
}

/** A caller-supplied commit id that must exist; 404 otherwise. */
export async function requireCommit(store: Store, id: string, what = 'commit'): Promise<Commit> {
  const commit = await store.getCommit(id);
  if (!commit) throw new ApiError(404, 'unknown_ref', `No ${what} ${id}`);
  return commit;
}

/** `?branch=`, `main` when absent. For routes that only make sense on a branch. */
export function branchFromQuery(c: Context): string {
  if (c.req.query('ref')) {
    throw new ApiError(400, 'branch_required', 'This route reads a branch; pass branch=, not ref=');
  }
  return c.req.query('branch') || 'main';
}

/** `If-Match: "<commit>"` as a bare commit id; absent or `*` means unconditional. */
export function ifMatchFrom(c: Context): string | undefined {
  const raw = c.req.header('If-Match')?.trim();
  if (!raw || raw === '*') return undefined;
  const match = /^(?:W\/)?"?([^"\s]+)"?$/.exec(raw);
  if (!match) throw new ApiError(400, 'bad_if_match', 'If-Match must be a quoted commit id');
  return match[1];
}

export function setEtag(c: Context, commit: string | undefined): void {
  if (commit) c.header('ETag', `"${commit}"`);
}

export function intQuery(c: Context, key: string, fallback: number): number {
  const raw = c.req.query(key);
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new ApiError(400, 'bad_query', `${key} must be a non-negative integer`);
  }
  return value;
}

export async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(400, 'bad_request', 'The body must be a JSON object');
  }
  if (!isRecord(body)) throw new ApiError(400, 'bad_request', 'The body must be a JSON object');
  return body;
}

/** A write envelope: `{ message, ...fields }` with a non-empty message (ADR-0025 decision 9). */
export async function readEnvelope(c: Context): Promise<Record<string, unknown> & { message: string }> {
  const body = await readJson(c);
  const message = body.message;
  if (typeof message !== 'string' || !message.trim()) {
    throw new ApiError(400, 'message_required', 'Every write needs a message saying why (ADR-0025)');
  }
  return { ...body, message: message.trim() };
}
