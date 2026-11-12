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
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Hono } from 'hono';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWTPayload } from 'jose';
import { app, createApp } from './app';
import { configFromEnv, type HubConfig } from './config';
import { firstEncounterId } from './identity';
import { forgetIssuers, jwksUrlOf } from './oidc';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from './store';

const stamp = Date.now().toString(36);
const SCRATCH_DB = `${process.env.TERMINUS_DB}_oidc_${stamp}`;
const DESIGNER = 'User/demo-designer';
const ISSUER = 'https://login.example.edu/realms/armature';
const AUDIENCE = 'armature-hub';
const ADMIN_SUB = 'f3a1-admin';
const VIEWER_CLIENT = `viewer-${stamp}`;
const RELAY_CLIENT = `outbox-${stamp}`;
const BRANCH = `test-oidc-${stamp}`;

let headerHub: Hono;
let oidcHub: Hono;
/** The oidc hub's configuration with its `oidc` settings replaced in part, for a hub that reaches an issuer. */
let oidcConfigWith: (oidc: Partial<NonNullable<HubConfig['oidc']>>) => () => HubConfig;
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

/** A person's token as a provider that verifies addresses sends it. */
const person = (sub: string, email: string, name = 'A Person') => token({ sub, name, email, email_verified: true });

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
  const settings = {
    issuer: ISSUER,
    audience: AUDIENCE,
    clientId: 'armature-desktop',
    admit: { issuers: new Set<string>(), domains: new Set(['example.edu']) },
    services: new Set([VIEWER_CLIENT, RELAY_CLIENT]),
    keys,
  };
  oidcConfigWith = (oidc) => () => ({ ...base(), identity: 'oidc', oidc: { ...settings, ...oidc } });
  oidcHub = createApp(oidcConfigWith({}));

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

