import type { Context } from 'hono';
import type { GrantRole } from '@armature/types';
import { hubOf, type HubConfig } from './config';
import { ApiError } from './errors';
import { grantsAt, isActive, type GrantDocument } from './grants';
import { isAgentExternalId, principalOf, registry, REGISTRY_BRANCH, resolveUser, type ResolvedUser } from './identity';
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
 *   list users               under `oidc`, a Maintainer of main or an Administrator; a full
 *                            export to anyone else carries only the users its records name
 *                            (decision 4's notes of 2026-10-30 and 2026-11-05; under `header`
 *                            open, since the caller is trusted and on loopback)
 *
 * A branch with no Owner in force is writable, mergeable and deletable by any
 * registered User, as before this decision: the migration window of decision
 * 3's note is open, and `GET /discover` says so (`ownerlessBranches`). The
 * check runs on a remote hub under every resolver; a workspace hub does not
 * authorize (decision 9), it only keeps each workspace to its owner (below).
 * On a remote hub an agent's own credential may read and never write
 * (ADR-0067 decision 10). The operator tools are outside the API and outside
 * this (ADR-0062). An agent acting for a person may do what the person may
 * (ADR-0067 decision 3): the person's grants are read, the agent's never. A
 * service relaying a person's earlier work (ADR-0067 decision 5, since
 * 2026-11-05) writes documents only, to a branch its Relay grant covers, and
 * then as the person: the person's grants decide, the service's grant bounds.
 */
export type Operation =
  | { permission: 'create'; branch: string }
  | { permission: 'write'; branch: string }
  | { permission: 'merge'; branch: string }
  | { permission: 'delete'; branch: string }
  | { permission: 'grant'; role: GrantRole; branch?: string }
  | { permission: 'register'; agent: boolean }
  | { permission: 'list_users' };

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
    case 'create':
      return undefined; // any registered User; whoever creates a branch owns it (decision 3)
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
    case 'list_users':
      return maintains(REGISTRY_BRANCH) || admin ? undefined : `listing users needs Maintainer of ${REGISTRY_BRANCH} or an Administrator`;
  }
}

/**
 * The read ADR-0068 decision 4's note keeps for maintainers of `main` and
 * administrators under `oidc`, where anyone with a token may read: the list
 * of everyone registered, by `GET /users` or `GET /documents/User`. The full
 * export is served to anyone, with the users its records name only, unless
 * the caller may list (`mayListUsers`; the note of 2026-11-05). Under
 * `header` nothing is checked, as the note says. On a workspace hub, which
 * runs under `header`, likewise.
 */
export async function requireReadPermission(c: Context, op: { permission: 'list_users' }): Promise<void> {
  if (hubOf(c).identity !== 'oidc') return;
  const who = await resolveUser(c);
  await requirePermission(c, who, op);
}

/**
 * Whether the caller may read the registry of everyone registered: under
 * `header` anyone, under `oidc` a maintainer of `main` or an administrator,
 * never a service's own credential (decision 4's note of 2026-11-05: a
 * `full` export to anyone else carries only the users its records name), and
 * never a relay, whoever it names: a relay delivers documents and reads no
 * registry by the person's grants (ADR-0067 decision 5; the 2026-11-09
 * review's A2).
 */
export async function mayListUsers(c: Context): Promise<boolean> {
  if (hubOf(c).identity !== 'oidc') return true;
  const who = await resolveUser(c);
  if (isAgentExternalId(who.user.externalId) && !who.onBehalfOf) return false;
  if (who.relayedBy) return false;
  return refusal(principalOf(who), { permission: 'list_users' }, await activeGrants(c)) === undefined;
}

/** Refuses with 403 `forbidden` when `who` may not perform `op` on this hub. */
export async function requirePermission(c: Context, who: ResolvedUser, op: Operation): Promise<void> {
  const hub = hubOf(c);
  if (hub.role !== 'remote') return requireWorkspaceOwner(hub, who, op); // decision 9: a workspace hub leaves authority to its remote
  const { permission, ...rest } = op;
  // ADR-0067 decision 10: an agent's own work reaches a remote hub only as a
  // workspace hub's push, acting for a person; an agent as the credential
  // itself may read, never write.
  if (isAgentExternalId(who.user.externalId) && !who.onBehalfOf) {
    throw new ApiError(
      403,
      'forbidden',
      `${who.user.externalId} is an agent; an agent's own work reaches a remote hub only through a workspace hub's push, acting for a person (ADR-0067 decision 10)`,
      { permission, ...rest, credential: who.user.externalId }
    );
  }
  const grants = await activeGrants(c);
  // ADR-0067 decision 5: a relay delivers a person's documents, to a branch its
  // Relay grant covers; the person's own grants then decide the write, as for
  // anyone. Nothing else is done by relay: not a branch, a merge, a grant.
  if (who.relayedBy) {
    const relayedBy = who.relayedBy.user.externalId;
    if (permission !== 'write') {
      throw new ApiError(403, 'forbidden', `${relayedBy} relays ${who.user.externalId}'s earlier work as documents; ${permission} is not a relayed action (ADR-0067 decision 5)`, {
        permission,
        ...rest,
        reason: 'relay',
        relayed: who.user.externalId,
      });
    }
    const covers = grants.some(
      (grant) =>
        grant.role === 'Relay' &&
        grant.user === who.relayedBy!.id &&
        (grant.branch === undefined || grant.branch === op.branch) &&
        (grant.relayedUsers === undefined || grant.relayedUsers.includes(who.id))
    );
    if (!covers) {
      throw new ApiError(403, 'forbidden', `${relayedBy}'s Relay grant does not cover branch ${op.branch} for ${who.user.externalId} (ADR-0067 decision 5)`, {
        permission,
        ...rest,
        reason: 'relay',
        relayed: who.user.externalId,
      });
    }
  }
  const principal = principalOf(who);
  const why = refusal(principal, op, grants);
  if (why === undefined) return;
  throw new ApiError(403, 'forbidden', `${principal.user.externalId} may not: ${why} (ADR-0068 decision 4)`, { permission, ...rest });
}

/**
 * A workspace hub's one rule (docs/workspace-hub-plan.md §7, decided
 * 2026-11-01): a workspace is written by its owner, or by an agent acting for
 * its owner; a request as anyone else is 403 `forbidden` naming the owner. A
 * branch with no workspace record (a scratch branch) is open, as the hub
 * holds one person's work and no grants.
 */
async function requireWorkspaceOwner(hub: HubConfig, who: ResolvedUser, op: Operation): Promise<void> {
  if (!('branch' in op) || op.branch === undefined) return;
  const record = await hub.workspaces?.get(op.branch);
  const principal = principalOf(who);
  if (!record || principal.id === record.owner) return;
  const { permission, ...rest } = op;
  throw new ApiError(403, 'forbidden', `${principal.user.externalId} may not ${permission} ${op.branch}: this workspace is ${record.ownerExternalId}'s`, {
    permission,
    ...rest,
    owner: record.ownerExternalId,
  });
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
