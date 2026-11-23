/**
 * The viewer's own credential for a hub under the `oidc` resolver (ADR-0067
 * decision 4, built 2026-11-05).
 *
 * The pages read a hub, and under `oidc` every read carries a token. The
 * viewer is a program with no person present, so it holds a credential of
 * its own from the identity provider, the OAuth client credentials grant,
 * and the hub resolves the token to the agent `User` `agent:<client id>`,
 * which a person registers once; it reads, and the hub lets it write nothing
 * (decision 10). Two ways to hold the credential, read from the environment:
 *
 *   ARMATURE_HUB_TOKEN                      a token as issued, sent as is; the operator
 *                                           rotates it by hand. For a rehearsal, or a
 *                                           provider that issues long-lived tokens
 *   ARMATURE_HUB_CLIENT_ID, _CLIENT_SECRET  the viewer asks the issuer for a token itself,
 *                                           at the token endpoint the issuer's metadata
 *                                           names, and asks again shortly before it expires
 *   ARMATURE_OIDC_ISSUER                    the issuer, the hub's own setting, read from the
 *                                           same docker/.env or .env.local; required with
 *                                           the client credentials unless the endpoint is given
 *   ARMATURE_HUB_TOKEN_ENDPOINT             optional: the token endpoint itself, when the
 *                                           issuer's public name is not one the viewer's
 *                                           container can reach (a rehearsal), as the hub's
 *                                           ARMATURE_OIDC_JWKS_URL is for its keys
 *   ARMATURE_REHEARSAL                      `1` lets those addresses be plain http off
 *                                           loopback, as it does the hub's
 *
 * The client secret goes only where the viewer's own settings point (the
 * 2026-11-09 review's V1, built 2026-11-22). Until then the issuer was the one
 * the hub named in `GET /discover`, so a hub that was not the instance's, or
 * the instance's own hub misconfigured, chose where the secret was sent. The
 * viewer still reads `/discover` once, to refuse a hub under `header` or
 * one naming another issuer, saying both names; the hub can stop the viewer,
 * as it always could, but not redirect its secret. Every address the secret
 * or a token travels to is `https`, or plain `http` on loopback or under
 * ARMATURE_REHEARSAL=1, the rule the hub applies to its own issuer
 * (lib/api/config.ts, the review's A5), and an `https` issuer names no `http`
 * token endpoint. Nothing here imports the API: the viewer is a client of the
 * hub over HTTP like any plugin (ADR-0054).
 */

/** How the viewer reaches the hub and the issuer; replaceable for a test, and the shape @armature/client takes. */
export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface TokenSourceOptions {
  /** The hub's origin, for `GET /discover`. */
  hubUrl: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: FetchLike;
  /** The clock, for tests. */
  now?: () => number;
}

/** Seconds before a token's expiry at which the viewer asks for a new one; half the lifetime for a token shorter-lived than twice this. */
const REFRESH_MARGIN_SECONDS = 30;

/**
 * Each request to the hub's discovery, the issuer's metadata and its token
 * endpoint ends within this (the 2026-11-09 review's V1). Until 2026-11-16
 * none had a limit, and since every page waits on the token, one stalled
 * request stalled every page for the runtime's own five minutes.
 */
export const ISSUER_TIMEOUT_MS = 15_000;

/** A loopback name as a URL gives it, as the hub's own rule reads it (lib/api/config.ts). */
const isLoopbackHost = (hostname: string): boolean =>
  hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127(\.\d{1,3}){3}$/.test(hostname);

/** ARMATURE_REHEARSAL: `1`, or unset; anything else is refused, so a misspelled value never passes for either. */
function rehearsal(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value) return false;
  if (value === '1') return true;
  throw new Error(`ARMATURE_REHEARSAL=${value} is not a setting (1, or unset)`);
}

