import { createHash } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';
import type { User } from '@armature/types';
import { ApiError } from './errors';
import { ON_BEHALF_OF_TRAILER, RELAYED_BY_TRAILER, withTrailer } from './trailers';
import { hubOf, storeFor } from './config';
import { challenge, oidcResolver } from './oidc';
import { StoreError, type DocumentReader, type Store, type TerminusDocument } from './store';
// A cycle at the module level (authorization.ts resolves identities too), used only inside functions.
import { activeGrants } from './authorization';

/**
 * Identity resolution (architecture decision record ADR-0032).
 *
 * A request's identity is a set of claims produced by a pluggable resolver;
 * the routes never see the mechanism. The claims name an `externalId`, which
 * the hub resolves to a `User` document on `main`, the registry of record
 * (decision 2). When the claims can complete a `User` (they carry a
 * `displayName`) and none exists, the hub registers one on `main` (decision
 * 3); otherwise the identity is unknown until `POST /api/v1/users` creates it.
 *
 * Resolvers, chosen by `ARMATURE_IDENTITY`:
 *   header  (default) `Armature-User: <externalId>`; trusts the caller, so
 *           the mutating routes stay local while it is configured
 *   oidc    `Authorization: Bearer <token>`, a signed token the hub verifies
 *           against the issuer's keys (ADR-0067 decision 1; ./oidc.ts, since
 *           2026-11-05): a person by `(issuer, sub)`, registered on first
 *           encounter only when ARMATURE_OIDC_ADMIT admits the token, else
 *           403 `not_registered`; a service's token as the agent `User` named
 *           by its client id. Every request needs a token but `GET /discover`
 *           (`requireIdentity`), and `Armature-User` beside a token is a
 *           relay's claim (decision 5, since 2026-11-05): a service whose
 *           agent holds a `Relay` grant naming the person delivers the
 *           person's earlier work with the person as author, and the hub
 *           writes `Armature-Relayed-By` into the message.
 */

export interface IdentityClaims {
  externalId: string;
  displayName?: string;
  email?: string;
  institution?: string;
  /** The identity provider that vouches for a person, kept on the `User` and part of its identity (ADR-0067 decision 1, note). */
  issuer?: string;
  /** Whether the resolver lets a first encounter register this person; `oidc` says no unless ARMATURE_OIDC_ADMIT admits the token. */
  admitted?: boolean;
  /** A program's own credential (ADR-0067 decision 4), which resolves to a registered agent and is never registered here. */
  service?: boolean;
}

export type IdentityResolver = (c: Context) => IdentityClaims | undefined | Promise<IdentityClaims | undefined>;

export const USER_HEADER = 'Armature-User';
/** Names the registered agent that acts for the person in `Armature-User` (ADR-0067 decision 3); read under every resolver (decision 8). */
export const AGENT_HEADER = 'Armature-Agent';

/** Where `User` documents are created and resolved (ADR-0032 decision 2). */
export const REGISTRY_BRANCH = 'main';

/**
 * The short handle a workspace's branch name begins with (ADR-0065;
 * docs/workspace-hub-plan.md §4): the external identifier's local part, in the
 * characters a branch name allows. A naming convention, not ownership, which
 * is a grant on the remote (ADR-0068). Because it identifies the person, the
 * pseudonymous export rewrites it where a grant records such a branch name.
 */
export function handleOf(externalId: string): string {
  const local = externalId.split('@')[0].replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return local || 'user';
}

/** An agent is a `User` whose externalId begins with this (ADR-0032 decision 7). */
export const AGENT_PREFIX = 'agent:';
export const isAgentExternalId = (externalId: unknown): boolean =>
  typeof externalId === 'string' && externalId.startsWith(AGENT_PREFIX);

export const headerResolver: IdentityResolver = (c) => {
  const externalId = c.req.header(USER_HEADER)?.trim();
  return externalId ? { externalId } : undefined;
};

// Built at the call, not at load: ./oidc.ts imports this module's types and this module imports its resolver.
const resolvers = (): Record<string, IdentityResolver> => ({ header: headerResolver, oidc: oidcResolver });

export function configuredResolver(name: string): IdentityResolver {
  const known = resolvers();
  const resolver = known[name];
  if (!resolver) {
    throw new Error(`ARMATURE_IDENTITY=${name} names no identity resolver (known: ${Object.keys(known).join(', ')})`);
  }
  return resolver;
}

