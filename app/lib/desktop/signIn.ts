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
  /** Where a token is revoked (RFC 7009), when the provider names one over https; a sign-out posts the refresh token there. */
  revocationEndpoint?: string;
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
/** Each request to the identity provider ends within this; the runtime's own default is five minutes (the 2026-11-09 review's C9). */
export const ISSUER_CALL_MS = 15_000;
const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** A whole-number lifetime in seconds from a token response, five minutes when absent. */
const lifetimeOf = (value: unknown) => (typeof value === 'number' && value > 0 ? value : 300);

const isLoopbackHost = (host: string) => host === 'localhost' || host === '[::1]' || host.endsWith('.localhost') || /^127\.\d+\.\d+\.\d+$/.test(host);

/**
 * Whether the program may send a credential to `address`: `https`, or `http` to this machine
 * alone (a provider run beside the program for a rehearsal). The remote was already held to
 * this (`insecure_remote`); the issuer and its endpoints were not, and an authorization code or
 * a refresh token posted over plain `http` is readable on the way (the 2026-11-09 review's C7).
 */
export function isSecureAddress(address: string): boolean {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return false;
  }
  return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopbackHost(url.hostname));
}

/**
 * The issuer's metadata; 503 `issuer_unreachable` when it cannot be read, 502 `issuer_error` when
 * it is not what an issuer serves, 400 `insecure_issuer` when the issuer or one of its endpoints
 * is not `https` (or this machine). An endpoint on another origin than the issuer's is allowed:
 * providers do serve their endpoints from other hosts.
 */
export async function issuerMetadata(issuer: string, fetchFn: FetchLike = fetch): Promise<IssuerMetadata> {
  const expected = issuer.replace(/\/+$/, '');
  const address = `${expected}/.well-known/openid-configuration`;
  if (!isSecureAddress(expected)) {
    throw new ApiError(400, 'insecure_issuer', `The sign-in provider ${expected} is not reached over https, so the app will not sign in there`, { issuer: expected });
  }
  let res: Response;
  try {
    res = await fetchFn(address, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ISSUER_CALL_MS) });
  } catch {
    throw new ApiError(503, 'issuer_unreachable', `The sign-in provider at ${expected} could not be reached`, { issuer: expected });
  }
  if (!res.ok) throw new ApiError(502, 'issuer_error', `${address} answered ${res.status}`, { issuer: expected });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const { authorization_endpoint, token_endpoint } = body;
  if (typeof body.issuer !== 'string' || body.issuer.replace(/\/+$/, '') !== expected) {
    throw new ApiError(502, 'issuer_error', `${address} names the sign-in provider ${JSON.stringify(body.issuer)}, not ${expected}`, { issuer: expected });
  }
  if (typeof authorization_endpoint !== 'string' || typeof token_endpoint !== 'string') {
    throw new ApiError(502, 'issuer_error', `${address} names no authorization_endpoint or token_endpoint`, { issuer: expected });
  }
  for (const [name, endpoint] of [['authorization_endpoint', authorization_endpoint], ['token_endpoint', token_endpoint]] as const) {
    if (!isSecureAddress(endpoint)) {
      throw new ApiError(400, 'insecure_issuer', `${address} names the ${name} ${JSON.stringify(endpoint)}, which is not an https address, so the app will not sign in there`, { issuer: expected, endpoint: name });
    }
  }
  const revocation = body.revocation_endpoint;
  return {
    issuer: expected,
    authorizationEndpoint: authorization_endpoint,
    tokenEndpoint: token_endpoint,
    // An endpoint the program would not post a token to is left out: revoking is a courtesy, never a reason to refuse a sign-in.
    ...(typeof revocation === 'string' && isSecureAddress(revocation) ? { revocationEndpoint: revocation } : {}),
  };
}

/**
 * Tells the provider a refresh token is no longer wanted (RFC 7009), at the sign-out. Until
 * 2026-11-16 a sign-out forgot the token here and left it valid at the provider for its whole
 * life, so a copy taken from the keychain earlier still signed in (the 2026-11-09 review's C18).
 * Best effort: a provider that names no endpoint, cannot be reached or refuses changes nothing
 * about the sign-out, which has already forgotten the token; what happened is returned for the log.
 */
