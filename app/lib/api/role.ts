import type { Context, Hono } from 'hono';
import { hubOf, type HubRole } from './config';
import { ApiError } from './errors';
import { isSnapshotBranch } from './workspace/snapshots';

/**
 * A hub's role (ADR-0065; docs/workspace-hub-plan.md §2 and §9).
 *
 * A remote hub is a hub as built: workspaces are created, merged and deleted
 * there and `User`s registered. A workspace hub is the same API in workspace
 * mode on one person's machine; what changes the remote's shared state
 * happens on the remote, so it answers those routes 400 `remote_only`, and its
 * `main` is the mirror of the remote's, read but never written. Tools learn
 * the role, and which routes are refused, from `GET /discover`.
 */

/** The routes only a remote hub serves, as the app's route table spells them under /api/v1, with the capability each belongs to. */
export const REMOTE_ONLY = [
  { method: 'POST', path: '/branches', capability: 'armature/branches', what: 'A workspace is created on the remote' },
  { method: 'POST', path: '/branches/:name/merge', capability: 'armature/branches', what: 'A merge happens on the remote' },
  { method: 'DELETE', path: '/branches/:name', capability: 'armature/branches', what: 'A branch is deleted on the remote' },
  { method: 'POST', path: '/users', capability: 'armature/users', what: 'A User is registered on the remote' },
] as const;

/** The branch a workspace hub serves only for reading: the remote's `main`, mirrored. */
export const MIRROR_BRANCH = 'main';

const remoteOnly = (what: string) =>
  new ApiError(400, 'remote_only', `${what}, not on a workspace hub`);

/**
 * Registers the refusals ahead of the route groups, so a refused request
 * reaches neither identity nor the store. On a remote hub each passes through.
 */
export function guardRemoteOnly(app: Hono): void {
  for (const route of REMOTE_ONLY) {
    app.on(route.method, route.path, async (c, next) => {
      if (hubOf(c).role === 'workspace') throw remoteOnly(route.what);
      await next();
    });
  }
}

/** Refuses a write to the mirror of `main`, or to a snapshot of the remote (plan §8), on a workspace hub. */
export function refuseMirrorWrite(c: Context, branch: string): void {
  if (hubOf(c).role !== 'workspace') return;
  if (branch === MIRROR_BRANCH) {
    throw remoteOnly(`${MIRROR_BRANCH} is the remote's, mirrored here for reading; write on a workspace, and the remote's ${MIRROR_BRANCH} receives it by delivery`);
  }
  if (isSnapshotBranch(branch)) {
    throw remoteOnly(`${branch} is a snapshot of the remote at an older commit, kept for reading`);
  }
}

/** Whether a branch is the clone's own, left out of `GET /branches` on a workspace hub. */
export const isInternalBranch = (role: HubRole, name: string): boolean => role === 'workspace' && isSnapshotBranch(name);

/** What `GET /discover` says a capability refuses: none on a remote, the table's on a workspace hub. */
export function remoteOnlyRoutes(role: HubRole, capability: string): string[] {
  if (role !== 'workspace') return [];
  return REMOTE_ONLY.filter((r) => r.capability === capability).map((r) => `${r.method} /api/v1${r.path}`);
}

/** The branches `GET /discover` says are read-only: none on a remote, the mirror on a workspace hub. */
export const readOnlyBranches = (role: HubRole): string[] => (role === 'workspace' ? [MIRROR_BRANCH] : []);
