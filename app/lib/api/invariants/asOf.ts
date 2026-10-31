import { CLASS_FIELDS } from '@armature/types';
import { StoreError, type TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * Constraint 13 (ADR-0057): a record that refers to a state of the graph
 * names it by commit in `asOf`, and a named state must hold what the record
 * is about.
 *
 *   - a commit id the store does not hold is `unknown_commit`
 *   - each subject the record names must exist at that commit, else
 *     `absent_at_commit`; a subject created in the same write (a
 *     `{ "@ref" }`) cannot, since the commit predates it
 *   - a record that takes its state from a parent (a metric from the
 *     dataset it was derived from) must agree with the parent's `asOf`,
 *     absent when the parent has none, else `as_of_disagrees`
 *
 * Values the pipeline took from the branch head are not checked
 * (`ctx.asOfFilled`): the head exists, and a subject created in the same
 * write is by design not in the state the write started from. A value the
 * client supplied, one kept from the stored document on a replace, or one
 * copied from a parent that holds such a value is checked, because the record
 * must hold after the write: an item created after an administration cannot
 * carry that administration's statistics (ADR-0058 decision 4).
 */

/** Classes that carry `asOf`, read from the generated field map. */
export const hasAsOf = (type: string): boolean =>
  Object.prototype.hasOwnProperty.call((CLASS_FIELDS as Record<string, Record<string, unknown>>)[type] ?? {}, 'asOf');

/** The reference field through which a class takes its `asOf` from a parent record. */
export const AS_OF_PARENT: Record<string, string> = { LearningMetric: 'derivedFrom' };

/**
 * Classes whose `asOf` a replace refills from the head instead of keeping
 * (ADR-0028 decision 5, amending ADR-0057 decision 5 for these alone). Every
 * field of an attestation outside its key is part of the verdict, so any
 * write of one is the attester judging again, now; a finding's status, by
 * contrast, changes without anyone re-judging its subject.
 */
export const AS_OF_REFILLED_ON_REPLACE: ReadonlySet<string> = new Set(['Attestation']);

/** The reference fields naming what a record is about, which must exist at its `asOf`. */
const AS_OF_SUBJECTS: Record<string, readonly string[]> = {
  LearningDataset: ['producedBy'],
  LearningMetric: ['subject'],
  DesignFinding: ['subject', 'regarding'],
  Attestation: ['subject'],
};

/** A bare commit id as the store mints them (lowercase base 36). */
const COMMIT_ID = /^[a-z0-9]+$/;

/**
 * The commit a record's `asOf` names, when constraint 13 checks it and it is
 * a commit the store holds; undefined otherwise (absent, filled from the
 * head, or not a commit, which `checkAsOf` reports). Other rules that read
 * the subject at its state (constraint 16) use it.
 */
export async function checkedAsOf(doc: TerminusDocument, ctx: WriteContext): Promise<string | undefined> {
  const asOf = doc.asOf;
  if (typeof asOf !== 'string' || ctx.asOfFilled.has(doc) || !COMMIT_ID.test(asOf)) return undefined;
  return (await ctx.branch.getCommit(asOf)) ? asOf : undefined;
}

export async function checkAsOf(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const type = doc['@type'];
  const asOf = doc.asOf;
  const id = typeof doc['@id'] === 'string' && doc['@id'] ? doc['@id'] : undefined;
  const violation = (code: string, field: string, message: string): Violation => ({ code, id, index, field, message });

  const parentField = AS_OF_PARENT[type];
  if (parentField && doc[parentField] !== undefined) {
    // A missing parent is constraint 0's to report.
    const parent = await ctx.resolve(doc[parentField]);
    if (!parent) return [];
    if (parent.asOf !== asOf) return [
      violation(
        'as_of_disagrees',
        'asOf',
        `asOf must match ${parentField} ${parent['@id'] ?? '(this write)'}, whose asOf is ${
          parent.asOf === undefined ? 'absent' : String(parent.asOf)
        }; a ${type} takes its state from its ${parentField}`
      ),
    ];
    // Agreeing with the parent, the value is then checked like any other.
  }

  if (asOf === undefined || ctx.asOfFilled.has(doc)) return [];
  if (typeof asOf !== 'string' || !COMMIT_ID.test(asOf) || !(await ctx.branch.getCommit(asOf))) {
    return [violation('unknown_commit', 'asOf', `asOf names ${String(asOf)}, which is not a commit`)];
  }

  const at = ctx.branch.at({ commit: asOf });
  const out: Violation[] = [];
  for (const field of AS_OF_SUBJECTS[type] ?? []) {
    const raw = doc[field];
    if (raw === undefined) continue;
    const values = Array.isArray(raw) ? raw : [raw];
    for (const [i, value] of values.entries()) {
      const path = Array.isArray(raw) ? `${field}[${i}]` : field;
      if (typeof value !== 'string') {
        out.push(violation('absent_at_commit', path, `${path} is created in this write, so it does not exist at asOf ${asOf}`));
        continue;
      }
      try {
        await at.getDocument(value);
      } catch (err) {
        if (!(err instanceof StoreError && err.kind === 'not_found')) throw err;
        out.push(violation('absent_at_commit', path, `${path} names ${value}, which does not exist at asOf ${asOf}`));
      }
    }
  }
  return out;
}
