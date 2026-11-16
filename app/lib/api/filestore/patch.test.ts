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

// ADR-0070 decision 12: inside a JSON value the two stores' operations may differ, and applyPatch
// reads both. The patch below is TerminusDB v12.0.7's own, copied from platform check AP4's record
// (node scripts/platform_checks.js, 2026-11-15) for the replace of one CheckRequirement's params.
describe('a patch inside a JSON value (platform check AP4)', () => {
  const before = { n: 1, ignore: ['a', 'b', 'c'], nested: { keep: 1, change: 1 }, list: [{ id: 'r1', on: true }, { id: 'r2', on: true }] };
  const after = { alpha: { severity: 'warning' }, added: [3], ignore: ['a', 'x', 'c'], nested: { keep: 1, change: 2 }, list: [{ id: 'r1', on: true }, { id: 'r2', on: false }] };
  const fromTheStore = {
    added: { '@after': [3], '@before': null, '@op': 'SwapValue' },
    alpha: { '@after': { severity: 'warning' }, '@before': null, '@op': 'SwapValue' },
    ignore: { '@op': 'CopyList', '@rest': { '@op': 'PatchList', '@patch': [{ '@after': 'x', '@before': 'b', '@op': 'SwapValue' }], '@rest': { '@op': 'KeepList' } }, '@to': 1 },
    list: [{}, { on: { '@after': false, '@before': true, '@op': 'SwapValue' } }],
    n: { '@after': null, '@before': 1, '@op': 'SwapValue' },
    nested: { change: { '@after': 2, '@before': 1, '@op': 'SwapValue' } },
  };

  it("applies the store's own patch: a key added, one removed, a scalar patched in a list, and a list of objects as a plain array of positional patches", () => {
    same(applyPatch(before, fromTheStore), after);
  });

  it('applies the positional array on its own: `{}` keeps an element, and an element past the end of the patch is kept', () => {
    const list = [{ id: 'r1', on: true }, { id: 'r2', on: true }, { id: 'r3', on: true }];
    same(applyPatch(list, [{}, { on: { '@op': 'SwapValue', '@before': true, '@after': false } }]), [{ id: 'r1', on: true }, { id: 'r2', on: false }, { id: 'r3', on: true }]);
    same(applyPatch(list, []), list);
    same(applyPatch({ list }, { list: [{ id: { '@op': 'SwapValue', '@before': 'r1', '@after': 'first' } }] }), { list: [{ id: 'first', on: true }, list[1], list[2]] });
  });

  it("this store's patch for the same change is a chain where the store's is an array, and gives the same after state", () => {
    const ours = diffValue(before, after) as Record<string, unknown>;
    expect(ours.list).toEqual({ '@op': 'CopyList', '@to': 1, '@rest': { '@op': 'PatchList', '@patch': [{ on: { '@op': 'SwapValue', '@before': true, '@after': false } }], '@rest': { '@op': 'KeepList' } } });
    expect(Array.isArray(fromTheStore.list)).toBe(true);
    same(applyPatch(before, ours), after);
    same(applyPatch(before, ours), applyPatch(before, fromTheStore));
  });

  it('cannot tell a key set to null from a key removed, as the format cannot: both read as removed', () => {
    expect(diffValue({ a: 1 }, { a: null })).toEqual(diffValue({ a: 1 }, {}));
    same(applyPatch({ a: 1, b: 2 }, diffValue({ a: 1, b: 2 }, { a: null, b: 2 })), { b: 2 });
  });
});
