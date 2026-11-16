/**
 * The sign-in flow against a fake issuer (./signIn.ts;
 * docs/desktop-program-plan.md §6 and §12): the issuer's metadata and
 * endpoints are a fetch stub that holds the flow to PKCE, and the browser is
 * a real request to the flow's own loopback listener. No store.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { issuerMetadata, signIn, type FetchLike } from './signIn';

const ISSUER = 'https://login.example.edu/realms/armature';
const CLIENT = 'armature-desktop';

interface IssuerBehavior {
  /** The authorization endpoint's answer instead of a code: an OAuth error. */
  authorizeError?: string;
  /** The token endpoint's refusal of the code. */
  tokenError?: string;
  /** Whether a refresh token is issued; true by default. */
  refresh?: boolean;
  /** The metadata's issuer, when it should differ. */
  metadataIssuer?: string;
}

function fakeIssuer(behavior: IssuerBehavior = {}) {
  const issued = new Map<string, { challenge: string; redirect: string }>();
  const seen: { authorize?: URL; exchanges: URLSearchParams[]; pages: Promise<{ status: number; text: string }>[] } = { exchanges: [], pages: [] };
  const fetchStub: FetchLike = async (input, init) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/openid-configuration`) {
      return Response.json({ issuer: behavior.metadataIssuer ?? ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token` });
    }
    if (url === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(init?.body));
      seen.exchanges.push(body);
      if (behavior.tokenError) return Response.json({ error: behavior.tokenError, error_description: 'Not for you' }, { status: 400 });
      const grant = issued.get(body.get('code') ?? '');
      const verified = grant && createHash('sha256').update(body.get('code_verifier') ?? '').digest('base64url') === grant.challenge;
      if (!grant || !verified || body.get('redirect_uri') !== grant.redirect || body.get('client_id') !== CLIENT) {
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      }
      return Response.json({ access_token: 'access-1', expires_in: 300, ...(behavior.refresh === false ? {} : { refresh_token: 'refresh-1' }) });
    }
    throw new TypeError(`fetch failed: ${url}`);
  };
  /** The person's browser: the provider answers the authorization request by redirecting to the loopback callback. */
  const browser = (authorize: string) => {
    const url = new URL(authorize);
    seen.authorize = url;
    const redirect = new URL(url.searchParams.get('redirect_uri')!);
    redirect.searchParams.set('state', url.searchParams.get('state')!);
    if (behavior.authorizeError) {
      redirect.searchParams.set('error', behavior.authorizeError);
    } else {
      issued.set('the-code', { challenge: url.searchParams.get('code_challenge')!, redirect: url.searchParams.get('redirect_uri')! });
      redirect.searchParams.set('code', 'the-code');
    }
    seen.pages.push(fetch(redirect).then(async (res) => ({ status: res.status, text: await res.text() })));
  };
  return { fetch: fetchStub, browser, seen };
}

