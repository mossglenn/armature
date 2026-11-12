import { describe, expect, it } from 'vitest';
import { StoreError, type OperatorStore } from '../store';
import { memoryFiles, type StoreFiles } from './files';
import { encodeKeyPart, keyString, SchemaIndex, sha256Hex } from './ids';
import { openFileStore } from './store';

// The file-backed store on its own, over memory files and a small schema:
// what it mints, what it refuses, what it keeps and what it remembers
// across an open (ADR-0066). No TerminusDB is involved; the two-store
// contract test (contract.test.ts) holds it to the adapter's answers on the
// seed.

const BASE = 'http://armature.design/data/';
const SCHEMA = 'http://armature.design/schema#';
const schema: Record<string, unknown>[] = [
  { '@type': '@context', '@base': BASE, '@schema': SCHEMA },
  { '@type': 'Enum', '@id': 'Tone', '@value': ['Warm', 'Cool'] },
  { '@type': 'Class', '@id': 'Base', '@abstract': [], label: 'xsd:string' },
  {
    '@type': 'Class',
    '@id': 'Thing',
    '@inherits': 'Base',
    '@key': { '@type': 'Random' },
    tags: { '@type': 'Set', '@class': 'xsd:string' },
    parts: { '@type': 'List', '@class': 'Part' },
    note: { '@type': 'Optional', '@class': 'Part' },
  },
  { '@type': 'Class', '@id': 'Other', '@inherits': 'Base', '@key': { '@type': 'Random' } },
  { '@type': 'Class', '@id': 'Part', '@subdocument': [], '@key': { '@type': 'Random' }, text: 'xsd:string' },
  {
    '@type': 'Class',
    '@id': 'Link',
    '@key': { '@type': 'Hash', '@fields': ['a', 'tone', 'memo'] },
    a: 'Thing',
    tone: 'Tone',
    memo: { '@type': 'Optional', '@class': 'xsd:string' },
  },
];

const by = { author: 'User/t', message: 'm' };
const thing = (id: string, extra: Record<string, unknown> = {}) => ({ '@type': 'Thing', '@id': `Thing/${id}`, label: id, ...extra });

async function fresh(files: StoreFiles = memoryFiles()): Promise<{ files: StoreFiles; main: OperatorStore }> {
  const main = openFileStore(files).at({ branch: 'main' });
  await main.ensureDatabase();
  await main.replaceSchema(schema, { ...by, message: 'schema' });
  return { files, main };
}

const kind = async (work: Promise<unknown>): Promise<string | undefined> => {
  try {
    await work;
    return undefined;
  } catch (err) {
    return err instanceof StoreError ? `${err.status} ${err.kind}` : String(err);
  }
};

describe('the store and its branches', () => {
  it('marks a folder as a store with a main branch once', async () => {
    const files = memoryFiles();
    const store = openFileStore(files);
    expect(await store.at({ branch: 'main' }).ensureDatabase()).toBe(true);
    expect(await store.at({ branch: 'main' }).ensureDatabase()).toBe(false);
    expect(await store.at({ branch: 'main' }).listBranches()).toEqual(['main']);
    expect(await files.list('')).toEqual(['main', 'store.json']);
    expect(await store.at({ branch: 'main' }).head()).toBeUndefined();
  });

  it('refuses a branch or a commit it does not have', async () => {
    const { main } = await fresh();
    expect(await kind(main.at({ branch: 'nope' }).allDocuments())).toBe('404 unknown_ref');
    expect(await kind(main.at({ commit: 'abc123' }).allDocuments())).toBe('404 unknown_ref');
    expect(await kind(main.at({ branch: 'nope' }).putDocuments([thing('x')], by))).toBe('404 unknown_ref');
    expect(await main.getCommit('abc123')).toBeUndefined();
  });
});

