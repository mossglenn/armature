import { execFileSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

/**
 * Whether a folder the person chose for their workspaces lies under a
 * directory a sync client keeps (docs/desktop-program-plan.md §9). The
 * program warns and does not refuse: the file-backed store works there, with
 * the costs the Windows rehearsal measured (ADR-0066, Verification,
 * 2026-11-03), and a person may have reasons.
 *
 * What is recognized: on macOS, iCloud Drive (`~/Library/Mobile Documents`)
 * and every File Provider client (`~/Library/CloudStorage/<client>`); on
 * Windows, the folders the OneDrive client names in its environment
 * variables; anywhere, a path segment a sync client names its folder by
 * (`OneDrive`, `OneDrive - <organization>`, `Dropbox`, `Dropbox (<team>)`,
 * `Google Drive`, `GoogleDrive`, `My Drive`, `iCloudDrive`). A synced folder
 * under another name is not recognized; the warning is a help, not a guard.
 *
 * Since 2026-11-16 (the 2026-11-09 review's C14) two things the path alone
 * does not say are asked of the machine. A link is followed first, so a
 * folder that is a symbolic link into a synced one is judged where it leads.
 * And on macOS, iCloud's "Desktop & Documents Folders" setting syncs
 * `~/Desktop` and `~/Documents` where they are, with nothing in their paths
 * to show it: the folder then carries the extended attribute
 * `com.apple.file-provider-domain-id` naming iCloud's file provider (seen on
 * a Mac with the setting on, 2026-11-16), which is read for those two
 * folders alone. Still unrecognized: Box, Nextcloud and Google Drive's
 * shared drives under names of their own.
 *
 * The machine is an argument, so the rules for each system are tested on
 * any; the default is this machine.
 */

export interface Machine {
  platform: NodeJS.Platform;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
  /** Where a path leads once its links are followed; the path itself when it cannot be told (a folder not yet made). Absent, paths are taken as written. */
  resolve?: (path: string) => string;
  /** A folder's file-provider domain, macOS's `com.apple.file-provider-domain-id`, or undefined when it has none. Absent, none is read. */
  fileProvider?: (path: string) => string | undefined;
}

/** The nearest existing ancestor's real path with the rest appended, so a folder not yet made under a link is still judged where it will be. */
function realPath(path: string): string {
  const { dirname, basename, join } = process.platform === 'win32' ? win32 : posix;
  try {
    return realpathSync.native(path);
  } catch {
    const parent = dirname(path);
    return parent === path ? path : join(realPath(parent), basename(path));
  }
}

/** macOS's file-provider attribute on `path`, read with the system's own tool since Node reads no extended attributes. */
function fileProviderOf(path: string): string | undefined {
  try {
    return execFileSync('/usr/bin/xattr', ['-p', 'com.apple.file-provider-domain-id', path], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined;
  } catch {
    return undefined;
  }
}

const thisMachine = (): Machine => ({
  platform: process.platform,
  home: homedir(),
  env: process.env,
  resolve: realPath,
  ...(process.platform === 'darwin' ? { fileProvider: fileProviderOf } : {}),
});

/** The environment variables the OneDrive client sets on Windows, each naming a synced folder. */
const ONEDRIVE_VARIABLES = ['OneDrive', 'OneDriveCommercial', 'OneDriveConsumer'];

/** A segment a sync client names its folder by, and the client. */
const SEGMENTS: ReadonlyArray<[RegExp, string]> = [
  [/^onedrive( - .+|-.+)?$/i, 'OneDrive'],
  [/^dropbox( \(.+\))?$/i, 'Dropbox'],
  [/^(google ?drive|my drive)$/i, 'Google Drive'],
  [/^iclouddrive$/i, 'iCloud Drive'],
];

/** The client a File Provider folder under `~/Library/CloudStorage` belongs to, from its name (`OneDrive-Personal`, `GoogleDrive-a@b.c`, `Dropbox`, `Box-Box`). */
function cloudStorageClient(folder: string): string {
  const name = folder.split('-')[0];
  if (/^googledrive$/i.test(name)) return 'Google Drive';
  return name || 'a cloud storage app';
}

/** The sync client that keeps `folder`, or undefined when none is recognized. */
export function syncClientOf(folder: string, machine: Machine = thisMachine()): string | undefined {
  const resolved = machine.resolve?.(folder) ?? folder;
  return clientOfPath(folder, machine) ?? (resolved === folder ? undefined : clientOfPath(resolved, machine));
}

function clientOfPath(folder: string, machine: Machine): string | undefined {
  const path = machine.platform === 'win32' ? win32 : posix;
  // Case decides nothing on the default file systems of macOS and Windows.
  const fold = machine.platform === 'linux' ? (s: string) => s : (s: string) => s.toLowerCase();
  const normal = path.normalize(folder);
  const segments = (p: string) => p.split(path.sep).filter(Boolean);
  /** The segments of `folder` below `root`, as written, when it lies within; compared as the file system compares. */
  const within = (root: string): string[] | undefined => {
    const relative = path.relative(fold(path.normalize(root)), fold(normal));
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined;
    return segments(normal).slice(segments(path.normalize(root)).length);
  };

  if (machine.platform === 'darwin') {
    // A folder's name on disk: vocabulary-allow: document
    if (within(path.join(machine.home, 'Library', 'Mobile Documents'))) return 'iCloud Drive';
    const cloud = within(path.join(machine.home, 'Library', 'CloudStorage'));
    if (cloud) return cloud.length ? cloudStorageClient(cloud[0]) : 'a cloud storage app';
    // "Desktop & Documents Folders": the two folders synced in place, told only by the attribute iCloud's provider sets on them.
    // Folders' names on disk: vocabulary-allow: document
    for (const name of ['Desktop', 'Documents']) {
      const synced = path.join(machine.home, name);
      if (within(synced) && /clouddocs|icloud/i.test(machine.fileProvider?.(synced) ?? '')) return 'iCloud Drive';
    }
  }
  if (machine.platform === 'win32') {
    for (const variable of ONEDRIVE_VARIABLES) {
      const root = machine.env[variable]?.trim();
      if (root && within(root)) return 'OneDrive';
    }
  }
  for (const segment of normal.split(path.sep)) {
    for (const [pattern, client] of SEGMENTS) if (pattern.test(segment)) return client;
  }
  return undefined;
}

/** What the program says when the folder is a synced one, or undefined. */
export function syncedFolderWarning(folder: string, machine: Machine = thisMachine()): string | undefined {
  const client = syncClientOf(folder, machine);
  if (!client) return undefined;
  return (
    `${folder} looks like a folder ${client} copies to the cloud. The workspaces work there, at a cost: ` +
    'a file it has made online-only cannot be read until it is downloaded again (503 store_unreadable), ' +
    'and a rename it holds up is retried for about two and a half seconds before the write is refused (503 store_unwritable). ' +
    'The app keeps its workspaces on this computer by default; a folder outside the copied one avoids both.'
  );
}
