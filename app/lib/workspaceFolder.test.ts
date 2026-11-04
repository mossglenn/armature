/**
 * A workspace hub's records in a folder (lib/workspaceFolder.ts): one
 * `workspace.json` per workspace, written whole, never outside the folder;
 * the file-backed store's files beside them, and the lock one process holds.
 */
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openFileStore } from './api/filestore/store';
import type { WorkspaceRecord } from './api/workspace/records';
import { RENAME_WAITS, folderFiles, folderRecords, lockFolder, sweepTemporaries, unreadable, unwritable } from './workspaceFolder';

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

// A process killed between the temporary write and the rename (ADR-0066
// Verification; rehearsed on a Windows laptop 2026-11-03 and kept here): a
// child built from these very modules writes three versions of one document,
// then dies by SIGKILL (TerminateProcess on Windows) the moment `rename` would
// move the next commit file, or the next head, into place. The folder must
// hold the old file whole, the store must reopen at the old head and take the
// next write, and the lock's sweep must remove what the child left.
const KILLED_CHILD = `
import { openFileStore } from './api/filestore/store';
import { folderFiles } from './workspaceFolder';
const [dir, seam] = process.argv.slice(2);
const fsp = require('fs').promises;
const real = fsp.rename;
let armed = false;
fsp.rename = async (from: string, to: string) => {
  const hit = seam === 'commit' ? to.includes('commits') && to.endsWith('.json') : to.endsWith('head.json');
  if (armed && hit) process.kill(process.pid, 'SIGKILL');
  return real(from, to);
};
const by = { author: 'User/t', message: 'm' };
const schema = [
  { '@type': '@context', '@base': 'http://armature.design/data/', '@schema': 'http://armature.design/schema#' },
  { '@type': 'Class', '@id': 'Thing', '@key': { '@type': 'Random' }, label: 'xsd:string' },
];
async function main() {
  const main = openFileStore(folderFiles(dir)).at({ branch: 'main' });
  await main.ensureDatabase();
  await main.replaceSchema(schema, by);
  for (let i = 0; i < 3; i++) await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: 'v' + i }], { ...by, create: true });
  armed = true;
  await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: 'killed' }], { ...by, create: true });
  console.log('NOT KILLED');
}
main().then(() => process.exit(3), (err) => { console.error(err); process.exit(2); });
`;

describe('a process killed between the temporary write and the rename', () => {
  it('leaves the old file whole; the store reopens at the old head, writes again, and the lock sweeps the temporary file', async () => {
    const child = join(dir, 'killed-child.cjs');
    await build({ stdin: { contents: KILLED_CHILD, resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: child, logLevel: 'silent' });
    for (const seam of ['commit', 'head'] as const) {
      const folder = join(dir, seam);
      const run = spawnSync(process.execPath, [child, folder, seam], { encoding: 'utf8' });
      // Killed: exit status 1 on Windows, the signal elsewhere; 3 would mean the write completed, 2 that it failed.
      expect(run.stdout, run.stderr).not.toContain('NOT KILLED');
      expect(run.status, run.stderr).not.toBe(2);
      const where = seam === 'commit' ? join(folder, 'main', 'commits') : join(folder, 'main');
      expect((await readdir(where)).filter((f) => f.endsWith('.tmp'))).toHaveLength(1);
      const main = openFileStore(folderFiles(folder)).at({ branch: 'main' });
      expect((await main.getDocument('Thing/t')).document.label).toBe('v2');
      await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: 'after' }], { author: 'User/t', message: 'm', create: true });
      expect((await openFileStore(folderFiles(folder)).at({ branch: 'main' }).getDocument('Thing/t')).document.label).toBe('after');
      await (await lockFolder(folder))();
      expect((await readdir(where)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    }
  });
});

describe('unreadable', () => {
  it('names a file the operating system refused to read, and nothing else', () => {
    const refused = unreadable({ code: 'UNKNOWN' }, 'C:/a/commits/b.json');
    expect(refused?.status).toBe(503);
    expect(refused?.kind).toBe('unreadable');
    expect(refused?.body).toEqual({ path: 'C:/a/commits/b.json', code: 'UNKNOWN' });
    expect(unreadable({ code: 'EIO' }, 'x')?.kind).toBe('unreadable');
    expect(unreadable({ code: 'ENOENT' }, 'x')).toBeUndefined();
    expect(unreadable(new Error('no code'), 'x')).toBeUndefined();
  });
});

describe('unwritable', () => {
  it('names a file another program held against a rename, and nothing else', () => {
    const held = unwritable({ code: 'EPERM' }, 'C:/a/push.json', 3);
    expect(held?.status).toBe(503);
    expect(held?.kind).toBe('unwritable');
    expect(held?.body).toEqual({ path: 'C:/a/push.json', code: 'EPERM', attempts: 3 });
    expect(unwritable({ code: 'EACCES' }, 'x', 1)?.kind).toBe('unwritable');
    expect(unwritable({ code: 'EBUSY' }, 'x', 1)?.kind).toBe('unwritable');
    expect(unwritable({ code: 'ENOENT' }, 'x', 1)).toBeUndefined();
    expect(unwritable({ code: 'UNKNOWN' }, 'x', 1)).toBeUndefined();
    expect(unwritable(new Error('no code'), 'x', 1)).toBeUndefined();
  });
});

