import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * Attestation (ADR-0028):
 *
 *  14  a claim comes whole: `claimRef` and `claimText` are both present or
 *      both absent. A worded claim with no identity would share its key with
 *      the attester's claimless endorsement of the same subject and replace
 *      it; an identity with no wording is unreadable without the plugin
 *  15  `attestedBy` is the caller. The pipeline fills it from the resolved
 *      identity (ADR-0032) before it looks for the record to replace, since
 *      it is part of the key; a body naming anyone else is refused
 *
 * And, so that `asOf` (constraint 13) names a state the verdict is about,
 * the subject is not written in the same request (`subject_in_same_write`).
 * A commit cannot name itself, so `asOf` would name a state without the
 * subject (created) or with its old version (replaced), and the staleness
 * read would report the verdict Unanchored or Stale from the start
 * (ADR-0028 decision 5, added while building).
 *
 * The subject's class is constraint 0, its existence at `asOf` constraint
 * 13, and a named fragment constraint 16 (fragmentRef.ts).
 */
export async function validateAttestation(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const out: Violation[] = [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;

  const hasRef = doc.claimRef !== undefined;
  const hasText = doc.claimText !== undefined;
  if (hasRef !== hasText) {
    out.push({
      code: 'claim_incomplete',
      id,
      index,
      field: hasRef ? 'claimText' : 'claimRef',
      message: `A claim needs both claimRef and claimText, or neither for an endorsement; this attestation has only ${hasRef ? 'claimRef' : 'claimText'} (ADR-0028)`,
    });
  }

  const subject = await ctx.resolve(doc.subject);
  if (subject && ctx.batch.includes(subject)) {
    out.push({
      code: 'subject_in_same_write',
      id,
      index,
      field: 'subject',
      message: `${subject['@id'] ?? 'The subject'} is written in this request; attest it in a later write, so asOf names a state that holds it (ADR-0028)`,
    });
  }

  if (doc.attestedBy !== ctx.caller) {
    out.push({
      code: 'attester_not_caller',
      id,
      index,
      field: 'attestedBy',
      message: `attestedBy names ${String(doc.attestedBy)}, but the request is made by ${ctx.caller}; an attestation is always the caller's own (ADR-0028)`,
    });
  }
  return out;
}
