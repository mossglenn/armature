import { createClient, HubError, type ArmatureClient } from '@armature/client';
import type { HubConfig } from '../config';
import { ApiError } from '../errors';

/**
 * The workspace hub's calls to its remote (docs/workspace-hub-plan.md §4): an
 * ordinary client of the remote's /api/v1 through @armature/client, never its
 * store (ADR-0065 decision 2), made as the person whose identity the request
 * resolved to.
 *
 * How the remote knows who calls (ADR-0067 decision 2, note of 2026-11-05).
 * A remote under `header` takes the owner's external identifier, as it always
 * did. A remote under `oidc` takes a bearer token, the owner's, which the
 * host supplies (`hub.remoteToken`: the desktop program from its sign-in,
 * `app/server.ts` from ARMATURE_REMOTE_TOKEN), and then no `Armature-User`,
 * since beside a token that header is a relay's claim; `Armature-Agent` goes
 * as before. Whose token it is, the remote says: before a workspace is made or
 * pushed, bring in or delivered, `GET /users/me` on the remote must resolve to
 * the workspace's owner, else 403 `forbidden` with `reason: remote_identity`,
 * so a token left over from someone else's sign-in never pushes as them.
 *
 * Every call carries this installation's identifier as
 * `Armature-Workspace-Link` (ADR-0072 decision 3, since 2026-11-20), which
 * the remote compares on a write to a workspace's branch: the push, the
 * update from the parent and the removal are taken from the computer the
 * workspace is linked to and from no other.
 */

/** Each call to the remote ends within this; a full export of a large bank is the slowest, so longer than the store's 30 seconds. */
export const REMOTE_TIMEOUT_MS = 60_000;

/**
 * A client of this hub's remote, acting as `externalId` under `header`, or as
 * the token's subject under `oidc`; with `agent`, as that agent acting for
 * them (ADR-0067 decision 3).
 */
export function remoteClient(hub: HubConfig, externalId?: string, agent?: string): ArmatureClient {
  if (!hub.remote) throw new Error('This hub has no remote; ARMATURE_REMOTE_URL names it when ARMATURE_ROLE=workspace');
  if (!hub.remoteToken && !externalId) throw new Error('A call to the remote needs an identity: the owner, or the token the host supplies');
  const remote = hub.remote;
  return createClient({
    baseUrl: remote,
    ...(hub.remoteToken ? { token: hub.remoteToken } : { user: externalId }),
    ...(agent ? { agent } : {}),
    ...(hub.installation ? { workspaceLink: hub.installation.id } : {}),
    timeout: REMOTE_TIMEOUT_MS,
    fetch: (input, init) => withFreshToken(hub, (headers) => withoutRedirect(remote, input, { ...init, headers }), init?.headers),
  });
}

/**
 * One request, sent once more with a new token when the remote refuses the one it carried as
 * `invalid_token` and the host can get another (`hub.forgetRemoteToken`). The issuer's keys may
 * change under a token still in its lifetime; until 2026-11-16 the program then sent the refused
 * token until thirty seconds before its expiry, every action failing meanwhile, where the viewer
 * already asked again (`lib/viewerToken.ts`; the 2026-11-09 review's C15). Any other answer, and a
 * second refusal, pass through.
 */
async function withFreshToken(hub: HubConfig, send: (headers: HeadersInit | undefined) => Promise<Response>, headers: HeadersInit | undefined): Promise<Response> {
  const res = await send(headers);
  if (res.status !== 401 || !hub.remoteToken || !hub.forgetRemoteToken) return res;
  const body = (await res
    .clone()
    .json()
    .catch(() => undefined)) as { error?: unknown } | undefined;
  if (body?.error !== 'invalid_token') return res;
  hub.forgetRemoteToken();
  const again = new Headers(headers);
  again.set('Authorization', `Bearer ${await hub.remoteToken()}`);
  return send(again);
}

/**
 * One request to the remote that follows no redirect (the 2026-11-09 review's
 * W5). The runtime's default follows one: within the origin the token goes
 * along, and to another origin the token is dropped but the body, the
 * person's identifier and `If-Match` are sent again, to an address nobody
 * configured. A remote that has moved is answered instead as 502
 * `remote_error` with `reason: redirect` and where it pointed, so the person
 * or the administrator gives the hub the address the remote lives at.
 */
