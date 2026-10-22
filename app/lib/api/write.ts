import { CLASS_FIELDS, CLASS_KEY, type FieldShape } from '@armature/types';
import { DOCUMENT_SCHEMAS } from '@armature/types/schemas';
import { hasAttestedBy, hasCreatedBy, isWritable } from './classes';
import { ApiError } from './errors';
import { userCopyFor, type ResolvedUser } from './identity';
import { checkInvariants, createWriteContext, type WriteContext } from './invariants';
import { AS_OF_PARENT, AS_OF_REFILLED_ON_REPLACE, hasAsOf } from './invariants/asOf';
import { StoreError, type Store, type TerminusDocument } from './store';

/**
 * The generic write path (plan §4 Phase 3; architecture decision records
 * ADR-0024, ADR-0025, ADR-0032). One pipeline for a single PUT and for a
 * batch POST:
 *
 *   1. shape: each document's @type is a writable class and the document
 *      matches its generated Zod (validation library) schema in
 *      app/lib/schemas.ts (400 invalid_document)
 *   2. identity: an id held by another type is a 409 (ADR-0024 decision 4);
 *      an existing document is found by @id, or for a Hash-keyed class by
 *      its key fields, so a replace is recognized either way. An omitted
 *      attestedBy is filled with the caller first, because it is part of
 *      Attestation's key (ADR-0028 decision 4)
 *   3. provenance: createdBy is set on create and preserved on replace for
 *      every class that carries it; a User the branch lacks is carried in
 *      the same commit (ADR-0032 decisions 4 and 5); asOf, on the records
 *      that refer to a state of the graph, is filled from the branch head
 *      on create, kept on replace (refilled for an attestation, ADR-0028
 *      decision 5), or copied from a parent record (ADR-0057)
 *   4. invariants: every constraint, over the whole batch (422)
 *   5. the write: one PUT with create=true for the whole list, so it is one
 *      commit and fails together (platform checks X1, X2b, X5); If-Match
 *      honored (412). The caller's documents and the carried User land as
 *      one commit under the caller's reason, and nothing else: the graph
 *      stores no derived values (ADR-0056)
 */

export interface WriteOptions {
  branch: Store;
  who: ResolvedUser;
  message: string;
  ifMatch?: string;
  /**
   * `'skip'` leaves out step 4, the hub's rules, and nothing else: shape,
   * identity, provenance and the store's own checks still apply. Only the
   * operator's `put --unchecked` passes it (ADR-0062 decision 5); no route
   * does, and a test reads the route files to keep it so.
   */
  invariants?: 'check' | 'skip';
}

export interface WriteResult {
  commit: string;
  /** The written documents' ids, in input order; Hash-keyed ids as the store minted them. */
  ids: string[];
}

const keyOf = (type: string): { type: string; fields?: readonly string[] } | undefined =>
  (CLASS_KEY as Record<string, { type: string; fields?: readonly string[] }>)[type];

/** Step 1: shape. Returns the parsed documents with @type set. */
export function parseDocuments(inputs: unknown[]): TerminusDocument[] {
  const issues: Array<{ index: number; path: string; message: string }> = [];
  const parsed: TerminusDocument[] = [];
  inputs.forEach((input, index) => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      issues.push({ index, path: '', message: 'each document must be an object' });
      return;
    }
    const type = (input as Record<string, unknown>)['@type'];
    if (typeof type !== 'string' || !isWritable(type)) {
      issues.push({ index, path: '@type', message: `${String(type)} is not a writable document type` });
      return;
    }
    const schema = (DOCUMENT_SCHEMAS as Record<string, (typeof DOCUMENT_SCHEMAS)[keyof typeof DOCUMENT_SCHEMAS]>)[type];
    const result = schema.safeParse(input);
    if (!result.success) {
      for (const issue of result.error.issues) {
        if (issue.code === 'unrecognized_keys') {
          // One issue per key, at the key's path, so a client learns which
          // field was refused.
          for (const key of issue.keys) {
            const path = [...issue.path, key].map(String).join('.');
            issues.push({ index, path, message: `${key} is not a field of ${issue.path.length ? issue.path.map(String).join('.') : type}` });
          }
          continue;
        }
        issues.push({ index, path: issue.path.map(String).join('.'), message: issue.message });
      }
      return;
    }
    parsed.push({ ...(result.data as Record<string, unknown>), '@type': type } as TerminusDocument);
  });
  if (issues.length) {
    throw new ApiError(400, 'invalid_document', `${issues.length} problem(s) with the document(s)`, { issues });
  }
  return parsed;
}