/** A `User` document as the store returns it. */
export type UserDocument = TerminusDocument & User;

export interface ResolvedUser {
  /** `User/<id>`: the commit author and the `createdBy` value. */
  id: string;
  user: UserDocument;
  /**
   * The person an agent acts for (ADR-0067 decision 3): the request's
   * credential, when `Armature-Agent` names the author. Authority is theirs
   * (ADR-0068), the agent is the author, and the commit says so in its
   * `Armature-On-Behalf-Of` trailer. Absent when the caller acts as itself.
   */
  onBehalfOf?: { id: string; user: UserDocument };
  /**
   * The service that delivered this person's earlier work (ADR-0067 decision
   * 5): the request's credential, an agent holding an active `Relay` grant
   * that names the person, under `oidc`. The person is the author, the
   * `createdBy` and the `attestedBy`; the commit says who carried it in its
   * `Armature-Relayed-By` trailer. Absent when the caller acts as itself.
   */
  relayedBy?: { id: string; user: UserDocument };
}

/** Whose authority a request runs under: the person an agent acts for, else the caller (a relayed person is the caller). */
export const principalOf = (who: ResolvedUser): { id: string; user: UserDocument } => who.onBehalfOf ?? who;

/** The message as the hub commits it: the caller's, with the hub's own trailer when an agent acts for a person or a service relays one (ADR-0067 decisions 3, 5 and 6). */
export function commitMessage(who: ResolvedUser, message: string): string {
  if (who.onBehalfOf) return withTrailer(message, `${ON_BEHALF_OF_TRAILER}: ${who.onBehalfOf.user.externalId}`);
  if (who.relayedBy) return withTrailer(message, `${RELAYED_BY_TRAILER}: ${who.relayedBy.user.externalId}`);
  return message;
}

/** The store bound to the registry branch of the request's hub. */
export function registry(c: Context): Store {
  return storeFor(c, { branch: REGISTRY_BRANCH });
}

/**
 * The `User` with this externalId at the store's ref, and the commit read
 * (check W1). With an issuer, the one that provider vouches for, `(issuer,
 * sub)` (ADR-0067 decision 1, note): a `User` registered without one is not
 * matched by a token, so an administrator registering ahead of a first
 * encounter names the issuer too.
 */
export async function findUserByExternalId(
  store: Store,
  externalId: string,
  issuer?: string
): Promise<{ user: UserDocument | undefined; commit: string }> {
  const { documents, commit } = await store.queryDocuments('User', { externalId, ...(issuer ? { issuer } : {}) });
  const user = (issuer ? documents.find((d) => d.issuer === issuer) : documents[0]) as UserDocument | undefined;
  return { user, commit };
}

/** A hub-minted `User` id for a registration by a person (ADR-0032 decision 3). */
export const mintUserId = (): string => `User/${crypto.randomUUID()}`;

/**
 * The `User` id a first encounter registers under (ADR-0032 decision 3, note of
 * 2026-11-06): opaque like any other, and the same for every first encounter of
 * one `(issuer, sub)`, so concurrent ones collide on the id, the one thing the
 * store settles among concurrent writers (check AO). A random id with `If-Match`
 * on the head does not: the store checks the version before its transaction and
 * lets every concurrent writer land, so one person became several `User`s.
 */
export const firstEncounterId = (issuer: string | undefined, externalId: string): string =>
  `User/${createHash('sha256').update(JSON.stringify([issuer ?? '', externalId])).digest('hex').slice(0, 32)}`;

/** The claims the hub's resolver finds on the request; 401 `identity_required` when it finds none. */
export async function requireClaims(c: Context): Promise<IdentityClaims> {
  const { identity } = hubOf(c);
  const claims = await configuredResolver(identity)(c);
  if (!claims) {
    if (identity === 'oidc') {
      challenge(c);
      throw new ApiError(401, 'identity_required', 'No identity on the request: send Authorization: Bearer <token> from the issuer GET /discover names');
    }
    throw new ApiError(401, 'identity_required', `No identity on the request: send ${USER_HEADER}: <externalId>`);
  }
  return claims;
}

declare module 'hono' {
  interface ContextVariableMap {
    /** The request's resolved identity, kept once resolved so a route after `requireIdentity` reads it, not the store again. */
    who?: ResolvedUser;
  }
}

/** The routes open without a token under `oidc`: discovery, which says how to sign in, and the health probes, which cannot (./routes/health.ts). */
const OPEN_UNDER_OIDC = (path: string): boolean => path === '/api/v1/discover' || path.startsWith('/api/v1/health/');

