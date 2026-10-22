import { findUserByExternalId, registry, REGISTRY_BRANCH, type ResolvedUser } from '../api/identity';
import { createStore, type Commit, type Store } from '../api/store';
import { parseDocuments, writeDocuments, type WriteResult } from '../api/write';

/**
 * `delete` and `put` (ADR-0062 decisions 4, 5 and 7): repairs the plugin API
 * refuses, each a new commit on the branch it repairs, authored by the
 * operator's own `User` with the reason as the message. History is never
 * rewritten (ADR-0025 decision 6); the store's own checks are the floor
 * (decision 3), so a delete of a referenced document is refused by the store.
 *
 * Every repair commit is marked in its metadata, so a reader of the log can
 * tell an operator's commit from a plugin's without parsing its message:
 *
 *   { "armature": { "operator": { "tool": "put", "rulesSkipped": false } } }
 *
 * beside the merge route's `mergeSource`. The document API ignores commit
 * metadata (check V4) and `apply` stores it (V2), so a repair is made on a
 * transient branch cut at the target's head and applied onto the target as
 * one commit (check AF). The transient commit stays readable by id on no
 * branch (AF3); `/api/history` entries carry no metadata (V3c), so the marker
 * is read from the log or a branch's head.
 */

export class OperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperatorError';
  }
}

/**
 * Branch name prefixes the tests and the global setup use for scratch
 * branches, and the operator's own transient branches, which a repair deletes
 * when it ends and a crashed one may leave behind.
 */
export const SCRATCH_PREFIXES: readonly string[] = ['test-', 'warmup-', 'anon-', 'future-', 'operator-'];

export interface OperatorMarker {
  tool: 'delete' | 'put';
  rulesSkipped: boolean;
}

/** The metadata an operator commit carries. */
export const operatorMetadata = (marker: OperatorMarker) => ({ armature: { operator: marker } });

/**
 * One repair as one marked commit on `branch`. `change` makes it on a
 * transient branch cut at the head; the difference is applied onto `branch`
 * with the marker. A branch that moved meanwhile is refused rather than
 * merged, since a checked write was checked against the head it started from.
 */
async function asOperatorCommit<T>(
  branch: string,
  who: ResolvedUser,
  message: string,
  marker: OperatorMarker,
  change: (transient: Store) => Promise<T>
): Promise<{ commit: string; base: Commit; result: T }> {
  const target = createStore({ branch });
  const base = await target.head();
  if (!base) throw new OperatorError(`Branch ${branch} has no commits`);
  const name = `operator-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await target.createBranch(name, { commit: base.id });
  try {
    const transient = createStore({ branch: name });
    const result = await change(transient);
    const source = await transient.head();
    if (!source || source.id === base.id) throw new OperatorError('The repair changed nothing');
    const now = await target.head();
    if (now?.id !== base.id) {
      throw new OperatorError(`${branch} moved during the repair (from ${base.id} to ${now?.id}); run it again`);
    }
    const applied = await target.apply(branch, {
      base: base.id,
      source: source.id,
      author: who.id,
      message,
      metadata: operatorMetadata(marker),
    });
    if (!applied.ok) throw new OperatorError(`The repair conflicts with ${branch}: ${JSON.stringify(applied.witnesses)}`);
    return { commit: applied.commit, base, result };
  } finally {
    await target.deleteBranch(name).catch(() => undefined);
  }
}

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
  const { commit, base } = await asOperatorCommit(opts.branch, who, message, { tool: 'delete', rulesSkipped: false }, (transient) =>
    transient.deleteDocument(opts.id, { author: who.id, message })
  );
  return { commit, before: base };
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
  const message = opts.unchecked ? `${reason} ${UNCHECKED_NOTE}` : reason;
  const { commit, result } = await asOperatorCommit(
    opts.branch,
    who,
    message,
    { tool: 'put', rulesSkipped: opts.unchecked === true },
    (transient) => writeDocuments(documents, { branch: transient, who, message, invariants: opts.unchecked ? 'skip' : 'check' })
  );
  // The ids as the transient write minted them; the commit is the target's.
  return { commit, ids: result.ids };
}
