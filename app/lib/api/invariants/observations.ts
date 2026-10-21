import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * Constraint 20 (ADR-0063): an outcome record names where it came from.
 *
 *   - a LearningDataset carries `producedBy` (the Assessment administered) or
 *     at least one externalRef (the system it was imported from)
 *   - a LearningMetric carries `derivedFrom` (its dataset, whose source it
 *     inherits) or at least one externalRef
 *
 * Nothing is inferred about whose assessment it was; the writer says what the
 * source is, and the rule insists that something is said.
 */
const hasExternalRef = (doc: TerminusDocument): boolean => Array.isArray(doc.externalRefs) && doc.externalRefs.length > 0;
const names = (doc: TerminusDocument, field: string): boolean => {
  const value = doc[field];
  return typeof value === 'string' ? value.trim() !== '' : value !== undefined && value !== null;
};

export async function validateLearningDataset(doc: TerminusDocument, index: number, _ctx: WriteContext): Promise<Violation[]> {
  void _ctx;
  if (names(doc, 'producedBy') || hasExternalRef(doc)) return [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  return [{ code: 'dataset_without_source', id, index, field: 'producedBy', message: 'A dataset names the Assessment that produced it (producedBy) or the system it was imported from (externalRefs); ADR-0063' }];
}

export async function validateLearningMetric(doc: TerminusDocument, index: number, _ctx: WriteContext): Promise<Violation[]> {
  void _ctx;
  if (names(doc, 'derivedFrom') || hasExternalRef(doc)) return [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  return [{ code: 'metric_without_source', id, index, field: 'derivedFrom', message: 'A metric names the dataset it was derived from (derivedFrom) or the system it came from (externalRefs); ADR-0063' }];
}