async function withoutRedirect(remote: string, input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, redirect: 'manual' });
  if (res.status < 300 || res.status >= 400 || res.status === 304) return res;
  const location = res.headers.get('location') ?? undefined;
  await res.body?.cancel().catch(() => undefined);
  throw new ApiError(
    502,
    'remote_error',
    `The instance at ${remote} answered with a redirect${location ? ` to ${location}` : ''}, which this hub does not follow; set the instance's address to where it is served`,
    { remote: true, reason: 'redirect', ...(location ? { location } : {}) }
  );
}

/**
 * The shape of a commit identifier from either store: TerminusDB's and the file store's are lower-case
 * letters and digits. Bounded so that a snapshot's branch, `at.<commit>`, is a branch name the store takes.
 */
export const COMMIT_ID = /^[a-z0-9]{1,97}$/;

/**
 * A commit identifier the remote gave in an `ETag`, checked to be one before
 * this hub records it. A proxy in front of the remote can alter a strong ETag:
 * Caddy's `encode` appends the encoding's name when it compresses a response
 * (`"<commit>-gzip"`), which the Droplet run of 2026-11-05 found when a clone
 * recorded such a base and its push was 412 at the remote (ADR-0067 decision 7,
 * note of that day). Refused here instead, before anything is written: 502
 * `remote_error` with `reason: etag_altered` and the value, naming the proxy as
 * the likely cause. A missing commit is the same code without a reason.
 */
export function remoteCommit(hub: HubConfig, commit: string | undefined, what: string): string {
  if (!commit) throw new ApiError(502, 'remote_error', `The instance answered ${what} without a commit`, { remote: true });
  if (!COMMIT_ID.test(commit)) {
    throw new ApiError(
      502,
      'remote_error',
      `The instance at ${hub.remote} answered ${what} with an ETag that is not a commit identifier, ${JSON.stringify(commit)}; a proxy in front of it has altered the ETag (a compressing proxy appends the encoding's name), which would break If-Match and every push from here`,
      { remote: true, reason: 'etag_altered', commit }
    );
  }
  return commit;
}

/**
 * A commit identifier the remote gave in a body (a merge's or a batch's commit, a log's entries),
 * checked to be one before this hub records it: 502 `remote_error` with `reason: not_a_commit`.
 * Until 2026-11-16 only the clone's ETag was checked among what a remote supplies (the 2026-11-09
 * review's W7). Where it is thrown after the remote has acted, the caller's marker stays and the next
 * push or bring-in settles from the remote's log.
 */
export function remoteCommitOf(hub: HubConfig, commit: unknown, what: string): string {
  if (typeof commit === 'string' && COMMIT_ID.test(commit)) return commit;
  throw new ApiError(502, 'remote_error', `The instance at ${hub.remote} answered ${what} with ${JSON.stringify(commit) ?? 'nothing'} where a commit identifier belongs`, {
    remote: true,
    reason: 'not_a_commit',
  });
}

/** Whether this hub reaches its remote with a token rather than the owner's identifier. */
export const remoteTakesToken = (hub: HubConfig): boolean => hub.remoteToken !== undefined;

/**
 * The remote's answer to "who am I" for this hub's credential, compared with
 * the person a workspace belongs to; the mismatch is refused. Under `header`
 * nothing is checked, since the identifier sent is the owner's.
 */
export async function requireRemoteIdentity(hub: HubConfig, owner: { id?: string; externalId: string }): Promise<void> {
  if (!remoteTakesToken(hub)) return;
  const me = (await fromRemote(hub, () => remoteClient(hub).users.me())).data;
  const same = owner.id ? me['@id'] === owner.id : me.externalId === owner.externalId;
  if (same) return;
  throw new ApiError(
    403,
    'forbidden',
    `The remote resolves this hub's token to ${me.externalId}, not ${owner.externalId}, whose workspace this is; sign in to the remote as the owner (ADR-0067 decision 2)`,
    { reason: 'remote_identity', owner: owner.externalId, credential: me.externalId }
  );
}

/** The owner's client of the remote, its credential checked against the workspace's record. */
export async function ownerClient(hub: HubConfig, record: { owner: string; ownerExternalId: string }): Promise<ArmatureClient> {
  await requireRemoteIdentity(hub, { id: record.owner, externalId: record.ownerExternalId });
  return remoteClient(hub, record.ownerExternalId);
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
      throw new ApiError(err.status as ApiError['status'], err.code, `The instance refused: ${err.message}`, {
        ...err.details,
        remote: true,
      });
    }
    if (err instanceof TypeError || (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'))) {
      throw new ApiError(502, 'remote_unreachable', `The instance at ${hub.remote} cannot be reached`, { remote: true });
    }
    throw err;
  }
}