describe('first encounter under a race (ADR-0032; the deep review\'s HTTP item 3, narrowed in PR #85 and reachable since this resolver)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Answers the store's inserts into the scratch database with `refusal`, counting them; every other call goes through. */
  function refuseInserts(refusal: () => Response) {
    const seen = { inserts: 0 };
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      const isInsert = init?.method === 'POST' && url.includes(`/api/document/`) && url.includes(SCRATCH_DB) && url.includes('author=');
      if (!isInsert) return real(input, init);
      seen.inserts += 1;
      return refusal();
    });
    return seen;
  }
  const storeRefusal = (status: number, type: string) => () =>
    new Response(JSON.stringify({ '@type': 'api:InsertDocumentErrorResponse', 'api:status': 'api:failure', 'api:error': { '@type': type }, 'api:message': type }), { status });

  it('settles concurrent first encounters on one User, every request answered', async () => {
    const bearer = await person('sub-race', 'race@example.edu', 'Ray Race');
    const answers = await Promise.all(Array.from({ length: 4 }, async () => json(await as(bearer, 'GET', '/users/me'))));
    expect(answers.map((a) => a.status)).toEqual([200, 200, 200, 200]);
    expect(new Set(answers.map((a) => a.body['@id']))).toEqual(new Set([firstEncounterId(ISSUER, 'sub-race')]));
    const listed = await json(await operator('GET', '/users'));
    expect(listed.body.filter((u: { externalId: string }) => u.externalId === 'sub-race')).toHaveLength(1);
  });

  it('looks again once when the id was taken, then says to retry: 409 registration_conflict', async () => {
    const seen = refuseInserts(storeRefusal(400, 'api:DocumentIdAlreadyExists'));
    const res = await json(await as(await person('sub-lost-twice', 'lost@example.edu', 'Lee Lost'), 'GET', '/users/me'));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('registration_conflict');
    expect(seen.inserts).toBe(2);
  });

  it("gives one person's id under one issuer only: the same sub at another issuer is another person (decision 1's (issuer, sub))", () => {
    expect(firstEncounterId(ISSUER, 'sub-7')).toBe(firstEncounterId(ISSUER, 'sub-7'));
    expect(firstEncounterId(ISSUER, 'sub-7')).not.toBe(firstEncounterId('https://other.example.org', 'sub-7'));
    expect(firstEncounterId(ISSUER, 'sub-7')).toMatch(/^User\/[0-9a-f]{32}$/);
  });

  it('surfaces any other refusal at once: a store 400 is a fault, not a reason to look again', async () => {
    const seen = refuseInserts(storeRefusal(400, 'api:SchemaCheckFailure'));
    const res = await as(await person('sub-refused', 'refused@example.edu', 'Rae Refused'), 'GET', '/users/me');
    expect(seen.inserts).toBe(1);
    expect(res.status).not.toBe(200);
    expect(res.status).not.toBe(409);
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
    // A domain admits only an email the token says is verified (decision 1, note of 2026-11-12; the 2026-11-09
    // review's A4): marked unverified, or with the claim left out or not a boolean, the token admits nothing.
    for (const [label, claim] of [['false', { email_verified: false }], ['absent', {}], ['a string', { email_verified: 'true' }]] as const) {
      const unverified = await json(await as(await token({ sub: `sub-9-${label}`, name: 'Un Verified', email: 'un@example.edu', ...claim }), 'GET', '/users/me'));
      expect(unverified.status, label).toBe(403);
      expect(unverified.body.error, label).toBe('not_registered');
    }
    const listed9 = await json(await operator('GET', '/users'));
    expect(listed9.body.some((u: { externalId: string }) => u.externalId.startsWith('sub-9'))).toBe(false);
  });

  it('admits by issuer whatever the token says of its email: the entry for a provider that vouches for all its people', async () => {
    const vouching = createApp(oidcConfigWith({ admit: { issuers: new Set([ISSUER]), domains: new Set() } }));
    const bearer = await token({ sub: `sub-vouched-${stamp}`, name: 'Val Vouched', email: 'val@anywhere.org' });
    const res = await json(await vouching.request('/api/v1/users/me', { headers: { Authorization: `Bearer ${bearer}` } }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ externalId: `sub-vouched-${stamp}`, issuer: ISSUER });
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

describe("a service relaying a person's earlier work (ADR-0067 decision 5; ADR-0068 decision 5)", () => {
  const relay = () => token({ sub: `service-account-${RELAY_CLIENT}`, azp: RELAY_CLIENT });
  const forSam = { 'Armature-User': 'sub-7' };
  let samId: string;
  let relayId: string;

  beforeAll(async () => {
    samId = (await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', '/users/me'))).body['@id'];
    const registered = await json(await operator('POST', '/users', { message: "CoQui's outbox", user: { displayName: 'The outbox', externalId: `agent:${RELAY_CLIENT}` } }));
    expect(registered.status).toBe(201);
    relayId = registered.body.id;
  });

  it('refuses Armature-User beside a person\'s token, and beside a service\'s with no Relay grant', async () => {
    const byPerson = await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', '/users/me', undefined, { 'Armature-User': ADMIN_SUB }));
    expect(byPerson.status).toBe(403);
    expect(byPerson.body).toMatchObject({ error: 'forbidden', reason: 'relay', relayed: ADMIN_SUB });
    const noGrant = await json(await as(await relay(), 'GET', '/users/me', undefined, forSam));
    expect(noGrant.status).toBe(403);
    expect(noGrant.body).toMatchObject({ error: 'forbidden', reason: 'relay' });
  });

  it('under a Relay grant naming the person, writes as the person with the hub\'s Armature-Relayed-By trailer, on the branch the grant covers', async () => {
    const granted = await json(
      await operator('POST', '/documents?branch=main', {
        message: 'The outbox may deliver Sam\'s decisions for this round',
        documents: [{ '@type': 'Grant', user: relayId, role: 'Relay', branch: BRANCH, relayedUsers: [samId], status: 'Active', rationale: 'The outbox drains after the review' }],
      })
    );
    expect(granted.status).toBe(200);

    const me = await json(await as(await relay(), 'GET', '/users/me', undefined, forSam));
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ '@id': samId, externalId: 'sub-7', relayedBy: `agent:${RELAY_CLIENT}` });

    const written = await json(
      await as(await relay(), 'POST', `/documents?branch=${BRANCH}`, {
        message: "Sam's decision, delivered later",
        documents: [
          { '@type': 'DesignNote', '@id': `DesignNote/relayed-${stamp}`, label: 'Relayed', rationale: 'Decided offline', subject: ['Module/how-ai-works'] },
          { '@type': 'Attestation', subject: 'Module/how-ai-works', verdict: 'Affirmed' },
        ],
      }, forSam)
    );
    expect(written.status).toBe(200);
    const note = await json(await as(await relay(), 'GET', `/documents/DesignNote/relayed-${stamp}?branch=${BRANCH}`));
    expect(note.body.createdBy).toBe(samId);
    const attestation = await json(await as(await relay(), 'GET', `/documents/${written.body.ids[1]}?branch=${BRANCH}`));
    expect(attestation.body.attestedBy).toBe(samId);
    const history = await json(await as(await relay(), 'GET', `/documents/DesignNote/relayed-${stamp}/history?branch=${BRANCH}`));
    expect(history.body.entries[0].author).toBe(samId);
    expect(history.body.entries[0].message).toBe(`Sam's decision, delivered later\n\nArmature-Relayed-By: agent:${RELAY_CLIENT}`);

    // The person's own grants decide the write: Sam owns the branch; main is beyond both the grant and Sam.
    const elsewhere = await json(
      await as(await relay(), 'POST', '/documents?branch=main', { message: 'x', documents: [{ '@type': 'DesignNote', label: 'x', rationale: 'x', subject: ['Module/how-ai-works'] }] }, forSam)
    );
    expect(elsewhere.status).toBe(403);
    expect(elsewhere.body).toMatchObject({ error: 'forbidden', reason: 'relay', permission: 'write', branch: 'main' });
  });

  it('delivers documents only, for the people the grant names, and never beside Armature-Agent', async () => {
    const branch = await json(await as(await relay(), 'POST', '/branches', { name: `${BRANCH}-relayed` }, forSam));
    expect(branch.status).toBe(403);
    expect(branch.body).toMatchObject({ error: 'forbidden', reason: 'relay', permission: 'create' });
    const someoneElse = await json(await as(await relay(), 'GET', '/users/me', undefined, { 'Armature-User': ADMIN_SUB }));
    expect(someoneElse.status).toBe(403);
    expect(someoneElse.body).toMatchObject({ error: 'forbidden', reason: 'relay', relayed: ADMIN_SUB });
    const nobody = await json(await as(await relay(), 'GET', '/users/me', undefined, { 'Armature-User': 'nobody-here' }));
    expect(nobody.status).toBe(401);
    expect(nobody.body.error).toBe('unknown_user');
    const withAgent = await json(await as(await relay(), 'GET', '/users/me', undefined, { ...forSam, 'Armature-Agent': `agent:${VIEWER_CLIENT}` }));
    expect(withAgent.status).toBe(403);
    expect(withAgent.body).toMatchObject({ error: 'forbidden', reason: 'relay' });
    const reserved = await json(
      await as(await relay(), 'POST', `/documents?branch=${BRANCH}`, {
        message: `Forged\n\nArmature-Relayed-By: agent:${VIEWER_CLIENT}`,
        documents: [{ '@type': 'DesignNote', label: 'x', rationale: 'x', subject: ['Module/how-ai-works'] }],
      }, forSam)
    );
    expect(reserved.body.error).toBe('reserved_trailer');
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
    // The generic document route lists the same people, so it is the same read.
    const byType = await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', '/documents/User'));
    expect(byType.status).toBe(403);
    expect(byType.body).toMatchObject({ error: 'forbidden', permission: 'list_users' });
    expect((await as(await token({ sub: ADMIN_SUB, name: 'Pat Admin' }), 'GET', '/documents/User')).status).toBe(200);
    // The agents are tools, not people: anyone may list them, and the persons are the registry.
    const agents = await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', '/users?kind=agent'));
    expect(agents.status).toBe(200);
    expect(agents.body.map((u: { externalId: string }) => u.externalId)).toContain(`agent:${VIEWER_CLIENT}`);
    expect(agents.body.every((u: { externalId: string }) => u.externalId.startsWith('agent:'))).toBe(true);
    expect((await as(await person('sub-7', 'sam@example.edu'), 'GET', '/users?kind=person')).status).toBe(403);
    expect((await json(await as(await person('sub-7', 'sam@example.edu'), 'GET', '/users?kind=robot'))).body.error).toBe('bad_query');
    // Under header the list stays open, as the note says.
    expect((await operator('GET', '/users')).status).toBe(200);
  });

  it('exports pseudonymously by default and keeps the full profile for an administrator', async () => {
    const sam = await person('sub-7', 'sam@example.edu');
    const byDefault = await json(await as(sam, 'GET', '/export?slice=full'));
    expect(byDefault.status).toBe(200);
    expect(byDefault.body.armature.profile).toBe('pseudonymous');
    expect(byDefault.body.documents.some((d: { '@type': string; displayName?: string }) => d['@type'] === 'User' && d.displayName)).toBe(false);
    // Full to anyone, but with the users the records name and oneself only: the registry stays a maintainer's.
    const users = (body: { documents: Array<{ '@type': string; externalId?: string }> }) => body.documents.filter((d) => d['@type'] === 'User').map((d) => d.externalId);
    const referenced = await json(await as(sam, 'GET', '/export?profile=full'));
    expect(referenced.status).toBe(200);
    expect(referenced.body.armature).toMatchObject({ profile: 'full', users: 'referenced' });
    expect(users(referenced.body)).toContain('sub-7');
    expect(users(referenced.body)).toContain('demo-designer@example.edu'); // the seed's author, named by its records
    expect(users(referenced.body)).toContain(ADMIN_SUB); // named by their Grant, which anyone may list (ADR-0068 decision 8)
    // A person registered and named by nothing is the registry's alone.
    const quiet = await json(await operator('POST', '/users', { message: 'Registered, wrote nothing', user: { displayName: 'Quiet', externalId: `quiet-${stamp}`, issuer: ISSUER } }));
    expect(quiet.status).toBe(201);
    const again = await json(await as(sam, 'GET', '/export?profile=full'));
    expect(users(again.body)).not.toContain(`quiet-${stamp}`);
    const institutional = await as(sam, 'GET', '/export?profile=institutional');
    expect(institutional.status).toBe(200);
    const full = await json(await as(await token({ sub: ADMIN_SUB, name: 'Pat Admin' }), 'GET', '/export?profile=full'));
    expect(full.status).toBe(200);
    expect(full.body.armature).toMatchObject({ profile: 'full', users: 'all' });
    expect(users(full.body)).toContain(`quiet-${stamp}`);
    // Under header the default stays full and every user is carried.
    expect((await json(await operator('GET', '/export'))).body.armature).toMatchObject({ profile: 'full', users: 'all' });
  });

  it("keeps the registry from a relay, whoever it names: an administrator relayed reads the users the records name (ADR-0067 decision 5; the 2026-11-09 review's A2)", async () => {
    const pat = await token({ sub: ADMIN_SUB, name: 'Pat Admin' });
    const patId = (await json(await as(pat, 'GET', '/users/me'))).body['@id'];
    const outbox = (await json(await as(pat, 'GET', '/users?kind=agent'))).body.find((u: { externalId: string }) => u.externalId === `agent:${RELAY_CLIENT}`);
    const granted = await json(
      await operator('POST', '/documents?branch=main', {
        message: 'The outbox may deliver the administrator\'s decisions too',
        documents: [{ '@type': 'Grant', user: outbox['@id'], role: 'Relay', relayedUsers: [patId], status: 'Active', rationale: 'A relay that names an administrator' }],
      })
    );
    expect(granted.status).toBe(200);
    const service = await token({ sub: `service-account-${RELAY_CLIENT}`, azp: RELAY_CLIENT });
    const forPat = { 'Armature-User': ADMIN_SUB };
    const me = await json(await as(service, 'GET', '/users/me', undefined, forPat));
    expect(me.body).toMatchObject({ '@id': patId, relayedBy: `agent:${RELAY_CLIENT}` });
    const users = (body: { documents: Array<{ '@type': string; externalId?: string }> }) => body.documents.filter((d) => d['@type'] === 'User').map((d) => d.externalId);
    const exported = await json(await as(service, 'GET', '/export?profile=full', undefined, forPat));
    expect(exported.status).toBe(200);
    expect(exported.body.armature).toMatchObject({ profile: 'full', users: 'referenced' });
    expect(users(exported.body)).not.toContain(`quiet-${stamp}`);
    // The list itself was already refused to a relay, as every act but a document write is.
    const listed = await json(await as(service, 'GET', '/users', undefined, forPat));
    expect(listed.status).toBe(403);
    expect(listed.body).toMatchObject({ error: 'forbidden', reason: 'relay' });
    // The administrator's own token still reads everyone.
    expect(users((await json(await as(pat, 'GET', '/export?profile=full'))).body)).toContain(`quiet-${stamp}`);
  });
});

describe("an identity provider that is down is never the caller's bad token (the 2026-11-09 review's A1)", () => {
  let server: Server;
  let origin: string;
  let answer: { status: number; body: string };
  const bearer = () => token({ sub: 'sub-7', name: 'Sam Designer' }, { issuer: origin });
  const me = async (hub: Hono) => {
    const res = await hub.request('/api/v1/users/me', { headers: { Authorization: `Bearer ${await bearer()}` } });
    return { status: res.status, body: await res.json(), challenge: res.headers.get('WWW-Authenticate') };
  };

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(answer.status, { 'Content-Type': 'application/json' });
      res.end(answer.body);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    forgetIssuers();
    await new Promise((resolve) => server.close(resolve));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    forgetIssuers();
  });

  it('answers 503 issuer_unreachable when the key set answers an error or something that is no key set', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hub = createApp(oidcConfigWith({ issuer: origin, jwksUrl: `${origin}/keys`, keys: undefined }));
    for (const reply of [
      { status: 503, body: '{"error":"starting"}' },
      { status: 502, body: '<html>Bad Gateway</html>' },
      { status: 404, body: '{}' },
      { status: 200, body: '<html>a sign-in page</html>' },
      { status: 200, body: '{"keys":"none"}' },
    ]) {
      answer = reply;
      forgetIssuers(); // a new key set, so the half minute between fetches does not stand in for the answer
      const res = await me(hub);
      expect(res.status, JSON.stringify(reply)).toBe(503);
      expect(res.body.error, JSON.stringify(reply)).toBe('issuer_unreachable');
      expect(res.challenge, 'no challenge: the token was not judged').toBeNull();
    }
  });

  it('answers 503 when the metadata cannot be read, and tries again on the next request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const hub = createApp(oidcConfigWith({ issuer: origin, keys: undefined }));
    answer = { status: 503, body: '{}' };
    const down = await me(hub);
    expect(down.status).toBe(503);
    expect(down.body.error).toBe('issuer_unreachable');
    // The provider is back, with keys that are not this token's: now the token is judged, and refused as its own fault.
    answer = { status: 200, body: JSON.stringify({ issuer: origin, jwks_uri: `${origin}/keys`, keys: [] }) };
    const back = await me(hub);
    expect(back.status).toBe(401);
    expect(back.body).toMatchObject({ error: 'invalid_token', reason: 'unknown_key' });
  });

  it('still names the token\'s own faults: one that marks a header critical is malformed, with the keys in hand', async () => {
    const critical = await new SignJWT({ sub: 'x', name: 'X' })
      .setProtectedHeader({ alg: 'ES256', kid, crit: ['exp-ext'], 'exp-ext': 1 } as never)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(privateKey, { crit: { 'exp-ext': false } });
    const res = await json(await as(critical, 'GET', '/users/me'));
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'invalid_token', reason: 'malformed' });
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