describe('ids (ADR-0066 decision 6, check AI)', () => {
  it('builds the Lexical string as the store does and hashes it', async () => {
    const index = new SchemaIndex(schema);
    const link = { '@type': 'Link', a: 'Thing/t1', tone: 'Warm' };
    const info = index.class('Link');
    expect(info?.key).toEqual({ type: 'Hash', fields: ['a', 'tone', 'memo'] });
    expect(keyString(index, info!, link)).toBe('http%3A%2F%2Farmature.design%2Fdata%2FThing%2Ft1+http%3A%2F%2Farmature.design%2Fschema%23Tone%2FWarm++none+');
    expect(encodeKeyPart(" !\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~")).toBe("%20!%22%23$%25&'()*%2B,-.%2F%3A;%3C=%3E%3F@%5B%5C%5D%5E_%60%7B%7C%7D~");
    expect(encodeKeyPart('café')).toBe('caf%C3%A9');
    const { main } = await fresh();
    await main.putDocuments([thing('t1')], by);
    const { ids } = await main.putDocuments([link], by);
    expect(ids).toEqual([`Link/${await sha256Hex(keyString(index, info!, link))}`]);
    // The same key is the same document: a second write replaces, and the id is found by it.
    const again = await main.putDocuments([{ ...link, memo: undefined }], by);
    expect(again.ids).toEqual(ids);
    expect((await main.queryDocuments('Link', {})).documents).toHaveLength(1);
  });

  it('mints a Random id of sixteen URL-safe characters, and nested ids for parts, regenerated on every write', async () => {
    const { main } = await fresh();
    const { ids } = await main.putDocuments([{ '@type': 'Thing', label: 'anon', parts: [{ '@type': 'Part', text: 'p' }], note: { '@type': 'Part', text: 'n' } }], by);
    expect(ids[0]).toMatch(/^Thing\/[A-Za-z0-9_-]{16}$/);
    const first = (await main.getDocument(ids[0])).document;
    const partId = (first.parts as Array<{ '@id': string }>)[0]['@id'];
    expect(partId).toMatch(new RegExp(`^${ids[0]}/parts/0/Part/[A-Za-z0-9_-]{16}$`));
    expect((first.note as { '@id': string })['@id']).toMatch(new RegExp(`^${ids[0]}/note/Part/[A-Za-z0-9_-]{16}$`));
    await main.putDocuments([{ ...first }], by);
    const second = (await main.getDocument(ids[0])).document;
    expect((second.parts as Array<{ '@id': string }>)[0]['@id']).not.toBe(partId);
    expect(Object.keys(second)).toEqual(['@id', '@type', 'label', 'note', 'parts']);
  });

  it('checks a given id for its prefix and, for a Hash key, against the minted one; an insert of a taken id is refused', async () => {
    const { main } = await fresh();
    await main.putDocuments([thing('t1')], by);
    expect(await kind(main.putDocuments([{ '@type': 'Thing', '@id': 'Other/t2' }], by))).toBe('400 id_prefix');
    expect(await kind(main.putDocuments([{ '@type': 'Link', '@id': 'Link/wrong', a: 'Thing/t1', tone: 'Warm' }], by))).toBe('400 id_mismatch');
    expect(await kind(main.insertDocument({ ...thing('t1') }, by))).toBe('400 exists');
    expect(await kind(main.insertDocuments([thing('t3'), thing('t3')], by))).toBe('400 exists');
    expect(await kind(main.putDocuments([thing('t4')], { ...by, create: false }))).toBe('404 not_found');
    expect(await kind(main.putDocuments([{ '@type': 'Nope', '@id': 'Nope/x' }], by))).toBe('400 other');
    expect(await kind(main.putDocuments([{ '@type': 'Part', text: 'alone' }], by))).toBe('400 other');
  });

  it('resolves @capture and @ref within one write, inside a key too', async () => {
    const { main } = await fresh();
    const { ids } = await main.putDocuments(
      [
        { '@type': 'Link', a: { '@ref': 'new' }, tone: 'Cool' },
        { '@type': 'Thing', '@capture': 'new', label: 'captured', tags: [{ '@ref': 'new' }] },
      ],
      by
    );
    const index = new SchemaIndex(schema);
    expect(ids[0]).toBe(`Link/${await sha256Hex(keyString(index, index.class('Link')!, { a: ids[1], tone: 'Cool' }))}`);
    const captured = (await main.getDocument(ids[1])).document;
    expect(captured['@capture']).toBeUndefined();
    expect(captured.tags).toEqual([ids[1]]);
    expect(await kind(main.putDocuments([{ '@type': 'Link', a: { '@ref': 'nobody' }, tone: 'Cool' }], by))).toBe('400 other');
  });
});

