import type { Context } from 'hono';
import type { User } from '@/lib/types';
import { ApiError } from './errors';
import { createStore, StoreError, type Store, type TerminusDocument } from './store';

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
 *   oidc    named, not yet built: OpenID Connect (OIDC) bearer token, `sub` as externalId, `name`
 *           and `email` as the other claims
 */

export interface IdentityClaims {
  externalId: string;
  displayName?: string;
  email?: string;
  institution?: string;
}

export type IdentityResolver = (c: Context) => IdentityClaims | undefined | Promise<IdentityClaims | undefined>;

export const USER_HEADER = 'Armature-User';

/** Where `User` documents are created and resolved (ADR-0032 decision 2). */
export const REGISTRY_BRANCH = 'main';

export const headerResolver: IdentityResolver = (c) => {
  const externalId = c.req.header(USER_HEADER)?.trim();
  return externalId ? { externalId } : undefined;
};

const RESOLVERS: Record<string, IdentityResolver> = { header: headerResolver };

export function configuredResolver(): IdentityResolver {
  const name = process.env.ARMATURE_IDENTITY?.trim() || 'header';
  const resolver = RESOLVERS[name];
  if (!resolver) {
    throw new Error(`ARMATURE_IDENTITY=${name} names no identity resolver (known: ${Object.keys(RESOLVERS).join(', ')})`);
  }
  return resolver;
}

/** A `User` document as the store returns it. */
export type UserDocument = TerminusDocument & User;

export interface ResolvedUser {
  /** `User/<id>`: the commit author and the `createdBy` value. */
  id: string;
  user: UserDocument;
}

/** The store bound to the registry branch. */
export function registry(): Store {
  return createStore({ branch: REGISTRY_BRANCH });
}

/** The `User` with this externalId at the store's ref, and the commit read (check W1). */
export async function findUserByExternalId(
  store: Store,
  externalId: string
): Promise<{ user: UserDocument | undefined; commit: string }> {
  const { documents, commit } = await store.queryDocuments('User', { externalId });
  return { user: documents[0] as UserDocument | undefined, commit };
}

/** A hub-minted `User` id for a registration (ADR-0032 decision 3). */
export const mintUserId = (): string => `User/${crypto.randomUUID()}`;

/**
 * Resolves the request to a registered `User`, registering one on `main`
 * when the claims carry a displayName. 401 `identity_required` with no
 * claims; 401 `unknown_user` when nothing is registered and nothing can be.
 */
export async function resolveUser(c: Context): Promise<ResolvedUser> {
  const claims = await configuredResolver()(c);
  if (!claims) {
    throw new ApiError(401, 'identity_required', `No identity on the request: send ${USER_HEADER}: <externalId>`);
  }
  const main = registry();
  // Two passes: a concurrent registration of the same externalId makes the
  // insert fail on the head it read (If-Match) or on the id, and the second
  // lookup then finds the winner's document.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { user, commit } = await findUserByExternalId(main, claims.externalId);
    if (user) return { id: user['@id'], user };
    if (!claims.displayName) {
      throw new ApiError(
        401,
        'unknown_user',
        `No User is registered for ${claims.externalId}; create one with POST /api/v1/users`
      );
    }
    const id = mintUserId();
    const document: UserDocument = {
      '@id': id,
      '@type': 'User',
      displayName: claims.displayName,
      externalId: claims.externalId,
      ...(claims.email ? { email: claims.email } : {}),
      ...(claims.institution ? { institution: claims.institution } : {}),
    };
    try {
      await main.insertDocument(document, {
        author: id,
        message: `Register ${claims.externalId} on first encounter`,
        ifMatch: commit || undefined,
      });
      return { id, user: document };
    } catch (err) {
      if (err instanceof StoreError && (err.type === 'api:DataVersionMismatch' || err.status === 400)) continue;
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
 * or undefined when the branch already holds it (ADR-0032 decision 5). `main`
 * always holds it: that is where it was registered.
 */
export async function userCopyFor(branchStore: Store, who: ResolvedUser): Promise<UserDocument | undefined> {
  if (branchStore.branch === REGISTRY_BRANCH) return undefined;
  try {
    await branchStore.getDocument(who.id);
    return undefined;
  } catch (err) {
    if (err instanceof StoreError && err.type === 'api:DocumentNotFound') return who.user;
    throw err;
  }
}
