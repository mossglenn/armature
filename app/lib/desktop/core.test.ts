/**
 * The desktop core's acceptance (docs/desktop-program-plan.md §14 step 3):
 * the workspace cycle driven through the control protocol over the
 * file-backed store in a folder on disk, against a remote under `header`;
 * and the sign-in, a push through the token source and a refresh with a
 * rotated token, against a remote under `oidc` with the suite's own signing
 * key and a fake issuer.
 *
 * Both remotes run on ephemeral ports over one scratch database loaded from
 * the seed's export (as cycle.test.ts and workspaceToken.test.ts load
 * theirs), since delivery writes to the remote's main; it is deleted
 * afterwards. The core runs in-process over a pair of streams, as the shell
 * would speak to it; the bundle's own life over real pipes is bundle.test.ts.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { createClient } from '@armature/client';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, createApp } from '../api/app';
import { configFromEnv, type HubConfig } from '../api/config';
import { handleOf } from '../api/routes/workspace';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from '../api/store';
import { CURRENT_REVISION } from '../api/version';
import { startHub, type RunningHub } from '../hub';
import { runCore, type Core } from './core';
import type { FetchLike } from './signIn';

const stamp = Date.now().toString(36);
const REMOTE_DB = `${process.env.TERMINUS_DB}_desktop_${stamp}`;
const DESIGNER = 'demo-designer@example.edu';
const ISSUER = 'https://login.example.edu/realms/armature';
const AUDIENCE = 'armature-hub';
const CLIENT_ID = 'armature-desktop';
const OWNER = `desktop-owner-${stamp}`;
const OIDC_IDENTITY = { resolver: 'oidc', issuer: ISSUER, clientId: CLIENT_ID };

let headerRemote: RunningHub;
let oidcRemote: RunningHub;
let privateKey: CryptoKey;
let ownerId: string;
const kid = `key-${stamp}`;
const folders: string[] = [];

const remoteStore = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: REMOTE_DB });
const remoteConfig = (): HubConfig => ({ ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), db: REMOTE_DB }) });
const signed = (sub: string) =>
  new SignJWT({ sub, name: 'The Owner', email: `${sub}@example.edu` }).setProtectedHeader({ alg: 'ES256', kid }).setIssuer(ISSUER).setAudience(AUDIENCE).setIssuedAt().setExpirationTime('10m').sign(privateKey);

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

const dataFolder = async () => {
  const dir = await mkdtemp(join(tmpdir(), 'armature-core-'));
  folders.push(dir);
  return dir;
};

/**
 * A hub that says of itself whatever it is told: `GET /discover` answers from a script, one body
 * per read, the last repeated. For what the program must not take at a hub's word (the 2026-11-09
 * review's C1 and C2).
 */