describe('documents', () => {
  it('drops an empty Set, keeps an empty List, and lists a type with its subclasses by id', async () => {
    const { main } = await fresh();
    await main.putDocuments([thing('b', { tags: [], parts: [] }), thing('a', { tags: ['x', 'y'] }), { '@type': 'Other', '@id': 'Other/o', label: 'o' }], by);
    const b = (await main.getDocument('Thing/b')).document;
    expect(b.tags).toBeUndefined();
    expect(b.parts).toEqual([]);
    expect((await main.queryDocuments('Base', {})).documents.map((d) => d['@id'])).toEqual(['Other/o', 'Thing/a', 'Thing/b']);
    expect((await main.queryDocuments('Thing', { tags: 'y' })).documents.map((d) => d['@id'])).toEqual(['Thing/a']);
    expect((await main.queryDocuments('Thing', { label: 'b' })).documents.map((d) => d['@id'])).toEqual(['Thing/b']);
    expect((await main.queryDocuments('Base', {}, { skip: 1, count: 1 })).documents.map((d) => d['@id'])).toEqual(['Thing/a']);
    expect((await main.getDocuments(['Thing/b', 'Thing/none', 'Thing/a'])).documents.map((d) => d['@id'])).toEqual(['Thing/b', 'Thing/a']);
    expect((await main.allDocuments()).documents.map((d) => d['@id'])).toEqual(['Other/o', 'Thing/a', 'Thing/b']);
  });

  it('deletes a document as a commit, after which its id is free again', async () => {
    const { main } = await fresh();
    await main.putDocuments([thing('t')], by);
    await main.deleteDocument('Thing/t', by);
    expect(await kind(main.getDocument('Thing/t'))).toBe('404 not_found');
    expect(await kind(main.deleteDocument('Thing/t', by))).toBe('404 not_found');
    await main.insertDocument(thing('t'), by);
    expect((await main.getDocument('Thing/t')).document.label).toBe('t');
  });
});

describe('commits, history and diff', () => {
  it('chains commits, reads at any of them and conditions a write on the head', async () => {
    const { main } = await fresh();
    const first = await main.putDocuments([thing('t', { label: 'one' })], by);
    const second = await main.putDocuments([thing('t', { label: 'two' })], { ...by, ifMatch: first.commit });
    expect(await kind(main.putDocuments([thing('t', { label: 'three' })], { ...by, ifMatch: first.commit }))).toBe('412 version_mismatch');
    expect((await main.head())?.id).toBe(second.commit);
    expect((await main.getCommit(second.commit))?.parent).toBe(first.commit);
    expect((await main.log({ count: 2 })).map((c) => c.id)).toEqual([second.commit, first.commit]);
    expect((await main.log({ start: 2 })).map((c) => c.message)).toEqual(['schema']);
    expect((await main.at({ commit: first.commit }).getDocument('Thing/t')).document.label).toBe('one');
    expect((await main.at({ commit: first.commit }).getDocument('Thing/t')).commit).toBe(first.commit);
    expect((await main.at({ commit: first.commit }).log()).map((c) => c.id)).toEqual([first.commit, (await main.log({ start: 2 }))[0].id]);
    expect((await main.getDocument('Thing/t')).commit).toBe(second.commit);
  });

  it('reports the commits that touched a document with each one’s change, and the difference between any two versions', async () => {
    const { main } = await fresh();
    const first = await main.putDocuments([thing('t', { label: 'one' }), thing('u')], by);
    const second = await main.putDocuments([thing('t', { label: 'two' })], by);
    const { entries, commit } = await main.history('Thing/t');
    expect(commit).toBe(second.commit);
    expect(entries.map((e) => e.id)).toEqual([second.commit, first.commit]);
    expect(entries[0].diff).toEqual({ '@id': 'Thing/t', label: { '@op': 'SwapValue', '@before': 'one', '@after': 'two' } });
    expect((entries[1].diff as Record<string, unknown>)['@op']).toBe('Insert');
    expect((await main.history('Thing/t', { start: 1, count: 1, diff: false })).entries.map((e) => e.id)).toEqual([first.commit]);
    expect(await main.diff(first.commit, second.commit, 'Thing/u')).toEqual({});
    expect(await main.diff(first.commit, 'main')).toEqual([{ '@id': 'Thing/t', label: { '@op': 'SwapValue', '@before': 'one', '@after': 'two' } }]);
    const beforeAny = (await main.log({ start: 2 }))[0].id;
    expect((await main.diff(beforeAny, first.commit)) as unknown[]).toHaveLength(2);
  });

  it('lands two writes sent at once as two commits in a chain', async () => {
    const { main } = await fresh();
    const [a, b] = await Promise.all([main.putDocuments([thing('a')], by), main.putDocuments([thing('b')], by)]);
    expect((await main.getCommit(b.commit))?.parent).toBe(a.commit);
    expect((await main.allDocuments()).documents).toHaveLength(2);
  });
});

