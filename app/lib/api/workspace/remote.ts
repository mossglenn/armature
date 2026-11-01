import { createClient, HubError, type ArmatureClient } from '@armature/client';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';

/**
 * The workspace hub's calls to its remote (docs/workspace-hub-plan.md §4): an
 * ordinary client of the remote's /api/v1 through @armature/client, never its
 * store (ADR-0065 decision 2), made as the person whose identity the request
 * resolved to.
 */

/** Each call to the remote ends within this; a full export of a large bank is the slowest, so longer than the store's 30 seconds. */
export const REMOTE_TIMEOUT_MS = 60_000;

/** A client of this hub's remote, acting as `externalId`. */
export function remoteClient(hub: HubConfig, externalId: string): ArmatureClient {
  if (!hub.remote) throw new Error('This hub has no remote; ARMATURE_REMOTE_URL names it when ARMATURE_ROLE=workspace');
  return createClient({ baseUrl: hub.remote, user: externalId, timeout: REMOTE_TIMEOUT_MS });
}

/**
 * One call to the remote. Its refusal is answered as the remote gave it, the
 * same status and code with `remote: true` (ADR-0065 decision 4: a local
 * refusal and a remote one carry the same code); a remote that cannot be
 * reached is 502 `remote_unreachable`.
 */
export async function fromRemote<T>(hub: HubConfig, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (err) {
    if (err instanceof HubError) {
      throw new ApiError(err.status as ApiError['status'], err.code, `The remote refused: ${err.message}`, {
        ...err.details,
        remote: true,
      });
    }
    if (err instanceof TypeError || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))) {
      throw new ApiError(502, 'remote_unreachable', `The remote at ${hub.remote} could not be reached`, { remote: true });
    }
    throw err;
  }
}
