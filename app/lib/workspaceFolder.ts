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
 * record or the new one (ADR-0066 decision 2, note of 2026-10-30); the
 * temporary file such a crash leaves is removed when the next process takes
 * the lock (`sweepTemporaries`). A file the operating system refuses to read
 * is reported as such (`unreadable`), not as an internal error; a rename
 * refused while another program holds the file is tried again for a few
 * seconds before it is reported (`unwritable`). All from the rehearsal on a
 * Windows PC (ADR-0066 Verification, 2026-11-03).
 */
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import type { StoreFiles } from './api/filestore/files';
import { BRANCH_NAME } from './api/http';
import { StoreError } from './api/store';
import type { PushTable, RemoteLog, Snapshots, WorkspaceRecord, WorkspaceRecords } from './api/workspace/records';

const RECORD = 'workspace.json';
const PUSH = 'push.json';
const SNAPSHOTS = 'snapshots.json';
const LOG = 'log.json';

/** Flushes a file to disk. */
async function sync(path: string, flags: string): Promise<void> {
  const handle = await open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Flushes a folder, so a rename into it is on disk: what macOS and Linux need
 * after `rename`. Windows has no such call: flushing a directory handle is
 * refused (`EPERM`, every write on the CI runner, 2026-11-02; ADR-0066
 * Verification), and NTFS journals the rename itself, so there is nothing to
 * do.
 */
async function syncFolder(path: string): Promise<void> {
  if (process.platform === 'win32') return;
  await sync(path, 'r');
}

/**
 * The waits, in milliseconds, between attempts to rename a file into place
 * when the system refuses because another program holds the target: about
 * 2.5 seconds in all. Windows refuses a rename over a file a sync client has
 * open (a sharing violation, surfacing as `EPERM`, `EACCES` or `EBUSY`), for
 * the moment the client takes to upload what it was just handed; the
 * rehearsal inside OneDrive met it once in 280 renames while the client was
 * busy, cleared by a second attempt 15 ms later (ADR-0066 Verification,
 * 2026-11-03). Retrying with a short backoff is what graceful-fs does there.
 * A refusal that outlasts the waits is reported as `unwritable`.
 */
export const RENAME_WAITS = [10, 20, 40, 80, 160, 320, 640, 1280];

const HELD = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * A rename the operating system refused because another program holds the
 * target, after `attempts` tries. The hub answers 503 `store_unwritable`
 * naming the file; nothing is lost, since the old file stands and the next
 * write tries again. Any other refusal is not this error.
 */
export const unwritable = (err: unknown, path: string, attempts: number): StoreError | undefined => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === undefined || !HELD.has(code)) return undefined;
  return new StoreError(503, 'store_unwritable', { path, code, attempts }, 'unwritable');
};

/** Renames `temporary` over `target`, trying again through `RENAME_WAITS` while the target is held; gives up as `unwritable`, the temporary removed. */
async function renameInto(temporary: string, target: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temporary, target);
      return;
    } catch (err) {
      const held = unwritable(err, target, attempt);
      if (!held) throw err;
      if (attempt > RENAME_WAITS.length) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw held;
      }
      await wait(RENAME_WAITS[attempt - 1]);
    }
  }
}

/** Writes `target` whole and durably: a temporary name, flushed, renamed into place (`renameInto`), the folder flushed where the platform has it. */
export async function writeWhole(target: string, text: string): Promise<void> {
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
  await renameInto(temporary, target);
  await syncFolder(folder);
}

const isMissing = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
};

/**
 * A read the operating system refused although the file is there. On Windows
 * a file a sync service has made cloud-only, read while that service is
 * stopped or the machine offline, fails with libuv's `UNKNOWN` (errno -4094;
 * rehearsed with OneDrive's Files On-Demand, 2026-11-03); macOS reports an
 * evicted file as `EIO`. The hub answers 503 `store_unreadable` naming the
 * file, and the store reads its folder again on the next request.
 */
export const unreadable = (err: unknown, path: string): StoreError | undefined => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code !== 'UNKNOWN' && code !== 'EIO') return undefined;
  return new StoreError(503, 'store_unreadable', { path, code }, 'unreadable');
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
      const target = under(dir, path);
      try {
        return await readFile(target, 'utf8');
      } catch (err) {
        if (isMissing(err)) return undefined;
        throw unreadable(err, target) ?? err;
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
        for (const name of await this.list('')) await rm(join(dir, name), REMOVAL);
      } else {
        await rm(target, REMOVAL);
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
 * A removal is tried again while the operating system refuses it because
 * another program holds the file (a sync client, an indexer), as a rename is
 * (`RENAME_WAITS`): Node's own retry, on `EBUSY`, `EPERM` and `ENOTEMPTY`, six
 * times over about two seconds. Until 2026-11-11 a removal had one try, and a
 * workspace's removal that failed on it could not be asked for again (the
 * 2026-11-09 review's W2).
 */
const REMOVAL = { recursive: true, force: true, maxRetries: 6, retryDelay: 100 } as const;

/** What `writeWhole` names a file while it is being written. */
const TEMPORARY = /\.\d+\.tmp$/;

/**
 * Removes the temporary files a process that died between the write and the
 * rename left under `dir`: beside the marker, in each branch folder and in
 * its `commits/`. Opening ignores them, but nothing else removes them, and in
 * a synced folder they would be uploaded. Run once the lock is held, when no
 * other process is writing. Returns what it removed.
 */
export async function sweepTemporaries(dir: string): Promise<string[]> {
  const removed: string[] = [];
  const sweep = async (folder: string, depth: number): Promise<void> => {
    let entries;
    try {
      entries = await readdir(folder, { withFileTypes: true });
    } catch (err) {
      if (isMissing(err)) return;
      throw err;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isFile() && TEMPORARY.test(entry.name)) {
        await rm(path, { force: true });
        removed.push(path);
      } else if (entry.isDirectory() && (depth === 0 ? BRANCH_NAME.test(entry.name) : depth === 1 && entry.name === 'commits')) {
        await sweep(path, depth + 1);
      }
    }
  };
  await sweep(dir, 0);
  return removed;
}

/**
 * Takes the store's lock for this process, or throws naming the process that
 * holds it. Returns the release, which removes the lock; a lock a dead
 * process left is replaced, and so are the temporary files it left mid-write.
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
      await sweepTemporaries(dir);
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
      await rm(join(dir, branch), REMOVAL);
      await sync(dir, 'r').catch(() => undefined);
    },
  };
}