describe('branches', () => {
  it('shares history with the branch it was made from, and is deleted with only the commits no branch reaches', async () => {
    const { files, main } = await fresh();
    const base = await main.putDocuments([thing('t')], by);
    await main.createBranch('work', { branch: 'main' });
    const work = main.at({ branch: 'work' });
    const own = await work.putDocuments([thing('w')], by);
    expect((await work.log()).map((c) => c.id)).toContain(base.commit);
    expect((await main.allDocuments()).documents.map((d) => d['@id'])).toEqual(['Thing/t']);
    expect((await work.allDocuments()).documents.map((d) => d['@id'])).toEqual(['Thing/t', 'Thing/w']);
    expect(await files.list('work/commits')).toEqual([`${own.commit}.json`]);
    await main.createBranch('from-work', { commit: own.commit });
    expect(await kind(main.createBranch('work', { branch: 'main' }))).toBe('400 exists');
    expect(await kind(main.createBranch('x', { branch: 'nope' }))).toBe('404 unknown_ref');
    await main.deleteBranch('work');
    expect(await main.listBranches()).toEqual(['from-work', 'main']);
    // from-work still reaches work's commit, so its file stays.
    expect(await files.list('work/commits')).toEqual([`${own.commit}.json`]);
    await main.deleteBranch('from-work');
    expect(await files.list('work')).toEqual([]);
    expect(await main.getCommit(own.commit)).toBeUndefined();
    expect(await kind(main.deleteBranch('work'))).toBe('404 unknown_ref');
  });

  it('starts an empty branch with no schema and no commit, and refuses a merge', async () => {
    const { main } = await fresh();
    await main.createEmptyBranch('empty');
    const empty = main.at({ branch: 'empty' });
    expect(await empty.head()).toBeUndefined();
    expect((await empty.getSchema()).entries).toEqual([]);
    expect(await kind(empty.putDocuments([{ '@type': 'Thing', label: 'no schema' }], by))).toBeUndefined();
    expect(await kind(main.apply('main', { base: 'a', source: 'b', author: 'x', message: 'y' }))).toBe('400 other');
  });
});

