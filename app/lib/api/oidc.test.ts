/**
 * The `oidc` resolver (architecture decision record ADR-0067 decision 1 with
 * its note, decisions 4 and 9; ADR-0068 decision 4's two rows under `oidc`).
 *
 * Tokens are signed here with a key the suite generates, and the hub is given
 * the matching key set on its configuration (`oidc.keys`), so no issuer is
 * reached; the issuer's metadata read is tested on its own with a stub fetch.
 * First encounters register on `main`, which the seeded store's other suites
 * read as a fixture, so this file runs a hub over a scratch database of its
 * own, loaded as the authorization suite loads one, and deleted afterwards. A
 * second hub over the same database runs under `header`, as the operator
 * would, to register ahead and to grant.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';
import { app, createApp } from './app';
import { configFromEnv, type HubConfig } from './config';
import { forgetIssuers, jwksUrlOf } from './oidc';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from './store';

const stamp = Date.now().toString(36);
const SCRATCH_DB = `${process.env.TERMINUS_DB}_oidc_${stamp}`;
const DESIGNER = 'User/demo-designer';
const ISSUER = 'https://login.example.edu/realms/armature';
const AUDIENCE = 'armature-hub';
const ADMIN_SUB = 'f3a1-admin';
const VIEWER_CLIENT = `viewer-${stamp}`;
const BRANCH = `test-oidc-${stamp}`;

let headerHub: Hono;
let oidcHub: Hono;
let privateKey: CryptoKey;
let otherKey: CryptoKey;
const kid = `key-${stamp}`;

const scratch = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: SCRATCH_DB });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });

/** A request to the oidc hub with a bearer token, or none. */
const as = (token: string | undefined, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
  oidcHub.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** The operator's own requests, under `header` as the seed's designer. */
const operator = (method: string, path: string, body?: unknown) =>
  headerHub.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

/** A token the suite's key signed: a person's by default, with `claims` added or overriding. */
async function token(
  claims: JWTPayload,
  {
    alg = 'ES256',
    key = privateKey,
    keyId = kid,
    issuer = ISSUER,
    audience = AUDIENCE,
    expires = '5m',
  }: { alg?: string; key?: CryptoKey; keyId?: string; issuer?: string; audience?: string; expires?: string | number } = {}
): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg, kid: keyId }).setIssuer(issuer).setAudience(audience).setIssuedAt().setExpirationTime(expires).sign(key);
}

const person = (sub: string, email: string, name = 'A Person') => token({ sub, name, email });

beforeAll(async () => {
  const exported = (await json(await app.request('/api/v1/export'))).body as { schema: Record<string, unknown>[]; documents: TerminusDocument[] };
  const main = scratch('main');
  await main.ensureDatabase();
  await main.replaceSchema(exported.schema, { author: DESIGNER, message: 'The seed schema, for the oidc suite' });
  const { commit: undated } = await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf === undefined),
    { author: DESIGNER, message: 'The seed, for the oidc suite' }
  );
  await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf !== undefined).map((doc) => ({ ...doc, asOf: undated })),
    { author: DESIGNER, message: "The seed's dated records, for the oidc suite" }
  );

  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' }] });

  const base = (): HubConfig => ({ ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), db: SCRATCH_DB }) });
  headerHub = createApp(base);
  oidcHub = createApp(() => ({
    ...base(),
    identity: 'oidc',
    oidc: {
      issuer: ISSUER,
      audience: AUDIENCE,
      clientId: 'armature-desktop',
      admit: { issuers: new Set(), domains: new Set(['example.edu']) },
      keys,
    },
  }));

  // Registered ahead by the operator: an administrator naming the issuer, and the viewer's service agent.
  const admin = await json(
    await operator('POST', '/users', { message: 'The instance administrator', user: { displayName: 'Pat Admin', externalId: ADMIN_SUB, issuer: ISSUER } })
  );
  expect(admin.status).toBe(201);
  const granted = await json(
    await operator('POST', '/documents?branch=main', {
      message: 'Pat administers the instance',
      documents: [{ '@type': 'Grant', user: admin.body.id, role: 'Administrator', status: 'Active' }],
    })
  );
  expect(granted.status).toBe(200);
  const viewer = await json(
    await operator('POST', '/users', { message: "The viewer's own credential", user: { displayName: 'The viewer', externalId: `agent:${VIEWER_CLIENT}` } })
  );
  expect(viewer.status).toBe(201);
});

