import type { Context } from 'hono';
import type { GrantRole } from '@armature/types';
import { hubOf } from './config';
import { ApiError } from './errors';
import { grantsAt, isActive, type GrantDocument } from './grants';
import { isAgentExternalId, principalOf, registry, REGISTRY_BRANCH, type ResolvedUser } from './identity';
import type { TerminusDocument } from './store';

/**
 * Authorization (architecture decision record ADR-0068 decisions 1 and 4):
 * once a request's identity is resolved and before anything is written, may
 * it do what it asks? The answer is read from the grants in force on `main`,
 * once per request, and a refusal is 403 `forbidden` naming the permission
 * that is missing and the branch it concerns.
 *
 * The table, as decision 4 has it:
 *
 *   create a branch          any registered User (nothing to check here)
 *   write to / merge into B  B's Owner, or a Maintainer of B or of every branch
 *   write to / merge into main   a Maintainer of main or of every branch
 *   delete B                 B's Owner, or a Maintainer of B or of every branch
 *   grant Maintainer on B    B's Owner, or an Administrator
 *   grant anything else      an Administrator
 *   register an agent        any person
 *   register a person        an Administrator
 *
 * A branch with no Owner in force is writable, mergeable and deletable by any
 * registered User, as before this decision: the migration window of decision
 * 3's note is open, and `GET /discover` says so (`ownerlessBranches`). The
 * check runs on a remote hub under every resolver; a workspace hub does not
 * authorize (decision 9). The operator tools are outside the API and outside
 * this (ADR-0062). An agent acting for a person may do what the person may
 * (ADR-0067 decision 3): the person's grants are read, the agent's never.
 */
export type Operation =
  | { permission: 'write'; branch: string }
  | { permission: 'merge'; branch: string }
  | { permission: 'delete'; branch: string }
  | { permission: 'grant'; role: GrantRole; branch?: string }
  | { permission: 'register'; agent: boolean };

declare module 'hono' {
  interface ContextVariableMap {
    /** The grants in force on `main`, read once per request. */
    grants?: GrantDocument[];
  }
}

/** The grants in force on `main` at the request's time, read once per request. */
export async function activeGrants(c: Context): Promise<GrantDocument[]> {
  const kept = c.get('grants');
  if (kept) return kept;
  const { grants } = await grantsAt(registry(c));
  const now = Date.now();
  const active = grants.filter((grant) => isActive(grant, now));
  c.set('grants', active);
  return active;
}

/** Why `who` may not perform `op` given the grants in force; undefined when they may. */
export function refusal(who: ResolvedUser, op: Operation, grants: GrantDocument[]): string | undefined {
  const mine = grants.filter((grant) => grant.user === who.id);
  const has = (role: GrantRole, branch?: string): boolean =>
    mine.some((grant) => grant.role === role && (branch === undefined ? grant.branch === undefined : grant.branch === branch));
  const admin = mine.some((grant) => grant.role === 'Administrator');
  const maintains = (branch: string): boolean => has('Maintainer', branch) || has('Maintainer');
  const owns = (branch: string): boolean => has('Owner', branch);
  const ownerless = (branch: string): boolean => !grants.some((grant) => grant.role === 'Owner' && grant.branch === branch);

  switch (op.permission) {
    case 'write':
    case 'merge': {
      const verb = op.permission === 'write' ? 'write to' : 'merge into';
      if (op.branch === REGISTRY_BRANCH) {
        return maintains(REGISTRY_BRANCH) ? undefined : `${verb} ${REGISTRY_BRANCH} needs Maintainer of ${REGISTRY_BRANCH} or of every branch`;
      }
      return owns(op.branch) || maintains(op.branch) || ownerless(op.branch)
        ? undefined
        : `${verb} branch ${op.branch} needs its Owner, or Maintainer of it or of every branch`;
    }
    case 'delete':
      return owns(op.branch) || maintains(op.branch) || ownerless(op.branch)
        ? undefined
        : `deleting branch ${op.branch} needs its Owner, or Maintainer of it or of every branch`;
    case 'grant':
      if (op.role === 'Maintainer' && op.branch !== undefined) {
        return owns(op.branch) || admin ? undefined : `granting or revoking Maintainer on branch ${op.branch} needs its Owner or an Administrator`;
      }
      return admin ? undefined : `granting or revoking ${op.role}${op.branch === undefined ? ' on every branch' : ''} needs an Administrator`;
    case 'register':
      if (op.agent) return isAgentExternalId(who.user.externalId) ? 'registering an agent needs a person' : undefined;
      return admin ? undefined : 'registering a person needs an Administrator';
  }
}

/** Refuses with 403 `forbidden` when `who` may not perform `op` on this hub. */
export async function requirePermission(c: Context, who: ResolvedUser, op: Operation): Promise<void> {
  if (hubOf(c).role !== 'remote') return; // decision 9: a workspace hub leaves authority to its remote
  const principal = principalOf(who);
  const why = refusal(principal, op, await activeGrants(c));
  if (why === undefined) return;
  const { permission, ...rest } = op;
  throw new ApiError(403, 'forbidden', `${principal.user.externalId} may not: ${why} (ADR-0068 decision 4)`, { permission, ...rest });
}

/**
 * The permissions a document write needs: a grant in the batch needs the
 * right to grant that role on that branch; anything else needs the right to
 * write the branch. Checked after the shape, so a grant's role is known.
 */
export async function requireWrite(c: Context, who: ResolvedUser, branch: string, documents: TerminusDocument[]): Promise<void> {
  for (const doc of documents) {
    if (doc['@type'] === 'Grant') {
      await requirePermission(c, who, { permission: 'grant', role: doc.role as GrantRole, branch: doc.branch as string | undefined });
    }
  }
  if (documents.some((doc) => doc['@type'] !== 'Grant')) await requirePermission(c, who, { permission: 'write', branch });
}

/** What `GET /discover` says about authorization on a remote hub: the migration window is open. */
export const AUTHORIZATION_SETTINGS = { ownerlessBranches: 'writable' } as const;