/**
 * Under `oidc` every request carries a token, reads included, except
 * `GET /discover`, which says how to sign in and so must be readable before
 * anyone has (ADR-0067 decision 1), and the health routes. Runs before the
 * routes; under `header` it does nothing, and the routes that need an
 * identity resolve it themselves.
 */
export const requireIdentity: MiddlewareHandler = async (c, next) => {
  if (hubOf(c).identity === 'oidc' && !OPEN_UNDER_OIDC(c.req.path) && c.req.method !== 'OPTIONS') await resolveUser(c);
  await next();
};

/**
 * Resolves the request to a registered `User`, registering one on `main`
 * when the claims carry a displayName. 401 `identity_required` with no
 * claims; 401 `unknown_user` when nothing is registered and nothing can be.
 * With `Armature-Agent`, the credential's person is resolved first and the
 * agent second: the agent is the author, the person is `onBehalfOf`. Resolved
 * once per request.
 */
export async function resolveUser(c: Context): Promise<ResolvedUser> {
  const kept = c.get('who');
  if (kept) return kept;
  const who = await resolveOnce(c);
  c.set('who', who);
  return who;
}

async function resolveOnce(c: Context): Promise<ResolvedUser> {
  const person = await resolveCredential(c);
  const agentExternalId = c.req.header(AGENT_HEADER)?.trim();
  if (!agentExternalId) return person;
  if (person.relayedBy) {
    throw new ApiError(403, 'forbidden', `A relay delivers the person's own earlier work; ${AGENT_HEADER} names an agent acting now, which a relayed write cannot carry (ADR-0067 decision 5)`, {
      reason: 'relay',
    });
  }
  if (isAgentExternalId(person.user.externalId)) {
    throw new ApiError(400, 'not_a_person', `${AGENT_HEADER} needs a person's credential in ${USER_HEADER}; ${person.user.externalId} is an agent`);
  }
  if (!isAgentExternalId(agentExternalId)) {
    throw new ApiError(400, 'not_an_agent', `${AGENT_HEADER} names ${agentExternalId}, which is not an agent's externalId (agent:…)`);
  }
  const { user } = await findUserByExternalId(registry(c), agentExternalId);
  if (!user) throw new ApiError(401, 'unknown_agent', `No agent User is registered for ${agentExternalId}; a person registers it with POST /api/v1/users`);
  return { id: user['@id'], user, onBehalfOf: { id: person.id, user: person.user } };
}

/** The `User` the request's own credential resolves to, or the person a service relays. */
async function resolveCredential(c: Context): Promise<ResolvedUser> {
  const hub = hubOf(c);
  const claims = await requireClaims(c);
  const main = registry(c);
  // Under a verified token, naming someone else in Armature-User is a relay's
  // claim (ADR-0067 decision 5): only a service holding a Relay grant that
  // names the person may make it, and the person is then the author.
  const relayed = hub.identity === 'oidc' ? c.req.header(USER_HEADER)?.trim() : undefined;
  if (relayed) return resolveRelay(c, claims, relayed);
  return resolveClaims(c, claims, main);
}

/** The relay's 403, one code and reason for every refusal so a client treats them alike. */
const relayRefused = (message: string, relayed: string): ApiError =>
  new ApiError(403, 'forbidden', `${message} (ADR-0067 decision 5)`, { reason: 'relay', relayed });

/**
 * A service delivering a person's earlier work (ADR-0067 decision 5): the
 * token is a service's, its agent `User` holds an active `Relay` grant, and
 * the grant names the person or names no one in particular (`relayedUsers`
 * absent). The person is resolved as the author, the service recorded beside
 * them; which branches the grant covers is checked at the write
 * (authorization.ts), where the branch is known.
 */