async function impostor(answers: Array<Record<string, unknown>>): Promise<{ url: string; close: () => Promise<void> }> {
  let reads = 0;
  const server = createHttpServer((req, res) => {
    if (req.url !== '/api/v1/discover') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(answers[Math.min(reads++, answers.length - 1)]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

type Message = Record<string, unknown> & { id?: unknown; status?: number; body?: Record<string, unknown>; event?: string };

/** The core over a pair of streams, with a request that resolves with its reply and a record of every event. */
function drive(options: { fetch?: FetchLike; now?: () => number } = {}) {
  const input = new PassThrough();
  const output = new PassThrough();
  const events: Message[] = [];
  const pending = new Map<unknown, (reply: Message) => void>();
  const eventWaiters: Array<() => void> = [];
  let buffered = '';
  output.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffered.slice(0, end)) as Message;
      buffered = buffered.slice(end + 1);
      if (message.event) {
        events.push(message);
        eventWaiters.splice(0).forEach((wake) => wake());
      } else {
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
    }
  });
  const core: Core = runCore({ input, output, ...options });
  let next = 0;
  const ask = (type: string, fields: Record<string, unknown> = {}) => {
    const id = ++next;
    const reply = new Promise<Message>((resolve) => pending.set(id, resolve));
    input.write(`${JSON.stringify({ id, type, ...fields })}\n`);
    return reply;
  };
  const event = async (match: (m: Message) => boolean) => {
    for (;;) {
      const found = events.find(match);
      if (found) return found;
      await new Promise<void>((wake) => eventWaiters.push(wake));
    }
  };
  return { ask, events, event, core, end: () => input.end() };
}

beforeAll(async () => {
  const exported = (await (await app.request('/api/v1/export')).json()) as { schema: Record<string, unknown>[]; documents: TerminusDocument[] };
  const main = remoteStore('main');
  await main.ensureDatabase();
  await main.replaceSchema(exported.schema, { author: 'User/demo-designer', message: 'The seed schema, for the desktop suite' });
  const { commit: undated } = await main.insertDocuments(exported.documents.filter((doc) => doc.asOf === undefined), { author: 'User/demo-designer', message: 'The seed, for the desktop suite' });
  await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf !== undefined).map((doc) => ({ ...doc, asOf: undated })),
    { author: 'User/demo-designer', message: "The seed's dated records, for the desktop suite" }
  );

  // The owner under oidc, registered ahead as an administrator would, naming the issuer.
  const operator = createApp(remoteConfig);
  const registered = await operator.request('/api/v1/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Armature-User': DESIGNER },
    body: JSON.stringify({ message: 'The desktop owner', user: { displayName: 'The Owner', externalId: OWNER, issuer: ISSUER } }),
  });
  expect(registered.status).toBe(201);
  ownerId = ((await registered.json()) as { id: string }).id;

  const pair = await generateKeyPair('ES256');
  privateKey = pair.privateKey;
  const keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(pair.publicKey)), kid, alg: 'ES256', use: 'sig' }] });
  headerRemote = await startHub({ port: 0, config: remoteConfig() });
  oidcRemote = await startHub({
    port: 0,
    config: { ...remoteConfig(), identity: 'oidc', oidc: { issuer: ISSUER, audience: AUDIENCE, clientId: CLIENT_ID, admit: { issuers: new Set(), domains: new Set() }, keys } },
  });
}, 60_000);

