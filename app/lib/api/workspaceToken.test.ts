/**
 * A workspace hub's credential for a remote under `oidc` (ADR-0067 decision
 * 2, the host-side shape, note of 2026-11-05; ./workspace/remote.ts).
 *
 * A remote runs on an ephemeral port under `oidc`, over a scratch database
 * loaded from the seed, with the suite's own signing key; a workspace hub
 * runs in-process beside it under `header`, as every workspace hub does, and
 * reaches the remote with the owner's token from `hub.remoteToken`. The
 * owner is registered ahead on the remote naming the issuer, as an
 * administrator registers a person, and holds no grant: a clone reads the
 * agents and the owner's own record, and the branch's full export carries
 * the users its records name, which any person may read (ADR-0068 decision
 * 4, note of 2026-11-05).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { startHub, type RunningHub } from '../hub';
import { app, createApp } from './app';
import { configFromEnv, type HubConfig } from './config';
import { localStoreConfig } from './filestore/testing';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from './store';
import { memoryRecords } from './workspace/records';

const stamp = Date.now().toString(36);
const REMOTE_DB = `${process.env.TERMINUS_DB}_wstoken_${stamp}`;
const ISSUER = 'https://login.example.edu/realms/armature';
const AUDIENCE = 'armature-hub';
const OWNER = `owner-${stamp}`;
const OTHER = `other-${stamp}`;
const SEED_DESIGNER = 'demo-designer@example.edu';
const TOKEN = `ws-token-${stamp}`;
const NAME = `test-token-${stamp}`;
// The owner's email differs from their sub, as a provider's does: the branch takes the email's
// handle from the remote's record of the person, never the sub (decided 2026-11-08).
const OWNER_EMAIL = `the-owner-${stamp}@example.edu`;
const BRANCH = `the-owner-${stamp}_${NAME}`;

let remote: RunningHub;
let workspace: ReturnType<typeof createApp>;
let privateKey: CryptoKey;
let ownerId: string;
/** What the workspace hub hands the remote on each call; a test swaps it for a stale one. */
let currentToken: () => Promise<string>;
const kid = `key-${stamp}`;

