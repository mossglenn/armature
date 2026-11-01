import type { Context } from 'hono';
import { ApiError } from './errors';
import { isRecord, type Commit, type DocumentReader, type Ref, type Store } from './store';

import { refuseReservedTrailers } from './trailers';
/**
 * Request and response conventions shared by the route groups (architecture
 * decision record ADR-0025): refs come from `?branch=` or `?ref=`,
 * concurrency tokens travel in `ETag` (entity tag) and `If-Match` as bare
 * commit ids, and every write body is an envelope with a required `message`.
 */

/** A branch name the hub accepts: no path separator, and never `.` or `..`, so it can also name a folder. */
export const BRANCH_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** `?branch=` or `?ref=` (a commit id), never both; `main` when neither. */
export function refFromQuery(c: Context): Ref {
  const branch = c.req.query('branch');
  const ref = c.req.query('ref');
  if (branch && ref) throw new ApiError(400, 'ambiguous_ref', 'Pass either branch or ref, not both');
  if (ref) return { commit: ref };
  return { branch: branch || 'main' };
}

/** A caller-supplied commit id that must exist; 404 otherwise. */
export async function requireCommit(store: DocumentReader, id: string, what = 'commit'): Promise<Commit> {
  const commit = await store.getCommit(id);
  if (!commit) throw new ApiError(404, 'unknown_ref', `No ${what} ${id}`);
  return commit;
}

/**
 * A read request's ref, resolved once (the deep review's B1): a branch to its
 * head at this moment, a commit checked to exist (404 otherwise). A request
 * that reads more than once reads through `at`, bound to that commit, so a
 * branch that moves while it runs is read as it stood and `commit` is the
 * ETag of every part of the answer. A single read needs none of this: it
 * reports the commit it was served from.
 */
export async function snapshot(store: Store): Promise<{ at: DocumentReader; commit: string | undefined }> {
  if ('commit' in store.ref) {
    await requireCommit(store, store.ref.commit);
    return { at: store, commit: store.ref.commit };
  }
  const head = await store.head();
  return head ? { at: store.at({ commit: head.id }), commit: head.id } : { at: store, commit: undefined };
}

/** `?branch=`, `main` when absent. For routes that only make sense on a branch. */
export function branchFromQuery(c: Context): string {
  if (c.req.query('ref')) {
    throw new ApiError(400, 'branch_required', 'This route reads a branch; pass branch=, not ref=');
  }
  return c.req.query('branch') || 'main';
}

/**
 * `If-Match: "<commit>"` as a bare commit id; absent means no condition. HTTP
 * reads `*` as "the resource exists", which a branch head cannot express, so
 * it is refused rather than taken as no condition (the deep review's HTTP
 * item 1).
 */
export function ifMatchFrom(c: Context): string | undefined {
  const raw = c.req.header('If-Match')?.trim();
  if (!raw) return undefined;
  if (raw === '*') {
    throw new ApiError(400, 'bad_if_match', 'If-Match: * is not supported; send the commit you read, or no If-Match');
  }
  const match = /^(?:W\/)?"?([^"\s]+)"?$/.exec(raw);
  if (!match) throw new ApiError(400, 'bad_if_match', 'If-Match must be a quoted commit id');
  return match[1];
}

export function setEtag(c: Context, commit: string | undefined): void {
  if (commit) c.header('ETag', `"${commit}"`);
}

/**
 * Query values are read in their exact lexical forms (the deep review's HTTP
 * item 2): digits for an integer, an optional sign and fraction for a decimal,
 * `true` or `false` for a boolean. Anything else is 400 `bad_query`, never a
 * coerced `NaN`, `false` or `10` from `1e1`.
 */
const LEXICAL = {
  count: /^\d+$/,
  integer: /^-?\d+$/,
  decimal: /^-?\d+(?:\.\d+)?$/,
};

export function intQuery(c: Context, key: string, fallback: number): number {
  const raw = c.req.query(key);
  if (raw === undefined || raw === '') return fallback;
  if (!LEXICAL.count.test(raw)) throw new ApiError(400, 'bad_query', `${key} must be a non-negative integer`);
  return Number(raw);
}

export function boolQuery(c: Context, key: string, fallback: boolean): boolean {
  const raw = c.req.query(key);
  if (raw === undefined || raw === '') return fallback;
  return booleanValue(key, raw);
}

/** A `?field=` value for a field of this XSD type, in its exact lexical form. */
export function queryValue(key: string, raw: string, xsdType: string): unknown {
  if (xsdType === 'xsd:boolean') return booleanValue(key, raw);
  if (xsdType === 'xsd:integer' || xsdType === 'xsd:decimal') {
    if (!LEXICAL[xsdType === 'xsd:integer' ? 'integer' : 'decimal'].test(raw)) {
      throw new ApiError(400, 'bad_query', `${key} must be ${xsdType === 'xsd:integer' ? 'an integer' : 'a decimal number'}`);
    }
    return Number(raw);
  }
  return raw;
}

function booleanValue(key: string, raw: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new ApiError(400, 'bad_query', `${key} must be true or false`);
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
  refuseReservedTrailers(message);
  return { ...body, message: message.trim() };
}
