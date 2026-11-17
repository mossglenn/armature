import { canonical } from '../api/fragments';
import { revocablesNaming, revokeGrantsNaming } from '../api/grants';
import { findUserByExternalId, REGISTRY_BRANCH, type ResolvedUser } from '../api/identity';
import { mergeBase } from '../api/routes/branches';
import { identityKey } from './identity';
import { createOperatorStore, createStore, type Commit, type OperatorStore, type TerminusDocument } from '../api/store';
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
  change: (transient: OperatorStore) => Promise<T>
): Promise<{ commit: string; base: Commit; result: T }> {
  const target = createOperatorStore({ branch });
  const base = await target.head();
  if (!base) throw new OperatorError(`Branch ${branch} has no commits`);
  const name = `operator-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
  await target.createBranch(name, { commit: base.id });
  try {
    const transient = createOperatorStore({ branch: name });
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
  const { user } = await findUserByExternalId(createStore({ branch: REGISTRY_BRANCH }), externalId);
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

/** A scratch name: one with a scratch prefix, or a workspace branch `<handle>_<name>` whose name has one. */
export const isScratchName = (name: string): boolean => {
  const bare = name.includes('_') ? name.slice(name.indexOf('_') + 1) : name;
  return SCRATCH_PREFIXES.some((p) => name.startsWith(p) || bare.startsWith(p));
};

/**
 * A scratch branch deleted (decision 7): only a name with a scratch prefix,
 * never a branch holding design work, which is process data to name rather
 * than delete. The grants naming the branch are revoked first, as a marked
 * commit on `main` by the operator (ADR-0068 decision 3: revoke, then
 * delete), when there are any. The deletion itself makes no commit; the
 * branch's commits stay readable by id (check T2), so the head is returned
 * for the record.
 */
export async function deleteScratchBranch(name: string, opts: { as: string }): Promise<{ head?: Commit; revoked: string[] }> {
  if (!isScratchName(name)) {
    throw new OperatorError(`${name} is not a scratch branch (its name must start with ${SCRATCH_PREFIXES.join(', ')}); name an abandoned exploration, do not delete it`);
  }
  const who = await operatorIdentity(opts.as);
  const main = createOperatorStore({ branch: REGISTRY_BRANCH });
  let revoked: string[] = [];
  if ((await revocablesNaming(main, name)).length) {
    const message = 'Scratch branch deleted';
    ({ result: { revoked } } = await asOperatorCommit(REGISTRY_BRANCH, who, message, { tool: 'delete', rulesSkipped: false }, (transient) =>
      revokeGrantsNaming(who, name, message, { main, write: transient })
    ));
  }
  const store = createOperatorStore({ branch: name });
  const head = await store.head();
  await store.deleteBranch(name);
  return { head, revoked };
}

/** The operator's own transient branches, which hold nothing that is merged as a branch is. */
const isTransient = (name: string): boolean => name.startsWith('operator-');

/**
 * What a `put` of `User` documents on `main` may not do (the code review of 2026-11-09's Q4,
 * decided 2026-11-16, Amos: the refusal, not the re-carry of ADR-0032 decision 6). Checked or
 * unchecked alike, since neither is a rule of one branch's state.
 *
 * A second `User` under an identity `main` already has: resolution finds one person by
 * `(issuer, externalId)`, and two documents under one would make one person two.
 *
 * An edit of a `User` while a branch holds a copy of it that was carried there after the branch
 * was cut. The write pipeline puts an author's `User` into a branch that lacks it (ADR-0032
 * decision 4), an insert on the branch of an id `main` inserted too; the two merge while they are
 * alike, and once `main`'s is edited they are an `InsertConflict` at every merge of that branch,
 * in both directions (platform check W2d), which no route and no `put` can then resolve, since a
 * `User` is written on `main` only. Such a branch is merged or deleted first. A branch cut after
 * the person was registered holds them by ancestry, and merges an edit as any other change:
 * those do not stand in the way.
 */
async function requireUsersWritable(documents: readonly TerminusDocument[]): Promise<void> {
  const users = documents.filter((doc) => doc['@type'] === 'User');
  if (!users.length) return;
  const main = createOperatorStore({ branch: REGISTRY_BRANCH });
  const held = (await main.queryDocuments('User', {})).documents;
  const written = new Map<string, string>();
  for (const user of users) {
    const key = identityKey(user);
    const other = held.find((u) => u['@id'] !== user['@id'] && identityKey(u) === key)?.['@id'] ?? (written.has(key) && written.get(key) !== user['@id'] ? written.get(key) : undefined);
    if (other) {
      throw new OperatorError(
        `${other} is already registered as ${String(user.externalId)}${typeof user.issuer === 'string' ? ` at ${user.issuer}` : ''}; one person is one User on ${REGISTRY_BRANCH} (ADR-0032 decision 2), so correct that one or delete it first`
      );
    }
    written.set(key, user['@id']);
  }
  const edited = users.filter((user) => {
    const before = held.find((u) => u['@id'] === user['@id']);
    return before !== undefined && canonical({ ...before, ...user }) !== canonical(before);
  });
  if (!edited.length) return;
  for (const name of await main.listBranches()) {
    if (name === REGISTRY_BRANCH || isTransient(name)) continue;
    const branch = createOperatorStore({ branch: name });
    const copies: string[] = [];
    for (const user of edited) {
      if (await holds(branch, user['@id'])) copies.push(user['@id']);
    }
    if (!copies.length) continue;
    const base = await mergeBase(main, branch);
    const carried: string[] = [];
    for (const id of copies) {
      if (!base || !(await holds(branch.at({ commit: base }), id))) carried.push(id);
    }
    if (carried.length) {
      throw new OperatorError(
        `Branch ${name} holds a copy of ${carried.join(', ')} that was carried there after the branch was cut; an edit on ${REGISTRY_BRANCH} would conflict at every merge of ${name}, and nothing could then resolve it (ADR-0032 decision 6). Merge or delete ${name} first, then run this again`
      );
    }
  }
}

/** Whether the store, at its ref, holds a document of that id. */
async function holds(store: { getDocument: OperatorStore['getDocument'] }, id: string): Promise<boolean> {
  try {
    await store.getDocument(id);
    return true;
  } catch {
    return false;
  }
}

/** What a commit made without the hub's rules says about itself (decision 4). */
export const UNCHECKED_NOTE = "[operator: the hub's rules were skipped]";

/**
 * One document or a batch through the write pipeline (decision 5.3), exactly
 * as on /api/v1 but authored by the operator, and taking `User` documents too,
 * which no route writes: a person's email corrected, or the `issuer` they
 * sign in with added (ADR-0067 decision 1; the rehearsal of 2026-11-05 found
 * the ADR's promise unkept). `unchecked` skips the hub's rules, never shape,
 * provenance or the store's checks, and the message says so; run `check`
 * afterward.
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
  const documents = parseDocuments(opts.documents, { operator: true });
  if (opts.branch === REGISTRY_BRANCH) await requireUsersWritable(documents);
  const message = opts.unchecked ? `${reason} ${UNCHECKED_NOTE}` : reason;
  const { commit, result } = await asOperatorCommit(
    opts.branch,
    who,
    message,
    { tool: 'put', rulesSkipped: opts.unchecked === true },
    (transient) =>
      writeDocuments(documents, { branch: transient, target: opts.branch, who, message, invariants: opts.unchecked ? 'skip' : 'check' })
  );
  // The ids as the transient write minted them; the commit is the target's.
  return { commit, ids: result.ids };
}
