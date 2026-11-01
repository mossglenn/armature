/**
 * A workspace's own record on a workspace hub (docs/workspace-hub-plan.md §4
 * and §10): which remote and branch it came from, whose it is, and the remote
 * commit it was cloned at, its *base*.
 *
 * Kept outside the store, in the workspace folder the plan lays out
 * (`<workspace>/workspace.json`), so that no commit message a tool writes can
 * stand in for one; the push table (`push.json`) joins it at step 3 and the
 * commit files at step 6. The API sees only this interface: the host gives a
 * folder (`app/lib/workspaceFolder.ts`, which uses the file system), a test
 * gives memory, and nothing under `app/lib/api/` touches a file.
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

export interface WorkspaceRecords {
  get(branch: string): Promise<WorkspaceRecord | undefined>;
  list(): Promise<WorkspaceRecord[]>;
  /** Writes the record whole, replacing any earlier one; a crash leaves the old record or the new, never part of one. */
  put(record: WorkspaceRecord): Promise<void>;
}

/** Records held in memory, for the tests and for a hub that need not outlive its process. */
export function memoryRecords(): WorkspaceRecords {
  const held = new Map<string, WorkspaceRecord>();
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
  };
}
