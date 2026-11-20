/**
 * What the pages read in the core's replies: the bodies of the core's own requests
 * (app/lib/desktop/core.ts) and of the workspace routes it answers through (app/lib/api/routes/
 * workspace.ts, docs/api.md's Workspace section). Kept to the fields a page uses.
 */
import type { CheckVerdict, InstanceProfile, PersonalRequirement } from '@armature/client';

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
  /** This installation's identifier, drawn by the core at its first start (ADR-0072 decision 2); shown nowhere, set by no page. */
  installation?: string;
  /** The name the person gave this computer, shown where one of their workspaces is linked elsewhere; unset, nothing is sent. */
  computerName?: string;
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

/**
 * The workspace routes' answers, the hub's own types from `@armature/client`, not copies: the pages
 * read what the core relays from those routes, and a field the route gains or renames is then a
 * compile error here, not a page quietly reading `undefined` (the 2026-11-09 review's P15 and D8).
 */
export type {
  BringInResult,
  CheckVerdict,
  MergeConflict,
  PersonalRequirement,
  PushResult,
  RemoteWorkspace,
  RemoveResult,
  RequestHealth,
  RequestMerged,
  RequestState,
  Violation,
  WorkspaceRecord,
  WorkspaceStatus,
} from '@armature/client';

/** `elsewhere`'s answer: the person's workspaces on the instance that are not on this computer (ADR-0072 decision 7). */
export interface Elsewhere {
  unlinked: import('@armature/client').RemoteWorkspace[];
  linkedElsewhere: import('@armature/client').RemoteWorkspace[];
}

/** `awaitRemoteChange`'s answer: where to ask from next, and whether a merge request's health may have changed. */
export interface RemoteChange {
  cursor: string | null;
  changed: boolean;
  stopped?: boolean;
}

/** A commit as the branch log gives it, newest first. */
export type { Commit as CommitEntry } from '@armature/client';

export const isVerdicts = (value: unknown): value is CheckVerdict[] =>
  Array.isArray(value) && value.every((v) => typeof v === 'object' && v !== null && typeof (v as CheckVerdict).check === 'string' && typeof (v as CheckVerdict).conclusion === 'string');

/** A verdict that stops its gate: required, not satisfied, not set aside. */
export const stops = (verdict: CheckVerdict): boolean => verdict.level === 'Required' && !verdict.satisfied && !verdict.overridden;

/** `checks`' answer: the file, what it holds, and why the push gate cannot read it when it cannot. */
export interface PersonalChecks {
  file: string;
  requirements: PersonalRequirement[];
  invalid?: { message: string; issues: Array<{ path: string; message: string }> };
}