afterAll(async () => {
  await scratch('main').deleteDatabase().catch(() => undefined);
});

describe('the token on every request (ADR-0067 decision 1)', () => {
  it('leaves GET /discover open and says how to sign in (decision 9)', async () => {
    const res = await json(await as(undefined, 'GET', '/discover'));
    expect(res.status).toBe(200);
    expect(res.body.identity).toEqual({
      resolver: 'oidc',
      headers: { Authorization: 'bearer', 'Armature-Agent': 'agent', 'Armature-User': 'relay' },
      issuer: ISSUER,
      audience: AUDIENCE,
      clientId: 'armature-desktop',
    });
  });

  it('refuses every other request without a token, reads included, with a Bearer challenge', async () => {
    for (const path of ['/users/me', '/documents/Module', '/schema', '/intelligence/coverage/how-ai-works']) {
      const res = await as(undefined, 'GET', path);
      expect(res.status, path).toBe(401);
      expect((await res.json()).error).toBe('identity_required');
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="armature"');
    }
  });

  it('refuses a token that is expired, for another audience or issuer, signed with a disallowed algorithm or an unknown key, or malformed', async () => {
    const cases: Array<[string, Promise<string> | string, string]> = [
      ['expired', token({ sub: 'x', name: 'X' }, { expires: Math.floor(Date.now() / 1000) - 60 }), 'expired'],
      ['audience', token({ sub: 'x', name: 'X' }, { audience: 'someone-else' }), 'audience'],
      ['issuer', token({ sub: 'x', name: 'X' }, { issuer: 'https://other.example.org' }), 'issuer'],
      ['wrong key', token({ sub: 'x', name: 'X' }, { key: otherKey }), 'signature'],
      ['unknown key', token({ sub: 'x', name: 'X' }, { key: otherKey, keyId: 'rotated-away' }), 'unknown_key'],
      ['malformed', 'not.a.token', 'malformed'],
      ['no subject', token({ name: 'X' }), 'claim:sub'],
    ];
    for (const [label, pending, reason] of cases) {
      const res = await as(await pending, 'GET', '/users/me');
      expect(res.status, label).toBe(401);
      const body = await res.json();
      expect(body.error, label).toBe('invalid_token');
      expect(body.reason, label).toBe(reason);
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer realm="armature", error="invalid_token"');
    }
    // A shared secret can never sign a token the hub takes: HS256 is not on the list, whatever key it names.
    const secret = new TextEncoder().encode('a-shared-secret-of-thirty-two-bytes!');
    const hs = await new SignJWT({ sub: 'x', name: 'X' }).setProtectedHeader({ alg: 'HS256', kid }).setIssuer(ISSUER).setAudience(AUDIENCE).setExpirationTime('5m').sign(secret);
    const refused = await json(await as(hs, 'GET', '/users/me'));
    expect(refused.status).toBe(401);
    expect(refused.body.reason).toBe('algorithm');
    const basic = await json(await oidcHub.request('/api/v1/users/me', { headers: { Authorization: 'Basic abc' } }));
    expect(basic.body).toMatchObject({ error: 'invalid_token', reason: 'malformed' });
  });
});