/** Steps 2 to 5. */
export async function writeDocuments(documents: TerminusDocument[], opts: WriteOptions): Promise<WriteResult> {
  const { branch, who } = opts;

  const ids = new Set<string>();
  const captures = new Set<string>();
  for (const doc of documents) {
    if (typeof doc['@id'] === 'string' && doc['@id']) {
      if (ids.has(doc['@id'])) throw new ApiError(400, 'duplicate_id', `${doc['@id']} appears twice in this write`);
      ids.add(doc['@id']);
    }
    if (typeof doc['@capture'] === 'string') {
      if (captures.has(doc['@capture'])) throw new ApiError(400, 'duplicate_capture', `@capture ${doc['@capture']} appears twice`);
      captures.add(doc['@capture']);
    }
  }

  // The attester before step 2: attestedBy is part of the key, so the
  // replace lookup must find the caller's own attestation. A value naming
  // anyone else is left for constraint 15 to refuse.
  for (const doc of documents) {
    if (hasAttestedBy(doc['@type']) && doc.attestedBy === undefined) doc.attestedBy = who.id;
  }

  // Step 2: what each document replaces, if anything.
  const existing = await Promise.all(documents.map((doc) => findExisting(branch, doc)));
  const replacing = new Set<string>();
  existing.forEach((found, i) => {
    const doc = documents[i];
    if (!found) return;
    if (found['@type'] !== doc['@type']) {
      throw new ApiError(409, 'type_conflict', `${found['@id']} already exists as ${found['@type']}`, {
        id: found['@id'],
        existingType: found['@type'],
      });
    }
    replacing.add(found['@id']);
  });

  // Step 3: provenance.
  let carryUser = documents.some((doc) => hasAttestedBy(doc['@type']) && doc.attestedBy === who.id);
  documents.forEach((doc, i) => {
    if (!hasCreatedBy(doc['@type'])) return;
    const found = existing[i];
    if (found) {
      if (found.createdBy === undefined) delete doc.createdBy;
      else doc.createdBy = found.createdBy;
    } else {
      doc.createdBy = who.id;
      carryUser = true;
    }
  });
  const copy = carryUser ? await userCopyFor(branch, who) : undefined;

  // The carried User is resolvable so createdBy passes constraint 0 on a
  // branch that does not hold it yet.
  const ctx = createWriteContext(branch, documents, replacing, who.id, copy ? [copy] : []);
  await fillAsOf(documents, existing, ctx, opts);

  // Step 4: invariants.
  if (opts.invariants !== 'skip') await checkInvariants(ctx);

  // Step 5: the write. The carried User first, then the caller's documents;
  // `ids` reports the caller's only.
  const carried = copy ? [copy] : [];
  let result: { commit: string; ids: string[] };
  try {
    result = await branch.putDocuments([...carried, ...documents], {
      author: who.id,
      message: opts.message,
      ifMatch: opts.ifMatch,
      create: true,
    });
  } catch (err) {
    if (err instanceof StoreError && err.type === 'api:DataVersionMismatch') {
      const head = await branch.head();
      throw new ApiError(412, 'precondition_failed', `Branch ${branch.branch} has moved since commit ${opts.ifMatch}`, {
        expected: opts.ifMatch,
        current: head?.id,
      });
    }
    throw err;
  }

  return { commit: result.commit, ids: result.ids.slice(carried.length, carried.length + documents.length) };
}