afterAll(async () => {
  await headerRemote?.close();
  await oidcRemote?.close();
  await remoteStore('main').deleteDatabase().catch(() => undefined);
  await Promise.all(folders.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('the cycle through the protocol, against a remote under header', () => {
  const NAME = `desk-${stamp}`;
  const WS = `${handleOf(DESIGNER)}_${NAME}`;
  const MINE = `LearningNeed/desktop-mine-${stamp}`;
  const THEIRS = `LearningNeed/desktop-theirs-${stamp}`;
  let driver: ReturnType<typeof drive>;
  let dataDir: string;
  let hub: string;
  let localToken: string;
  const tool = (method: string, path: string, body?: unknown) =>
    fetch(`${hub}/api/v1${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'Armature-User': DESIGNER, 'Armature-Local-Token': localToken },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  beforeAll(async () => {
    driver = drive();
    dataDir = await dataFolder();
  });

  it('opens the data folder, and asks to connect before it starts a hub', async () => {
    expect(await driver.ask('connect', { remote: headerRemote.url, identity: { resolver: 'header' } })).toMatchObject({ status: 409, body: { error: 'not_opened' } });
    expect(await driver.ask('start', { dataDir })).toMatchObject({ status: 200, body: { started: false, needs: 'connect' } });
  });

  it('reads the remote’s profile, warning of header, and connects', async () => {
    const profile = await driver.ask('profile', { remote: `${headerRemote.url}/` });
    expect(profile).toMatchObject({ status: 200, body: { remote: headerRemote.url, identity: { resolver: 'header' }, compatible: true } });
    expect(profile.body?.warning).toContain('development arrangement');
    expect(await driver.ask('profile', { remote: 'http://127.0.0.1:9' })).toMatchObject({ status: 502, body: { error: 'remote_unreachable' } });

    // Connecting carries the profile confirmed; without it the core refuses, since it would otherwise keep whatever the second read said (C2).
    expect(await driver.ask('connect', { remote: headerRemote.url })).toMatchObject({ status: 400, body: { error: 'bad_request', field: 'identity' } });
    const connected = await driver.ask('connect', { remote: headerRemote.url, identity: profile.body!.identity, instance: profile.body!.instance });
    expect(connected).toMatchObject({ status: 200, body: { settings: { remote: headerRemote.url, identity: { resolver: 'header' } }, restart: false } });
    expect(await driver.ask('start', { dataDir })).toMatchObject({ status: 200, body: { started: false, needs: 'user' } });
    expect(await driver.ask('settings', { set: { remote: 'https://elsewhere.example.edu' } })).toMatchObject({ status: 400, body: { error: 'use_connect' } });
    expect(await driver.ask('settings', { set: { user: DESIGNER, port: await freePort() } })).toMatchObject({ status: 200, body: { settings: { user: DESIGNER } } });
  });

  it('starts the hub, drawing a local token the shell keeps, with the action routes refused to tools', async () => {
    expect(await driver.ask('push', { workspace: WS })).toMatchObject({ status: 409, body: { error: 'not_started' } });
    const started = await driver.ask('start', { dataDir });
    expect(started).toMatchObject({ status: 200, body: { started: true, resolver: 'header', user: DESIGNER } });
    hub = started.body!.url as string;
    localToken = started.body!.localToken as string;
    expect(localToken).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dataDir, 'workspaces', 'lock'))).toBe(true);
    expect(await driver.ask('start', { dataDir })).toMatchObject({ status: 409, body: { error: 'already_started' } });
    const refused = await tool('POST', `/workspace/${WS}/push`);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ reason: 'program_action' });
  });

  it('creates a workspace, which a tool writes to through the hub with the local token', async () => {
    const created = await driver.ask('create', { name: NAME });
    expect(created).toMatchObject({ status: 201, body: { branch: WS, ownerExternalId: DESIGNER, remote: headerRemote.url } });
    expect((await driver.ask('workspaces')).body).toEqual([expect.objectContaining({ branch: WS })]);
    // What the pairing page shows a tool must send beside the value: under header, the identifier set.
    expect(await driver.ask('toolIdentity')).toMatchObject({ status: 200, body: { user: DESIGNER } });
    expect((await tool('PUT', `/documents/${MINE}?branch=${WS}`, { message: 'Mine', document: { label: 'mine', rationale: 'r' } })).status).toBe(200);
    expect(await driver.ask('status', { workspace: WS })).toMatchObject({ status: 200, body: { localCommits: 1, unpushed: 1 } });
    // The unpushed commit with its message, newest first, as the workspace page shows it.
    const commits = await driver.ask('commits', { workspace: WS, count: 5 });
    expect(commits).toMatchObject({ status: 200, body: { branch: WS } });
    expect((commits.body!.commits as Array<{ message: string }>)[0].message).toBe('Mine');
    expect(await driver.ask('commits', { workspace: WS, count: 0 })).toMatchObject({ status: 400, body: { field: 'count' } });
  });

  it('pushes, brings in main after it moved and delivers, each as the route answers', async () => {
    const pushed = await driver.ask('push', { workspace: WS });
    expect(pushed.status, JSON.stringify(pushed.body)).toBe(200);
    expect(pushed.body!.pushed).toHaveLength(1);

    const onMain = createClient({ baseUrl: headerRemote.url, user: DESIGNER });
    await onMain.documents.put('LearningNeed', THEIRS, { message: 'Work on main', document: { label: 'theirs', rationale: 'r' } });
    expect(await driver.ask('deliver', { workspace: WS, message: 'Too early' })).toMatchObject({ status: 409, body: { error: 'bring_in_first' } });
    expect(await driver.ask('bringIn', { workspace: WS, message: 'Catch up' })).toMatchObject({ status: 200, body: { upToDate: false } });
    expect(await driver.ask('deliver', { workspace: WS })).toMatchObject({ status: 400, body: { error: 'message_required' } });
    const delivered = await driver.ask('deliver', { workspace: WS, message: 'Deliver from the desktop' });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect((await onMain.documents.get('LearningNeed', MINE.split('/')[1])).data.label).toBe('mine');
  });

  it('answers a refusal as the route does, and a request it does not know', async () => {
    expect(await driver.ask('push', { workspace: 'nothing-here' })).toMatchObject({ status: 404, body: { error: 'not_found' } });
    expect(await driver.ask('push', {})).toMatchObject({ status: 400, body: { error: 'bad_request', field: 'workspace' } });
    expect(await driver.ask('signIn')).toMatchObject({ status: 409, body: { error: 'not_oidc' } });
    expect(await driver.ask('credential', { remote: headerRemote.url, refreshToken: 'r' })).toMatchObject({ status: 409, body: { error: 'not_oidc' } });
    // The remote stays while a workspace names it.
    const away = await driver.ask('profile', { remote: oidcRemote.url });
    expect(await driver.ask('connect', { remote: oidcRemote.url, identity: away.body!.identity, instance: away.body!.instance })).toMatchObject({ status: 409, body: { error: 'workspaces_exist', workspaces: [WS] } });
  });

  it('resets the pairing: the new token is the hub’s at once, the old one refused', async () => {
    const old = localToken;
    const reset = await driver.ask('resetPairing');
    localToken = reset.body!.localToken as string;
    expect(localToken).not.toBe(old);
    expect((await tool('PUT', `/documents/${MINE}?branch=${WS}`, { message: 'Again', document: { label: 'mine', rationale: 'again' } })).status).toBe(200);
    const stale = await fetch(`${hub}/api/v1/documents/${MINE}?branch=${WS}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Armature-User': DESIGNER, 'Armature-Local-Token': old },
      body: JSON.stringify({ message: 'Old', document: { label: 'mine', rationale: 'old' } }),
    });
    expect(stale.status).toBe(403);
  });

  it('stops, starts again with the kept token, and releases the lock when the input ends', async () => {
    expect(await driver.ask('stop')).toMatchObject({ status: 200, body: { stopped: true } });
    expect(existsSync(join(dataDir, 'workspaces', 'lock'))).toBe(false);
    const again = await driver.ask('start', { dataDir, localToken });
    expect(again.status).toBe(200);
    expect(again.body).not.toHaveProperty('localToken');
    expect((await driver.ask('status', { workspace: WS })).status).toBe(200);
    // Removed: refused while the pairing test's write is unpushed; pushed, the branch has work main lacks, so the remote keeps it.
    expect(await driver.ask('remove', { workspace: WS })).toMatchObject({ status: 409, body: { error: 'unpushed_commits' } });
    expect((await driver.ask('push', { workspace: WS })).status).toBe(200);
    expect(await driver.ask('remove', { workspace: WS })).toMatchObject({ status: 200, body: { remote: 'kept', reason: 'unmerged' } });
    expect((await driver.ask('workspaces')).body).toEqual([]);
    driver.end();
    await driver.core.closed;
    expect(existsSync(join(dataDir, 'workspaces', 'lock'))).toBe(false);
  });
});

