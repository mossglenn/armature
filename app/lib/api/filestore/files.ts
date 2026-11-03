/**
 * What the file-backed store asks of its folder (ADR-0066 decision 2; the
 * workspace hub plan's §10): text files under relative paths, each written
 * whole. The API never touches a file (ADR-0054): the host gives a folder
 * (`app/lib/workspaceFolder.ts`, `folderFiles`), a test gives memory, and the
 * store (`./store.ts`) is written against this interface alone, so one test
 * covers both.
 *
 * Paths are `/`-separated and relative to the store's root: `store.json`,
 * `<branch>/head.json`, `<branch>/commits/<id>.json`. A folder comes into
 * being with the first file written under it.
 */
export interface StoreFiles {
  /** The file's text, or undefined when there is none. */
  read(path: string): Promise<string | undefined>;
  /**
   * Writes the file whole, durably: under a temporary name, flushed, renamed
   * into place, its folder flushed; a crash leaves the old file or the new,
   * never part of one (ADR-0066 decision 2, note of 2026-10-30).
   */
  write(path: string, text: string): Promise<void>;
  /** The names of a folder's entries, files and folders alike; [] when the folder does not exist. */
  list(dir: string): Promise<string[]>;
  /** Removes a file, or a folder with everything in it; nothing when absent. */
  remove(path: string): Promise<void>;
}

/** Files held in memory, for the tests and for a store that need not outlive its process. */
export function memoryFiles(): StoreFiles {
  const held = new Map<string, string>();
  const within = (dir: string) => (dir ? `${dir}/` : '');
  return {
    async read(path) {
      return held.get(path);
    },
    async write(path, text) {
      held.set(path, text);
    },
    async list(dir) {
      const prefix = within(dir);
      const names = new Set<string>();
      for (const path of held.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name) names.add(name);
      }
      return [...names].sort();
    },
    async remove(path) {
      const prefix = within(path);
      for (const key of [...held.keys()]) {
        if (key === path || (prefix && key.startsWith(prefix)) || path === '') held.delete(key);
      }
    },
  };
}
