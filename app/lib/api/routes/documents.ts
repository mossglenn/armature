import { Hono, type Context } from 'hono';
import { CLASS_FIELDS, type FieldShape } from '@armature/types';
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
import { createStore, isRecord, type HistoryEntry, type Ref, type TerminusDocument } from '../store';
import { CommitMemo } from '../memo';
import { parseDocuments, writeDocuments } from '../write';

/**
 * /api/v1/documents (architecture decision records ADR-0024 and ADR-0025
 * decisions 3, 7, 8 and 9; Phase 3).
 *
 *   GET  /:type?branch=|ref=&<field>=&count=&skip=   list, filtered by field values (never by a User field)
 *   GET  /:type/:id?branch=|ref=                      one document at a ref; ETag (entity tag) is the commit
 *   PUT  /:type/:id?branch=                           { message, document }  replace or create
 *   POST /?branch=                                    { message, documents: [...] }  one commit
 *   GET  /:type/:id/history?branch=&start=&count=&diff=  the commits that touched it, with diffs
 *   GET  /:type/:id/diff?from=&to=                    the structural diff between two commits
 *
 * Both writes run the same pipeline (../write.ts): generated Zod shape,
 * 409 on an id held by another type, createdBy from the resolved identity,
 * the invariants engine, one commit, If-Match honored. A batch may use
 * @capture and { "@ref" } to reference a document it creates, which is how
 * a note attaches to a Hash-keyed junction written in the same request.
 */
/** History answers by the commit they were read at (docs/api.md § history). */
export const historyMemo = new CommitMemo<HistoryEntry[]>();

/** Reads of a document's history before a branch that keeps moving is answered 503 `branch_busy`. */
const HISTORY_ATTEMPTS = 3;

export const documents = new Hono();

const fieldsOf = (type: string): Record<string, FieldShape> =>
  (CLASS_FIELDS as Record<string, Record<string, FieldShape>>)[type] ?? {};

const RESERVED_QUERY = new Set(['branch', 'ref', 'count', 'skip']);

interface Filters {
  /** Required single-valued fields: the store's template query. */
  template: Record<string, unknown>;
  /** Optional or multi-valued fields: applied by the hub to the listed documents. */
  inHub: Array<{ field: string; many: boolean; value: unknown }>;
}

/**
 * The `?field=value` pairs the class has, split by who applies them. The
 * store filters a required single-valued field by template query, but
 * answers one on an Optional enum or reference, or on a Set, with a 500
 * (platform check Y), so the hub lists and filters those, as `Graph.where`
 * does. A Set matches when it contains the value. A field naming a `User`
 * is refused: the API offers no enumeration of a person's work (ADR-0021
 * decision 3, the non-aggregation guard).
 */
function filtersFromQuery(type: string, query: Record<string, string>): Filters {
  const fields = fieldsOf(type);
  const filters: Filters = { template: {}, inHub: [] };
  for (const [key, raw] of Object.entries(query)) {
    if (RESERVED_QUERY.has(key)) continue;
    const shape = fields[key];
    if (!shape || shape.kind === 'subdocument') {
      throw new ApiError(400, 'unknown_field', `${type} has no filterable field ${key}`);
    }
    if (shape.type === 'User') {
      throw new ApiError(400, 'person_filter_refused', `${key} names a person; the API does not list documents by who made them (ADR-0021)`);
    }
    let value: unknown = raw;
    if (shape.type === 'xsd:boolean') value = raw === 'true';
    else if (shape.type === 'xsd:integer' || shape.type === 'xsd:decimal') value = Number(raw);
    if (shape.optional || shape.many) filters.inHub.push({ field: key, many: shape.many, value });
    else filters.template[key] = value;
  }
  return filters;
}

const sameValue = (stored: unknown, wanted: unknown): boolean =>
  stored === wanted || (typeof wanted === 'number' && stored !== undefined && Number(stored) === wanted);

const matches = (doc: TerminusDocument, { field, many, value }: Filters['inHub'][number]): boolean =>
  many ? Array.isArray(doc[field]) && doc[field].some((v) => sameValue(v, value)) : sameValue(doc[field], value);

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
  const { template, inHub } = filtersFromQuery(type, c.req.query());
  const count = c.req.query('count') === undefined ? undefined : intQuery(c, 'count', 0);
  const skip = c.req.query('skip') === undefined ? undefined : intQuery(c, 'skip', 0);
  if (!inHub.length) {
    const { documents: found, commit } = await store.queryDocuments(type, template, { count, skip });
    setEtag(c, commit);
    return c.json(found);
  }
  // The hub filters, so it pages too: the store's count and skip would apply before the filter.
  const { documents: listed, commit } = await store.queryDocuments(type, template);
  const kept = listed.filter((doc) => inHub.every((f) => matches(doc, f)));
  const from = skip ?? 0;
  setEtag(c, commit);
  return c.json(kept.slice(from, count === undefined ? undefined : from + count));
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
  // The store reads history only at a branch (check AM2), so the head is
  // read around the answer: the same head before and after proves the answer
  // is that commit's, since history is never rewritten (ADR-0025 decision 6),
  // and only then is it served, under that head as the ETag (the deep
  // review's B1). The store walks the branch's whole log for a document
  // touched rarely (seconds on a few hundred commits), so a proven answer is
  // kept by its head and served again while the head stands still.
  const store = createStore({ branch });
  const keyAt = (at: string) => CommitMemo.key(at, docId, start, count, diff);
  let served: { entries: HistoryEntry[]; head: string | undefined } | undefined;
  for (let attempt = 0; attempt < HISTORY_ATTEMPTS && !served; attempt++) {
    const head = (await store.head())?.id;
    const kept = head ? historyMemo.get(keyAt(head)) : undefined;
    if (kept) {
      served = { entries: kept, head };
      break;
    }
    const entries = (await store.history(docId, { start, count, diff })).entries;
    if ((await store.head())?.id !== head) continue;
    if (head) historyMemo.set(keyAt(head), entries);
    served = { entries, head };
  }
  if (!served) {
    c.header('Retry-After', '1');
    throw new ApiError(503, 'branch_busy', `Branch ${branch} moved during each of ${HISTORY_ATTEMPTS} reads of the history; retry`);
  }
  const { entries, head } = served;
  setEtag(c, head);
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
