/**
 * The viewer's own credential (ADR-0067 decision 4): a fixed token sent as
 * is, or the client credentials grant against the issuer the hub names,
 * held until shortly before it expires, one request in flight at a time.
 * The hub and the issuer are a stub fetch here.
 */
import { describe, expect, it } from 'vitest';
import { retryingFetch, tokenSource } from './viewerToken';

const HUB = 'http://hub.test';
const ISSUER = 'https://login.example.edu/realms/armature';
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function issuer(resolver = 'oidc') {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let issued = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${HUB}/api/v1/discover`) return json({ identity: resolver === 'oidc' ? { resolver, issuer: ISSUER } : { resolver } });
    if (url === `${ISSUER}/.well-known/openid-configuration`) return json({ issuer: ISSUER, token_endpoint: `${ISSUER}/token` });
    if (url === `${ISSUER}/token`) {
      issued += 1;
      return json({ access_token: `token-${issued}`, token_type: 'Bearer', expires_in: 300 });
    }
    return json({ error: 'not_found' }, 404);
  };
  return { calls, fetch, issued: () => issued };
}

describe('the viewer’s token source', () => {
  it('is nothing without a credential, so a hub under header is read as before', () => {
    expect(tokenSource({ hubUrl: HUB, env: {} })).toBeUndefined();
    expect(tokenSource({ hubUrl: HUB, env: { ARMATURE_HUB_CLIENT_ID: 'viewer' } })).toBeUndefined();
  });

  it('sends a fixed token as is', async () => {
    const source = tokenSource({ hubUrl: HUB, env: { ARMATURE_HUB_TOKEN: ' fixed ' } });
    expect(await source!()).toBe('fixed');
  });

  it('asks the issuer the hub names with HTTP Basic client credentials, once, and again shortly before the token expires', async () => {
    const stub = issuer();
    let clock = 1_000_000;
    const source = tokenSource({
      hubUrl: HUB,
      env: { ARMATURE_HUB_CLIENT_ID: 'viewer', ARMATURE_HUB_CLIENT_SECRET: 's3cret/with:colon' },
      fetch: stub.fetch,
      now: () => clock,
    })!;
    const [a, b] = await Promise.all([source(), source()]);
    expect(a).toBe('token-1');
    expect(b).toBe('token-1');
    expect(await source()).toBe('token-1');
    expect(stub.issued()).toBe(1);
    expect(stub.calls.map((c) => c.url)).toEqual([`${HUB}/api/v1/discover`, `${ISSUER}/.well-known/openid-configuration`, `${ISSUER}/token`]);
    const grant = stub.calls[2].init!;
    expect(grant.method).toBe('POST');
    expect((grant.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from('viewer:s3cret%2Fwith%3Acolon').toString('base64')}`);
    expect(String(grant.body)).toBe('grant_type=client_credentials');
    // 300 seconds minus the 30-second margin: at 271 seconds a new token is asked for, the endpoint not read again.
    clock += 271_000;
    expect(await source()).toBe('token-2');
    expect(stub.calls.filter((c) => c.url.endsWith('openid-configuration'))).toHaveLength(1);
  });

  it('takes the token endpoint as given and reads nothing else first', async () => {
    const stub = issuer();
    const source = tokenSource({
      hubUrl: HUB,
      env: { ARMATURE_HUB_CLIENT_ID: 'viewer', ARMATURE_HUB_CLIENT_SECRET: 'x', ARMATURE_HUB_TOKEN_ENDPOINT: `${ISSUER}/token` },
      fetch: stub.fetch,
    })!;
    expect(await source()).toBe('token-1');
    expect(stub.calls.map((c) => c.url)).toEqual([`${ISSUER}/token`]);
  });

  it('forgets a token the hub refuses as invalid and sends the request once more with a new one', async () => {
    const stub = issuer();
    const source = tokenSource({ hubUrl: HUB, env: { ARMATURE_HUB_CLIENT_ID: 'viewer', ARMATURE_HUB_CLIENT_SECRET: 'x' }, fetch: stub.fetch })!;
    const seen: string[] = [];
    const hub = async (input: string | URL | Request, init?: RequestInit) => {
      const token = new Headers(init?.headers).get('Authorization');
      seen.push(token ?? '');
      // The hub refuses the first token (the issuer's keys changed) and takes the second.
      if (token === 'Bearer token-1') return json({ error: 'invalid_token', reason: 'unknown_key' }, 401);
      if (String(input).endsWith('/forbidden')) return json({ error: 'forbidden' }, 403);
      return json({ ok: true });
    };
    const fetchWithRetry = retryingFetch(source, hub);
    const first = await fetchWithRetry(`${HUB}/api/v1/documents/Module`, { headers: { Authorization: `Bearer ${await source()}` } });
    expect(first.status).toBe(200);
    expect(seen).toEqual(['Bearer token-1', 'Bearer token-2']);
    expect(await source()).toBe('token-2');
    // Any other refusal passes through untouched, and no new token is asked for.
    const other = await fetchWithRetry(`${HUB}/forbidden`, { headers: { Authorization: `Bearer ${await source()}` } });
    expect(other.status).toBe(403);
    expect(stub.issued()).toBe(2);
  });

  it('refuses to hold a client credential against a hub under header', async () => {
    const stub = issuer('header');
    const source = tokenSource({ hubUrl: HUB, env: { ARMATURE_HUB_CLIENT_ID: 'viewer', ARMATURE_HUB_CLIENT_SECRET: 'x' }, fetch: stub.fetch })!;
    await expect(source()).rejects.toThrow(/not oidc/);
  });
});
