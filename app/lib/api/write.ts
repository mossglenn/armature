import { CLASS_FIELDS, CLASS_KEY, type FieldShape } from '@armature/types';
import { DOCUMENT_SCHEMAS } from '@armature/types/schemas';
import { hasAttestedBy, hasCreatedBy, isWritable, livesOnMain } from './classes';
import { ApiError } from './errors';
import { REGISTRY_BRANCH, userCopyFor, type ResolvedUser } from './identity';
import { checkInvariants, createWriteContext, type WriteContext } from './invariants';
import { AS_OF_PARENT, AS_OF_REFILLED_ON_REPLACE, hasAsOf } from './invariants/asOf';
import { StoreError, type DocumentReader, type Store, type TerminusDocument } from './store';

/**
 * The generic write path (plan §4 Phase 3; architecture decision records
 * ADR-0024, ADR-0025, ADR-0032). One pipeline for a single PUT and for a
 * batch POST:
 *
 *   1. shape: each document's @type is a writable class and the document
 *      matches its generated Zod (validation library) schema in
 *      app/lib/schemas.ts (400 invalid_document); a class that lives on
 *      main (`Grant`, constraint 21) is refused on any other branch (400
 *      grants_live_on_main, ADR-0068 decision 2)
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
 *      commit and fails together (platform checks X1, X2b, X5). The caller's
 *      documents and the carried User land as one commit under the caller's
 *      reason, and nothing else: the graph stores no derived values (ADR-0056)
 *
 * All of it at one commit (the deep review's B2): the branch head is captured
 * first, every read of steps 2 to 4 is at that commit, and step 5 is
 * conditioned on it, so the rules are checked on the state the write lands
 * on. An If-Match that is not the head is a 412 before anything is read. A
 * write without one that loses a race to another commit is run again, whole,
 * on the new head, and answered 409 `branch_moved` when the branch keeps
 * moving; with one, losing the race is the 412 it asked for.
 */

export interface WriteOptions {
  branch: Store;
  /**
   * The branch this write is for, when `branch` is a transient one cut from
   * it: the operator's repairs are made on an `operator-…` branch and applied
   * onto their target (ADR-0062). The main-only rule (constraint 21) judges
   * by it, so the first Administrator grant can come from the operator's
   * `put` on `main` (ADR-0068 decision 6). Absent, `branch` is the target.
   */
  target?: string;
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

/** Runs of a write without If-Match before a branch that keeps moving is answered 409 `branch_moved`. */
export const WRITE_ATTEMPTS = 3;

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

/** Steps 2 to 5, each run at the head it captured. */
export async function writeDocuments(documents: TerminusDocument[], opts: WriteOptions): Promise<WriteResult> {
  const { branch } = opts;
  checkUnique(documents);
  const onMain = documents.find((doc) => livesOnMain(doc['@type']));
  if (onMain && (opts.target ?? branch.branch) !== REGISTRY_BRANCH) {
    throw new ApiError(
      400,
      'grants_live_on_main',
      `${onMain['@type']} documents live on ${REGISTRY_BRANCH} only, whatever branch the work is on; write this one there (ADR-0068 decision 2)`
    );
  }
  const moved = (current: string | undefined) =>
    new ApiError(412, 'precondition_failed', `Branch ${branch.branch} has moved since commit ${opts.ifMatch}`, {
      expected: opts.ifMatch,
      current,
    });
  for (let attempt = 1; ; attempt++) {
    const head = (await branch.head())?.id;
    if (opts.ifMatch && opts.ifMatch !== head) throw moved(head);
    try {
      // A fresh copy each run: the pipeline fills fields in as it goes.
      return await writeAt(structuredClone(documents), head, opts);
    } catch (err) {
      if (!(err instanceof StoreError && err.kind === 'version_mismatch')) throw err;
      if (opts.ifMatch) throw moved((await branch.head())?.id);
      if (attempt === WRITE_ATTEMPTS) {
        throw new ApiError(409, 'branch_moved', `Branch ${branch.branch} moved during each of ${WRITE_ATTEMPTS} attempts at this write; retry`);
      }
    }
  }
}

/** Ids and captures each appear once in a write. */
function checkUnique(documents: TerminusDocument[]): void {
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
}

/**
 * One run of steps 2 to 5 at `head`, the commit every read is at and the
 * write is conditioned on. A branch with no commit yet is read and written
 * unconditioned, as there is nothing to race.
 */
async function writeAt(documents: TerminusDocument[], head: string | undefined, opts: WriteOptions): Promise<WriteResult> {
  const { branch, who } = opts;
  const at = head ? branch.at({ commit: head }) : branch;

  // The attester before step 2: attestedBy is part of the key, so the
  // replace lookup must find the caller's own attestation. A value naming
  // anyone else is left for constraint 15 to refuse.
  for (const doc of documents) {
    if (hasAttestedBy(doc['@type']) && doc.attestedBy === undefined) doc.attestedBy = who.id;
  }

  // Step 2: what each document replaces, if anything.
  const existing = await Promise.all(documents.map((doc) => findExisting(at, doc)));
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
  const copy = carryUser ? await userCopyFor(branch.branch, at, who) : undefined;

  // The carried User is resolvable so createdBy passes constraint 0 on a
  // branch that does not hold it yet.
  const ctx = createWriteContext(at, documents, replacing, who.id, copy ? [copy] : []);
  await fillAsOf(documents, existing, ctx, head);

  // Step 4: invariants.
  if (opts.invariants !== 'skip') await checkInvariants(ctx);

  // Step 5: the write. The carried User first, then the caller's documents;
  // `ids` reports the caller's only.
  const carried = copy ? [copy] : [];
  const result = await branch.putDocuments([...carried, ...documents], {
    author: who.id,
    message: opts.message,
    ifMatch: head,
    create: true,
  });
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
  head: string | undefined
): Promise<void> {
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
    if (head) {
      doc.asOf = head;
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
async function findExisting(branch: DocumentReader, doc: TerminusDocument): Promise<TerminusDocument | undefined> {
  if (typeof doc['@id'] === 'string' && doc['@id']) {
    try {
      return (await branch.getDocument(doc['@id'])).document;
    } catch (err) {
      if (err instanceof StoreError && err.kind === 'not_found') return undefined;
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
