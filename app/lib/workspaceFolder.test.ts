/**
 * A workspace hub's records in a folder (lib/workspaceFolder.ts): one
 * `workspace.json` per workspace, written whole, never outside the folder.
 */
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceRecord } from './api/workspace/records';
import { folderRecords } from './workspaceFolder';

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
