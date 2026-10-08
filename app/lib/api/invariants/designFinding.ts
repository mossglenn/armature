import type { TerminusDocument } from '../store';
import type { Violation } from './index';

/**
 * DesignFinding (ADR-0020):
 *
 *  11  a finding may be Dismissed only with a resolutionRationale, so the
 *      record of why a concern was set aside is never empty
 */
export async function validateDesignFinding(doc: TerminusDocument, index: number): Promise<Violation[]> {
  if (doc.status !== 'Dismissed') return [];
  const rationale = typeof doc.resolutionRationale === 'string' ? doc.resolutionRationale.trim() : '';
  if (rationale) return [];
  return [
    {
      code: 'rationale_required',
      id: typeof doc['@id'] === 'string' ? doc['@id'] : undefined,
      index,
      field: 'resolutionRationale',
      message: 'A Dismissed finding needs a resolutionRationale (ADR-0020)',
    },
  ];
}
