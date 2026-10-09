import { CLASS_KEY } from '@/lib/types';
import { DOCUMENT_SCHEMAS } from '@/lib/schemas';
import { hasCreatedBy, isWritable } from './classes';
import { ApiError } from './errors';
import { userCopyFor, type ResolvedUser } from './identity';
import { checkInvariants, createWriteContext } from './invariants';
import { StoreError, type Store, type TerminusDocument } from './store';

/**
 * The generic write path (plan §4 Phase 3; ADR-0024, ADR-0025, ADR-0032).
 * One pipeline for a single PUT and for a batch POST:
 *
 *   1. shape: each document's @type is a writable class and the document
 *      matches its generated Zod schema (400 invalid_document)
 *   2. identity: an id held by another type is a 409 (ADR-0024 decision 4);
 *      an existing document is found by @id, or for a Hash-keyed class by
 *      its key fields, so a replace is recognised either way
 *   3. provenance: createdBy is set on create and preserved on replace for
 *      every class that carries it; a User the branch lacks is carried in
 *      the same commit (ADR-0032 decisions 4 and 5)
 *   4. invariants: every constraint, over the whole batch (422)
 *   5. the write: one PUT with create=true for the whole list, so it is one
 *      commit and fails together (platform checks X1, X2b, X5); If-Match
 *      honoured (412). The caller's documents and the carried User land as
 *      one commit under the caller's reason, and nothing else: the graph
 *      stores no derived values (ADR-0056)
 */

export interface WriteOptions {
  branch: Store;
  who: ResolvedUser;
  message: string;
  ifMatch?: string;
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

/** Steps 2 to 6. */
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
  let carryUser = false;
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

  // Step 4: invariants. The carried User is resolvable so createdBy passes
  // constraint 0 on a branch that does not hold it yet.
  const ctx = createWriteContext(branch, documents, replacing, copy ? [copy] : []);
  await checkInvariants(ctx);

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
 * The document on the branch this one replaces: by @id when it has one;
 * for a Hash-keyed class without one, by its key fields, since the store
 * derives the id from them (platform check X1c). Undefined when it is new.
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
  const template: Record<string, string> = {};
  for (const field of key.fields) {
    const value = doc[field];
    if (typeof value !== 'string') return undefined; // a { "@ref" } key: nothing to find yet
    template[field] = value;
  }
  const { documents } = await branch.queryDocuments(doc['@type'], template);
  return documents[0];
}
