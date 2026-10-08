import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * AssessmentItem (ADR-0018, ADR-0022, ADR-0023, ADR-0033):
 *
 *   8  fragmentId is unique across the stem, the options and the feedbacks
 *   9  option text is unique within the item (presence is the schema's job),
 *      and the number of correct options suits the itemType
 *  10  an item may not drop back to Draft or InReview while a placement of
 *      it is Approved (the ItemInstance validator checks the other side)
 *
 * Correct-count rules are defined for the option-bearing types only:
 * MultipleChoice and TrueFalse have exactly one correct option, and
 * TrueFalse exactly two options; MultipleSelect has at least one. The other
 * types carry no options rule in this phase (ADR-0034 will bring per-type
 * data shapes).
 */
export async function validateAssessmentItem(
  doc: TerminusDocument,
  index: number,
  ctx: WriteContext
): Promise<Violation[]> {
  const out: Violation[] = [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  const push = (code: string, field: string, message: string) => out.push({ code, id, index, field, message });

  const options = Array.isArray(doc.options) ? (doc.options as Array<Record<string, unknown>>) : [];
  const fragments: Array<[string, Record<string, unknown>]> = [];
  if (doc.stem && typeof doc.stem === 'object') fragments.push(['stem', doc.stem as Record<string, unknown>]);
  options.forEach((o, i) => fragments.push([`options[${i}]`, o]));
  for (const key of ['correctFeedback', 'incorrectFeedback'] as const) {
    if (doc[key] && typeof doc[key] === 'object') fragments.push([key, doc[key] as Record<string, unknown>]);
  }

  const seenFragmentIds = new Map<string, string>();
  for (const [path, fragment] of fragments) {
    const fragmentId = String(fragment.fragmentId ?? '');
    const first = seenFragmentIds.get(fragmentId);
    if (first) push('duplicate_fragment_id', path, `fragmentId ${fragmentId} is also used by ${first}`);
    else seenFragmentIds.set(fragmentId, path);
  }

  const seenText = new Map<string, number>();
  options.forEach((o, i) => {
    const text = String(o.text ?? '').trim();
    const first = seenText.get(text);
    if (first !== undefined) push('duplicate_option_text', `options[${i}]`, `option text duplicates options[${first}]`);
    else seenText.set(text, i);
  });

  const correct = options.filter((o) => o.isCorrect === true).length;
  switch (doc.itemType) {
    case 'MultipleChoice':
      if (options.length < 2) push('option_count', 'options', 'MultipleChoice needs at least two options');
      if (correct !== 1) push('correct_option_count', 'options', `MultipleChoice needs exactly one correct option, found ${correct}`);
      break;
    case 'MultipleSelect':
      if (options.length < 2) push('option_count', 'options', 'MultipleSelect needs at least two options');
      if (correct < 1) push('correct_option_count', 'options', 'MultipleSelect needs at least one correct option');
      break;
    case 'TrueFalse':
      if (options.length !== 2) push('option_count', 'options', `TrueFalse needs exactly two options, found ${options.length}`);
      if (correct !== 1) push('correct_option_count', 'options', `TrueFalse needs exactly one correct option, found ${correct}`);
      break;
    default:
      break;
  }

  if (id && (doc.status === 'Draft' || doc.status === 'InReview')) {
    const placements = await ctx.siblings('ItemInstance', { implements: id });
    for (const placement of placements) {
      if (placement.status === 'Approved') {
        push(
          'instance_ahead_of_item',
          'status',
          `${placement['@id'] ?? 'a placement in this write'} is Approved; the item cannot be ${String(doc.status)} (ADR-0018)`
        );
      }
    }
  }
  return out;
}