describe('signIn', () => {
  it('signs in with PKCE on a loopback port and keeps the refresh token', async () => {
    const issuer = fakeIssuer();
    const tokens = await signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: issuer.browser, fetch: issuer.fetch, now: () => 1_000_000 });
    expect(tokens).toEqual({ accessToken: 'access-1', expiresAt: 1_000_000 + 300_000, refreshToken: 'refresh-1' });

    const authorize = issuer.seen.authorize!;
    expect(`${authorize.origin}${authorize.pathname}`).toBe(`${ISSUER}/auth`);
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({ response_type: 'code', client_id: CLIENT, scope: 'openid profile email offline_access', code_challenge_method: 'S256' });
    expect(authorize.searchParams.get('redirect_uri')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    // A public client: no secret is sent, only the verifier.
    expect([...issuer.seen.exchanges[0].keys()].sort()).toEqual(['client_id', 'code', 'code_verifier', 'grant_type', 'redirect_uri']);

    const page = await issuer.seen.pages[0];
    expect(page.status).toBe(200);
    expect(page.text).toContain('Signed in');
    // The listener is closed once the flow ends.
    await expect(fetch(authorize.searchParams.get('redirect_uri')!)).rejects.toThrow();
  });

  it('answers a callback with another state 400 and goes on waiting for the person’s own', async () => {
    const issuer = fakeIssuer();
    let stray: { status: number } | undefined;
    const tokens = await signIn({
      issuer: ISSUER,
      clientId: CLIENT,
      fetch: issuer.fetch,
      openBrowser: async (url) => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri')!);
        stray = await fetch(`${redirect}?state=not-this-one&code=forged`);
        const other = await fetch(`${redirect.origin}/elsewhere`);
        expect(other.status).toBe(404);
        issuer.browser(url);
      },
    });
    expect(stray?.status).toBe(400);
    expect(tokens.accessToken).toBe('access-1');
    expect(issuer.seen.exchanges).toHaveLength(1);
  });

  it('says how to go on when the provider refuses offline_access, and can sign in without it', async () => {
    const refusing = fakeIssuer({ authorizeError: 'invalid_scope' });
    await expect(signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: refusing.browser, fetch: refusing.fetch })).rejects.toMatchObject({
      status: 403,
      code: 'sign_in_refused',
      details: { reason: 'invalid_scope', offlineAccess: true },
    });

    const issuer = fakeIssuer({ refresh: false });
    const tokens = await signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: issuer.browser, fetch: issuer.fetch, offline: false });
    expect(issuer.seen.authorize!.searchParams.get('scope')).toBe('openid profile email');
    expect(tokens.refreshToken).toBeUndefined();
  });

  it('answers the token endpoint’s refusal with its reason, as Keycloak’s not_allowed', async () => {
    const issuer = fakeIssuer({ tokenError: 'not_allowed' });
    await expect(signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: issuer.browser, fetch: issuer.fetch })).rejects.toMatchObject({
      status: 403,
      code: 'sign_in_refused',
      details: { reason: 'not_allowed', description: 'Not for you' },
    });
    expect((await issuer.seen.pages[0]).text).toContain('refused');
  });

  it('gives up after its timeout, and when cancelled', async () => {
    const issuer = fakeIssuer();
    await expect(signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: () => undefined, fetch: issuer.fetch, timeoutMs: 50 })).rejects.toMatchObject({ status: 408, code: 'sign_in_timeout' });
    const controller = new AbortController();
    const cancelled = signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: () => controller.abort(), fetch: issuer.fetch, signal: controller.signal });
    await expect(cancelled).rejects.toMatchObject({ code: 'sign_in_cancelled' });
  });

  it('is cancelled by a cancel that arrives while the metadata is read, and opens no browser (the 2026-11-09 review’s C9)', async () => {
    const issuer = fakeIssuer();
    const controller = new AbortController();
    let opened = 0;
    const slow: FetchLike = async (input, init) => {
      // The person cancels while the provider is still answering the first request.
      controller.abort();
      return issuer.fetch(input, init);
    };
    await expect(signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: () => void (opened += 1), fetch: slow, signal: controller.signal })).rejects.toMatchObject({ status: 409, code: 'sign_in_cancelled' });
    expect(opened).toBe(0);
  });

  it('tells a provider in trouble from a refusal at the exchange, and follows no redirect with the code (C4, C7)', async () => {
    const issuer = fakeIssuer();
    const inits: RequestInit[] = [];
    const troubled: FetchLike = async (input, init) => {
      if (String(input) === `${ISSUER}/token`) {
        inits.push(init ?? {});
        return new Response('<html>Bad Gateway</html>', { status: 502 });
      }
      return issuer.fetch(input, init);
    };
    await expect(signIn({ issuer: ISSUER, clientId: CLIENT, openBrowser: issuer.browser, fetch: troubled })).rejects.toMatchObject({ status: 503, code: 'issuer_unreachable', details: { status: 502 } });
    expect(inits[0].redirect).toBe('error');
    expect(inits[0].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('issuerMetadata', () => {
  it('reads the endpoints, and refuses metadata naming another issuer', async () => {
    expect(await issuerMetadata(`${ISSUER}/`, fakeIssuer().fetch)).toEqual({ issuer: ISSUER, authorizationEndpoint: `${ISSUER}/auth`, tokenEndpoint: `${ISSUER}/token` });
    await expect(issuerMetadata(ISSUER, fakeIssuer({ metadataIssuer: 'https://evil.example.com' }).fetch)).rejects.toMatchObject({ status: 502, code: 'issuer_error' });
  });

  it('refuses an issuer, or an endpoint of one, that is not https, except on this machine (the 2026-11-09 review’s C7)', async () => {
    const serving = (metadata: Record<string, string>): FetchLike => async () => Response.json(metadata);
    const refused = { status: 400, code: 'insecure_issuer' };
    // The issuer itself: nothing is asked of it.
    let asked = 0;
    await expect(
      issuerMetadata('http://login.example.edu/realms/armature', async () => {
        asked += 1;
        return Response.json({});
      })
    ).rejects.toMatchObject(refused);
    expect(asked).toBe(0);
    // An https issuer naming a plain or a non-web endpoint.
    for (const [name, endpoint] of [
      ['token_endpoint', 'http://login.example.edu/token'],
      ['authorization_endpoint', 'file:///Applications/Calculator.app'],
      ['authorization_endpoint', 'not an address'],
    ]) {
      const metadata = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, [name]: endpoint };
      await expect(issuerMetadata(ISSUER, serving(metadata)), endpoint).rejects.toMatchObject({ ...refused, details: { endpoint: name } });
    }
    // An endpoint on another origin is a provider's to choose, and a provider beside the program for a rehearsal is plain http on loopback.
    const elsewhere = { issuer: ISSUER, authorization_endpoint: 'https://auth.example.org/authorize', token_endpoint: 'https://tokens.example.org/token' };
    expect(await issuerMetadata(ISSUER, serving(elsewhere))).toMatchObject({ authorizationEndpoint: elsewhere.authorization_endpoint, tokenEndpoint: elsewhere.token_endpoint });
    const local = 'http://127.0.0.1:8080/realms/armature';
    expect(await issuerMetadata(local, serving({ issuer: local, authorization_endpoint: `${local}/auth`, token_endpoint: 'http://localhost:8080/token' }))).toMatchObject({ issuer: local });
  });

  it('gives the provider a deadline for its metadata (C9)', async () => {
    let init: RequestInit | undefined;
    await issuerMetadata(ISSUER, async (_input, given) => {
      init = given;
      return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token` });
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers an issuer it cannot reach 503', async () => {
    await expect(issuerMetadata('https://nowhere.example.edu', fakeIssuer().fetch)).rejects.toMatchObject({ status: 503, code: 'issuer_unreachable' });
  });
});