async function resolveRelay(c: Context, claims: IdentityClaims, relayed: string): Promise<ResolvedUser> {
  if (!claims.service) {
    throw relayRefused(`${USER_HEADER} beside a person's token names someone else as the author, which only a service holding a Relay grant may do; the token's own subject is the caller`, relayed);
  }
  const main = registry(c);
  const service = await resolveClaims(c, claims, main);
  const relays = (await activeGrants(c)).filter((grant) => grant.role === 'Relay' && grant.user === service.id);
  if (!relays.length) {
    throw relayRefused(`${service.user.externalId} holds no Relay grant, so it may not deliver anyone's work as theirs; an administrator grants one on main`, relayed);
  }
  // The person by the hub's issuer first, then as registered under header, since a relayed person signed in somewhere once.
  const found = (await findUserByExternalId(main, relayed, hubOf(c).oidc?.issuer)).user ?? (await findUserByExternalId(main, relayed)).user;
  if (!found) throw new ApiError(401, 'unknown_user', `No User is registered for ${relayed}, the person this relay names; they sign in once, or an administrator registers them`);
  if (isAgentExternalId(found.externalId)) throw new ApiError(400, 'not_a_person', `${relayed} is an agent; a relay delivers a person's work`);
  if (!relays.some((grant) => grant.relayedUsers === undefined || grant.relayedUsers.includes(found['@id']))) {
    throw relayRefused(`${service.user.externalId}'s Relay grant does not name ${relayed} among the people it may speak for (relayedUsers)`, relayed);
  }
  return { id: found['@id'], user: found, relayedBy: { id: service.id, user: service.user } };
}

/** The `User` these claims resolve to, registered on first encounter when the resolver allows. */
async function resolveClaims(c: Context, claims: IdentityClaims, main: Store): Promise<ResolvedUser> {
  const hub = hubOf(c);
  // Two passes: a concurrent registration of the same person makes the insert
  // fail on the id, and the second lookup then finds the winner's document.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { user } = await findUserByExternalId(main, claims.externalId, claims.issuer);
    if (user) return { id: user['@id'], user };
    // A workspace hub's main is the remote's registry, mirrored: a person is
    // registered on the remote, never here (docs/workspace-hub-plan.md §9).
    if (hub.role === 'workspace') {
      throw new ApiError(
        401,
        'unknown_user',
        `No User is registered for ${claims.externalId} in this workspace hub's mirror of the remote; register on the remote`
      );
    }
    // A service's credential resolves to an agent a person registered (ADR-0067 decision 4); it registers nothing.
    if (claims.service) {
      throw new ApiError(
        401,
        'unknown_user',
        `No agent User is registered for ${claims.externalId}, the client this token was issued to; a person registers it with POST /api/v1/users`
      );
    }
    // A valid token from a provider or a domain the instance did not admit
    // registers no one (ADR-0067 decision 1, note of 2026-10-30).
    if (claims.admitted === false) {
      throw new ApiError(
        403,
        'not_registered',
        `${claims.externalId} signed in with ${claims.issuer} but is not registered here, and the token is not admitted for first encounter (ARMATURE_OIDC_ADMIT); an administrator registers them with POST /api/v1/users, naming the issuer`
      );
    }
    if (!claims.displayName) {
      throw new ApiError(
        401,
        'unknown_user',
        `No User is registered for ${claims.externalId}; create one with POST /api/v1/users`
      );
    }
    const id = firstEncounterId(claims.issuer, claims.externalId);
    const document: UserDocument = {
      '@id': id,
      '@type': 'User',
      displayName: claims.displayName,
      externalId: claims.externalId,
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.institution ? { institution: claims.institution } : {}),
      ...(claims.issuer ? { issuer: claims.issuer } : {}),
    };
    try {
      await main.insertDocument(document, {
        author: id,
        message: `Register ${claims.externalId} on first encounter`,
      });
      return { id, user: document };
    } catch (err) {
      // Only the race: the id was taken. Any other refusal is a fault to
      // surface, not a reason to look again.
      if (err instanceof StoreError && err.kind === 'exists') continue;
      throw err;
    }
  }
  throw new ApiError(409, 'registration_conflict', `Could not register ${claims.externalId}; retry`);
}

/** The resolved `User`'s id, for routes that need only the commit author. */
export async function resolveAuthor(c: Context): Promise<string> {
  return (await resolveUser(c)).id;
}

/**
 * The `User` document to write beside an artifact whose `createdBy` names it,
 * or undefined when the branch, read at `at`, already holds it (ADR-0032 decision 5). `main`
 * always holds it: that is where it was registered.
 */
export async function userCopyFor(branch: string, at: DocumentReader, who: ResolvedUser): Promise<UserDocument | undefined> {
  if (branch === REGISTRY_BRANCH) return undefined;
  try {
    await at.getDocument(who.id);
    return undefined;
  } catch (err) {
    if (err instanceof StoreError && err.kind === 'not_found') return who.user;
    throw err;
  }
}
