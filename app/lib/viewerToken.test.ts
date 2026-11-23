/**
 * The viewer's own credential (ADR-0067 decision 4): a fixed token sent as
 * is, or the client credentials grant against the issuer the viewer's own
 * settings name, the hub's checked against it (the 2026-11-09 review's V1),
 * held until shortly before it expires, one request in flight at a time.
 * The hub and the issuer are a stub fetch here.
 */
import { describe, expect, it } from 'vitest';
import { retryingFetch, tokenSource } from './viewerToken';

const HUB = 'http://hub.test';
const ISSUER = 'https://login.example.edu/realms/armature';
/** The client credentials with the issuer they are for, as the compose file passes both. */
const CREDENTIALS = { ARMATURE_HUB_CLIENT_ID: 'viewer', ARMATURE_HUB_CLIENT_SECRET: 'x', ARMATURE_OIDC_ISSUER: ISSUER };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function issuer(resolver = 'oidc', hubIssuer = ISSUER) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let issued = 0;
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === `${HUB}/api/v1/discover`) return json({ identity: resolver === 'oidc' ? { resolver, issuer: hubIssuer } : { resolver } });
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

  it('asks the issuer its settings name with HTTP Basic client credentials, once, and again shortly before the token expires', async () => {
    const stub = issuer();
    let clock = 1_000_000;
    const source = tokenSource({
      hubUrl: HUB,
      env: { ...CREDENTIALS, ARMATURE_HUB_CLIENT_SECRET: 's3cret/with:colon' },
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
    const source = tokenSource({ hubUrl: HUB, env: CREDENTIALS, fetch: stub.fetch })!;
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

  it("asks for one new token when several requests are refused together, keeps a short-lived one for half its life, and bounds every request (the 2026-11-09 review's V1 and V2)", async () => {
    const stub = issuer();
    const source = tokenSource({ hubUrl: HUB, env: CREDENTIALS, fetch: stub.fetch })!;
    const first = await source();
    // Three pages rendered in parallel, all holding the token the hub now refuses.
    const hub = async (_input: string | URL | Request, init?: RequestInit) =>
      new Headers(init?.headers).get('Authorization') === `Bearer ${first}` ? json({ error: 'invalid_token', reason: 'unknown_key' }, 401) : json({ ok: true });
    const fetchWithRetry = retryingFetch(source, hub);
    const answers = await Promise.all([1, 2, 3].map(() => fetchWithRetry(`${HUB}/api/v1/documents/Module`, { headers: { Authorization: `Bearer ${first}` } })));
    expect(answers.map((res) => res.status)).toEqual([200, 200, 200]);
    expect(stub.issued()).toBe(2);
    // A refusal that arrives after the renewal names the old token and forgets nothing.
    source.forget(first);
    expect(await source()).toBe('token-2');
    expect(stub.issued()).toBe(2);
    // Every request to the hub and the issuer carries a limit.
    expect(stub.calls.every((call) => call.init?.signal instanceof AbortSignal)).toBe(true);

    // A token of twenty seconds is held for ten, not asked for on every call.
    let clock = 1_000_000;
    let issued = 0;
    const brief = tokenSource({
      hubUrl: HUB,
      env: { ARMATURE_HUB_CLIENT_ID: 'viewer', ARMATURE_HUB_CLIENT_SECRET: 'x', ARMATURE_HUB_TOKEN_ENDPOINT: `${ISSUER}/token` },
      fetch: async () => json({ access_token: `brief-${(issued += 1)}`, expires_in: 20 }),
      now: () => clock,
    })!;
    expect(await brief()).toBe('brief-1');
    clock += 9_000;
    expect(await brief()).toBe('brief-1');
    clock += 2_000;
    expect(await brief()).toBe('brief-2');
  });

  it("refuses metadata that describes another issuer, so the client secret goes only to the one the settings name (V1)", async () => {
    const stub = issuer();
    const fetch = async (input: string | URL | Request, init?: RequestInit) =>
      String(input).endsWith('openid-configuration') ? json({ issuer: 'https://elsewhere.example.org', token_endpoint: 'https://elsewhere.example.org/token' }) : stub.fetch(input, init);
    const source = tokenSource({ hubUrl: HUB, env: CREDENTIALS, fetch })!;
    await expect(source()).rejects.toThrow(/describes issuer https:\/\/elsewhere.example.org/);
    expect(stub.calls.some((call) => call.url.endsWith('/token'))).toBe(false);
  });

  it('refuses to hold a client credential against a hub under header', async () => {
    const stub = issuer('header');
    const source = tokenSource({ hubUrl: HUB, env: CREDENTIALS, fetch: stub.fetch })!;
    await expect(source()).rejects.toThrow(/not oidc/);
  });

  it('asks no issuer a hub names: without ARMATURE_OIDC_ISSUER nothing is read, and a hub naming another is refused before the secret leaves (V1)', async () => {
    const stub = issuer();
    const unset = tokenSource({ hubUrl: HUB, env: { ARMATURE_HUB_CLIENT_ID: 'viewer', ARMATURE_HUB_CLIENT_SECRET: 'x' }, fetch: stub.fetch })!;
    await expect(unset()).rejects.toThrow(/no ARMATURE_OIDC_ISSUER/);
    expect(stub.calls).toEqual([]);

    // A hub that is not the instance's, naming an issuer it controls, whose metadata would point anywhere.
    const hostile = issuer('oidc', 'https://login.attacker.example');
    const source = tokenSource({ hubUrl: HUB, env: CREDENTIALS, fetch: hostile.fetch })!;
    await expect(source()).rejects.toThrow(/takes tokens from https:\/\/login\.attacker\.example, but the viewer's ARMATURE_OIDC_ISSUER is https:\/\/login\.example\.edu/);
    expect(hostile.calls.map((c) => c.url)).toEqual([`${HUB}/api/v1/discover`]);

    // A trailing slash on either side is the same issuer.
    const slashed = issuer('oidc', `${ISSUER}/`);
    expect(await tokenSource({ hubUrl: HUB, env: CREDENTIALS, fetch: slashed.fetch })!()).toBe('token-1');
  });

  it('sends the secret and the token over https only, or plain http on loopback or in a rehearsal (V1, as the hub’s A5)', async () => {
    const plain = 'http://keycloak:8080/realms/armature';
    const at = (iss: string) => {
      const calls: string[] = [];
      const fetch = async (input: string | URL | Request) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith('/discover')) return json({ identity: { resolver: 'oidc', issuer: iss } });
        if (url.endsWith('openid-configuration')) return json({ issuer: iss, token_endpoint: `${iss}/token` });
        return json({ access_token: 'issued', expires_in: 300 });
      };
      return { calls, fetch };
    };
    // A plain-http issuer off loopback: refused, nothing read.
    const refused = at(plain);
    await expect(tokenSource({ hubUrl: HUB, env: { ...CREDENTIALS, ARMATURE_OIDC_ISSUER: plain }, fetch: refused.fetch })!()).rejects.toThrow(/ARMATURE_OIDC_ISSUER http:\/\/keycloak:8080\/realms\/armature is plain http/);
    expect(refused.calls).toEqual([]);
    // In a rehearsal, and on loopback, it is taken.
    expect(await tokenSource({ hubUrl: HUB, env: { ...CREDENTIALS, ARMATURE_OIDC_ISSUER: plain, ARMATURE_REHEARSAL: '1' }, fetch: at(plain).fetch })!()).toBe('issued');
    const loopback = 'http://localhost:8080/realms/armature';
    expect(await tokenSource({ hubUrl: HUB, env: { ...CREDENTIALS, ARMATURE_OIDC_ISSUER: loopback }, fetch: at(loopback).fetch })!()).toBe('issued');

    // The endpoint as given follows the same rule, as the rehearsal's settings give it.
    const given = { ...CREDENTIALS, ARMATURE_HUB_TOKEN_ENDPOINT: `${plain}/protocol/openid-connect/token` };
    const posted = at(plain);
    await expect(tokenSource({ hubUrl: HUB, env: given, fetch: posted.fetch })!()).rejects.toThrow(/ARMATURE_HUB_TOKEN_ENDPOINT .* is plain http/);
    expect(posted.calls).toEqual([]);
    expect(await tokenSource({ hubUrl: HUB, env: { ...given, ARMATURE_REHEARSAL: '1' }, fetch: at(plain).fetch })!()).toBe('issued');

    // An https issuer whose metadata names a plain-http token endpoint: refused even in a rehearsal.
    const downgrade = async (input: string | URL | Request) =>
      String(input).endsWith('openid-configuration') ? json({ issuer: ISSUER, token_endpoint: 'http://login.example.edu/token' }) : issuer().fetch(input);
    await expect(tokenSource({ hubUrl: HUB, env: { ...CREDENTIALS, ARMATURE_REHEARSAL: '1' }, fetch: downgrade })!()).rejects.toThrow(/token_endpoint that is not https/);

    // A misspelled rehearsal setting passes for neither.
    await expect(tokenSource({ hubUrl: HUB, env: { ...CREDENTIALS, ARMATURE_REHEARSAL: 'yes' }, fetch: at(ISSUER).fetch })!()).rejects.toThrow(/ARMATURE_REHEARSAL=yes is not a setting/);
  });
});
