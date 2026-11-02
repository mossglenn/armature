/**
 * The split rule (ADR-0065 decision 5, note of 2026-10-30), on documents
 * alone: no store. A push's parts follow what they name, keep documents that
 * name each other together, and refuse a group no request can hold.
 */
import { describe, expect, it } from 'vitest';
import type { TerminusDocument } from '../store';
import { GroupTooLarge, PART_LIMITS, splitIntoParts } from './split';

const doc = (id: string, fields: Record<string, unknown> = {}): TerminusDocument => ({ '@id': id, '@type': 'LearningNeed', ...fields }) as TerminusDocument;
const ids = (part: TerminusDocument[]) => part.map((d) => d['@id'] ?? d['@capture']);

describe('splitIntoParts', () => {
  it('sends a commit that fits as one part, in an order where each document follows what it names', () => {
    const parts = splitIntoParts([doc('C', { after: 'B' }), doc('B', { after: 'A' }), doc('A')]);
    expect(parts).toHaveLength(1);
    expect(ids(parts[0])).toEqual(['A', 'B', 'C']);
  });

  it('splits between groups only, never inside one, and keeps the order across parts', () => {
    // A and B name each other; C names B; D names nothing.
    const parts = splitIntoParts([doc('C', { after: 'B' }), doc('A', { peer: 'B' }), doc('B', { peer: 'A' }), doc('D')], { ...PART_LIMITS, documents: 2 });
    expect(parts.map(ids)).toEqual([['A', 'B'], ['C', 'D']]);
  });

  it('sees a name at any depth: in a list, a subdocument, and a @ref to a @capture', () => {
    const parts = splitIntoParts(
      [
        doc('Holder', { many: ['X', 'Y'], part: { nested: { '@ref': 'cap' } } }),
        { '@type': 'AssessmentItem', '@capture': 'cap', label: 'captured' } as unknown as TerminusDocument,
        doc('X'),
        doc('Y'),
      ],
      { ...PART_LIMITS, documents: 3 }
    );
    expect(parts).toHaveLength(2);
    expect(ids(parts[1])).toEqual(['Holder']);
    expect(ids(parts[0]).sort()).toEqual(['X', 'Y', 'cap']);
  });

  it('splits by bytes as well as by count', () => {
    const big = (id: string) => doc(id, { text: 'x'.repeat(1000) });
    const parts = splitIntoParts([big('A'), big('B'), big('C')], { documents: 500, bytes: 2500 });
    expect(parts.map(ids)).toEqual([['A', 'B'], ['C']]);
  });

  it('refuses a group that names itself round and cannot fit one request', () => {
    const cycle = [doc('A', { peer: 'B' }), doc('B', { peer: 'C' }), doc('C', { peer: 'A' })];
    expect(() => splitIntoParts(cycle, { ...PART_LIMITS, documents: 2 })).toThrow(GroupTooLarge);
    try {
      splitIntoParts(cycle, { ...PART_LIMITS, documents: 2 });
    } catch (err) {
      expect((err as GroupTooLarge).ids.sort()).toEqual(['A', 'B', 'C']);
    }
    expect(splitIntoParts([], PART_LIMITS)).toEqual([]);
  });
});
