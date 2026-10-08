import type { Context } from 'hono';
import { ApiError } from './errors';
import { StoreError, type Store } from './store';

/**
 * Interim identity resolution (ADR-0025 decision 2).
 *
 * Until ADR-0032 lands in Phase 3, a write names its author in the
 * `Armature-User` header as a `User` document id. The hub checks that the
 * document exists on the branch being written and is a `User`, and uses the
 * id as the commit author. The header trusts the caller; that is acceptable
 * only while the demo has no auth. ADR-0032 replaces this function without
 * changing any route.
 */
export const USER_HEADER = 'Armature-User';

export async function resolveAuthor(c: Context, store: Store): Promise<string> {
  const id = c.req.header(USER_HEADER)?.trim();
  if (!id) {
    throw new ApiError(
      401,
      'identity_required',
      `Writes need an ${USER_HEADER} header naming a User document (interim until ADR-0032)`
    );
  }
  if (!id.startsWith('User/')) {
    throw new ApiError(401, 'unknown_user', `${USER_HEADER} must be a User document id, got ${id}`);
  }
  try {
    const { document } = await store.getDocument(id);
    if (document['@type'] !== 'User') {
      throw new ApiError(401, 'unknown_user', `${id} is not a User`);
    }
  } catch (err) {
    if (err instanceof StoreError && err.type === 'api:DocumentNotFound') {
      throw new ApiError(401, 'unknown_user', `No User ${id}`);
    }
    throw err;
  }
  return id;
}