describe('a branch deleted while another is written (the 2026-11-09 review’s W1)', () => {
  /** Files whose write of one path waits until released, so a delete can run between a commit file and its head. */
  function held(path: string): { files: StoreFiles; reached: Promise<void>; arm: () => void; release: () => void } {
    const inner = memoryFiles();
    let reach!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (reach = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    let armed = false;
    const files: StoreFiles = {
      ...inner,
      async write(target, text) {
        if (armed && target === path) {
          reach();
          await gate;
        }
        await inner.write(target, text);
      },
    };
    return { files, reached, arm: () => void (armed = true), release };
  }

  it('keeps the commit of a write in flight on another branch, and the folder opens again', async () => {
    const gate = held('kept/head.json');
    const { files, main } = await fresh(gate.files);
    await main.createBranch('kept', { branch: 'main' });
    await main.createBranch('gone', { branch: 'main' });
    await main.at({ branch: 'gone' }).putDocuments([thing('g')], by);
    const kept = main.at({ branch: 'kept' });

    gate.arm();
    const writing = kept.putDocuments([thing('k')], by);
    await gate.reached; // the commit file is written, the head not yet moved
    const deleting = main.deleteBranch('gone');
    gate.release();
    const [{ commit }] = await Promise.all([writing, deleting]);

    expect((await kept.head())?.id).toBe(commit);
    expect((await kept.allDocuments()).documents.map((d) => d['@id'])).toContain('Thing/k');
    expect(await files.list('kept/commits')).toContain(`${commit}.json`);
    const again = openFileStore(files).at({ branch: 'kept' });
    expect((await again.allDocuments()).documents.map((d) => d['@id'])).toContain('Thing/k');
  });

  it('does not bring back a branch deleted while a write to it was in flight', async () => {
    const gate = held('gone/head.json');
    const { files, main } = await fresh(gate.files);
    await main.createBranch('gone', { branch: 'main' });
    const gone = main.at({ branch: 'gone' });

    gate.arm();
    const writing = kind(gone.putDocuments([thing('g')], by));
    await gate.reached;
    const deleting = main.deleteBranch('gone');
    gate.release();
    await Promise.all([writing, deleting]);

    // Whichever went first, the branch is gone and the folder is whole.
    expect(await main.listBranches()).toEqual(['main']);
    expect(await openFileStore(files).at({ branch: 'main' }).listBranches()).toEqual(['main']);
  });
});

describe('exclusive, the hub\u2019s write queue (ADR-0025 decision 7, note of 2026-11-06)', () => {
  it('lets work holding it commit: it is not the queue commits go through', async () => {
    const { main } = await fresh();
    const { commit } = await main.exclusive(() => main.putDocuments([thing('held')], by));
    expect((await main.head())?.id).toBe(commit);
  });

  it('runs the writers of one branch from reading the head to the commit, one at a time', async () => {
    const { main } = await fresh();
    const write = (i: number) =>
      main.exclusive(async () => {
        const head = (await main.head())?.id;
        await new Promise((resolve) => setImmediate(resolve));
        return main.putDocuments([thing(`w${i}`)], { ...by, ifMatch: head });
      });
    const before = (await main.log({ count: 100 })).length;
    await Promise.all([0, 1, 2, 3].map(write));
    expect((await main.log({ count: 100 })).length).toBe(before + 4);
  });
});

describe('the folder', () => {
  it('is read back whole by a second open, and a commit file that does not match its name is refused', async () => {
    const { files, main } = await fresh();
    const { commit } = await main.putDocuments([thing('t', { label: 'kept' })], by);
    const reopened = openFileStore(files).at({ branch: 'main' });
    expect((await reopened.getDocument('Thing/t')).document.label).toBe('kept');
    expect((await reopened.head())?.id).toBe(commit);
    expect((await reopened.getSchema()).entries).toEqual(schema);
    const path = `main/commits/${commit}.json`;
    await files.write(path, (await files.read(path))!.replace('"kept"', '"forged"'));
    await expect(openFileStore(files).at({ branch: 'main' }).head()).rejects.toThrow(/does not match its name/);
  });

  it('removes what the store wrote and nothing else', async () => {
    const { files, main } = await fresh();
    await main.putDocuments([thing('t')], by);
    await files.write('main/workspace.json', '{}');
    await main.deleteDatabase();
    expect(await files.list('')).toEqual(['main']);
    expect(await files.list('main')).toEqual(['workspace.json']);
    expect(await main.ensureDatabase()).toBe(true);
  });

  it('reads the folder again after an open that failed, rather than keeping the failure', async () => {
    // A file the operating system refuses today (cloud-only under a stopped
    // sync service; ADR-0066 Verification, 2026-11-03) may read tomorrow.
    const files = memoryFiles();
    const main = openFileStore(files).at({ branch: 'main' });
    await main.ensureDatabase();
    await main.replaceSchema(schema, by);
    const { commit } = await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: 'x' }], { ...by, create: true });
    let refusing = true;
    const flaky: StoreFiles = {
      ...files,
      read: async (path) => {
        if (refusing && path.endsWith(`${commit}.json`)) throw new StoreError(503, 'store_unreadable', { path }, 'unreadable');
        return files.read(path);
      },
    };
    const reopened = openFileStore(flaky).at({ branch: 'main' });
    await expect(reopened.head()).rejects.toMatchObject({ kind: 'unreadable' });
    await expect(reopened.head()).rejects.toMatchObject({ kind: 'unreadable' });
    refusing = false;
    expect((await reopened.head())?.id).toBe(commit);
    expect((await reopened.getDocument('Thing/t')).document.label).toBe('x');
  });
});
