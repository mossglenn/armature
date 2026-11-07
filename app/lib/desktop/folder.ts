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
 * The machine is an argument, so the rules for each system are tested on
 * any; the default is this machine.
 */

export interface Machine {
  platform: NodeJS.Platform;
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

const thisMachine = (): Machine => ({ platform: process.platform, home: homedir(), env: process.env });

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
  return name || 'a sync client';
}

/** The sync client that keeps `folder`, or undefined when none is recognized. */
export function syncClientOf(folder: string, machine: Machine = thisMachine()): string | undefined {
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
    if (within(path.join(machine.home, 'Library', 'Mobile Documents'))) return 'iCloud Drive';
    const cloud = within(path.join(machine.home, 'Library', 'CloudStorage'));
    if (cloud) return cloud.length ? cloudStorageClient(cloud[0]) : 'a sync client';
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
    `${folder} looks like a folder ${client} keeps in sync. The workspaces work there, at a cost: ` +
    'a file the client has made online-only cannot be read until it is downloaded again (503 store_unreadable), ' +
    'and a rename the client holds up is retried for about two and a half seconds before the write is refused (503 store_unwritable). ' +
    'The program keeps its workspaces on this machine by default; a folder outside the synced one avoids both.'
  );
}
