import { checkInvariants, createWriteContext, InvariantError, type Violation } from '../api/invariants';
import type { Store } from '../api/store';

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

export async function checkBranch(store: Store): Promise<CheckReport> {
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
  return {
    commit,
    documents: documents.length,
    violations,
    skipped: [...WRITE_ONLY_RULES].map(([code, reason]) => ({ code, reason })),
  };
}
