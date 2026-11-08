/**
 * What the pages read in the core's replies: the bodies of the core's own requests
 * (app/lib/desktop/core.ts) and of the workspace routes it answers through (app/lib/api/routes/
 * workspace.ts, docs/api.md's Workspace section). Kept to the fields a page uses.
 */
import type { InstanceProfile } from '@armature/client';

export type { InstanceProfile };

/** A refusal as the hub's routes give one: `{ error, message, ...details }`, `remote: true` when the remote gave it. */
export interface Refusal {
  error: string;
  message: string;
  remote?: boolean;
  reason?: string;
  [detail: string]: unknown;
}

export const isRefusal = (body: unknown): body is Refusal =>
  typeof body === 'object' && body !== null && typeof (body as Refusal).error === 'string' && typeof (body as Refusal).message === 'string';

export type RemoteIdentity = { resolver: 'header' } | { resolver: 'oidc'; issuer: string; clientId: string };

/** `profile`'s answer: what the remote's GET /discover says, checked as the program can use it. */
export interface Profile {
  remote: string;
  instance?: InstanceProfile;
  identity: RemoteIdentity;
  versions: string[];
  /** The contract revision this program's hub speaks. */
  revision: string;
  compatible: boolean;
  warning?: string;
}

export interface Settings {
  remote?: string;
  instance?: InstanceProfile;
  identity?: RemoteIdentity;
  folder?: string;
  port: number;
  snapshots: number;
  user?: string;
  startAtLogin: boolean;
}

export interface SettingsReply {
  settings: Settings;
  /** True when a change takes effect only once the hub starts again. */
  restart?: boolean;
  /** The synced-folder warning, when the workspaces folder looks synced. */
  warning?: string;
}

export interface Person {
  id: string;
  externalId: string;
  displayName?: string;
}

export interface WorkspaceRecord {
  branch: string;
  remote: string;
  owner: string;
  ownerExternalId: string;
  from?: string;
  base: string;
  local: string;
  clonedAt: string;
  instance?: InstanceProfile;
}

export interface WorkspaceStatus {
  workspace: WorkspaceRecord;
  head?: string;
  localCommits: number;
  pushed: number;
  unpushed: number;
  snapshots: { budget: number; held: string[]; declined: unknown[] };
  remote: { head: string; moved: boolean } | { reachable: false };
}

/** A commit as the branch log gives it, newest first. */
export interface CommitEntry {
  commit: string;
  author: string;
  message: string;
  timestamp: number;
}

/** The remote's warning when a cloned branch is one the owner may not write (ADR-0068 decision 9). */
export interface WorkspaceWarning {
  code: 'forbidden';
  message: string;
  holders: string[];
}
