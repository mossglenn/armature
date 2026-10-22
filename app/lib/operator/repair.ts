import { findUserByExternalId, registry, REGISTRY_BRANCH, type ResolvedUser } from '../api/identity';
import { createStore, type Commit } from '../api/store';
import { parseDocuments, writeDocuments, type WriteResult } from '../api/write';

/**
 * `delete` and `put` (ADR-0062 decisions 4, 5 and 7): repairs the plugin API
 * refuses, each a new commit on the branch it repairs, authored by the
 * operator's own `User` with the reason as the message. History is never
 * rewritten (ADR-0025 decision 6); the store's own checks are the floor
 * (decision 3), so a delete of a referenced document is refused by the store.
 */

export class OperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorError';
  }
}

/** Branch name prefixes the tests and the global setup use for scratch branches. */
export const SCRATCH_PREFIXES: readonly string[] = ['test-', 'warmup-', 'anon-', 'future-'];

/**
 * The operator as a registered `User` on `main` (decision 4). An operator
 * registers like anyone else; an unknown externalId is refused rather than
 * registered, since a repair names who made it.
 */
export async function operatorIdentity(externalId: string): Promise<ResolvedUser> {
  const { user } = await findUserByExternalId(registry(), externalId);
  if (!user) {
    throw new OperatorError(`No User with externalId ${externalId} is registered on ${REGISTRY_BRANCH}; register through POST /api/v1/users first`);
  }
  return { id: user['@id'], user };
}

const needReason = (reason: string): string => {
  const trimmed = reason.trim();
  if (!trimmed) throw new OperatorError('A repair needs a reason; it is the commit message');
  return trimmed;
};

export interface DeleteResult {
  commit: string;
  /** The head before the delete, at which the document stays readable (check AC3). */
  before?: Commit;
}

/** One document deleted as a commit (decision 5.2). The store refuses a referenced one (check AC1). */
export async function deleteDocument(opts: { branch: string; id: string; as: string; reason: string }): Promise<DeleteResult> {
  const message = needReason(opts.reason);
  const who = await operatorIdentity(opts.as);
  const store = createStore({ branch: opts.branch });
  const before = await store.head();
  const { commit } = await store.deleteDocument(opts.id, { author: who.id, message });
  return { commit, before };
}

/**
 * A scratch branch deleted (decision 7): only a name with a scratch prefix,
 * never a branch holding design work, which is process data to name rather
 * than delete. A branch deletion makes no commit; its commits stay readable by
 * id (check T2), so the head is returned for the record.
 */
export async function deleteScratchBranch(name: string): Promise<{ head?: Commit }> {
  if (!SCRATCH_PREFIXES.some((p) => name.startsWith(p))) {
    throw new OperatorError(`${name} is not a scratch branch (its name must start with ${SCRATCH_PREFIXES.join(', ')}); name an abandoned exploration, do not delete it`);
  }
  const store = createStore({ branch: name });
  const head = await store.head();
  await store.deleteBranch(name);
  return { head };
}

/** What a commit made without the hub's rules says about itself (decision 4). */
export const UNCHECKED_NOTE = "[operator: the hub's rules were skipped]";

/**
 * One document or a batch through the write pipeline (decision 5.3), exactly
 * as on /api/v1 but authored by the operator. `unchecked` skips the hub's
 * rules, never shape, provenance or the store's checks, and the message says
 * so; run `check` afterward.
 */
export async function putDocuments(opts: {
  branch: string;
  documents: unknown[];
  as: string;
  reason: string;
  unchecked?: boolean;
}): Promise<WriteResult> {
  const reason = needReason(opts.reason);
  if (!opts.documents.length) throw new OperatorError('Nothing to write: the input holds no documents');
  const who = await operatorIdentity(opts.as);
  const documents = parseDocuments(opts.documents);
  return writeDocuments(documents, {
    branch: createStore({ branch: opts.branch }),
    who,
    message: opts.unchecked ? `${reason} ${UNCHECKED_NOTE}` : reason,
    invariants: opts.unchecked ? 'skip' : 'check',
  });
}
