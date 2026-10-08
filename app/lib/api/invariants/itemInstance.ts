import type { TerminusDocument } from '../store';
import { refId, type Violation, type WriteContext } from './index';

/**
 * ItemInstance (ADR-0018):
 *
 *   5  sequence is unique within an Assessment
 *  10  a placement may not be Approved while its AssessmentItem is Draft or
 *      InReview; placement clearance never runs ahead of the item
 */
export async function validateItemInstance(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const out: Violation[] = [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  const push = (code: string, field: string, message: string) => out.push({ code, id, index, field, message });

  const assessment = refId(doc.assessment);
  if (assessment && typeof doc.sequence === 'number') {
    const others = (await ctx.siblings('ItemInstance', { assessment })).filter((d) => d !== doc);
    const clash = others.find((d) => d.sequence === doc.sequence);
    if (clash) {
      push('duplicate_sequence', 'sequence', `sequence ${doc.sequence} is already used in ${assessment} by ${clash['@id'] ?? 'another placement in this write'}`);
    }
  }

  if (doc.status === 'Approved') {
    const item = await ctx.resolve(doc.implements);
    if (item && (item.status === 'Draft' || item.status === 'InReview')) {
      push('instance_ahead_of_item', 'status', `${item['@id']} is ${String(item.status)}; a placement of it cannot be Approved (ADR-0018)`);
    }
  }
  return out;
}
