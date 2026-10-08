import { Hono, type Context } from 'hono';
import { CLASS_FIELDS, type FieldShape } from '@/lib/types';
import { isKnownType, isWritable } from '../classes';
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
import { resolveUser } from '../identity';
import { createStore, isRecord, type Ref } from '../store';
import { parseDocuments, writeDocuments } from '../write';

/**
 * /api/v1/documents (ADR-0024, ADR-0025 decisions 3, 7, 8 and 9; Phase 3).
 *
 *   GET  /:type?branch=|ref=&<field>=&count=&skip=   list, filtered by field values
 *   GET  /:type/:id?branch=|ref=                      one document at a ref; ETag is the commit
 *   PUT  /:type/:id?branch=                           { message, document }  replace or create
 *   POST /?branch=                                    { message, documents: [...] }  one commit
 *   GET  /:type/:id/history?branch=                   the commits that touched it, with diffs
 *   GET  /:type/:id/diff?from=&to=                    the structural diff between two commits
 *
 * Both writes run the same pipeline (../write.ts): generated Zod shape,
 * 409 on an id held by another type, createdBy from the resolved identity,
 * the invariants engine, one commit, If-Match honoured. A batch may use
 * @capture and { "@ref" } to reference a document it creates, which is how
 * a note attaches to a Hash-keyed junction written in the same request.
 */
export const documents = new Hono();

const fieldsOf = (type: string): Record<string, FieldShape> =>
  (CLASS_FIELDS as Record<string, Record<string, FieldShape>>)[type] ?? {};

const RESERVED_QUERY = new Set(['branch', 'ref', 'count', 'skip']);

/** A template for the store's query from `?field=value` pairs the class has. */
function templateFromQuery(type: string, query: Record<string, string>): Record<string, unknown> {
  const fields = fieldsOf(type);
  const template: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(query)) {
    if (RESERVED_QUERY.has(key)) continue;
    const shape = fields[key];
    if (!shape || shape.kind === 'subdocument') {
      throw new ApiError(400, 'unknown_field', `${type} has no filterable field ${key}`);
    }
    if (shape.type === 'xsd:boolean') template[key] = raw === 'true';
    else if (shape.type === 'xsd:integer' || shape.type === 'xsd:decimal') template[key] = Number(raw);
    else template[key] = raw;
  }
  return template;
}

function writeRef(c: Context): Ref & { branch: string } {
  const ref = refFromQuery(c);
  if ('commit' in ref) throw new ApiError(400, 'write_at_commit', 'Writes go to a branch; a commit is read-only');
  return ref;
}

documents.get('/:type', async (c) => {
  const { type } = c.req.param();
  if (!isKnownType(type)) throw new ApiError(404, 'unknown_type', `No type ${type}`);
  const ref = refFromQuery(c);
  const store = createStore(ref);
  if ('commit' in ref) await requireCommit(store, ref.commit);
  const template = templateFromQuery(type, c.req.query());
  const count = c.req.query('count') === undefined ? undefined : intQuery(c, 'count', 0);
  const skip = c.req.query('skip') === undefined ? undefined : intQuery(c, 'skip', 0);
  const { documents: found, commit } = await store.queryDocuments(type, template, { count, skip });
  setEtag(c, commit);
  return c.json(found);
});

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
  if (!isWritable(type)) throw new ApiError(400, 'invalid_type', `${type} is not a writable document type`);
  const ref = writeRef(c);
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
  const [document] = parseDocuments([{ ...input, '@id': docId, '@type': type }]);

  const who = await resolveUser(c);
  const { commit } = await writeDocuments([document], {
    branch: createStore(ref),
    who,
    message: envelope.message,
    ifMatch: ifMatchFrom(c),
  });
  setEtag(c, commit);
  return c.json({ id: docId, commit });
});

documents.post('/', async (c) => {
  const ref = writeRef(c);
  const envelope = await readEnvelope(c);
  const inputs = envelope.documents;
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw new ApiError(400, 'bad_request', 'documents must be a non-empty array');
  }
  if (inputs.length > 500) throw new ApiError(400, 'bad_request', 'At most 500 documents per write');
  const parsed = parseDocuments(inputs);

  const who = await resolveUser(c);
  const { commit, ids } = await writeDocuments(parsed, {
    branch: createStore(ref),
    who,
    message: envelope.message,
    ifMatch: ifMatchFrom(c),
  });
  setEtag(c, commit);
  return c.json({ commit, ids });
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
