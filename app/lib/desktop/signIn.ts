import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ApiError } from '../api/errors';

/**
 * The desktop program's sign-in to a remote under `oidc`
 * (docs/desktop-program-plan.md §6; ADR-0067 decision 2, note of
 * 2026-11-05): the authorization code flow with PKCE for a native app, as
 * RFC 8252 describes it, run by the core, in TypeScript, beside
 * `app/lib/viewerToken.ts`'s client credentials grant.
 *
 *   1. Read `<issuer>/.well-known/openid-configuration` for the endpoints,
 *      its `issuer` checked against the one asked for (RFC 8414 §3.3).
 *   2. Draw a `code_verifier`, its S256 challenge and a `state`.
 *   3. Listen on 127.0.0.1 at a port the system chooses, for `/callback`.
 *   4. Ask the shell to open the system browser at the authorization endpoint
 *      (`openBrowser`; the core sends the shell an `open` event).
 *   5. On the callback with the right `state`, exchange the code with the
 *      verifier at the token endpoint, and answer the browser with a page
 *      saying to return to the program.
 *
 * The client is a public one, with no secret (RFC 8252 §8.5); the provider
 * registers the redirect as `http://127.0.0.1/callback` without a port, which
 * Keycloak and RFC 8252 §7.3 treat as any loopback port. `offline_access` is
 * asked for, so the provider issues a refresh token the shell keeps in its
 * keychain. A provider that refuses the scope (Keycloak's `invalid_scope`
 * when the client does not offer it) is answered 403 `sign_in_refused` with
 * `reason: invalid_scope` and `offlineAccess: true`, so the shell can offer
 * to sign in without staying signed in, `offline: false`; the plan's note of
 * 2026-11-06 says not to assume the scope is ignored.
 *
 * A request to the callback with another `state` is answered 400 and the flow
 * goes on waiting: it may be a stale tab or another process on the machine,
 * and the person's own redirect may still arrive.
 */

/** How the core reaches the issuer; replaceable for a test, the shape `fetch` has. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface IssuerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

/** The tokens a sign-in or a refresh gives. */
export interface Tokens {
  accessToken: string;
  /** When the access token expires, in milliseconds since the epoch. */
  expiresAt: number;
  /** Absent when the provider issued none, so the person signs in again when the access token expires. */
  refreshToken?: string;
}

export interface SignInOptions {
  issuer: string;
  clientId: string;
  /** Opens the system browser at the authorization URL; the core asks the shell to. */
  openBrowser: (url: string) => void | Promise<void>;
  /** Ask for `offline_access`, so a refresh token is issued; true by default. */
  offline?: boolean;
  /** How long to wait for the browser's redirect; five minutes by default. */
  timeoutMs?: number;
  /** Ends the wait early, as when the program stops or the person cancels. */
  signal?: AbortSignal;
  fetch?: FetchLike;
  now?: () => number;
}

export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** A whole-number lifetime in seconds from a token response, five minutes when absent. */
const lifetimeOf = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 300);

/** The issuer's metadata; 503 `issuer_unreachable` when it cannot be read, 502 `issuer_error` when it is not what an issuer serves. */
export async function issuerMetadata(issuer: string, fetchFn: FetchLike = fetch): Promise<IssuerMetadata> {
  const expected = issuer.replace(/\/+$/, '');
  const address = `${expected}/.well-known/openid-configuration`;
  let res: Response;
  try {
    res = await fetchFn(address, { headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiError(503, 'issuer_unreachable', `The identity provider at ${expected} could not be reached`, { issuer: expected });
  }
  if (!res.ok) throw new ApiError(502, 'issuer_error', `${address} answered ${res.status}`, { issuer: expected });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const { authorization_endpoint, token_endpoint } = body;
  if (typeof body.issuer !== 'string' || body.issuer.replace(/\/+$/, '') !== expected) {
    throw new ApiError(502, 'issuer_error', `${address} names the issuer ${JSON.stringify(body.issuer)}, not ${expected}`, { issuer: expected });
  }
  if (typeof authorization_endpoint !== 'string' || typeof token_endpoint !== 'string') {
    throw new ApiError(502, 'issuer_error', `${address} names no authorization_endpoint or token_endpoint`, { issuer: expected });
  }
  return { issuer: expected, authorizationEndpoint: authorization_endpoint, tokenEndpoint: token_endpoint };
}

/** A token endpoint's answer as tokens, or its refusal as an `ApiError`. */
export async function tokensFrom(res: Response, now: () => number, what: string): Promise<Tokens> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : `status_${res.status}`;
    const description = typeof body.error_description === 'string' ? body.error_description : undefined;
    throw new ApiError(403, 'sign_in_refused', `The identity provider refused ${what}: ${reason}${description ? ` (${description})` : ''}`, {
      reason,
      ...(description ? { description } : {}),
    });
  }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new ApiError(502, 'issuer_error', `The identity provider's answer to ${what} carries no access_token`);
  return {
    accessToken: body.access_token,
    expiresAt: now() + lifetimeOf(body.expires_in) * 1000,
    ...(typeof body.refresh_token === 'string' && body.refresh_token ? { refreshToken: body.refresh_token } : {}),
  };
}

