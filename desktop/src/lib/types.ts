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

/**
 * `remove`'s answer: what became of the branch on the remote (since 2026-11-07). After a discard
 * (`remove` with `discard`, since 2026-11-12) the remote is `untouched`, and `discarded` names the
 * commits given up and where the workspace's files were set aside in the workspaces folder.
 */
export interface RemoveResult {
  workspace: WorkspaceRecord;
  remote: 'deleted' | 'kept' | 'absent' | 'untouched';
  reason?: 'unmerged' | 'forbidden' | 'unreachable';
  discarded?: { commits: string[]; setAside?: string };
}

/** The remote's warning when a cloned branch is one the owner may not write (ADR-0068 decision 9). */
export interface WorkspaceWarning {
  code: 'forbidden';
  message: string;
  holders: string[];
}

/**
 * One required check's verdict, as a gate gives it (ADR-0070 decisions 6 and 8): in a push's or a
 * delivery's refusal (`checks_pending`, `checks_failed`), in its success, and in a delivery's dry
 * run. `reporter` is absent on a personal requirement, where any run on the machine counts.
 */
export interface CheckVerdict {
  check: string;
  requirement: string;
  level: 'Required' | 'Advisory';
  locked: boolean;
  reporter?: string;
  paramsHash: string;
  conclusion: 'pass' | 'fail' | 'neutral' | 'error' | 'pending';
  run?: { id: string; reportedAt: string; summary?: string; detailsUrl?: string };
  satisfied: boolean;
  overridden?: { reason: string };
}

export const isVerdicts = (value: unknown): value is CheckVerdict[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'object' && v !== null && typeof (v as CheckVerdict).check === 'string' && typeof (v as CheckVerdict).conclusion === 'string');

/** A verdict that stops its gate: required, not satisfied, not set aside. */
export const stops = (verdict: CheckVerdict): boolean => verdict.level === 'Required' && !verdict.satisfied && !verdict.overridden;

/** A check a person asks of their own pushes: an entry of `checks.json` in the workspaces folder (ADR-0070 decision 8). */
export interface PersonalRequirement {
  check: string;
  /** The workspace it binds; every workspace when absent. */
  branch?: string;
  fromPrefix?: string;
  level: 'Required' | 'Advisory';
  params: unknown;
  status: 'Active' | 'Revoked';
  rationale?: string;
}

/** `checks`' answer: the file, what it holds, and why the push gate cannot read it when it cannot. */
export interface PersonalChecks {
  file: string;
  requirements: PersonalRequirement[];
  invalid?: { message: string; issues: Array<{ path: string; message: string }> };
}
