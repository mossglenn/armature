import { fragmentsOf } from '../fragments';
import { StoreError, type TerminusDocument } from '../store';
import { checkedAsOf } from './asOf';
import type { Violation, WriteContext } from './index';

/**
 * Constraint 16 (ADR-0028 decision 6, the general form of ADR-0023 decision
 * 5): a record about a part names the pair (record, fragmentId) on itself.
 * For every class with a top-level `fragmentId` (Attestation, DesignNote,
 * DesignFinding):
 *
 *   - `subject` has exactly one member when `fragmentId` is present, since a
 *     part belongs to one record (`fragment_needs_one_subject`)
 *   - the subject has a part with that `fragmentId` (`unknown_fragment`): at
 *     `asOf` when constraint 13 checks the record's `asOf`, otherwise in the
 *     subject as this write leaves it (a subject in the batch is read from the
 *     batch). A subject with no parts has none to name
 *
 * A subject that does not exist, or is not where `asOf` says, is constraint
 * 0's or 13's to report; this rule then says nothing.
 */
export async function checkFragmentRef(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const fragmentId = doc.fragmentId;
  if (typeof fragmentId !== 'string') return [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  const violation = (code: string, field: string, message: string): Violation => ({ code, id, index, field, message });

  const subjects = Array.isArray(doc.subject) ? doc.subject : [doc.subject];
  if (subjects.length !== 1) {
    return [violation('fragment_needs_one_subject', 'subject', `fragmentId names one part of one record; subject has ${subjects.length} members (ADR-0028)`)];
  }

  const asOf = await checkedAsOf(doc, ctx);
  let subject: TerminusDocument | undefined;
  if (asOf && typeof subjects[0] === 'string') {
    try {
      subject = (await ctx.branch.at({ commit: asOf }).getDocument(subjects[0])).document;
    } catch (err) {
      if (err instanceof StoreError && err.kind === 'not_found') return [];
      throw err;
    }
  } else {
    subject = await ctx.resolve(subjects[0]);
  }
  if (!subject) return [];

  if (fragmentsOf(subject).has(fragmentId)) return [];
  const where = asOf ? `at asOf ${asOf}` : 'as this write leaves it';
  return [violation('unknown_fragment', 'fragmentId', `${subject['@id'] ?? 'the subject'} has no part with fragmentId ${fragmentId} ${where}`)];
}
