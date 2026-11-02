/**
 * A workspace's own records on a workspace hub (docs/workspace-hub-plan.md §4,
 * §5 and §10): which remote and branch it came from, whose it is, and the
 * remote commit it was cloned at, its *base* (`workspace.json`); and the push
 * table (`push.json`), which local commit became which remote commit, with
 * the request possibly on the wire when the process died.
 *
 * Kept outside the store, in the workspace folder the plan lays out, so that
 * no commit message a tool writes can stand in for one; the commit files join
 * them at step 6. The API sees only this interface: the host gives a folder
 * (`app/lib/workspaceFolder.ts`, which uses the file system), a test gives
 * memory, and nothing under `app/lib/api/` touches a file.
 */
export interface WorkspaceRecord {
  /** The branch: the same name on the remote and in the local store. */
  branch: string;
  /** The remote hub's address the workspace was cloned from. */
  remote: string;
  /** The owner's `User` id on the remote, and their external identifier. */
  owner: string;
  ownerExternalId: string;
  /** The remote branch the workspace started from, when the workspace hub created the branch; absent when an existing branch was cloned. */
  from?: string;
  /** The remote commit cloned: the base. */
  base: string;
  /** The local commit holding the clone, the base's counterpart in the local store; local work is what follows it. */
  local: string;
  /** When the clone was made, ISO 8601. */
  clonedAt: string;
}

/** One local commit replayed on the remote (ADR-0065 decision 5). */
export interface PushedCommit {
  local: string;
  /** The remote commit holding the local commit's state: the last part's, when it was split. */
  remote: string;
  /** How many requests the commit was replayed as (ADR-0065 decision 5, note of 2026-10-30: the split rule). */
  parts: number;
  /** When the last part landed, ISO 8601. */
  pushedAt: string;
}

/**
 * The marker written before each request of a push (ADR-0066 decision 2,
 * note of 2026-10-30; review B4): after a crash, the request may or may not
 * have landed, and the next push settles it from the remote branch's log,
 * which holds the hub's own `Armature-Workspace-Commit` trailer when it did.
 */
export interface InFlight {
  local: string;
  /** This part, 1-based, of `total`. */
  part: number;
  total: number;
  /** The remote commit the request was conditioned on (`If-Match`). */
  ifMatch: string;
  /** The remote commits of the parts before this one, in order. */
  landed: string[];
  sentAt: string;
}

export interface PushTable {
  /** Oldest first; the clone's own commit is not here, it maps to the base. */
  commits: PushedCommit[];
  inFlight?: InFlight;
}

export const emptyPushTable = (): PushTable => ({ commits: [] });

export interface WorkspaceRecords {
  get(branch: string): Promise<WorkspaceRecord | undefined>;
  list(): Promise<WorkspaceRecord[]>;
  /** Writes the record whole, replacing any earlier one; a crash leaves the old record or the new, never part of one. */
  put(record: WorkspaceRecord): Promise<void>;
  /** The push table of a workspace this hub holds; undefined before its first push. */
  getPush(branch: string): Promise<PushTable | undefined>;
  /** Writes the table whole, under the same durability as `put`. */
  putPush(branch: string, table: PushTable): Promise<void>;
}

/** Records held in memory, for the tests and for a hub that need not outlive its process. */
export function memoryRecords(): WorkspaceRecords {
  const held = new Map<string, WorkspaceRecord>();
  const tables = new Map<string, PushTable>();
  return {
    async get(branch) {
      const record = held.get(branch);
      return record && { ...record };
    },
    async list() {
      return [...held.values()].map((r) => ({ ...r })).sort((a, b) => a.branch.localeCompare(b.branch));
    },
    async put(record) {
      held.set(record.branch, { ...record });
    },
    async getPush(branch) {
      const table = tables.get(branch);
      return table && structuredClone(table);
    },
    async putPush(branch, table) {
      tables.set(branch, structuredClone(table));
    },
  };
}