describe('who a token is (decision 1 and its note; decision 4)', () => {
  let personId: string;

  it('registers an admitted person on first encounter with the issuer, and finds them by (issuer, sub) after', async () => {
    const first = await json(await as(await person('sub-7', 'sam@example.edu', 'Sam Designer'), 'GET', '/users/me'));
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ externalId: 'sub-7', displayName: 'Sam Designer', email: 'sam@example.edu', issuer: ISSUER, grants: [] });
    personId = first.body['@id'];
    const again = await json(await as(await person('sub-7', 'sam@example.edu', 'Sam Designer'), 'GET', '/users/me'));
    expect(again.body['@id']).toBe(personId);
    const stored = await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', `/documents/${personId}`));
    expect(stored.body.issuer).toBe(ISSUER);
  });

  it('refuses a valid token the instance did not admit: 403 not_registered, nothing registered', async () => {
    const res = await json(await as(await person('sub-8', 'kim@elsewhere.org', 'Kim Elsewhere'), 'GET', '/users/me'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_registered');
    const listed = await json(await operator('GET', '/users'));
    expect(listed.body.some((u: { externalId: string }) => u.externalId === 'sub-8')).toBe(false);
    // An email the token marks unverified admits nothing either, and a token with no email is judged by the issuer alone.
    const unverified = await json(await as(await token({ sub: 'sub-9', name: 'Un Verified', email: 'un@example.edu', email_verified: false }), 'GET', '/users/me'));
    expect(unverified.body.error).toBe('not_registered');
    const nameless = await json(await as(await token({ sub: 'sub-10', email: 'no-name@example.edu' }), 'GET', '/users/me'));
    expect(nameless.body.error).toBe('unknown_user');
  });

  it('does not match a User registered without an issuer: the seed designer is not a token subject', async () => {
    const res = await json(await as(await person('demo-designer@example.edu', 'demo-designer@example.edu', 'Demo Designer'), 'GET', '/users/me'));
    // Admitted by domain, so first encounter registers a second User under the same externalId with the issuer.
    expect(res.status).toBe(200);
    expect(res.body['@id']).not.toBe(DESIGNER);
    expect(res.body.issuer).toBe(ISSUER);
  });

  it('resolves a person registered ahead by an administrator naming the issuer, with their grants', async () => {
    const res = await json(await as(await token({ sub: ADMIN_SUB, name: 'Pat Admin', email: 'pat@elsewhere.org' }), 'GET', '/users/me'));
    expect(res.status).toBe(200);
    expect(res.body.externalId).toBe(ADMIN_SUB);
    expect(res.body.grants.map((g: { role: string }) => g.role)).toEqual(['Administrator']);
    const noIssuer = await json(await operator('POST', '/users', { message: 'x', user: { displayName: 'An agent', externalId: 'agent:x', issuer: ISSUER } }));
    expect(noIssuer.status).toBe(400);
  });

  it("resolves a service's token to the agent its client id names, which reads and never writes (decisions 4 and 10)", async () => {
    const service = await token({ sub: `service-account-${VIEWER_CLIENT}`, azp: VIEWER_CLIENT });
    const me = await json(await as(service, 'GET', '/users/me'));
    expect(me.status).toBe(200);
    expect(me.body.externalId).toBe(`agent:${VIEWER_CLIENT}`);
    const read = await as(service, 'GET', '/documents/Module');
    expect(read.status).toBe(200);
    const write = await json(await as(service, 'POST', '/branches', { name: `${BRANCH}-service` }));
    expect(write.status).toBe(403);
    expect(write.body).toMatchObject({ error: 'forbidden', credential: `agent:${VIEWER_CLIENT}` });
    const unregistered = await json(await as(await token({ sub: 'service-account-nobody', client_id: 'nobody' }), 'GET', '/users/me'));
    expect(unregistered.status).toBe(401);
    expect(unregistered.body.error).toBe('unknown_user');
  });

  it('refuses Armature-User beside a token as a relay claim until relays are built (decision 5)', async () => {
    const res = await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', '/users/me', undefined, { 'Armature-User': 'demo-designer@example.edu' }));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: 'forbidden', reason: 'relay' });
  });

  it('takes Armature-Agent beside a person\'s token as under header: the agent writes, acting for the person (decision 3)', async () => {
    const sam = await person('sub-7', 'sam@example.edu');
    const created = await json(await as(sam, 'POST', '/branches', { name: BRANCH }));
    expect(created.status).toBe(201);
    const agent = { 'Armature-Agent': `agent:${VIEWER_CLIENT}` };
    const me = await json(await as(sam, 'GET', '/users/me', undefined, agent));
    expect(me.body.externalId).toBe(`agent:${VIEWER_CLIENT}`);
    const written = await json(
      await as(sam, 'POST', `/documents?branch=${BRANCH}`, {
        message: 'A note the agent drafted',
        documents: [{ '@type': 'DesignNote', '@id': `DesignNote/oidc-${stamp}`, label: 'Drafted', rationale: 'x', subject: ['Module/how-ai-works'] }],
      }, agent)
    );
    expect(written.status).toBe(200);
    const note = await json(await as(sam, 'GET', `/documents/DesignNote/oidc-${stamp}?branch=${BRANCH}`));
    expect(note.body.createdBy).toBe(me.body['@id']);
  });
});