describe('a hub’s account of itself is checked against the address dialed (the 2026-11-09 review’s C1 and C2)', () => {
  const RELEASES = 'https://github.com/mossglenn/armature/releases';
  const declares = (identity: Record<string, unknown>, instance: Record<string, unknown>) => ({ role: 'remote', versions: [CURRENT_REVISION], identity, instance, capabilities: {}, schema: {} });
  let driver: ReturnType<typeof drive>;
  let dataDir: string;
  const impostors: Array<{ close: () => Promise<void> }> = [];
  const hub = async (answers: Array<Record<string, unknown>>) => {
    const made = await impostor(answers);
    impostors.push(made);
    return made.url;
  };

  beforeAll(async () => {
    driver = drive();
    dataDir = await dataFolder();
    expect((await driver.ask('start', { dataDir })).body).toMatchObject({ needs: 'connect' });
  });

  afterAll(async () => {
    driver?.end();
    await driver?.core.closed;
    await Promise.all(impostors.map((i) => i.close()));
  });

  it('shows the address dialed, and warns when the hub declares the real instance’s address as its own', async () => {
    // The impostor declares the real instance's name, its address and its provider (C1's scenario); the program keeps the address it dialed.
    const hostile = await hub([declares(OIDC_IDENTITY, { name: 'Armature at Example University', api: oidcRemote.url, program: { releases: RELEASES } })]);
    const profile = await driver.ask('profile', { remote: hostile });
    expect(profile).toMatchObject({ status: 200, body: { remote: hostile, instance: { name: 'Armature at Example University', api: oidcRemote.url }, identity: OIDC_IDENTITY } });
    expect(profile.body!.warning).toContain(`The hub at ${hostile} says its address is ${oidcRemote.url}`);
    // The real remote declares no other address, so no warning.
    expect((await driver.ask('profile', { remote: oidcRemote.url })).body).not.toHaveProperty('warning');
  });

  it('refuses a profile the program cannot use, naming what is wrong', async () => {
    const broken = await hub([declares(OIDC_IDENTITY, { name: 'Broken', api: 'not an address', program: { releases: RELEASES } })]);
    expect(await driver.ask('profile', { remote: broken })).toMatchObject({ status: 400, body: { error: 'bad_profile', field: 'instance.api', remote: broken } });
  });

  it('connects only to the profile confirmed: a hub that answers the second read differently is refused and nothing is kept', async () => {
    const instance = { name: 'Armature at Example University', program: { releases: RELEASES } };
    const flipping = await hub([declares(OIDC_IDENTITY, instance), declares({ ...OIDC_IDENTITY, issuer: 'https://login.attacker.example/realms/armature' }, instance)]);
    const profile = await driver.ask('profile', { remote: flipping });
    expect(profile).toMatchObject({ status: 200, body: { identity: OIDC_IDENTITY } });
    const refused = await driver.ask('connect', { remote: flipping, identity: profile.body!.identity, instance: profile.body!.instance });
    expect(refused).toMatchObject({
      status: 409,
      body: { error: 'profile_changed', remote: flipping, confirmed: { identity: OIDC_IDENTITY }, found: { identity: { issuer: 'https://login.attacker.example/realms/armature' } } },
    });
    expect((await driver.ask('start', { dataDir })).body).toMatchObject({ started: false, needs: 'connect' });

    // A hub answering alike is connected, and the start reply names the issuer for the sign-in page.
    const steady = await hub([declares(OIDC_IDENTITY, instance)]);
    const read = await driver.ask('profile', { remote: steady });
    expect(await driver.ask('connect', { remote: steady, identity: read.body!.identity, instance: read.body!.instance })).toMatchObject({ status: 200, body: { settings: { remote: steady } } });
    expect((await driver.ask('settings', { set: { port: await freePort() } })).status).toBe(200);
    expect(await driver.ask('start', { dataDir })).toMatchObject({ status: 200, body: { started: true, resolver: 'oidc', issuer: ISSUER } });
    expect(await driver.ask('stop')).toMatchObject({ status: 200 });
  });
});