/** The address as given when it is https, or plain http on loopback or in a rehearsal; throws naming `what` otherwise. */
function secureUrl(what: string, raw: string, rehearsed: boolean): string {
  const value = raw.trim();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${what} ${value} is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${what} ${value} is not an http or https address`);
  if (url.protocol === 'http:' && !rehearsed && !isLoopbackHost(url.hostname)) {
    throw new Error(`${what} ${value} is plain http on a host that is not loopback, and the viewer sends its client secret or its token there; use https, or set ARMATURE_REHEARSAL=1 for a rehearsal that is never a deployment`);
  }
  return value;
}

/**
 * The current token on each call. `forget` drops the held token so the next
 * call asks for a new one; given the token that was refused, it drops the
 * held one only when it is that token, so of several requests refused together
 * the first asks for a new token and the rest use it (the review's V2).
 */
export interface TokenSource {
  (): Promise<string>;
  forget: (refused?: string) => void;
}

/**
 * A function the client calls on every request for the current token, or
 * undefined when the environment holds no credential, so a hub under `header`
 * is read as before. A token the hub refuses as `invalid_token` (the issuer
 * rotated its keys under a token still in its lifetime) is forgotten by the
 * viewer's hub client (./viewer.ts), which asks once more with a new one.
 */
export function tokenSource(options: TokenSourceOptions): TokenSource | undefined {
  const env = options.env ?? process.env;
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());

  const fixed = env.ARMATURE_HUB_TOKEN?.trim();
  if (fixed) return Object.assign(async () => fixed, { forget: () => undefined });

  const clientId = env.ARMATURE_HUB_CLIENT_ID?.trim();
  const clientSecret = env.ARMATURE_HUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;

  const fixedEndpoint = env.ARMATURE_HUB_TOKEN_ENDPOINT?.trim();
  const configuredIssuer = env.ARMATURE_OIDC_ISSUER?.trim();
  // Checked when a token is first asked for, so a page says what is wrong rather than the viewer failing to load.
  let tokenEndpoint: Promise<string> | undefined = fixedEndpoint
    ? Promise.resolve().then(() => secureUrl('ARMATURE_HUB_TOKEN_ENDPOINT', fixedEndpoint, rehearsal(env.ARMATURE_REHEARSAL)))
    : undefined;
  let held: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  const endpoint = (): Promise<string> => {
    tokenEndpoint ??= (async () => {
      const rehearsed = rehearsal(env.ARMATURE_REHEARSAL);
      if (!configuredIssuer) {
        throw new Error(
          'The viewer holds a client credential (ARMATURE_HUB_CLIENT_ID) but no ARMATURE_OIDC_ISSUER: it asks only the issuer its own settings name for a token, never the one a hub names, so set the hub’s ARMATURE_OIDC_ISSUER for the viewer too',
        );
      }
      const expected = secureUrl('ARMATURE_OIDC_ISSUER', configuredIssuer, rehearsed).replace(/\/+$/, '');
      const discover = await fetchFn(`${options.hubUrl}/api/v1/discover`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ISSUER_TIMEOUT_MS) });
      if (!discover.ok) throw new Error(`GET /discover answered ${discover.status}; the viewer cannot tell whether the hub takes its issuer's tokens`);
      const identity = ((await discover.json()) as { identity?: { resolver?: string; issuer?: string } }).identity;
      if (identity?.resolver !== 'oidc' || !identity.issuer) {
        throw new Error(`The hub runs under ${identity?.resolver ?? 'an unknown resolver'}, not oidc, yet the viewer holds a client credential (ARMATURE_HUB_CLIENT_ID)`);
      }
      // A consistency check, nothing more: what the hub says is not where the secret goes.
      if (identity.issuer.replace(/\/+$/, '') !== expected) {
        throw new Error(`The hub takes tokens from ${identity.issuer}, but the viewer's ARMATURE_OIDC_ISSUER is ${expected}; the two settings name one issuer`);
      }
      const address = `${expected}/.well-known/openid-configuration`;
      const metadata = await fetchFn(address, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(ISSUER_TIMEOUT_MS) });
      if (!metadata.ok) throw new Error(`${address} answered ${metadata.status}`);
      const { issuer, token_endpoint } = (await metadata.json()) as { issuer?: unknown; token_endpoint?: unknown };
      // OpenID Connect Discovery §4.3, as the hub reads its keys (lib/api/oidc.ts): the metadata's issuer is the one
      // asked for, or the document is someone else's and its token endpoint not where the client secret goes.
      if (typeof issuer !== 'string' || issuer.replace(/\/+$/, '') !== expected) throw new Error(`${address} describes issuer ${String(issuer)}, not ${expected}`);
      if (typeof token_endpoint !== 'string' || !token_endpoint) throw new Error(`${address} names no token_endpoint`);
      if (expected.startsWith('https://') && !token_endpoint.startsWith('https://')) throw new Error(`${address} names a token_endpoint that is not https: ${token_endpoint}`);
      return secureUrl(`The token endpoint ${address} names,`, token_endpoint, rehearsed);
    })();
    tokenEndpoint.catch(() => (tokenEndpoint = undefined));
    return tokenEndpoint;
  };

  const request = async (): Promise<string> => {
    // RFC 6749 §4.4 with §2.3.1: the client authenticates with HTTP Basic, the grant in the body.
    const res = await fetchFn(await endpoint(), {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${encodeURIComponent(clientId)}:${encodeURIComponent(clientSecret)}`, 'utf8').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }).toString(),
      signal: AbortSignal.timeout(ISSUER_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`The issuer refused the viewer's client credentials: ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error("The issuer's answer carries no access_token");
    const lifetime = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 300;
    // A token that lives no longer than the margin was never kept, one request to the issuer per page read.
    const margin = Math.min(REFRESH_MARGIN_SECONDS, lifetime / 2);
    held = { token: body.access_token, expiresAt: now() + (lifetime - margin) * 1000 };
    return held.token;
  };

  const source = async () => {
    if (held && held.expiresAt > now()) return held.token;
    // One request at a time: pages rendering in parallel share the one in flight.
    pending ??= request().finally(() => (pending = undefined));
    return pending;
  };
  return Object.assign(source, {
    forget: (refused?: string) => {
      if (refused === undefined || held?.token === refused) held = undefined;
    },
  });
}

/**
 * A fetch that, when the hub refuses the token it was sent as `invalid_token`,
 * forgets it and sends the request once more with a fresh one: the issuer may
 * have rotated its keys under a token the viewer still held. Any other answer
 * passes through.
 */
export function retryingFetch(source: TokenSource, fetchFn: FetchLike = (input, init) => fetch(input, init)): FetchLike {
  return async (input, init) => {
    const res = await fetchFn(input, init);
    if (res.status !== 401) return res;
    const body = (await res
      .clone()
      .json()
      .catch(() => undefined)) as { error?: unknown } | undefined;
    if (body?.error !== 'invalid_token') return res;
    // Only the token this request carried: one renewed since, by a request refused a moment earlier, is kept.
    const sent = /^Bearer\s+(\S+)$/i.exec(new Headers(init?.headers).get('Authorization') ?? '')?.[1];
    source.forget(sent);
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${await source()}`);
    return fetchFn(input, { ...init, headers });
  };
}