describe("the reads kept for maintainers of main and administrators under oidc (ADR-0068 decision 4, note)", () => {
  it('lists users for an administrator and refuses anyone else', async () => {
    const refused = await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', '/users'));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'forbidden', permission: 'list_users' });
    const listed = await json(await as(await token({ sub: ADMIN_SUB, name: 'Pat Admin' }), 'GET', '/users'));
    expect(listed.status).toBe(200);
    expect(listed.body.some((u: { externalId: string }) => u.externalId === 'sub-7')).toBe(true);
    // Under header the list stays open, as the note says.
    expect((await operator('GET', '/users')).status).toBe(200);
  });

  it('exports pseudonymously by default and keeps the full profile for an administrator', async () => {
    const sam = await person('sub-7', 'sam@example.edu');
    const byDefault = await json(await as(sam, 'GET', '/export?slice=full'));
    expect(byDefault.status).toBe(200);
    expect(byDefault.body.armature.profile).toBe('pseudonymous');
    expect(byDefault.body.documents.some((d: { '@type': string; displayName?: string }) => d['@type'] === 'User' && d.displayName)).toBe(false);
    const refused = await json(await as(sam, 'GET', '/export?profile=full'));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'forbidden', permission: 'export_full' });
    const institutional = await as(sam, 'GET', '/export?profile=institutional');
    expect(institutional.status).toBe(200);
    const full = await json(await as(await token({ sub: ADMIN_SUB, name: 'Pat Admin' }), 'GET', '/export?profile=full'));
    expect(full.status).toBe(200);
    expect(full.body.armature.profile).toBe('full');
    // Under header the default stays full.
    expect((await json(await operator('GET', '/export'))).body.armature.profile).toBe('full');
  });
});

describe("the issuer's metadata and the configuration", () => {
  const metadata = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

  it('reads jwks_uri from the issuer\'s metadata once, refuses another issuer\'s document, and forgets a failed read', async () => {
    forgetIssuers();
    const calls: string[] = [];
    const good = async (input: string | URL) => {
      calls.push(String(input));
      return metadata({ issuer: ISSUER, jwks_uri: `${ISSUER}/protocol/openid-connect/certs` })();
    };
    await expect(jwksUrlOf(ISSUER, metadata({ issuer: 'https://someone.else', jwks_uri: 'https://someone.else/keys' }))).rejects.toThrow(/describes issuer/);
    await expect(jwksUrlOf(ISSUER, metadata({}, 503))).rejects.toThrow(/answered 503/);
    expect(await jwksUrlOf(ISSUER, good)).toBe(`${ISSUER}/protocol/openid-connect/certs`);
    expect(await jwksUrlOf(ISSUER, good)).toBe(`${ISSUER}/protocol/openid-connect/certs`);
    expect(calls).toEqual([`${ISSUER}/.well-known/openid-configuration`]);
    forgetIssuers();
  });

  it('requires the issuer and the audience, splits the admission list by shape, and refuses oidc on a workspace hub', () => {
    const env = { ...process.env, ARMATURE_IDENTITY: 'oidc' } as Record<string, string | undefined>;
    expect(() => configFromEnv(env)).toThrow(/ARMATURE_OIDC_ISSUER/);
    expect(() => configFromEnv({ ...env, ARMATURE_OIDC_ISSUER: ISSUER })).toThrow(/ARMATURE_OIDC_AUDIENCE/);
    expect(() => configFromEnv({ ...env, ARMATURE_OIDC_ISSUER: 'ldap://x', ARMATURE_OIDC_AUDIENCE: AUDIENCE })).toThrow(/not an http or https/);
    const config = configFromEnv({
      ...env,
      ARMATURE_OIDC_ISSUER: `${ISSUER}/`,
      ARMATURE_OIDC_AUDIENCE: AUDIENCE,
      ARMATURE_OIDC_ADMIT: ' Example.EDU, https://cilogon.org/ ,partner.org',
      ARMATURE_OIDC_CLIENT_ID: 'armature-desktop',
    });
    expect(config.oidc).toMatchObject({ issuer: ISSUER, audience: AUDIENCE, clientId: 'armature-desktop' });
    expect([...config.oidc!.admit.issuers]).toEqual(['https://cilogon.org']);
    expect([...config.oidc!.admit.domains]).toEqual(['example.edu', 'partner.org']);
    expect(configFromEnv({ ...process.env } as Record<string, string | undefined>).oidc).toBeUndefined();
    expect(() =>
      configFromEnv({ ...env, ARMATURE_OIDC_ISSUER: ISSUER, ARMATURE_OIDC_AUDIENCE: AUDIENCE, ARMATURE_ROLE: 'workspace', ARMATURE_REMOTE_URL: 'http://x', ARMATURE_WORKSPACE_DIR: '/tmp/x' })
    ).toThrow(/workspace hub runs under header/);
  });
});