describe('the sign-in and a push through the token source, against a remote under oidc', () => {
  const NAME = `desk-oidc-${stamp}`;
  const WS = `${handleOf(OWNER)}_${NAME}`;
  const NEED = `LearningNeed/desktop-oidc-${stamp}`;
  let clock = Date.now();
  const exchanges: URLSearchParams[] = [];
  let refreshes = 0;
  /** The identity provider: its metadata, and a token endpoint issuing the owner's tokens, rotating the refresh token on each refresh. */
  const issuer: FetchLike = async (input, init) => {
    const url = String(input);
    if (url === `${ISSUER}/.well-known/openid-configuration`) return Response.json({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token` });
    if (url === `${ISSUER}/token`) {
      const body = new URLSearchParams(String(init?.body));
      exchanges.push(body);
      if (body.get('grant_type') === 'authorization_code') return Response.json({ access_token: await signed(OWNER), expires_in: 300, refresh_token: 'refresh-0' });
      if (body.get('grant_type') === 'refresh_token' && body.get('refresh_token') === `refresh-${refreshes}`) {
        refreshes += 1;
        return Response.json({ access_token: await signed(OWNER), expires_in: 300, refresh_token: `refresh-${refreshes}` });
      }
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    throw new TypeError(`fetch failed: ${url}`);
  };
  let driver: ReturnType<typeof drive>;
  let dataDir: string;
  let hub: string;
  let localToken: string;

  beforeAll(async () => {
    driver = drive({ fetch: issuer, now: () => clock });
    dataDir = await dataFolder();
    expect((await driver.ask('start', { dataDir })).body).toMatchObject({ needs: 'connect' });
    // An identifier kept for a remote under header is dropped on connecting to one that signs people in.
    expect((await driver.ask('connect', { remote: headerRemote.url, identity: { resolver: 'header' }, instance: (await driver.ask('profile', { remote: headerRemote.url })).body!.instance })).status).toBe(200);
    expect((await driver.ask('settings', { set: { user: DESIGNER } })).body).toMatchObject({ settings: { user: DESIGNER } });
    const connected = await driver.ask('connect', { remote: oidcRemote.url, identity: OIDC_IDENTITY, instance: (await driver.ask('profile', { remote: oidcRemote.url })).body!.instance });
    expect(connected).toMatchObject({ status: 200, body: { settings: { identity: { resolver: 'oidc', issuer: ISSUER, clientId: CLIENT_ID } } } });
    expect(connected.body!.settings).not.toHaveProperty('user');
    expect((await driver.ask('settings', { set: { port: await freePort() } })).status).toBe(200);
  });

  afterAll(async () => {
    driver?.end();
    await driver?.core.closed;
  });

  it('starts offline of the issuer, signed out, and says so when the remote is needed', async () => {
    const started = await driver.ask('start', { dataDir });
    expect(started).toMatchObject({ status: 200, body: { started: true, resolver: 'oidc', signedIn: false } });
    hub = started.body!.url as string;
    localToken = started.body!.localToken as string;
    expect(exchanges).toHaveLength(0);
    expect(await driver.ask('create', { name: NAME })).toMatchObject({ status: 401, body: { error: 'signed_out' } });
    expect(await driver.ask('toolIdentity')).toMatchObject({ status: 401, body: { error: 'signed_out' } });
  });

  it('signs in: the browser opened at the provider, the refresh token sent for the keychain, the person the remote resolves', async () => {
    const reply = driver.ask('signIn');
    const open = await driver.event((m) => m.event === 'open');
    const authorize = new URL(open.url as string);
    expect(authorize.searchParams.get('client_id')).toBe(CLIENT_ID);
    // The person signs in at the provider, which redirects to the program's loopback listener.
    const callback = new URL(authorize.searchParams.get('redirect_uri')!);
    callback.search = new URLSearchParams({ code: 'a-code', state: authorize.searchParams.get('state')! }).toString();
    expect((await fetch(callback)).status).toBe(200);
    expect(await reply).toMatchObject({ status: 200, body: { signedIn: true, staysSignedIn: true, person: { id: ownerId, externalId: OWNER } } });
    expect(driver.events.filter((m) => m.event === 'credential').map((m) => m.refreshToken)).toEqual(['refresh-0']);
    // Under oidc a tool sends the remote's externalId for the person, the provider's sub, which only the pairing page shows.
    expect(await driver.ask('toolIdentity')).toMatchObject({ status: 200, body: { user: OWNER } });
  });

  it('creates the workspace and pushes as the token’s subject: the remote records the owner as author', async () => {
    expect(await driver.ask('create', { name: NAME })).toMatchObject({ status: 201, body: { branch: WS, owner: ownerId } });
    const written = await fetch(`${hub}/api/v1/documents?branch=${WS}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Armature-User': OWNER, 'Armature-Local-Token': localToken },
      body: JSON.stringify({ message: 'Work done offline', documents: [{ '@type': 'LearningNeed', '@id': NEED, label: 'A need', rationale: 'r' }] }),
    });
    expect(written.status).toBe(200);
    const pushed = await driver.ask('push', { workspace: WS });
    expect(pushed.status, JSON.stringify(pushed.body)).toBe(200);
    const history = await fetch(`${oidcRemote.url}/api/v1/documents/${NEED}/history?branch=${WS}`, { headers: { Authorization: `Bearer ${await signed(OWNER)}` } });
    expect(((await history.json()) as { entries: Array<{ author: string }> }).entries[0].author).toBe(ownerId);
  });

  it('refreshes near expiry and hands the rotated refresh token to the shell', async () => {
    clock += 300_000;
    expect((await driver.ask('status', { workspace: WS })).body).toMatchObject({ remote: { moved: false } });
    expect(exchanges.at(-1)?.get('grant_type')).toBe('refresh_token');
    expect(driver.events.filter((m) => m.event === 'credential').map((m) => m.refreshToken)).toEqual(['refresh-0', 'refresh-1']);
  });

  it('starts again from the keychain’s refresh token alone, with no sign-in', async () => {
    // The program quits and starts again: a new core, which holds nothing but what the shell sends.
    driver.end();
    await driver.core.closed;
    driver = drive({ fetch: issuer, now: () => clock });
    expect((await driver.ask('start', { dataDir, localToken, refreshToken: 'refresh-1' })).body).toMatchObject({ started: true, signedIn: true });
    expect((await driver.ask('push', { workspace: WS })).status).toBe(200);
    expect(driver.events.filter((m) => m.event === 'credential').map((m) => m.refreshToken)).toEqual(['refresh-2']);
  });

  it('takes the keychain’s refresh token after start, for the remote the settings name only', async () => {
    // As the shell does: start, learn the remote from the reply, then send the token the keychain keeps for it.
    driver.end();
    await driver.core.closed;
    driver = drive({ fetch: issuer, now: () => clock });
    const started = await driver.ask('start', { dataDir, localToken });
    expect(started.body).toMatchObject({ started: true, remote: oidcRemote.url, signedIn: false });
    expect(await driver.ask('credential', { remote: 'https://other.example.edu', refreshToken: `refresh-${refreshes}` })).toMatchObject({
      status: 409,
      body: { error: 'other_remote', remote: oidcRemote.url },
    });
    expect(await driver.ask('credential', { remote: `${oidcRemote.url}/`, refreshToken: `refresh-${refreshes}` })).toMatchObject({ status: 200, body: { signedIn: true } });
    expect((await driver.ask('push', { workspace: WS })).status).toBe(200);
  });

  it('is signed out by a refused refresh and by signOut, each 401 signed_out at the next remote action', async () => {
    expect((await driver.ask('stop')).status).toBe(200);
    expect((await driver.ask('start', { dataDir, localToken, refreshToken: 'revoked' })).status).toBe(200);
    expect(await driver.ask('push', { workspace: WS })).toMatchObject({ status: 401, body: { error: 'signed_out' } });
    expect(driver.events.some((m) => m.event === 'signedOut' && m.reason === 'invalid_grant')).toBe(true);

    expect((await driver.ask('stop')).status).toBe(200);
    expect((await driver.ask('start', { dataDir, localToken, refreshToken: `refresh-${refreshes}` })).status).toBe(200);
    expect((await driver.ask('signOut')).body).toEqual({ signedOut: true });
    expect(await driver.ask('push', { workspace: WS })).toMatchObject({ status: 401, body: { error: 'signed_out' } });
    // Reads of the workspace stay local and need no sign-in.
    expect((await driver.ask('workspaces')).status).toBe(200);
  });
});