// A rename refused while another program holds the target (ADR-0066
// Verification; met inside OneDrive on a Windows laptop 2026-11-03, where the
// sync client holds a file it was just handed): the same child as above, its
// `rename` refusing the next head with EPERM a given number of times, or every
// time. A refusal that clears must leave the write landed and no temporary
// file; one that never clears must leave the old head whole, the temporary
// removed, and the error named `unwritable` with every attempt counted.
const HELD_CHILD = `
import { openFileStore } from './api/filestore/store';
import { folderFiles } from './workspaceFolder';
const [dir, mode] = process.argv.slice(2);
const fsp = require('fs').promises;
const real = fsp.rename;
let armed = false;
let refused = 0;
fsp.rename = async (from: string, to: string) => {
  if (armed && to.endsWith('head.json') && (mode === 'always' || refused < Number(mode))) {
    refused++;
    throw Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM', errno: -4048, syscall: 'rename' });
  }
  return real(from, to);
};
const by = { author: 'User/t', message: 'm' };
const schema = [
  { '@type': '@context', '@base': 'http://armature.design/data/', '@schema': 'http://armature.design/schema#' },
  { '@type': 'Class', '@id': 'Thing', '@key': { '@type': 'Random' }, label: 'xsd:string' },
];
async function main() {
  const main = openFileStore(folderFiles(dir)).at({ branch: 'main' });
  await main.ensureDatabase();
  await main.replaceSchema(schema, by);
  for (let i = 0; i < 3; i++) await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: 'v' + i }], { ...by, create: true });
  armed = true;
  await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: 'retried' }], { ...by, create: true });
  console.log('LANDED after ' + refused + ' refusals');
}
main().then(() => process.exit(0), (err) => { console.error('FAILED ' + err.kind + ' ' + JSON.stringify(err.body)); process.exit(2); });
`;

describe('a rename refused while another program holds the file', () => {
  it('is tried again until it clears, and the write lands with no temporary file left', async () => {
    const child = join(dir, 'held-child.cjs');
    await build({ stdin: { contents: HELD_CHILD, resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: child, logLevel: 'silent' });
    const folder = join(dir, 'clears');
    const run = spawnSync(process.execPath, [child, folder, '2'], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('LANDED after 2 refusals');
    expect((await readdir(join(folder, 'main'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    expect((await openFileStore(folderFiles(folder)).at({ branch: 'main' }).getDocument('Thing/t')).document.label).toBe('retried');
  });

  it('gives up as unwritable after every wait, the old file whole and the temporary removed', async () => {
    const child = join(dir, 'held-child.cjs');
    await build({ stdin: { contents: HELD_CHILD, resolveDir: __dirname, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', outfile: child, logLevel: 'silent' });
    const folder = join(dir, 'never');
    const started = Date.now();
    const run = spawnSync(process.execPath, [child, folder, 'always'], { encoding: 'utf8' });
    const total = RENAME_WAITS.reduce((a, b) => a + b, 0);
    expect(run.status, run.stderr).toBe(2);
    expect(run.stderr).toContain(`FAILED unwritable {"path":"${join(folder, 'main', 'head.json').replace(/\\/g, '\\\\')}","code":"EPERM","attempts":${RENAME_WAITS.length + 1}}`);
    expect(Date.now() - started).toBeGreaterThanOrEqual(total);
    expect((await readdir(join(folder, 'main'))).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    const main = openFileStore(folderFiles(folder)).at({ branch: 'main' });
    expect((await main.getDocument('Thing/t')).document.label).toBe('v2');
    // A later write, with nothing holding the file, lands as before.
    await main.putDocuments([{ '@type': 'Thing', '@id': 'Thing/t', label: 'after' }], { author: 'User/t', message: 'm', create: true });
    expect((await openFileStore(folderFiles(folder)).at({ branch: 'main' }).getDocument('Thing/t')).document.label).toBe('after');
  });
});

describe('lockFolder', () => {
  it('sweeps the temporary files a dead process left, in the branch folders and their commits, and nothing else', async () => {
    const files = folderFiles(dir);
    await files.write('main/commits/abc.json', '{}');
    await writeFile(join(dir, 'store.json.111.tmp'), 'partial');
    await writeFile(join(dir, 'main', 'head.json.222.tmp'), 'partial');
    await writeFile(join(dir, 'main', 'commits', 'def.json.333.tmp'), 'partial');
    await writeFile(join(dir, 'main', 'notes.tmp'), 'kept: not a temporary of a write');
    await writeFile(join(dir, 'main', 'commits', 'ghi.json'), 'kept');
    const removed = await sweepTemporaries(dir);
    expect(removed.map((p) => p.slice(dir.length + 1).replace(/\\/g, '/')).sort()).toEqual(['main/commits/def.json.333.tmp', 'main/head.json.222.tmp', 'store.json.111.tmp']);
    expect((await readdir(join(dir, 'main'))).sort()).toEqual(['commits', 'notes.tmp']);
    expect((await readdir(join(dir, 'main', 'commits'))).sort()).toEqual(['abc.json', 'ghi.json']);
    expect(await sweepTemporaries(join(dir, 'absent'))).toEqual([]);
  });

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