/** What the browser shows on the callback; a page with no script, no style from elsewhere, nothing to leak. */
function page(res: ServerResponse, status: number, heading: string, text: string): void {
  const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end(`<!doctype html><meta charset="utf-8"><title>Armature</title><h1>${escape(heading)}</h1><p>${escape(text)}</p>`);
}

/** Signs the person in; resolves with the tokens, or rejects with an `ApiError` the shell shows. */
export async function signIn(options: SignInOptions): Promise<Tokens> {
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const offline = options.offline ?? true;
  const metadata = await issuerMetadata(options.issuer, fetchFn);

  const verifier = base64url(randomBytes(32));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const state = base64url(randomBytes(16));

  let settle!: { resolve: (tokens: Tokens) => void; reject: (err: unknown) => void };
  const done = new Promise<Tokens>((resolve, reject) => (settle = { resolve, reject }));
  // Handled here so a refusal that arrives while the browser is still being opened is not an unhandled rejection; `await done` still sees it.
  done.catch(() => undefined);
  let redirectUri = '';
  let finished = false;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/callback') return page(res, 404, 'Not found', 'This address answers the Armature sign-in only.');
    if (finished || url.searchParams.get('state') !== state) {
      return page(res, 400, 'Not this sign-in', 'This answer does not belong to the sign-in Armature is waiting for. Return to Armature and sign in again if it is still waiting.');
    }
    finished = true;
    const error = url.searchParams.get('error');
    if (error) {
      const description = url.searchParams.get('error_description') ?? undefined;
      const scopeRefused = error === 'invalid_scope' && offline;
      page(res, 200, 'Sign-in refused', `The identity provider refused: ${error}. Return to Armature.`);
      settle.reject(
        new ApiError(
          403,
          'sign_in_refused',
          scopeRefused
            ? 'The identity provider refused offline_access, which keeps you signed in; sign in without it, or ask the administrator to offer it to the desktop client'
            : `The identity provider refused the sign-in: ${error}${description ? ` (${description})` : ''}`,
          { reason: error, ...(description ? { description } : {}), ...(scopeRefused ? { offlineAccess: true } : {}) }
        )
      );
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      page(res, 400, 'Sign-in incomplete', 'The identity provider sent no code. Return to Armature and sign in again.');
      settle.reject(new ApiError(502, 'issuer_error', 'The identity provider redirected without a code'));
      return;
    }
    try {
      let exchanged: Response;
      try {
        exchanged = await fetchFn(metadata.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: options.clientId, code_verifier: verifier }).toString(),
        });
      } catch {
        throw new ApiError(503, 'issuer_unreachable', `The identity provider's token endpoint, ${metadata.tokenEndpoint}, could not be reached`, { issuer: metadata.issuer });
      }
      const tokens = await tokensFrom(exchanged, now, 'the sign-in');
      page(res, 200, 'Signed in', 'You are signed in. Return to Armature; this tab can be closed.');
      settle.resolve(tokens);
    } catch (err) {
      page(res, 200, 'Sign-in refused', err instanceof ApiError ? err.message : 'The sign-in failed. Return to Armature.');
      settle.reject(err);
    }
  };

  const server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;

  const timer = setTimeout(
    () => settle.reject(new ApiError(408, 'sign_in_timeout', 'The sign-in was not completed in the browser in time; sign in again')),
    options.timeoutMs ?? SIGN_IN_TIMEOUT_MS
  );
  const abort = () => settle.reject(new ApiError(409, 'sign_in_cancelled', 'The sign-in was cancelled'));
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const authorization = new URL(metadata.authorizationEndpoint);
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: options.clientId,
      redirect_uri: redirectUri,
      scope: offline ? 'openid profile email offline_access' : 'openid profile email',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    await options.openBrowser(authorization.toString());
    return await done;
  } finally {
    finished = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    // close() ends the idle connections and lets the answer just written reach the browser; a
    // connection a stale tab still holds is ended a second later rather than waited for.
    server.close();
    setTimeout(() => server.closeAllConnections(), 1000).unref();
  }
}
