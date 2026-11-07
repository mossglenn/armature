import { ApiError } from '../api/errors';
import { tokensFrom, type FetchLike, type Tokens } from './signIn';

/**
 * The desktop program's credential for its remote: the token source behind
 * `hub.remoteToken` (docs/desktop-program-plan.md §6; ADR-0067 decision 2,
 * note of 2026-11-05).
 *
 * It holds the access token in the core's memory only, and the refresh token
 * the shell's keychain kept and sent at `start`, or the one a sign-in just
 * gave. On each call it returns the access token, asking the token endpoint
 * for a new one with the refresh token when the held one is within thirty
 * seconds of expiry (the viewer's margin, `app/lib/viewerToken.ts`); calls
 * made together share one request. A provider that rotates the refresh token
 * gives a new one with the access token, which `onRotated` hands to the shell
 * to keep, so the keychain always holds the one that works.
 *
 * A refresh the provider refuses (the person was removed, the token expired
 * or was revoked) clears the credential and calls `onSignedOut`; that call
 * and every later one are 401 `signed_out`, which the shell answers with the
 * sign-in screen. A provider that cannot be reached is 503
 * `issuer_unreachable` and clears nothing: the next call tries again.
 *
 * Whose token it is stays the hub's question: before a workspace is made,
 * pushed, brought in or delivered, the remote's `GET /users/me` must resolve
 * to the owner (`requireRemoteIdentity`, ./../api/workspace/remote.ts).
 */

/** Seconds before an access token's expiry at which a new one is asked for. */
export const REFRESH_MARGIN_SECONDS = 30;

export interface CredentialOptions {
  tokenEndpoint: string;
  clientId: string;
  /** Called with a refresh token the provider rotated, for the shell's keychain. */
  onRotated?: (refreshToken: string) => void;
  /** Called once when a refresh is refused and the credential is cleared, with the provider's reason. */
  onSignedOut?: (reason: string) => void;
  fetch?: FetchLike;
  now?: () => number;
}

export interface Credential {
  /** The current access token, refreshed when near its expiry; what `hub.remoteToken` calls. */
  (): Promise<string>;
  /** Drops the held access token, so the next call refreshes (the remote refused it as invalid_token). */
  forget: () => void;
  /** Forgets everything: sign out. */
  clear: () => void;
  /** Whether anything is held to sign the next call with. */
  readonly signedIn: boolean;
}

const signedOut = () => new ApiError(401, 'signed_out', 'The desktop program is not signed in to the remote; sign in again');

/** A credential from a sign-in's tokens, or from the refresh token the keychain kept alone. */
export function credential(initial: Partial<Tokens>, options: CredentialOptions): Credential {
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let access = initial.accessToken !== undefined && initial.expiresAt !== undefined ? { token: initial.accessToken, expiresAt: initial.expiresAt } : undefined;
  let refreshToken = initial.refreshToken;
  let pending: Promise<string> | undefined;

  const fresh = () => access !== undefined && access.expiresAt - REFRESH_MARGIN_SECONDS * 1000 > now();

  const refresh = async (): Promise<string> => {
    if (!refreshToken) {
      access = undefined;
      throw signedOut();
    }
    const sent = refreshToken;
    let res: Response;
    try {
      res = await fetchFn(options.tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: sent, client_id: options.clientId }).toString(),
      });
    } catch {
      throw new ApiError(503, 'issuer_unreachable', `The identity provider's token endpoint, ${options.tokenEndpoint}, could not be reached; the remote cannot be signed in to until it can`);
    }
    let tokens: Tokens;
    try {
      tokens = await tokensFrom(res, now, 'the refresh');
    } catch (err) {
      // A refusal (400 invalid_grant, as RFC 6749 §5.2 has it) ends the sign-in; a provider's
      // malformed answer is not the person's to fix by signing in again, and clears nothing.
      if (err instanceof ApiError && err.code === 'sign_in_refused') {
        access = undefined;
        refreshToken = undefined;
        options.onSignedOut?.(String(err.details?.reason ?? 'refused'));
        throw signedOut();
      }
      throw err;
    }
    access = { token: tokens.accessToken, expiresAt: tokens.expiresAt };
    if (tokens.refreshToken && tokens.refreshToken !== sent) {
      refreshToken = tokens.refreshToken;
      options.onRotated?.(tokens.refreshToken);
    }
    return tokens.accessToken;
  };

  const source = async (): Promise<string> => {
    if (fresh()) return access!.token;
    pending ??= refresh().finally(() => (pending = undefined));
    return pending;
  };
  return Object.defineProperties(source, {
    forget: { value: () => (access = undefined) },
    clear: {
      value: () => {
        access = undefined;
        refreshToken = undefined;
      },
    },
    signedIn: { get: () => fresh() || refreshToken !== undefined },
  }) as Credential;
}
