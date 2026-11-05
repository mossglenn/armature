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
 *
 * The issuer is the one the hub names in `GET /discover` (`identity.issuer`),
 * read once; a hub under `header` names none, and the viewer then sends no
 * token, as it never did. Nothing here imports the API: the viewer is a
 * client of the hub over HTTP like any plugin (ADR-0054).
 */

/** How the viewer reaches the hub and the issuer; replaceable for a test. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface TokenSourceOptions {
  /** The hub's origin, for `GET /discover`. */
  hubUrl: string;
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: FetchLike;
  /** The clock, for tests. */
  now?: () => number;
}

/** Seconds before a token's expiry at which the viewer asks for a new one. */
const REFRESH_MARGIN_SECONDS = 30;

/**
 * A function the client calls on every request for the current token, or
 * undefined when the environment holds no credential, so a hub under `header`
 * is read as before.
 */
export function tokenSource(options: TokenSourceOptions): (() => Promise<string>) | undefined {
  const env = options.env ?? process.env;
  const fetchFn: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => Date.now());

  const fixed = env.ARMATURE_HUB_TOKEN?.trim();
  if (fixed) return async () => fixed;

  const clientId = env.ARMATURE_HUB_CLIENT_ID?.trim();
  const clientSecret = env.ARMATURE_HUB_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;

  let tokenEndpoint: Promise<string> | undefined;
  let held: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  const endpoint = (): Promise<string> => {
    tokenEndpoint ??= (async () => {
      const discover = await fetchFn(`${options.hubUrl}/api/v1/discover`, { headers: { Accept: 'application/json' } });
      if (!discover.ok) throw new Error(`GET /discover answered ${discover.status}; the viewer cannot learn the hub's issuer`);
      const identity = ((await discover.json()) as { identity?: { resolver?: string; issuer?: string } }).identity;
      if (identity?.resolver !== 'oidc' || !identity.issuer) {
        throw new Error(`The hub runs under ${identity?.resolver ?? 'an unknown resolver'}, not oidc, yet the viewer holds a client credential (ARMATURE_HUB_CLIENT_ID)`);
      }
      const address = `${identity.issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
      const metadata = await fetchFn(address, { headers: { Accept: 'application/json' } });
      if (!metadata.ok) throw new Error(`${address} answered ${metadata.status}`);
      const { token_endpoint } = (await metadata.json()) as { token_endpoint?: unknown };
      if (typeof token_endpoint !== 'string' || !token_endpoint) throw new Error(`${address} names no token_endpoint`);
      return token_endpoint;
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
    });
    if (!res.ok) throw new Error(`The issuer refused the viewer's client credentials: ${res.status}`);
    const body = (await res.json()) as { access_token?: unknown; expires_in?: unknown };
    if (typeof body.access_token !== 'string' || !body.access_token) throw new Error("The issuer's answer carries no access_token");
    const lifetime = typeof body.expires_in === 'number' && body.expires_in > 0 ? body.expires_in : 300;
    held = { token: body.access_token, expiresAt: now() + (lifetime - REFRESH_MARGIN_SECONDS) * 1000 };
    return held.token;
  };

  return async () => {
    if (held && held.expiresAt > now()) return held.token;
    // One request at a time: pages rendering in parallel share the one in flight.
    pending ??= request().finally(() => (pending = undefined));
    return pending;
  };
}
