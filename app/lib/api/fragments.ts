import { CLASS_CATEGORY, CLASS_FIELDS, type FieldShape } from '@/lib/types';
import type { TerminusDocument } from './store';

/**
 * A record's parts and how two states of one are compared (architecture
 * decision records ADR-0023, ADR-0028 decisions 6 and 7).
 *
 * A part is found by its client-assigned `fragmentId`, never by position or
 * by the store's nested `@id`: a replace regenerates every subdocument id
 * (platform checks J4, AB4) and the store's diff of a list is positional
 * (AB1). Which fields hold parts is read from the schema: every field whose
 * class is in the `fragment` category (ADR-0027), so a later type with parts
 * needs no change here. Constraint 16 and the attestation staleness read use
 * the same lookup, so "the same fragment" means one thing in both.
 */

const fieldsOf = (type: string): Record<string, FieldShape> =>
  (CLASS_FIELDS as Record<string, Record<string, FieldShape>>)[type] ?? {};

const isFragmentClass = (type: string): boolean => (CLASS_CATEGORY as Record<string, string>)[type] === 'fragment';

/** The fields of `type` that hold parts. */
const fragmentFields = (type: string): string[] =>
  Object.entries(fieldsOf(type))
    .filter(([, shape]) => shape.kind === 'subdocument' && isFragmentClass(shape.type))
    .map(([field]) => field);

/** True when a record names a part of its subject: it has a top-level `fragmentId`. */
export const namesFragment = (type: string): boolean =>
  !isFragmentClass(type) && Object.prototype.hasOwnProperty.call(fieldsOf(type), 'fragmentId');

/** The record's parts by `fragmentId`. A type without parts has none. */
export function fragmentsOf(doc: TerminusDocument): Map<string, Record<string, unknown>> {
  const out = new Map<string, Record<string, unknown>>();
  for (const field of fragmentFields(doc['@type'])) {
    const value = doc[field];
    for (const part of Array.isArray(value) ? value : [value]) {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).fragmentId === 'string') {
        out.set((part as Record<string, string>).fragmentId, part as Record<string, unknown>);
      }
    }
  }
  return out;
}

/**
 * A value as a string that is equal for equal content: keys sorted, every
 * `@id` removed. A part's `@id` is the store's and is regenerated on replace;
 * a whole record compared with itself at two commits has the same `@id` on
 * both sides, so dropping it loses nothing. List order is kept: the order of
 * an item's options is the item's.
 */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== '@id')
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