/**
 * Step 3, the state each record refers to (ADR-0057 decision 2), for the
 * classes that carry `asOf` when the client left it out:
 *
 *   - a record with a parent (a metric with a dataset) copies the parent's
 *     value, absent when the parent has none
 *   - otherwise a replace keeps the stored value, so a status change does
 *     not move what a finding was about; an attestation's replace is a new
 *     verdict and takes the head like a create (AS_OF_REFILLED_ON_REPLACE)
 *   - otherwise a create takes the head the write starts from. That is the
 *     latest state a write can name: the commit it makes has no id until it
 *     exists, so a subject created in the same write is not in it
 *
 * Values taken from the head go in `ctx.asOfFilled`, which constraint 13
 * skips; a copy joins it only when the parent's value came from the head.
 * Records with a parent are filled last, so a metric copies the value its
 * dataset in the same write was just given.
 */
async function fillAsOf(
  documents: TerminusDocument[],
  existing: Array<TerminusDocument | undefined>,
  ctx: WriteContext,
  opts: WriteOptions
): Promise<void> {
  // With If-Match the write lands on that commit or not at all (412).
  let head: Promise<string | undefined> | undefined;
  const headId = () => (head ??= opts.ifMatch ? Promise.resolve(opts.ifMatch) : opts.branch.head().then((c) => c?.id));
  const parentOf = (doc: TerminusDocument): unknown => {
    const field = AS_OF_PARENT[doc['@type']];
    return field ? doc[field] : undefined;
  };

  const carrying = documents.filter((doc) => hasAsOf(doc['@type']));
  for (const doc of carrying.filter((d) => parentOf(d) === undefined)) {
    if (doc.asOf !== undefined) continue;
    const found = existing[documents.indexOf(doc)];
    if (found && !AS_OF_REFILLED_ON_REPLACE.has(doc['@type'])) {
      if (found.asOf !== undefined) doc.asOf = found.asOf;
      continue;
    }
    const id = await headId();
    if (id) {
      doc.asOf = id;
      ctx.asOfFilled.add(doc);
    }
  }
  for (const doc of carrying.filter((d) => parentOf(d) !== undefined)) {
    if (doc.asOf !== undefined) continue;
    const parent = await ctx.resolve(parentOf(doc));
    if (parent?.asOf !== undefined) {
      doc.asOf = parent.asOf;
      if (ctx.asOfFilled.has(parent)) ctx.asOfFilled.add(doc);
    }
  }
}

/**
 * The document on the branch this one replaces: by @id when it has one;
 * for a Hash-keyed class without one, by its key fields, since the store
 * derives the id from them (platform check X1c). Undefined when it is new.
 *
 * Required single-valued key fields go to the store as a template. Optional
 * key fields (Attestation's fragmentId, claimRef and attestedBy) are matched
 * here, absent only against absent, which is how the store hashes them
 * (check AA3): a template on an Optional reference is a store 500 (Y2).
 */
async function findExisting(branch: Store, doc: TerminusDocument): Promise<TerminusDocument | undefined> {
  if (typeof doc['@id'] === 'string' && doc['@id']) {
    try {
      return (await branch.getDocument(doc['@id'])).document;
    } catch (err) {
      if (err instanceof StoreError && err.type === 'api:DocumentNotFound') return undefined;
      throw err;
    }
  }
  const key = keyOf(doc['@type']);
  if (key?.type !== 'Hash' || !key.fields) return undefined;
  const fields = (CLASS_FIELDS as Record<string, Record<string, FieldShape>>)[doc['@type']] ?? {};
  const template: Record<string, string> = {};
  const inHub: string[] = [];
  for (const field of key.fields) {
    const value = doc[field];
    if (value !== undefined && typeof value !== 'string') return undefined; // a { "@ref" } key: nothing to find yet
    if (fields[field]?.optional) inHub.push(field);
    else if (value === undefined) return undefined; // the shape check requires it; nothing to find
    else template[field] = value;
  }
  const { documents } = await branch.queryDocuments(doc['@type'], template);
  return documents.find((d) => inHub.every((field) => d[field] === doc[field]));
}
