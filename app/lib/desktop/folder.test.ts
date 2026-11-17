/**
 * The synced-folder warning (./folder.ts; docs/desktop-program-plan.md §9),
 * on example paths for each system, whichever system runs the test. No store.
 */
import { describe, expect, it } from 'vitest';
import { syncClientOf, syncedFolderWarning, type Machine } from './folder';

const mac: Machine = { platform: 'darwin', home: '/Users/amos', env: {} };
const windows: Machine = {
  platform: 'win32',
  home: 'C:\\Users\\amos',
  env: { OneDrive: 'C:\\Users\\amos\\OneDrive - Example University', OneDriveConsumer: 'D:\\Sync\\Personal' },
};
const linux: Machine = { platform: 'linux', home: '/home/amos', env: {} };

describe('syncClientOf', () => {
  it('recognizes iCloud Drive and the File Provider clients on macOS', () => {
    expect(syncClientOf('/Users/amos/Library/Mobile Documents/com~apple~CloudDocs/Armature', mac)).toBe('iCloud Drive');
    expect(syncClientOf('/Users/amos/Library/CloudStorage/OneDrive-Personal/Armature', mac)).toBe('OneDrive');
    expect(syncClientOf('/Users/amos/Library/CloudStorage/GoogleDrive-amos@example.edu/My Drive/x', mac)).toBe('Google Drive');
    expect(syncClientOf('/Users/amos/Library/CloudStorage/Dropbox/Armature', mac)).toBe('Dropbox');
    expect(syncClientOf('/Users/amos/Library/CloudStorage/Box-Box/Armature', mac)).toBe('Box');
    // Case decides nothing on the Mac's file system.
    expect(syncClientOf('/users/AMOS/library/cloudstorage/Dropbox', mac)).toBe('Dropbox');
  });

  it('leaves the program’s own folder and other local folders alone on macOS', () => {
    expect(syncClientOf('/Users/amos/Library/Application Support/com.mossglenn.armature/workspaces', mac)).toBeUndefined();
    expect(syncClientOf('/Users/amos/Documents/Armature', mac)).toBeUndefined();
    expect(syncClientOf('/Users/amos/Library/CloudStorageNotReally/x', mac)).toBeUndefined();
  });

  it('recognizes the OneDrive client’s folders by its variables on Windows, whatever they are named', () => {
    expect(syncClientOf('C:\\Users\\amos\\OneDrive - Example University\\Armature', windows)).toBe('OneDrive');
    expect(syncClientOf('d:\\sync\\personal\\Armature', windows)).toBe('OneDrive');
    expect(syncClientOf('D:\\Sync\\Other', windows)).toBeUndefined();
  });

  it('recognizes a client by its folder’s name anywhere', () => {
    expect(syncClientOf('C:\\Users\\amos\\Dropbox (Example Team)\\Armature', windows)).toBe('Dropbox');
    expect(syncClientOf('G:\\My Drive\\Armature', windows)).toBe('Google Drive');
    expect(syncClientOf('C:\\Users\\amos\\iCloudDrive\\Armature', windows)).toBe('iCloud Drive');
    expect(syncClientOf('/home/amos/Dropbox/Armature', linux)).toBe('Dropbox');
    expect(syncClientOf('/home/amos/OneDrive/Armature', linux)).toBe('OneDrive');
  });

  it('leaves the program’s default folders alone on Windows and Linux', () => {
    expect(syncClientOf('C:\\Users\\amos\\AppData\\Local\\com.mossglenn.armature\\workspaces', windows)).toBeUndefined();
    expect(syncClientOf('/home/amos/.local/share/com.mossglenn.armature/workspaces', linux)).toBeUndefined();
    // A name that merely contains a client's is not one.
    expect(syncClientOf('/home/amos/notes-on-dropbox/x', linux)).toBeUndefined();
  });
});

describe("what the path alone does not say (the 2026-11-09 review's C14)", () => {
  it('follows a link: a folder that leads into a synced one is judged where it leads', () => {
    const linked: Machine = { ...mac, resolve: (path) => path.replace('/Users/amos/Work', '/Users/amos/Library/Mobile Documents/com~apple~CloudDocs/Work') };
    expect(syncClientOf('/Users/amos/Work/Armature', linked)).toBe('iCloud Drive');
    expect(syncClientOf('/Users/amos/Elsewhere/Armature', linked)).toBeUndefined();
  });

  it("knows iCloud's Desktop and Documents by the attribute the two folders carry, and nothing else by it", () => {
    const provider = 'com.apple.CloudDocs.iCloudDriveFileProvider/52C4531D-11F5-4EB6-91A2-8D88F00D433E';
    const asked: string[] = [];
    const on: Machine = { ...mac, fileProvider: (path) => (asked.push(path), path === '/Users/amos/Documents' || path === '/Users/amos/Desktop' ? provider : undefined) };
    expect(syncClientOf('/Users/amos/Documents/Armature', on)).toBe('iCloud Drive');
    expect(syncClientOf('/Users/amos/Desktop', on)).toBe('iCloud Drive');
    // A folder under neither is not asked about: the attribute is read for those two alone.
    asked.length = 0;
    expect(syncClientOf('/Users/amos/Music/Armature', on)).toBeUndefined();
    expect(asked).toEqual([]);
    // The setting off: the folders carry no such attribute, or another provider's.
    expect(syncClientOf('/Users/amos/Documents/Armature', { ...mac, fileProvider: () => undefined })).toBeUndefined();
    expect(syncClientOf('/Users/amos/Documents/Armature', { ...mac, fileProvider: () => 'com.example.other/1' })).toBeUndefined();
    // No such rule elsewhere.
    expect(syncClientOf('/home/amos/Documents/Armature', { ...linux, fileProvider: () => provider })).toBeUndefined();
  });
});

describe('syncedFolderWarning', () => {
  it('names the client and both costs the rehearsal measured, or says nothing', () => {
    const warning = syncedFolderWarning('/Users/amos/Library/Mobile Documents/com~apple~CloudDocs/Armature', mac);
    expect(warning).toContain('iCloud Drive');
    expect(warning).toContain('store_unreadable');
    expect(warning).toContain('store_unwritable');
    expect(syncedFolderWarning('/Users/amos/Documents/Armature', mac)).toBeUndefined();
  });
});