export async function revokeRefreshToken(
  identity: { issuer: string; clientId: string },
  refreshToken: string,
  fetchFn: FetchLike = fetch
): Promise<'revoked' | 'no_endpoint' | 'failed'> {
  try {
    const { revocationEndpoint } = await issuerMetadata(identity.issuer, fetchFn);
    if (!revocationEndpoint) return 'no_endpoint';
    const res = await fetchFn(revocationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      // A public client names itself; it has no secret to authenticate with (RFC 7009 §2.1).
      body: new URLSearchParams({ token: refreshToken, token_type_hint: 'refresh_token', client_id: identity.clientId }).toString(),
      redirect: 'error',
      signal: AbortSignal.timeout(ISSUER_CALL_MS),
    });
    return res.ok ? 'revoked' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * A token endpoint's answer as tokens, or what went wrong as an `ApiError`.
 *
 * Only an OAuth error answer is the provider's refusal (RFC 6749 §5.2: 400, or 401 for the
 * client, with `error` in the body): 403 `sign_in_refused`, on which a refresh signs the person
 * out. A 5xx or a 429 is the provider or a proxy before it in trouble, 503 `issuer_unreachable`,
 * and any other answer without tokens is 502 `issuer_error`; neither is the person's to fix by
 * signing in again, and neither clears a kept token (the 2026-11-09 review's C4: a proxy's 502
 * during the provider's restart signed everyone out and deleted the keychain's entry).
 */
export async function tokensFrom(res: Response, now: () => number, what: string): Promise<Tokens> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) {
      throw new ApiError(503, 'issuer_unreachable', `The sign-in provider answered ${res.status} to ${what}; it is busy or restarting, so try again shortly`, { status: res.status });
    }
    if ((res.status !== 400 && res.status !== 401) || typeof body.error !== 'string') {
      throw new ApiError(502, 'issuer_error', `The sign-in provider answered ${res.status} to ${what}, with no reason a token endpoint gives`, { status: res.status });
    }
    const reason = body.error;
    const description = typeof body.error_description === 'string' ? body.error_description : undefined;
    throw new ApiError(403, 'sign_in_refused', `The sign-in provider refused ${what}: ${reason}${description ? ` (${description})` : ''}`, {
      reason,
      ...(description ? { description } : {}),
    });
  }
  if (typeof body.access_token !== 'string' || !body.access_token) throw new ApiError(502, 'issuer_error', `The sign-in provider's answer to ${what} carries no access_token`);
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
  const cancelled = () => new ApiError(409, 'sign_in_cancelled', 'The sign-in was cancelled');
  const metadata = await issuerMetadata(options.issuer, fetchFn);
  // A cancel that arrived while the metadata was read: no listener was there yet to hear it, and
  // the browser would open on a sign-in nobody is waiting for (the 2026-11-09 review's C9).
  if (options.signal?.aborted) throw cancelled();

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
      page(res, 200, 'Sign-in refused', `The sign-in provider refused: ${error}. Return to Armature.`);
      settle.reject(
        new ApiError(
          403,
          'sign_in_refused',
          scopeRefused
            ? 'The sign-in provider refused offline_access, which keeps you signed in; sign in without it, or ask the administrator to offer it to the desktop client'
            : `The sign-in provider refused the sign-in: ${error}${description ? ` (${description})` : ''}`,
          { reason: error, ...(description ? { description } : {}), ...(scopeRefused ? { offlineAccess: true } : {}) }
        )
      );
      return;
    }
    const code = url.searchParams.get('code');
    if (!code) {
      page(res, 400, 'Sign-in incomplete', 'The sign-in provider sent no code. Return to Armature and sign in again.');
      settle.reject(new ApiError(502, 'issuer_error', 'The sign-in provider redirected without a code'));
      return;
    }
    try {
      let exchanged: Response;
      try {
        exchanged = await fetchFn(metadata.tokenEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: options.clientId, code_verifier: verifier }).toString(),
          // A redirect would post the code again wherever it points (C7); a silent endpoint is given up on (C9).
          redirect: 'error',
          signal: AbortSignal.timeout(ISSUER_CALL_MS),
        });
      } catch {
        throw new ApiError(503, 'issuer_unreachable', `The sign-in provider's token endpoint, ${metadata.tokenEndpoint}, could not be reached`, { issuer: metadata.issuer });
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
  const abort = () => settle.reject(cancelled());
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    const authorization = new URL(metadata.authorizationEndpoint);
    authorization.search = new URLSearchParams({
      response_type: 'code',
      client_id: options.clientId,
      redirect_uri: redirectUri,
      // OpenID Connect's scope names: vocabulary-allow: profile
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
