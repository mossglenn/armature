import { isActive, type GrantDocument } from '../api/grants';
import { REGISTRY_BRANCH } from '../api/identity';
import { checkInvariants, createWriteContext, InvariantError, type Violation } from '../api/invariants';
import type { DocumentReader, Store, TerminusDocument } from '../api/store';

/**
 * `check` (ADR-0062 decision 5.1): the invariants engine over a whole branch,
 * read-only. Every document at the ref is the batch and every id counts as
 * replaced, so `siblings()` and `resolve()` see exactly the branch and a
 * document is not its own sibling. The validators that gate a write lint a
 * state; no rule code is added for it.
 *
 * Two rules are about the write rather than the state, and are skipped by
 * code after the engine reports them:
 *
 *   attester_not_caller    constraint 15: there is no caller
 *   subject_in_same_write  constraint 13's clause for attestations: the whole
 *                          branch is the batch, so every subject is in it
 *
 * Two rules are about the whole store rather than one branch, and run only
 * when `main` is checked through a store that can list branches (ADR-0068
 * decision 3, note): a grant in force naming a branch the store lacks
 * (`grant_without_branch`), and a branch with no `Owner` in force
 * (`branch_without_owner`, with no document, so its index is -1). The repair
 * for either is `put` on the grant, as a commit with a reason.
 */
export const WRITE_ONLY_RULES: ReadonlyMap<string, string> = new Map([
  ['attester_not_caller', 'constraint 15, the attester is the caller: a check has no caller'],
  ['subject_in_same_write', "constraint 13's same-request clause: a check's batch is the whole branch"],
]);

export interface CheckReport {
  /** The commit the documents were read at. */
  commit: string;
  documents: number;
  violations: Violation[];
  /** The rules left out, by code, with the reason. */
  skipped: Array<{ code: string; reason: string }>;
}

export async function checkBranch(store: DocumentReader): Promise<CheckReport> {
  const { documents, commit } = await store.allDocuments();
  // Every later read at the commit the documents came from, so a branch that
  // moves while the check runs is checked as it was.
  const at = commit ? store.at({ commit }) : store;
  const replacing = new Set(documents.map((d) => d['@id']));
  const ctx = createWriteContext(at, documents, replacing, '');
  let violations: Violation[] = [];
  try {
    await checkInvariants(ctx);
  } catch (err) {
    if (!(err instanceof InvariantError)) throw err;
    violations = err.violations.filter((v) => !WRITE_ONLY_RULES.has(v.code));
  }
  if (checksOwnership(store)) violations.push(...(await checkOwnership(store, documents)));
  return {
    commit,
    documents: documents.length,
    violations,
    skipped: [...WRITE_ONLY_RULES].map(([code, reason]) => ({ code, reason })),
  };
}

const checksOwnership = (store: DocumentReader): store is Store =>
  'listBranches' in store && 'branch' in store.ref && store.ref.branch === REGISTRY_BRANCH;

async function checkOwnership(store: Store, documents: TerminusDocument[]): Promise<Violation[]> {
  const out: Violation[] = [];
  const names = await store.listBranches();
  const active = documents.filter((d): d is GrantDocument => d['@type'] === 'Grant' && isActive(d as GrantDocument));
  for (const grant of active) {
    if (grant.branch !== undefined && !names.includes(grant.branch)) {
      out.push({
        code: 'grant_without_branch',
        id: grant['@id'],
        index: documents.indexOf(grant),
        field: 'branch',
        message: `${grant['@id']} grants ${grant.role} on branch ${grant.branch}, which the store does not have; revoke it (ADR-0068 decision 3)`,
      });
    }
  }
  for (const name of names) {
    if (name === REGISTRY_BRANCH) continue;
    if (!active.some((grant) => grant.role === 'Owner' && grant.branch === name)) {
      out.push({
        code: 'branch_without_owner',
        index: -1,
        field: 'branch',
        message: `Branch ${name} has no Owner grant in force; an administrator assigns one (ADR-0068 decision 3)`,
      });
    }
  }
  return out;
}
