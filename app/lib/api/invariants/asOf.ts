import { CLASS_FIELDS } from '@/lib/types';
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
 * Values the pipeline filled from the branch head or copied from a parent
 * are not checked (`ctx.asOfFilled`): the head exists, and a subject created
 * in the same write is by design not in the state the write started from.
 * A value the client supplied, or one kept from the stored document on a
 * replace, is checked, because the record must hold after the write.
 */

/** Classes that carry `asOf`, read from the generated field map. */
export const hasAsOf = (type: string): boolean =>
  Object.prototype.hasOwnProperty.call((CLASS_FIELDS as Record<string, Record<string, unknown>>)[type] ?? {}, 'asOf');

/** The reference field through which a class takes its `asOf` from a parent record. */
export const AS_OF_PARENT: Record<string, string> = { LearningMetric: 'derivedFrom' };

/** The reference fields naming what a record is about, which must exist at its `asOf`. */
const AS_OF_SUBJECTS: Record<string, readonly string[]> = {
  LearningDataset: ['producedBy'],
  DesignFinding: ['subject', 'regarding'],
};

/** A bare commit id as the store mints them (lowercase base 36). */
const COMMIT_ID = /^[a-z0-9]+$/;

export async function checkAsOf(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const type = doc['@type'];
  const asOf = doc.asOf;
  const id = typeof doc['@id'] === 'string' && doc['@id'] ? doc['@id'] : undefined;
  const violation = (code: string, field: string, message: string): Violation => ({ code, id, index, field, message });

  const parentField = AS_OF_PARENT[type];
  if (parentField && doc[parentField] !== undefined) {
    // A missing parent is constraint 0's to report.
    const parent = await ctx.resolve(doc[parentField]);
    if (!parent || parent.asOf === asOf) return [];
    return [
      violation(
        'as_of_disagrees',
        'asOf',
        `asOf must match ${parentField} ${parent['@id'] ?? '(this write)'}, whose asOf is ${
          parent.asOf === undefined ? 'absent' : String(parent.asOf)
        }; a ${type} takes its state from its ${parentField}`
      ),
    ];
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
        if (!(err instanceof StoreError && err.type === 'api:DocumentNotFound')) throw err;
        out.push(violation('absent_at_commit', path, `${path} names ${value}, which does not exist at asOf ${asOf}`));
      }
    }
  }
  return out;
}
