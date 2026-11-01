/**
 * A workspace hub's records in a folder (docs/workspace-hub-plan.md §10):
 * `<dir>/<branch>/workspace.json`, one folder per workspace, which the push
 * table and the commit files join at later steps. The host side of
 * `WorkspaceRecords` (`lib/api/workspace/records.ts`): the API never touches a
 * file, so it stays host-neutral, and `server.ts` hands it this.
 *
 * Every file is written under a temporary name, flushed, and renamed into
 * place, and the folder is flushed after the rename, so a crash leaves the old
 * record or the new one (ADR-0066 decision 2, note of 2026-10-30).
 */
import { mkdir, open, readdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { BRANCH_NAME } from './api/http';
import type { WorkspaceRecord, WorkspaceRecords } from './api/workspace/records';

const RECORD = 'workspace.json';

/** Flushes a file or a folder to disk. */
async function sync(path: string, flags: string): Promise<void> {
  const handle = await open(path, flags);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function folderRecords(dir: string): WorkspaceRecords {
  const read = async (branch: string): Promise<WorkspaceRecord | undefined> => {
    // A branch name is a folder name here; the pattern keeps it inside `dir`.
    if (!BRANCH_NAME.test(branch)) return undefined;
    try {
      return JSON.parse(await readFile(join(dir, branch, RECORD), 'utf8')) as WorkspaceRecord;
    } catch (err) {
      // No folder, or a file where a folder would be: no workspace by that name.
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;
      throw err;
    }
  };
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
    async put(record) {
      if (!BRANCH_NAME.test(record.branch)) throw new Error(`Not a branch name: ${JSON.stringify(record.branch)}`);
      const folder = join(dir, record.branch);
      await mkdir(folder, { recursive: true });
      const target = join(folder, RECORD);
      const temporary = `${target}.${process.pid}.tmp`;
      const handle = await open(temporary, 'w');
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
      await sync(folder, 'r');
    },
  };
}
