import { Hono } from 'hono';
import { CLASS_CATEGORY } from '@/lib/types';
import { ApiError } from '../errors';
import {
  branchFromQuery,
  ifMatchFrom,
  intQuery,
  readEnvelope,
  refFromQuery,
  requireCommit,
  setEtag,
} from '../http';
import { resolveAuthor } from '../identity';
import { createStore, isRecord, StoreError, type TerminusDocument } from '../store';

/**
 * /api/v1/documents (ADR-0025 decisions 3, 7, 8 and 9).
 *
 *   GET /:type/:id?branch=|ref=          one document at a ref; ETag is the commit
 *   PUT /:type/:id?branch=               provisional write (see below); If-Match honoured
 *   GET /:type/:id/history?branch=       the commits that touched it, with diffs
 *   GET /:type/:id/diff?from=&to=        the structural diff between two commits
 *
 * The write is provisional until Phase 3's invariants engine: it checks only
 * that the type is a writable class, that the body's `@id` and `@type` agree
 * with the route, that the id is not held by another type (ADR-0024), and
 * that an author and a reason are present. Writable classes are the artifact
 * and relationship categories: fragments are parts of a document, and
 * infrastructure (`User`, the abstract roots) is not written here. In
 * particular a caller cannot mint the `User` it then names as author; users
 * arrive with `POST /users` and identity resolution in Phase 3 (ADR-0032).
 */
export const documents = new Hono();

const isKnownType = (type: string): boolean => Object.prototype.hasOwnProperty.call(CLASS_CATEGORY, type);
const isWritable = (type: string): boolean => {
  const category = (CLASS_CATEGORY as Record<string, string>)[type];
  return category === 'artifact' || category === 'relationship';
};

documents.get('/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  if (!isKnownType(type)) throw new ApiError(404, 'unknown_type', `No type ${type}`);
  const docId = `${type}/${id}`;
  const ref = refFromQuery(c);
  const store = createStore(ref);
  if ('commit' in ref) await requireCommit(store, ref.commit);
  const { document, commit } = await store.getDocument(docId);
  if (document['@type'] !== type) {
    // The id exists under another type (ADR-0024). For a read, "not found
    // under this type" is the honest answer.
    throw new ApiError(404, 'not_found', `No ${type} with id ${docId}`);
  }
  setEtag(c, commit);
  return c.json(document);
});

documents.put('/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  if (!isWritable(type)) {
    throw new ApiError(400, 'invalid_type', `${type} is not a writable document type`);
  }
  const ref = refFromQuery(c);
  if ('commit' in ref) throw new ApiError(400, 'write_at_commit', 'Writes go to a branch; a commit is read-only');
  const docId = `${type}/${id}`;

  const envelope = await readEnvelope(c);
  const input = envelope.document;
  if (!isRecord(input)) throw new ApiError(400, 'bad_request', 'document must be an object');
  if (input['@id'] !== undefined && input['@id'] !== docId) {
    throw new ApiError(400, 'id_mismatch', `document @id ${String(input['@id'])} does not match ${docId}`);
  }
  if (input['@type'] !== undefined && input['@type'] !== type) {
    throw new ApiError(400, 'type_mismatch', `document @type ${String(input['@type'])} does not match ${type}`);
  }
  const document: TerminusDocument = { ...input, '@id': docId, '@type': type };

  const store = createStore(ref);
  const author = await resolveAuthor(c, store);

  // An id held by another type is a conflict, never a replace (ADR-0024).
  try {
    const existing = await store.getDocument(docId);
    if (existing.document['@type'] !== type) {
      throw new ApiError(409, 'type_conflict', `${docId} already exists as ${existing.document['@type']}`);
    }
  } catch (err) {
    if (!(err instanceof StoreError && err.type === 'api:DocumentNotFound')) throw err;
  }

  const ifMatch = ifMatchFrom(c);
  try {
    const { commit } = await store.putDocument(document, { author, message: envelope.message, ifMatch });
    setEtag(c, commit);
    return c.json({ id: docId, commit });
  } catch (err) {
    if (err instanceof StoreError && err.type === 'api:DataVersionMismatch') {
      const head = await store.head();
      throw new ApiError(412, 'precondition_failed', `Branch ${ref.branch} has moved since commit ${ifMatch}`, {
        expected: ifMatch,
        current: head?.id,
      });
    }
    throw err;
  }
});

documents.get('/:type/:id/history', async (c) => {
  const { type, id } = c.req.param();
  if (!isKnownType(type)) throw new ApiError(404, 'unknown_type', `No type ${type}`);
  const branch = branchFromQuery(c);
  const start = intQuery(c, 'start', 0);
  const count = intQuery(c, 'count', 20);
  const diff = c.req.query('diff') !== 'false';
  const docId = `${type}/${id}`;
  const { entries, commit } = await createStore({ branch }).history(docId, { start, count, diff });
  setEtag(c, commit);
  return c.json({
    id: docId,
    branch,
    start,
    count,
    entries: entries.map((e) => ({
      commit: e.id,
      author: e.author,
      message: e.message,
      timestamp: e.timestamp,
      ...(diff ? { diff: e.diff ?? null } : {}),
    })),
  });
});

documents.get('/:type/:id/diff', async (c) => {
  const { type, id } = c.req.param();
  if (!isKnownType(type)) throw new ApiError(404, 'unknown_type', `No type ${type}`);
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) throw new ApiError(400, 'range_required', 'Pass from=<commit> and to=<commit>');
  const docId = `${type}/${id}`;
  const store = createStore({ branch: 'main' });
  await Promise.all([requireCommit(store, from, 'from commit'), requireCommit(store, to, 'to commit')]);
  const diff = await store.diff(from, to, docId);
  return c.json({ id: docId, from, to, diff });
});