const remoteStore = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: REMOTE_DB });
const localConfig = localStoreConfig();
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const on = (method: string, path: string, body?: unknown, user = OWNER) =>
  workspace.request(`/api/v1${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Armature-User': user, 'Armature-Local-Token': TOKEN },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const token = (sub: string, expires: string | number = '5m') =>
  new SignJWT({ sub, name: 'The Owner', email: `${sub}@example.edu` }).setProtectedHeader({ alg: 'ES256', kid }).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime(expires).sign(privateKey);

beforeAll(async () => {
  const exported = (await json(await app.request('/api/v1/export'))).body as { schema: Record<string, unknown>[]; documents: TerminusDocument[] };
  const main = remoteStore('main');
  await main.ensureDatabase();
  await main.replaceSchema(exported.schema, { author: 'User/demo-designer', message: 'The seed schema, for the token suite' });
  const { commit: undated } = await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf === undefined),
    { author: 'User/demo-designer', message: 'The seed, for the token suite' }
  );
  await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf !== undefined).map((doc) => ({ ...doc, asOf: undated })),
    { author: 'User/demo-designer', message: "The seed's dated records, for the token suite" }
  );

  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' }] });
  const remoteConfig = (): HubConfig => ({ ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), db: REMOTE_DB }) });

  // The operator registers the owner ahead, naming the issuer; the owner holds no grant.
  const operator = createApp(remoteConfig);
  const asOperator = (method: string, path: string, body: unknown) =>
    operator.request(`/api/v1${path}`, { method, headers: { 'Content-Type': 'application/json', 'Armature-User': SEED_DESIGNER }, body: JSON.stringify(body) });
  const registered = await json(
    await asOperator('POST', '/users', { message: 'The workspace owner', user: { displayName: 'The Owner', externalId: OWNER, email: OWNER_EMAIL, issuer: ISSUER } })
  );
  expect(registered.status).toBe(201);
  ownerId = registered.body.id;
  // A second person the remote knows, whose token this hub might be left holding.
  const other = await json(await asOperator('POST', '/users', { message: 'Another person', user: { displayName: 'Another', externalId: OTHER, issuer: ISSUER } }));
  expect(other.status).toBe(201);

  remote = await startHub({
    port: 0,
    config: { ...remoteConfig(), identity: 'oidc', oidc: { issuer: ISSUER, audience: AUDIENCE, admit: { issuers: new Set(), domains: new Set() }, keys } },
  });
  currentToken = () => token(OWNER);
  const config: HubConfig = {
    ...configFromEnv(),
    role: 'workspace',
    remote: remote.url,
    workspaces: memoryRecords(),
    store: () => localConfig,
    localToken: TOKEN,
    actionRoutes: true,
    remoteToken: () => currentToken(),
  };
  workspace = createApp(() => config);
});

afterAll(async () => {
  await remote?.close();
  await remoteStore('main').deleteDatabase().catch(() => undefined);
});

describe('a workspace hub reaching a remote under oidc with the owner’s token', () => {
  it('refuses the remote without a token: a remote under oidc takes no Armature-User', async () => {
    const bare = createApp(() => ({ ...configFromEnv(), role: 'workspace', remote: remote.url, workspaces: memoryRecords(), store: () => localStoreConfig(), localToken: TOKEN, actionRoutes: true }));
    const res = await json(
      await bare.request('/api/v1/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Armature-User': OWNER, 'Armature-Local-Token': TOKEN },
        body: JSON.stringify({ name: NAME }),
      })
    );
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: 'identity_required', remote: true });
  });

  it('creates and clones a workspace as the token’s subject, who must be the person the request names', async () => {
    const someoneElse = await json(await on('POST', '/workspace', { name: NAME }, SEED_DESIGNER));
    expect(someoneElse.status).toBe(403);
    expect(someoneElse.body).toMatchObject({ error: 'forbidden', reason: 'remote_identity', owner: SEED_DESIGNER, credential: OWNER });

    const created = await json(await on('POST', '/workspace', { name: NAME }));
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ branch: BRANCH, owner: ownerId, ownerExternalId: OWNER });
    // The mirror of main carries the owner as the remote registered them, issuer included, so identity resolves here offline,
    // and no other person: the registry is a maintainer's read, and the owner is none.
    const me = await json(await on('GET', '/users/me'));
    expect(me.body).toMatchObject({ '@id': ownerId, issuer: ISSUER, grants: [] });
    const mirrored = (await json(await on('GET', '/users'))).body as Array<{ externalId: string }>;
    expect(mirrored.map((u) => u.externalId)).toEqual([OWNER]);
  });

  it('pushes local work through the token: the remote records the owner as author', async () => {
    const written = await json(
      await on('POST', `/documents?branch=${BRANCH}`, { message: 'Work done offline', documents: [{ '@type': 'LearningNeed', '@id': `LearningNeed/token-${stamp}`, label: 'A need', rationale: 'r' }] })
    );
    expect(written.status).toBe(200);
    const pushed = await json(await on('POST', `/workspace/${BRANCH}/push`));
    expect(pushed.status, JSON.stringify(pushed.body)).toBe(200);
    expect(pushed.body.pushed).toHaveLength(1);
    const onRemote = await fetch(`${remote.url}/api/v1/documents/LearningNeed/token-${stamp}/history?branch=${BRANCH}`, { headers: { Authorization: `Bearer ${await token(OWNER)}` } });
    expect(onRemote.status).toBe(200);
    expect((await onRemote.json()).entries[0].author).toBe(ownerId);
  });

  it('forwards a read at a remote commit through the token, whoever asked here', async () => {
    const head = await fetch(`${remote.url}/api/v1/branches/main`, { headers: { Authorization: `Bearer ${await token(OWNER)}` } });
    const commit = (await head.json()).head.commit as string;
    const forwarded = await on('GET', `/documents/Module/how-ai-works?ref=${commit}`);
    expect(forwarded.status).toBe(200);
    expect(forwarded.headers.get('etag')).toBe(`"${commit}"`);
  });

  it('answers the remote’s refusal of a stale token as the remote gave it', async () => {
    currentToken = () => token(OWNER, Math.floor(Date.now() / 1000) - 60);
    try {
      const pushed = await json(await on('POST', `/workspace/${BRANCH}/push`));
      expect(pushed.status).toBe(401);
      expect(pushed.body).toMatchObject({ error: 'invalid_token', reason: 'expired', remote: true });
      // A token for someone else the remote knows is refused before anything is replayed as the owner...
      currentToken = () => token(OTHER);
      const other = await json(await on('POST', `/workspace/${BRANCH}/push`));
      expect(other.status).toBe(403);
      expect(other.body).toMatchObject({ error: 'forbidden', reason: 'remote_identity', owner: OWNER, credential: OTHER });
      // ...and one for someone it does not know is the remote's own refusal.
      currentToken = () => token(`stranger-${stamp}`);
      const stranger = await json(await on('POST', `/workspace/${BRANCH}/push`));
      expect(stranger.status).toBe(403);
      expect(stranger.body).toMatchObject({ error: 'not_registered', remote: true });
    } finally {
      currentToken = () => token(OWNER);
    }
  });
});
