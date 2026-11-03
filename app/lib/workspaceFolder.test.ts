/**
 * A workspace hub's records in a folder (lib/workspaceFolder.ts): one
 * `workspace.json` per workspace, written whole, never outside the folder;
 * the file-backed store's files beside them, and the lock one process holds.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
