/**
 * A workspace hub's records in a folder (lib/workspaceFolder.ts): one
 * `workspace.json` per workspace, written whole, never outside the folder;
 * the file-backed store's files beside them, and the lock one process holds.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFileStore } from './api/filestore/store';
import type { WorkspaceRecord } from './api/workspace/records';
import { folderFiles, folderRecords, lockFolder } from './workspaceFolder';

const record = (branch: string): WorkspaceRecord => ({
  branch,
  remote: 'http://localhost:3100',
  owner: 'User/demo-designer',
  ownerExternalId: 'demo-designer@example.edu',
  from: 'main',
  base: 'remotecommit',
  local: 'localcommit',
  clonedAt: '2026-11-01T12:00:00.000Z',
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'armature-workspaces-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('folderRecords', () => {
  it('lists nothing before the folder exists, then keeps each record in its own folder', async () => {
    const records = folderRecords(join(dir, 'not-yet'));
    expect(await records.list()).toEqual([]);
    await records.put(record('b_two'));
    await records.put(record('a_one'));
    expect((await records.list()).map((r) => r.branch)).toEqual(['a_one', 'b_two']);
    expect(await readdir(join(dir, 'not-yet', 'a_one'))).toEqual(['workspace.json']);
  });

  it('replaces a record whole and leaves no temporary file behind', async () => {
    const records = folderRecords(dir);
    await records.put(record('a_one'));
    await records.put({ ...record('a_one'), base: 'later' });
    expect((await records.get('a_one'))?.base).toBe('later');
    expect(await readdir(join(dir, 'a_one'))).toEqual(['workspace.json']);
  });

  it('never reads or writes outside the folder, and ignores what is not a workspace', async () => {
    await writeFile(join(dir, 'workspace.json'), JSON.stringify(record('outside')));
    await writeFile(join(dir, 'stray.txt'), 'not a workspace');
    const records = folderRecords(join(dir, 'inner'));
    await records.put(record('a_one'));
    expect(await records.get('..')).toBeUndefined();
    expect(await records.get('.')).toBeUndefined();
    await expect(records.put(record('../escape'))).rejects.toThrow(/Not a branch name/);
    expect((await folderRecords(dir).list()).map((r) => r.branch)).toEqual([]);
    expect(await records.get('missing')).toBeUndefined();
  });
});

describe('folderFiles', () => {
  it('reads, writes, lists and removes under the folder, and nothing outside it', async () => {
    const files = folderFiles(join(dir, 'store'));
    expect(await files.read('store.json')).toBeUndefined();
    expect(await files.list('')).toEqual([]);
    await files.write('main/commits/abc.json', '{"id":"abc"}');
    await files.write('main/head.json', '{"head":"abc"}');
    await files.write('store.json', '{}');
    expect(await files.list('')).toEqual(['main', 'store.json']);
    expect(await files.list('main')).toEqual(['commits', 'head.json']);
    expect(await files.read('main/commits/abc.json')).toBe('{"id":"abc"}');
    expect(await readdir(join(dir, 'store', 'main'))).toEqual(['commits', 'head.json']);
    await files.remove('main/commits');
    expect(await files.list('main')).toEqual(['head.json']);
    await files.remove('nothing/here');
    await expect(files.read('../outside.json')).rejects.toThrow(/Not a store path/);
    await expect(files.write('a/../../outside.json', 'x')).rejects.toThrow(/Not a store path/);
    await files.write('keep.txt', 'k');
    await files.remove('');
    expect(await files.list('')).toEqual([]);
  });
});

// The write-then-rename sequence and the lock on this machine's file system
// (ADR-0066 Verification): many replacements of one file in a row, and a file
// store written as files, reopened from disk. CI runs this file on a Windows
// runner too (`npm run test:files`), where rename semantics differ and Defender
// holds new files open; a folder inside a synced directory needs a real machine.
describe('the folder on this file system', () => {
  it('replaces one file hundreds of times in a row, each replacement whole, and leaves no temporary file', async () => {
    const files = folderFiles(dir);
    for (let i = 0; i < 300; i++) {
      await files.write('main/head.json', `{"head":"commit-${i}"}\n`);
      expect(await files.read('main/head.json')).toBe(`{"head":"commit-${i}"}\n`);
    }
    expect(await readdir(join(dir, 'main'))).toEqual(['head.json']);
  });

  it('holds a file store: commits written as files, reopened from disk, read at an earlier commit, stray temporary files ignored', async () => {
    const schema = [
      { '@type': '@context', '@base': 'http://armature.design/data/', '@schema': 'http://armature.design/schema#' },
      { '@type': 'Class', '@id': 'Thing', '@key': { '@type': 'Random' }, label: 'xsd:string' },
    ];
    const by = { author: 'User/t', message: 'm' };
    const folder = join(dir, 'store');
    const main = openFileStore(folderFiles(folder)).at({ branch: 'main' });
    await main.ensureDatabase();
    await main.replaceSchema(schema, { ...by, message: 'schema' });
    const commits: string[] = [];
    for (let i = 0; i < 40; i++) {
      commits.push((await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: `v${i}` }], { ...by, create: true })).commit);
    }
    // A crash between the temporary write and the rename leaves a temporary file behind; opening ignores it.
    await writeFile(join(folder, 'main', 'commits', 'abc.json.999.tmp'), 'partial');
    await writeFile(join(folder, 'store.json.999.tmp'), 'partial');
    const reopened = openFileStore(folderFiles(folder)).at({ branch: 'main' });
    expect((await reopened.head())?.id).toBe(commits[39]);
    expect((await reopened.getDocument('Thing/t')).document.label).toBe('v39');
    expect((await reopened.at({ commit: commits[9] }).getDocument('Thing/t')).document.label).toBe('v9');
    expect((await readdir(join(folder, 'main', 'commits'))).filter((f) => f.endsWith('.json'))).toHaveLength(41);
  });
});

describe('lockFolder', () => {
  it('is held by one process at a time, released on return, and taken over from a process that is gone', async () => {
    const release = await lockFolder(dir);
    expect(JSON.parse(await readFile(join(dir, 'lock'), 'utf8')).pid).toBe(process.pid);
    // This process holds it, so this process may take it again (the same hub restarting in place).
    await (await lockFolder(dir))();
    await release();
    expect(await readdir(dir)).toEqual([]);
    await writeFile(join(dir, 'lock'), JSON.stringify({ pid: 2 ** 22 - 1 }));
    await (await lockFolder(dir))();
    await writeFile(join(dir, 'lock'), 'not json');
    await (await lockFolder(dir))();
  });
});
