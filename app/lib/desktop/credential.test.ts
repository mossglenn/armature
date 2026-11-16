/**
 * The token source behind `hub.remoteToken` (./credential.ts;
 * docs/desktop-program-plan.md §6 and §12), with a fake clock and a fake
 * token endpoint: refresh timing, one refresh for calls made together, a
 * rotated refresh token reported, a refused refresh signing out, an
 * unreachable provider clearing nothing. No store.
 */
import { describe, expect, it } from 'vitest';
import { credential, REFRESH_MARGIN_SECONDS } from './credential';
import type { FetchLike } from './signIn';

const ENDPOINT = 'https://login.example.edu/realms/armature/token';

function endpoint(answers: Array<() => Response | Promise<Response>>) {
  const requests: URLSearchParams[] = [];
  const fetchStub: FetchLike = async (_input, init) => {
    requests.push(new URLSearchParams(String(init?.body)));
    const next = answers.shift();
    if (!next) throw new Error('no answer left');
    return next();
  };
  return { fetch: fetchStub, requests };
}

const tokens = (access: string, refresh?: string, expiresIn = 300) => () => Response.json({ access_token: access, expires_in: expiresIn, ...(refresh ? { refresh_token: refresh } : {}) });

describe('the credential', () => {
  it('returns the held token until the margin before its expiry, then refreshes', async () => {
    let clock = 0;
    const token = endpoint([tokens('access-2', 'refresh-1')]);
    const source = credential({ accessToken: 'access-1', expiresAt: 300_000, refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'armature-desktop', fetch: token.fetch, now: () => clock });
    clock = 300_000 - REFRESH_MARGIN_SECONDS * 1000 - 1;
    expect(await source()).toBe('access-1');
    expect(token.requests).toHaveLength(0);
    clock += 1;
    expect(await source()).toBe('access-2');
    expect(Object.fromEntries(token.requests[0])).toEqual({ grant_type: 'refresh_token', refresh_token: 'refresh-1', client_id: 'armature-desktop' });
  });

  it('starts from the keychain’s refresh token alone, and shares one refresh among calls made together', async () => {
    const token = endpoint([tokens('access-1')]);
    const source = credential({ refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: token.fetch, now: () => 0 });
    expect(await Promise.all([source(), source(), source()])).toEqual(['access-1', 'access-1', 'access-1']);
    expect(token.requests).toHaveLength(1);
  });

  it('reports a rotated refresh token for the keychain, once, and refreshes with it next', async () => {
    let clock = 0;
    const rotated: string[] = [];
    const token = endpoint([tokens('access-1', 'refresh-2'), tokens('access-2', 'refresh-2')]);
    const source = credential({ refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: token.fetch, now: () => clock, onRotated: (r) => rotated.push(r) });
    await source();
    clock += 300_000;
    await source();
    expect(rotated).toEqual(['refresh-2']);
    expect(token.requests.map((r) => r.get('refresh_token'))).toEqual(['refresh-1', 'refresh-2']);
  });

  it('signs out when the provider refuses the refresh: 401 signed_out now and after, without asking again', async () => {
    const reasons: string[] = [];
    const token = endpoint([() => Response.json({ error: 'invalid_grant' }, { status: 400 })]);
    const source = credential({ refreshToken: 'revoked' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: token.fetch, now: () => 0, onSignedOut: (r) => reasons.push(r) });
    await expect(source()).rejects.toMatchObject({ status: 401, code: 'signed_out' });
    await expect(source()).rejects.toMatchObject({ code: 'signed_out' });
    expect(reasons).toEqual(['invalid_grant']);
    expect(token.requests).toHaveLength(1);
    expect(source.signedIn).toBe(false);
  });

  it('answers a provider it cannot reach 503 and clears nothing, so the next call tries again', async () => {
    const token = endpoint([
      () => {
        throw new TypeError('fetch failed');
      },
      tokens('access-1'),
    ]);
    const source = credential({ refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: token.fetch, now: () => 0 });
    await expect(source()).rejects.toMatchObject({ status: 503, code: 'issuer_unreachable' });
    expect(source.signedIn).toBe(true);
    expect(await source()).toBe('access-1');
  });

  it('keeps the person signed in through a provider in trouble: a 502, a 503, a 429 and an answer that is no refusal clear nothing (the 2026-11-09 review’s C4)', async () => {
    const reasons: string[] = [];
    const token = endpoint([
      () => new Response('<html>Bad Gateway</html>', { status: 502 }),
      () => Response.json({ error: 'temporarily_unavailable' }, { status: 503 }),
      () => new Response('', { status: 429 }),
      () => new Response('Not Found', { status: 404 }),
      () => Response.json({ message: 'no reason a token endpoint gives' }, { status: 400 }),
      tokens('access-1'),
    ]);
    const source = credential({ refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: token.fetch, now: () => 0, onSignedOut: (r) => reasons.push(r) });
    for (const status of [502, 503, 429]) await expect(source(), String(status)).rejects.toMatchObject({ status: 503, code: 'issuer_unreachable', details: { status } });
    await expect(source()).rejects.toMatchObject({ status: 502, code: 'issuer_error', details: { status: 404 } });
    await expect(source()).rejects.toMatchObject({ status: 502, code: 'issuer_error', details: { status: 400 } });
    expect(reasons).toEqual([]);
    expect(source.signedIn).toBe(true);
    expect(await source()).toBe('access-1');
    expect(token.requests.map((r) => r.get('refresh_token'))).toEqual(Array(6).fill('refresh-1'));
  });

  it('is not signed in again by a refresh that lands after a sign-out, and reports no rotation from it (the 2026-11-09 review’s C5)', async () => {
    const rotated: string[] = [];
    const reasons: string[] = [];
    let answer!: (res: Response) => void;
    const token = endpoint([() => new Promise<Response>((resolve) => (answer = resolve))]);
    const source = credential({ refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: token.fetch, now: () => 0, onRotated: (r) => rotated.push(r), onSignedOut: (r) => reasons.push(r) });
    const inFlight = source();
    await new Promise((resolve) => setTimeout(resolve, 0));
    source.clear();
    answer(Response.json({ access_token: 'access-late', expires_in: 300, refresh_token: 'refresh-rotated' }));
    await expect(inFlight).rejects.toMatchObject({ status: 401, code: 'signed_out' });
    expect(rotated).toEqual([]);
    expect(source.signedIn).toBe(false);
    await expect(source()).rejects.toMatchObject({ code: 'signed_out' });
    expect(token.requests).toHaveLength(1);

    // The same when the provider's late answer is a refusal: the sign-out already happened, and is not announced twice.
    let refuse!: (res: Response) => void;
    const second = endpoint([() => new Promise<Response>((resolve) => (refuse = resolve))]);
    const other = credential({ refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: second.fetch, now: () => 0, onSignedOut: (r) => reasons.push(r) });
    const late = other();
    await new Promise((resolve) => setTimeout(resolve, 0));
    other.clear();
    refuse(Response.json({ error: 'invalid_grant' }, { status: 400 }));
    await expect(late).rejects.toMatchObject({ code: 'signed_out' });
    expect(reasons).toEqual([]);
  });

  it('posts the refresh token where it was told and nowhere a redirect points, within a deadline (C7, C9)', async () => {
    const seen: RequestInit[] = [];
    const source = credential(
      { refreshToken: 'refresh-1' },
      {
        tokenEndpoint: ENDPOINT,
        clientId: 'c',
        now: () => 0,
        fetch: async (_input, init) => {
          seen.push(init ?? {});
          return Response.json({ access_token: 'access-1', expires_in: 300 });
        },
      }
    );
    await source();
    expect(seen[0].redirect).toBe('error');
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
  });

  it('is signed out when the access token expires and the provider issued no refresh token', async () => {
    let clock = 0;
    const source = credential({ accessToken: 'access-1', expiresAt: 300_000 }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: endpoint([]).fetch, now: () => clock });
    expect(await source()).toBe('access-1');
    clock = 300_000;
    await expect(source()).rejects.toMatchObject({ code: 'signed_out' });
  });

  it('forgets the access token on request, and clears everything on sign out', async () => {
    const token = endpoint([tokens('access-2')]);
    const source = credential({ accessToken: 'access-1', expiresAt: 300_000, refreshToken: 'refresh-1' }, { tokenEndpoint: ENDPOINT, clientId: 'c', fetch: token.fetch, now: () => 0 });
    source.forget();
    expect(await source()).toBe('access-2');
    source.clear();
    expect(source.signedIn).toBe(false);
    await expect(source()).rejects.toMatchObject({ code: 'signed_out' });
  });
});
