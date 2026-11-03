/**
 * A workspace hub's records in a folder (docs/workspace-hub-plan.md §10):
 * `<dir>/<branch>/workspace.json`, one folder per workspace, and beside it
 * `push.json`, the push table, since the plan's step 3, `snapshots.json`, the
 * remote commits held as snapshots or declined, and `log.json`, the remote
 * branch's log at the clone, since step 5; and since step 6 the file-backed
 * store's `head.json` and `commits/` in the same folder (`folderFiles`,
 * below). The host side of `WorkspaceRecords` (`lib/api/workspace/records.ts`)
 * and of `StoreFiles` (`lib/api/filestore/files.ts`): the API never touches a
 * file, so it stays host-neutral, and `server.ts` hands it these.
 *
 * Every file is written under a temporary name, flushed, and renamed into
 * place, and the folder is flushed after the rename, so a crash leaves the old
 * record or the new one (ADR-0066 decision 2, note of 2026-10-30).
 */
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import type { StoreFiles } from './api/filestore/files';
import { BRANCH_NAME } from './api/http';
import type { PushTable, RemoteLog, Snapshots, WorkspaceRecord, WorkspaceRecords } from './api/workspace/records';

const RECORD = 'workspace.json';
const PUSH = 'push.json';
const SNAPSHOTS = 'snapshots.json';
const LOG = 'log.json';

/** Flushes a file or a folder to disk. */
async function sync(path: string, flags: string): Promise<void> {
  const handle = await open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Writes `target` whole and durably: a temporary name, flushed, renamed into place, the folder flushed. */
async function writeWhole(target: string, text: string): Promise<void> {
  const folder = join(target, '..');
  await mkdir(folder, { recursive: true });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  await sync(folder, 'r');
}

const isMissing = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/** A relative store path as a path under `dir`; refuses one that would leave it. */
function under(dir: string, path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.some((p) => p === '..' || p.includes(sep))) throw new Error(`Not a store path: ${JSON.stringify(path)}`);
  return join(dir, ...parts);
}

/**
 * The file-backed store's folder (ADR-0066 decision 2; `lib/api/filestore/`):
 * `StoreFiles` over `dir`, each file written as the records are. `main` and
 * the snapshots are branch folders beside the workspaces, and a workspace's
 * branch folder is its folder, so the two interfaces share `dir`.
 *
 * Only one process writes a store: `lockFolder` takes `<dir>/lock`, holding
 * this process's id, and refuses the folder while another live process holds
 * it; a lock left by a process that is gone is taken over.
 */
export function folderFiles(dir: string): StoreFiles {
  return {
    async read(path) {
      try {
        return await readFile(under(dir, path), 'utf8');
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw err;
      }
    },
    async write(path, text) {
      await writeWhole(under(dir, path), text);
    },
    async list(path) {
      try {
        return (await readdir(under(dir, path))).sort();
      } catch (err) {
        if (isMissing(err)) return [];
        throw err;
      }
    },
    async remove(path) {
      const target = under(dir, path);
      if (target === dir) {
        for (const name of await this.list('')) await rm(join(dir, name), { recursive: true, force: true });
      } else {
        await rm(target, { recursive: true, force: true });
      }
      await sync(join(target, '..'), 'r').catch(() => undefined);
    },
  };
}

const LOCK = 'lock';

/** Whether a process with this id is alive on this machine. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the store's lock for this process, or throws naming the process that
 * holds it. Returns the release, which removes the lock; a lock a dead
 * process left is replaced.
 */
export async function lockFolder(dir: string): Promise<() => Promise<void>> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, LOCK);
  const claim = JSON.stringify({ pid: process.pid, since: new Date().toISOString() });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx');
      try {
        await handle.writeFile(`${claim}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      return () => rm(path, { force: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
    let holder: { pid?: number } = {};
    try {
      holder = JSON.parse(await readFile(path, 'utf8')) as { pid?: number };
    } catch {
      // An unreadable lock is a dead one.
    }
    if (holder.pid !== undefined && holder.pid !== process.pid && alive(holder.pid)) {
      throw new Error(`${dir} is open in another Armature hub (process ${holder.pid}); one process writes a store at a time`);
    }
    await rm(path, { force: true });
  }
  throw new Error(`${dir} could not be locked`);
}

export function folderRecords(dir: string): WorkspaceRecords {
  const readJson = async <T>(branch: string, file: string): Promise<T | undefined> => {
    // A branch name is a folder name here; the pattern keeps it inside `dir`.
    if (!BRANCH_NAME.test(branch)) return undefined;
    try {
      return JSON.parse(await readFile(join(dir, branch, file), 'utf8')) as T;
    } catch (err) {
      // No folder, or a file where a folder would be: nothing by that name.
      if (isMissing(err)) return undefined;
      throw err;
    }
  };
  const writeJson = async (branch: string, file: string, value: unknown): Promise<void> => {
    if (!BRANCH_NAME.test(branch)) throw new Error(`Not a branch name: ${JSON.stringify(branch)}`);
    await writeWhole(join(dir, branch, file), `${JSON.stringify(value, null, 2)}\n`);
  };
  const read = (branch: string) => readJson<WorkspaceRecord>(branch, RECORD);
  return {
    get: read,
    async list() {
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
      const records = await Promise.all(entries.map(read));
      return records.filter((r): r is WorkspaceRecord => r !== undefined).sort((a, b) => a.branch.localeCompare(b.branch));
    },
    put: (record) => writeJson(record.branch, RECORD, record),
    getPush: (branch) => readJson<PushTable>(branch, PUSH),
    putPush: (branch, table) => writeJson(branch, PUSH, table),
    getSnapshots: (branch) => readJson<Snapshots>(branch, SNAPSHOTS),
    putSnapshots: (branch, snapshots) => writeJson(branch, SNAPSHOTS, snapshots),
    getLog: (branch) => readJson<RemoteLog>(branch, LOG),
    putLog: (branch, log) => writeJson(branch, LOG, log),
    async remove(branch) {
      if (!BRANCH_NAME.test(branch)) throw new Error(`Not a branch name: ${JSON.stringify(branch)}`);
      await rm(join(dir, branch), { recursive: true, force: true });
      await sync(dir, 'r').catch(() => undefined);
    },
  };
}
