import type { Context } from 'hono';
import { createRemoteJWKSet, decodeProtectedHeader, errors as jose, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { bareName, hubOf, type OidcConfig } from './config';
import { ApiError } from './errors';
import type { IdentityClaims, IdentityResolver } from './identity';

/**
 * The `oidc` resolver (architecture decision record ADR-0067 decision 1;
 * OIDC is OpenID Connect): a request carries `Authorization: Bearer <token>`,
 * a JSON Web Token the identity provider signed, and the hub verifies it
 * against the provider's published keys before it trusts a word of it.
 *
 * What is checked, with `jose`: the signature against the issuer's key set
 * (its JWKS, JSON Web Key Set), the algorithm against an allow-list, and the
 * `iss`, `aud`, `exp` and `nbf` claims against ARMATURE_OIDC_ISSUER and
 * ARMATURE_OIDC_AUDIENCE. A token that fails any of these is 401
 * `invalid_token` with a `reason`, and no token at all is 401
 * `identity_required` (identity.ts), both with `WWW-Authenticate: Bearer` as
 * RFC 6750 asks. One issuer per instance.
 *
 * What the token says. A person's token resolves by `(issuer, sub)`: `sub` is
 * the `externalId`, the issuer is kept on the `User` (decision 1, note of
 * 2026-10-30), `name` is the display name a first encounter registers with
 * and `email` the email, and the token is *admitted*, so that first encounter
 * may register, when ARMATURE_OIDC_ADMIT lists the issuer or the email's
 * domain (an email the token marks unverified admits nothing). A service's
 * token, one issued to a program with no person present by the client
 * credentials grant (decision 4), carries no `name` and names its client in
 * `azp` or `client_id`; it resolves to the agent `User` whose externalId is
 * `agent:` followed by that client id, registered by a person as any agent
 * is, and reads only (ADR-0067 decision 10, authorization.ts). The rule is
 * the same one decision 1 draws for persons: a person's token carries a name,
 * a service's does not.
 *
 * The keys. The issuer's key set is fetched once per process from the address
 * its metadata names (`<issuer>/.well-known/openid-configuration`, OpenID
 * Connect Discovery) or from ARMATURE_OIDC_JWKS_URL, and kept, refetched when a
 * token names a key it does not hold and at most every half minute, which is
 * how a provider rotates keys. The configuration is rebuilt on every request
 * (config.ts), so the key set lives here, keyed by its address, as the reads
 * memo lives beside the store; a host or a test may supply the keys on the
 * configuration instead (`oidc.keys`), which is how the contract suite signs
 * tokens with a key it generated. An issuer that cannot be reached, or whose
 * metadata or key set answers anything but what a provider serves, is 503
 * `issuer_unreachable`, and the next request tries again: a provider's outage
 * is never told to a caller as a fault in their token.
 */

/** The signature algorithms a token may use (decision 1): asymmetric only, so no shared secret could mint one. */
export const ALGORITHMS = ['RS256', 'ES256', 'EdDSA'] as const;

/** The `WWW-Authenticate` challenge every 401 under `oidc` carries (RFC 6750 §3). */
export function challenge(c: Context, error?: 'invalid_token'): void {
  c.header('WWW-Authenticate', error ? `Bearer realm="armature", error="${error}"` : 'Bearer realm="armature"');
}

/** 401 `invalid_token` with the challenge set and the reason named. */
function invalid(c: Context, reason: string, message: string): ApiError {
  challenge(c, 'invalid_token');
  return new ApiError(401, 'invalid_token', message, { reason });
}

/**
 * Why `jose` refused a token, as a stable reason, or undefined when the
 * failure was not the token's. The token's own faults are named one by one;
 * anything else `jose` raises is the issuer's: a key set that answered an
 * error or something that is no key set (a plain `JOSEError`, `JWKSInvalid`),
 * one that timed out, a key the runtime cannot use.
 */
function reasonOf(err: unknown): string | undefined {
  if (err instanceof jose.JWTExpired) return 'expired';
  if (err instanceof jose.JWTClaimValidationFailed) {
    return err.claim === 'aud' ? 'audience' : err.claim === 'iss' ? 'issuer' : err.claim === 'nbf' ? 'not_yet_valid' : `claim:${err.claim}`;
  }
  if (err instanceof jose.JOSEAlgNotAllowed) return 'algorithm';
  if (err instanceof jose.JWSSignatureVerificationFailed) return 'signature';
  if (err instanceof jose.JWKSNoMatchingKey || err instanceof jose.JWKSMultipleMatchingKeys) return 'unknown_key';
  if (err instanceof jose.JWTInvalid || err instanceof jose.JWSInvalid) return 'malformed';
  return undefined;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** The domain of an email address, as compared: lower case, after the last `@`. */
const domainOf = (email: string): string => bareName(email.slice(email.lastIndexOf('@') + 1));

/**
 * The claims a verified token resolves to (decision 1 and its note; decision
 * 4): a service's, or a person's with whether first encounter may register.
 */
export function claimsOf(payload: JWTPayload, oidc: OidcConfig): IdentityClaims {
  const sub = text(payload.sub);
  if (!sub) throw new jose.JWTClaimValidationFailed('missing required "sub" claim', payload, 'sub', 'missing');
  const name = text(payload.name);
  const clientId = text(payload.azp) ?? text(payload.client_id);
  if (!name && clientId) return { externalId: `agent:${clientId}`, service: true };
  const email = text(payload.email);
  const admitted =
    oidc.admit.issuers.has(oidc.issuer) ||
    (email !== undefined && payload.email_verified !== false && oidc.admit.domains.has(domainOf(email)));
  return { externalId: sub, issuer: oidc.issuer, admitted, ...(name ? { displayName: name } : {}), ...(email ? { email } : {}) };
}

/** Whether a token's header carries `crit`; a token whose header cannot be read is left for `jwtVerify` to refuse. */
function criticalOf(token: string): boolean {
  try {
    return decodeProtectedHeader(token).crit !== undefined;
  } catch {
    return false;
  }
}

export const oidcResolver: IdentityResolver = async (c) => {
  const oidc = hubOf(c).oidc;
  if (!oidc) throw new Error('ARMATURE_IDENTITY=oidc without its settings; configFromEnv reads them');
  const header = c.req.header('Authorization')?.trim();
  if (!header) return undefined;
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw invalid(c, 'malformed', 'Authorization carries a bearer token: Authorization: Bearer <token>');
  try {
    // The hub understands no extension a token could mark critical; refused here, since `jose` reports
    // one with the class it also uses for a key it cannot read, which is the issuer's fault.
    if (criticalOf(match[1])) throw new jose.JWSInvalid('the token marks a header parameter critical (crit), and the hub understands none');
    // Inside the try: metadata that cannot be read is the issuer's failure too, 503 and not a 500.
    const keys = oidc.keys ?? (await keysFor(oidc));
    const { payload } = await jwtVerify(match[1], keys, { issuer: oidc.issuer, audience: oidc.audience, algorithms: [...ALGORITHMS] });
    return claimsOf(payload, oidc);
  } catch (err) {
    const reason = reasonOf(err);
    if (reason) throw invalid(c, reason, `The bearer token was refused: ${reason.replace(/_/g, ' ')} (${(err as Error).message})`);
    console.error(`The issuer's keys could not be read (${c.req.method} ${c.req.path}):`, err);
    throw new ApiError(503, 'issuer_unreachable', `The identity provider's keys could not be read from ${oidc.jwksUrl ?? oidc.issuer}; the hub tries again on the next request`);
  }
};

// ── The issuer's keys, kept per process ──────────────────────────────────────

/** How the hub reaches the issuer; replaceable for a test. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

const jwksUrls = new Map<string, Promise<string>>();
const keySets = new Map<string, JWTVerifyGetKey>();

/** The address of an issuer's key set from its metadata, read once and kept; a failed read is forgotten so the next request asks again. */
export function jwksUrlOf(issuer: string, fetchFn: FetchLike = (input, init) => fetch(input, init)): Promise<string> {
  const kept = jwksUrls.get(issuer);
  if (kept) return kept;
  const read = (async () => {
    const address = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`;
    const res = await fetchFn(address, { signal: AbortSignal.timeout(5_000), headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`${address} answered ${res.status}`);
    const metadata = (await res.json()) as { issuer?: unknown; jwks_uri?: unknown };
    // OpenID Connect Discovery §4.3: the metadata's issuer is the one asked for, or the document is someone else's.
    if (metadata.issuer !== issuer) throw new Error(`${address} describes issuer ${String(metadata.issuer)}, not ${issuer}`);
    const url = text(metadata.jwks_uri);
    if (!url) throw new Error(`${address} names no jwks_uri`);
    return url;
  })();
  jwksUrls.set(issuer, read);
  read.catch(() => jwksUrls.delete(issuer));
  return read;
}

/** The issuer's keys as `jose` fetches and keeps them, one key set per address. */
export async function keysFor(oidc: OidcConfig): Promise<JWTVerifyGetKey> {
  const url = oidc.jwksUrl ?? (await jwksUrlOf(oidc.issuer));
  let keys = keySets.get(url);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(url), { timeoutDuration: 5_000, cooldownDuration: 30_000 });
    keySets.set(url, keys);
  }
  return keys;
}

/** Forgets every issuer and key set read so far; for tests. */
export function forgetIssuers(): void {
  jwksUrls.clear();
  keySets.clear();
}
