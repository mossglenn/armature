import { describe, expect, it } from 'vitest';
import { canonical } from '../fragments';
import { applyPatch, diffDocument, diffDocuments, diffValue } from './patch';

// The file-backed store's diff in TerminusDB's patch format (ADR-0066
// decision 5): the operations it emits, and that every patch applies back
// to the after state.

const same = (a: unknown, b: unknown) => expect(canonical(a)).toBe(canonical(b));

describe('diffValue', () => {
  it('swaps a changed scalar, with null for an absent side', () => {
    expect(diffValue('Jane', 'Janine')).toEqual({ '@op': 'SwapValue', '@before': 'Jane', '@after': 'Janine' });
    expect(diffValue(undefined, 3)).toEqual({ '@op': 'SwapValue', '@before': null, '@after': 3 });
    expect(diffValue('x', undefined)).toEqual({ '@op': 'SwapValue', '@before': 'x', '@after': null });
    expect(diffValue(2, 2)).toBeUndefined();
  });

  it('patches a nested object field by field', () => {
    expect(diffValue({ a: 1, b: { c: 'quux', d: 1 } }, { a: 1, b: { c: 'quuz', d: 1 } })).toEqual({
      b: { c: { '@op': 'SwapValue', '@before': 'quux', '@after': 'quuz' } },
    });
    expect(diffValue({ a: 1 }, { a: 1 })).toBeUndefined();
  });

  it('describes a list as a copy of the equal prefix, a swap of the changed region and the kept rest', () => {
    expect(diffValue([0, 1, 2], [0, 1, 2, 3])).toEqual({
      '@op': 'CopyList',
      '@to': 3,
      '@rest': { '@op': 'SwapList', '@before': [], '@after': [3], '@rest': { '@op': 'KeepList' } },
    });
    expect(diffValue(['a', 'b', 'c', 'd'], ['a', 'x', 'd'])).toEqual({
      '@op': 'CopyList',
      '@to': 1,
      '@rest': { '@op': 'SwapList', '@before': ['b', 'c'], '@after': ['x'], '@rest': { '@op': 'KeepList' } },
    });
    expect(diffValue(['a'], ['a'])).toBeUndefined();
  });

  it('patches objects of a list in place when the region keeps its length', () => {
    const before = [{ '@id': 'p/1', text: 'one' }, { '@id': 'p/2', text: 'two' }];
    const after = [{ '@id': 'p/1', text: 'one' }, { '@id': 'p/2', text: 'deux' }];
    expect(diffValue(before, after)).toEqual({
      '@op': 'CopyList',
      '@to': 1,
      '@rest': { '@op': 'PatchList', '@patch': [{ text: { '@op': 'SwapValue', '@before': 'two', '@after': 'deux' } }], '@rest': { '@op': 'KeepList' } },
    });
  });
});

describe('diffDocument and diffDocuments', () => {
  const jane = { '@id': 'Person/jane', '@type': 'Person', name: 'Jane' };

  it('is an insert, a delete, a patch under @id, or nothing', () => {
    expect(diffDocument(undefined, jane)).toEqual({ '@op': 'Insert', '@insert': jane });
    expect(diffDocument(jane, undefined)).toEqual({ '@op': 'Delete', '@delete': jane });
    expect(diffDocument(jane, { ...jane, name: 'Janine' })).toEqual({ '@id': 'Person/jane', name: { '@op': 'SwapValue', '@before': 'Jane', '@after': 'Janine' } });
    expect(diffDocument(jane, { ...jane })).toEqual({});
    expect(diffDocument(undefined, undefined)).toEqual({});
  });

  it('lists one entry per changed document, by id', () => {
    const before = new Map([
      ['Person/b', { '@id': 'Person/b', '@type': 'Person', name: 'B' }],
      ['Person/c', { '@id': 'Person/c', '@type': 'Person', name: 'C' }],
      ['Person/a', jane],
    ]);
    const after = new Map([
      ['Person/a', jane],
      ['Person/b', { '@id': 'Person/b', '@type': 'Person', name: 'Bee' }],
      ['Person/d', { '@id': 'Person/d', '@type': 'Person', name: 'D' }],
    ]);
    const entries = diffDocuments(before, after);
    expect(entries.map((e) => e['@id'] ?? e['@op'])).toEqual(['Person/b', 'Delete', 'Insert']);
  });
});

describe('applyPatch', () => {
  const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
    [
      { '@id': 'I/1', '@type': 'Item', label: 'a', tags: ['x', 'y'], options: [{ '@id': 'I/1/options/0/O/aaaa', text: 'one' }] },
      { '@id': 'I/1', '@type': 'Item', label: 'b', tags: ['x'], options: [{ '@id': 'I/1/options/0/O/bbbb', text: 'one' }, { '@id': 'I/1/options/1/O/cccc', text: 'two' }] },
    ],
    [
      { '@id': 'I/2', '@type': 'Item', stem: { '@id': 'I/2/stem/T/aaaa', text: 'old' }, n: 1 },
      { '@id': 'I/2', '@type': 'Item', stem: { '@id': 'I/2/stem/T/bbbb', text: 'new', extra: true } },
    ],
    [
      { '@id': 'I/3', '@type': 'Item', list: [1, 2, 3, 4, 5] },
      { '@id': 'I/3', '@type': 'Item', list: [1, 9, 9, 4, 5, 6] },
    ],
    [
      { '@id': 'I/4', '@type': 'Item', list: [{ a: 1 }, { a: 2 }, { a: 3 }] },
      { '@id': 'I/4', '@type': 'Item', list: [{ a: 1 }, { a: 20 }, { a: 3 }] },
    ],
    [
      { '@id': 'I/5', '@type': 'Item', list: ['a', 'b'] },
      { '@id': 'I/5', '@type': 'Item', list: [] },
    ],
  ];

  it('takes every before to its after', () => {
    for (const [before, after] of cases) {
      const applied = applyPatch(before, diffDocument(before, after)) as Record<string, unknown>;
      same(applied, after);
      expect(applied['@id']).toBe(after['@id']);
    }
  });

  it('inserts and deletes whole documents', () => {
    const doc = { '@id': 'I/6', '@type': 'Item' };
    expect(applyPatch(undefined, diffDocument(undefined, doc))).toEqual(doc);
    expect(applyPatch(doc, diffDocument(doc, undefined))).toBeUndefined();
  });
});
