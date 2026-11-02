/**
 * Authorization (architecture decision record ADR-0068): grants on `main`.
 *
 * Grants are written to `main`, which the contract suite never touches on the
 * seeded store (the seed is a fixture the other files read), so this file runs
 * a hub over a scratch database of its own: the seeded store's full export,
 * loaded by the operator's steps (ADR-0062) as the workspace clone loads one
 * (platform check AN), and deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hono } from 'hono';
import { app, createApp } from './app';
import { configFromEnv } from './config';
import { createOperatorStore, storeConfigFromEnv, type TerminusDocument } from './store';
import { writeDocuments } from './write';
import { checkBranch } from '../operator/check';
import { capabilitiesOf } from './version';
import { createClient } from '@armature/client';
import type { UserDocument } from './identity';

const stamp = Date.now().toString(36);
const SCRATCH_DB = `${process.env.TERMINUS_DB}_authz_${stamp}`;
const DESIGNER = 'User/demo-designer';
const REVIEWER = 'User/demo-reviewer';
const AGENT_EXTERNAL_ID = `agent:test/relay-${stamp}`;
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const BRANCH = `test-authz-${stamp}`;

let hub: Hono;
const scratch = (branch: string) => createOperatorStore({ branch }, { ...storeConfigFromEnv(), db: SCRATCH_DB });

const on = (method: string, path: string, body?: unknown) =>
  hub.request(`/api/v1${path}`, { method, headers: HEADERS, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (res: Response) => ({ status: res.status, body: await res.json() });
const codes = (body: { violations: Array<{ code: string; field?: string }> }) => body.violations.map((v) => `${v.code}@${v.field ?? ''}`);

const grant = (fields: Record<string, unknown>) => ({ '@type': 'Grant', status: 'Active', ...fields });
const write = (documents: unknown[], message: string, branch = 'main') => on('POST', `/documents?branch=${branch}`, { message, documents });

beforeAll(async () => {
  const exported = (await json(await app.request('/api/v1/export'))).body as { schema: Record<string, unknown>[]; documents: TerminusDocument[] };
  const main = scratch('main');
  await main.ensureDatabase();
  await main.replaceSchema(exported.schema, { author: DESIGNER, message: 'The seed schema, for the authorization suite' });
  await main.insertDocuments(exported.documents, { author: DESIGNER, message: 'The seed, for the authorization suite' });
  hub = createApp(() => ({ ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), db: SCRATCH_DB }) }));
});

afterAll(async () => {
  await scratch('main').deleteDatabase().catch(() => undefined);
});

describe('Grant documents (ADR-0068 decision 2; constraints 21 and 22)', () => {
  let agentId: string;
  let grantId: string;

  beforeAll(async () => {
    expect((await on('POST', '/branches', { name: BRANCH })).status).toBe(201);
    const registered = await json(
      await on('POST', '/users', { message: 'A relay service for the tests', user: { displayName: 'Test relay', externalId: AGENT_EXTERNAL_ID } })
    );
    expect(registered.status).toBe(201);
    agentId = registered.body.id;
  });

  it('refuses a grant on any branch but main (constraint 21)', async () => {
    const res = await json(await write([grant({ user: REVIEWER, role: 'Maintainer', branch: BRANCH })], 'Where it does not belong', BRANCH));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('grants_live_on_main');
    const single = await json(
      await on('PUT', `/documents/Grant/anything?branch=${BRANCH}`, { message: 'x', document: grant({ user: REVIEWER, role: 'Maintainer' }) })
    );
    expect(single.body.error).toBe('grants_live_on_main');
  });

  it('writes a Maintainer grant on main under a hub-minted id, and lists it by role', async () => {
    const res = await json(await write([grant({ user: REVIEWER, role: 'Maintainer', branch: BRANCH, rationale: 'Reviews this round' })], 'Grant the reviewer the round'));
    expect(res.status).toBe(200);
    expect(res.body.ids).toHaveLength(1);
    grantId = res.body.ids[0];
    expect(grantId).toMatch(/^Grant\//);
    const listed = await json(await on('GET', '/documents/Grant?role=Maintainer'));
    expect(listed.body.map((g: TerminusDocument) => g['@id'])).toContain(grantId);
    const read = await json(await on('GET', `/documents/${grantId}`));
    expect(read.body).toMatchObject({ user: REVIEWER, role: 'Maintainer', branch: BRANCH, status: 'Active' });
    expect(read.body.createdBy).toBeUndefined();
  });

  it('revokes by replacing under the same key: one current grant per holder, role and branch; the id stays', async () => {
    const res = await json(
      await write([grant({ user: REVIEWER, role: 'Maintainer', branch: BRANCH, status: 'Revoked', rationale: 'The round closed' })], 'Revoke the round grant')
    );
    expect(res.status).toBe(200);
    expect(res.body.ids[0]).toBe(grantId);
    const read = await json(await on('GET', `/documents/${grantId}`));
    expect(read.body.status).toBe('Revoked');
    // Of every branch is a second grant beside the branch-scoped one (an absent Optional in the key, check AA).
    const every = await json(await write([grant({ user: REVIEWER, role: 'Maintainer' })], 'Maintainer of every branch'));
    expect(every.status).toBe(200);
    expect(every.body.ids[0]).not.toBe(grantId);
    // Taken back at once: the permission tests below rely on the reviewer holding nothing.
    const back = await json(await write([grant({ user: REVIEWER, role: 'Maintainer', status: 'Revoked', rationale: 'Only a key test' })], 'Revoked'));
    expect(back.body.ids[0]).toBe(every.body.ids[0]);
  });

  it('refuses a client-supplied id: the key is the identity', async () => {
    const res = await json(await write([grant({ '@id': `Grant/mine-${stamp}`, user: REVIEWER, role: 'Owner', branch: BRANCH })], 'x'));
    expect(res.status).toBe(400);
  });

  it('refuses an agent as Maintainer or Administrator, and a person as Relay (constraint 22)', async () => {
    const res = await json(
      await write(
        [grant({ user: agentId, role: 'Maintainer' }), grant({ user: agentId, role: 'Administrator' }), grant({ user: REVIEWER, role: 'Relay' })],
        'Three grants the rules refuse'
      )
    );
    expect(res.status).toBe(422);
    expect(codes(res.body)).toEqual(['grant_holder_kind@user', 'grant_holder_kind@user', 'grant_holder_kind@user']);
  });

  it('refuses relayedUsers on anything but a Relay grant, and an agent among them', async () => {
    const res = await json(
      await write(
        [grant({ user: REVIEWER, role: 'Maintainer', branch: `${BRANCH}-2`, relayedUsers: [DESIGNER] }), grant({ user: agentId, role: 'Relay', relayedUsers: [agentId] })],
        'Narrowing in the wrong places'
      )
    );
    expect(res.status).toBe(422);
    expect(codes(res.body)).toEqual(['relayed_users_not_relay@relayedUsers', 'grant_holder_kind@relayedUsers[0]']);
  });

  it('accepts a Relay grant for an agent, narrowed to persons and a period, and an Owner grant for either kind', async () => {
    const expires = new Date(Date.now() + 86_400_000).toISOString();
    const res = await json(
      await write(
        [
          grant({ user: agentId, role: 'Relay', branch: BRANCH, relayedUsers: [REVIEWER], expires, rationale: "CoQui's outbox for this round" }),
          grant({ user: agentId, role: 'Owner', branch: `${BRANCH}-agent` }),
          grant({ user: DESIGNER, role: 'Owner', branch: `${BRANCH}-person` }),
        ],
        'Grants the rules accept'
      )
    );
    expect(res.status).toBe(200);
    const relay = await json(await on('GET', `/documents/${res.body.ids[0]}`));
    expect(relay.body).toMatchObject({ role: 'Relay', relayedUsers: [REVIEWER], expires });
  });

  it('keeps a grant out of the design record hierarchy: not a note subject (constraint 0), the holder a User', async () => {
    // On main, where the grant is; on a branch it would be unknown_reference, since branches hold no grants.
    const note = await json(
      await write(
        [{ '@type': 'DesignNote', '@id': `DesignNote/about-grant-${stamp}`, label: 'About a grant', rationale: 'x', subject: [grantId] }],
        'A note about a grant'
      )
    );
    expect(note.status).toBe(422);
    expect(codes(note.body)).toContain('reference_class@subject[0]');
    const holder = await json(await write([grant({ user: 'Module/how-ai-works', role: 'Maintainer' })], 'A module cannot hold authority'));
    expect(holder.status).toBe(422);
    expect(codes(holder.body)).toEqual(['reference_class@user']);
  });

  it('exports grants in the full slice, and the pseudonymous profile rewrites user and relayedUsers', async () => {
    const full = (await json(await on('GET', '/export'))).body;
    const grants = full.documents.filter((d: TerminusDocument) => d['@type'] === 'Grant');
    expect(grants.length).toBeGreaterThanOrEqual(5);
    expect(grants.some((g: TerminusDocument) => g.user === REVIEWER)).toBe(true);
    const pseudonymous = (await json(await on('GET', '/export?profile=pseudonymous'))).body;
    const hidden = pseudonymous.documents.filter((d: TerminusDocument) => d['@type'] === 'Grant');
    expect(hidden.length).toBe(grants.length);
    for (const g of hidden) {
      expect(g.user).toMatch(/^User\/[0-9a-f]{32}$/);
      for (const u of (g.relayedUsers as string[] | undefined) ?? []) expect(u).toMatch(/^User\/[0-9a-f]{32}$/);
    }
  });
});

describe('branch ownership (ADR-0068 decision 3)', () => {
  const OWNED = `test-authz-owned-${stamp}`;
  const mainHead = async () => (await json(await on('GET', '/branches/main'))).body.head;
  const grantsNaming = async (branch: string): Promise<TerminusDocument[]> =>
    (await json(await on('GET', '/documents/Grant'))).body.filter((g: TerminusDocument) => g.branch === branch);

  it('needs an identity: creating a branch is a commit on main', async () => {
    const res = await json(
      await hub.request('/api/v1/branches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: OWNED }) })
    );
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('identity_required');
  });

  it("writes the caller's Owner grant on main, in a commit of its own, before the branch exists", async () => {
    const before = (await mainHead()).commit;
    const res = await json(await on('POST', '/branches', { name: OWNED }));
    expect(res.status).toBe(201);
    const [owner] = await grantsNaming(OWNED);
    expect(owner).toMatchObject({ user: DESIGNER, role: 'Owner', branch: OWNED, status: 'Active' });
    const head = await mainHead();
    expect(head.commit).not.toBe(before);
    expect(head.author).toBe(DESIGNER);
    expect(head.message).toContain(OWNED);
    // Cut from main after the grant, the branch starts at the commit that records its owner.
    expect(res.body.head.commit).toBe(head.commit);
  });

  it('writes nothing on main for a branch that exists or an origin that does not', async () => {
    const before = (await mainHead()).commit;
    expect((await json(await on('POST', '/branches', { name: OWNED }))).body.error).toBe('branch_exists');
    expect((await json(await on('POST', '/branches', { name: `${OWNED}-b`, from: { branch: `no-such-${stamp}` } }))).body.error).toBe('unknown_ref');
    expect((await mainHead()).commit).toBe(before);
  });

  it('revokes every grant naming the branch before deleting it', async () => {
    expect((await write([grant({ user: REVIEWER, role: 'Maintainer', branch: OWNED })], 'A maintainer of the owned branch')).status).toBe(200);
    const res = await json(await on('DELETE', `/branches/${OWNED}`));
    expect(res.status).toBe(200);
    expect(res.body.heldBy).toBe('main');
    const after = await grantsNaming(OWNED);
    expect(after.map((g) => [g.role, g.status, g.rationale]).sort()).toEqual([
      ['Maintainer', 'Revoked', 'Branch deleted'],
      ['Owner', 'Revoked', 'Branch deleted'],
    ]);
  });

  it("the operator's check reports a grant in force naming no branch, and a branch with no owner, on main only", async () => {
    const ORPHAN = `test-authz-orphan-${stamp}`;
    const GHOST = `test-authz-ghost-${stamp}`;
    await scratch('main').createBranch(ORPHAN, { branch: 'main' }); // around the route, so no Owner grant
    const ghost = await json(await write([grant({ user: REVIEWER, role: 'Maintainer', branch: GHOST })], 'A grant on a branch that does not exist'));
    expect(ghost.status).toBe(200);
    const report = await checkBranch(scratch('main'));
    expect(report.violations).toContainEqual(expect.objectContaining({ code: 'grant_without_branch', id: ghost.body.ids[0], field: 'branch' }));
    expect(report.violations).toContainEqual(expect.objectContaining({ code: 'branch_without_owner', index: -1, message: expect.stringContaining(ORPHAN) }));
    expect(report.violations.filter((v) => v.code === 'branch_without_owner').map((v) => v.message)).not.toContainEqual(expect.stringContaining(BRANCH));
    const atCommit = await checkBranch(scratch('main').at({ commit: report.commit }));
    expect(atCommit.violations.filter((v) => v.code === 'grant_without_branch' || v.code === 'branch_without_owner')).toEqual([]);
  });

  it("takes a grant written on a transient branch for main, as the operator's put writes one (decision 6), and refuses it for the branch itself", async () => {
    const me = (await json(await on('GET', '/users/me'))).body as UserDocument;
    const who = { id: me['@id'], user: me };
    const TRANSIENT = `operator-test-${stamp}`;
    await scratch('main').createBranch(TRANSIENT, { branch: 'main' });
    const transient = scratch(TRANSIENT);
    const document = { '@type': 'Grant', user: REVIEWER, role: 'Administrator', status: 'Active' } as unknown as TerminusDocument;
    await expect(writeDocuments([document], { branch: transient, who, message: 'x' })).rejects.toMatchObject({ code: 'grants_live_on_main' });
    const { ids } = await writeDocuments([document], { branch: transient, target: 'main', who, message: 'The first administrator, as the operator writes one' });
    expect(ids[0]).toMatch(/^Grant\//);
  });
});

describe('permissions (ADR-0068 decisions 4, 7 and 8)', () => {
  const asReviewer = { 'Content-Type': 'application/json', 'Armature-User': 'demo-reviewer@example.edu' };
  const AGENT = `agent:test/authz-${stamp}`;
  const asAgent = { 'Content-Type': 'application/json', 'Armature-User': AGENT };
  const MINE = `test-authz-reviewers-${stamp}`;
  const as = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) =>
    hub.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const reviewer = as(asReviewer);
  const agent = as(asAgent);
  const need = (label: string) => ({ message: 'A need', document: { label, rationale: 'r' } });
  const forbidden = async (res: Response, details: Record<string, unknown>) => {
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: 'forbidden', ...details });
  };

  it('refuses the reviewer, who holds no grant, everything but reading, creating a branch and registering an agent', async () => {
    await forbidden(await reviewer('PUT', `/documents/LearningNeed/r1-${stamp}?branch=${BRANCH}`, need('r1')), { permission: 'write', branch: BRANCH });
    await forbidden(await reviewer('POST', `/branches/${BRANCH}/merge`, { message: 'x', from: 'main' }), { permission: 'merge', branch: BRANCH });
    await forbidden(await reviewer('DELETE', `/branches/${BRANCH}`), { permission: 'delete', branch: BRANCH });
    await forbidden(await reviewer('PUT', `/documents/LearningNeed/r1-${stamp}`, need('r1')), { permission: 'write', branch: 'main' });
    await forbidden(
      await reviewer('POST', '/documents', { message: 'x', documents: [grant({ user: REVIEWER, role: 'Maintainer', branch: BRANCH })] }),
      { permission: 'grant', role: 'Maintainer', branch: BRANCH }
    );
    await forbidden(
      await reviewer('POST', '/users', { message: 'x', user: { displayName: 'Someone', externalId: `someone-${stamp}@example.edu` } }),
      { permission: 'register', agent: false }
    );
    expect((await reviewer('GET', `/documents/LearningObjective?branch=${BRANCH}`)).status).toBe(200);
    const registered = await json(await reviewer('POST', '/users', { message: 'A drafting agent', user: { displayName: 'Authz agent', externalId: AGENT } }));
    expect(registered.status).toBe(201);
  });

  it("the branch's owner grants Maintainer on it, and the reviewer may then write; Administrator is beyond an owner", async () => {
    expect((await write([grant({ user: REVIEWER, role: 'Maintainer', branch: BRANCH })], 'The reviewer may write this branch')).status).toBe(200);
    expect((await reviewer('PUT', `/documents/LearningNeed/r1-${stamp}?branch=${BRANCH}`, need('r1'))).status).toBe(200);
    // Owning a branch of their own, the reviewer grants Maintainer on it but nothing wider.
    expect((await reviewer('POST', '/branches', { name: MINE })).status).toBe(201);
    expect((await reviewer('POST', '/documents', { message: 'x', documents: [grant({ user: DESIGNER, role: 'Maintainer', branch: MINE })] })).status).toBe(200);
    await forbidden(
      await reviewer('POST', '/documents', { message: 'x', documents: [grant({ user: REVIEWER, role: 'Maintainer' })] }),
      { permission: 'grant', role: 'Maintainer' }
    );
    await forbidden(
      await reviewer('POST', '/documents', { message: 'x', documents: [grant({ user: REVIEWER, role: 'Administrator' })] }),
      { permission: 'grant', role: 'Administrator' }
    );
    // The owner merges into and deletes their own branch.
    expect((await reviewer('POST', `/branches/${MINE}/merge`, { message: 'Bring in the designer\'s branch', from: BRANCH })).status).toBe(200);
    const SHORT = `${MINE}-short`;
    expect((await reviewer('POST', '/branches', { name: SHORT })).status).toBe(201);
    expect((await reviewer('DELETE', `/branches/${SHORT}`)).status).toBe(200);
  });

  it('a merge into main needs a maintainer of main: refused for the reviewer, taken for the designer', async () => {
    const M = `test-authz-to-main-${stamp}`;
    expect((await on('POST', '/branches', { name: M })).status).toBe(201);
    expect((await on('PUT', `/documents/LearningNeed/tm-${stamp}?branch=${M}`, need('tm'))).status).toBe(200);
    await forbidden(await reviewer('POST', '/branches/main/merge', { message: 'Deliver', from: M }), { permission: 'merge', branch: 'main' });
    const merged = await json(await on('POST', '/branches/main/merge', { message: 'Deliver', from: M }));
    expect(merged.status).toBe(200);
    expect(merged.body.upToDate).toBe(false);
  });

  it('an agent as the credential itself reads but never writes to a remote hub (ADR-0067 decision 10)', async () => {
    const A = `test-authz-agent-${stamp}`;
    await forbidden(await agent('POST', '/branches', { name: A }), { permission: 'create', branch: A, credential: AGENT });
    await forbidden(await agent('PUT', `/documents/LearningNeed/a1-${stamp}?branch=${BRANCH}`, need('a1')), { permission: 'write', branch: BRANCH, credential: AGENT });
    await forbidden(await agent('PUT', `/documents/LearningNeed/a1-${stamp}`, need('a1')), { permission: 'write', branch: 'main', credential: AGENT });
    await forbidden(await agent('POST', '/users', { message: 'x', user: { displayName: 'Another', externalId: `agent:test/other-${stamp}` } }), {
      permission: 'register',
      agent: true,
      credential: AGENT,
    });
    expect((await agent('GET', `/documents/LearningObjective?branch=${BRANCH}`)).status).toBe(200);
    expect((await json(await agent('GET', '/users/me'))).body.externalId).toBe(AGENT);
    expect((await on('GET', `/branches/${A}`)).status).toBe(404);
  });

  it('a branch with no owner is writable by any registered User while the migration window is open, as discovery says', async () => {
    const OWNERLESS = `test-authz-ownerless-${stamp}`;
    await scratch('main').createBranch(OWNERLESS, { branch: 'main' });
    expect((await reviewer('PUT', `/documents/LearningNeed/o1-${stamp}?branch=${OWNERLESS}`, need('o1'))).status).toBe(200);
    const discover = (await json(await on('GET', '/discover'))).body;
    expect(discover.capabilities['armature/authorization']).toEqual({ fallback: 'reject', ownerlessBranches: 'writable' });
    expect(capabilitiesOf('workspace').map(([id]) => id)).not.toContain('armature/authorization');
  });

  it('a grant past its expiry is not in force; Maintainer of main opens main and its revocation closes it', async () => {
    const E = `test-authz-expired-${stamp}`;
    expect((await on('POST', '/branches', { name: E })).status).toBe(201);
    const expired = grant({ user: REVIEWER, role: 'Maintainer', branch: E, expires: new Date(Date.now() - 60_000).toISOString() });
    expect((await write([expired], 'A grant that has already expired')).status).toBe(200);
    await forbidden(await reviewer('PUT', `/documents/LearningNeed/e1-${stamp}?branch=${E}`, need('e1')), { permission: 'write', branch: E });

    expect((await write([grant({ user: REVIEWER, role: 'Maintainer' })], 'The reviewer maintains every branch')).status).toBe(200);
    expect((await reviewer('PUT', `/documents/LearningNeed/m1-${stamp}`, need('m1'))).status).toBe(200);
    const me = (await json(await reviewer('GET', '/users/me'))).body;
    expect(me['@id']).toBe(REVIEWER);
    expect(me.grants.map((g: TerminusDocument) => [g.role, g.branch ?? '*'])).toContainEqual(['Maintainer', '*']);
    expect(me.grants.every((g: TerminusDocument) => g.status === 'Active')).toBe(true);
    expect((await write([grant({ user: REVIEWER, role: 'Maintainer', status: 'Revoked', rationale: 'Enough' })], 'Revoked')).status).toBe(200);
    await forbidden(await reviewer('PUT', `/documents/LearningNeed/m2-${stamp}`, need('m2')), { permission: 'write', branch: 'main' });
  });

  it('lists grants by person (decision 8) while a design record is still never listed by who made it (ADR-0021)', async () => {
    const mine = await json(await on('GET', `/documents/Grant?user=${REVIEWER}`));
    expect(mine.status).toBe(200);
    expect(mine.body.length).toBeGreaterThan(0);
    expect(mine.body.every((g: TerminusDocument) => g.user === REVIEWER)).toBe(true);
    const refused = await json(await on('GET', `/documents/LearningNeed?createdBy=${DESIGNER}`));
    expect(refused.status).toBe(400);
    expect(refused.body.error).toBe('person_filter_refused');
  });
});

describe('an agent acting for a person (ADR-0067 decisions 3, 6 and 8; ADR-0068 decisions 3 and 5)', () => {
  const asAgentFor = (person: string) => ({ 'Content-Type': 'application/json', 'Armature-User': person, 'Armature-Agent': AGENT_EXTERNAL_ID });
  const forDesigner = asAgentFor('demo-designer@example.edu');
  const call = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) =>
    hub.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const doc = (label: string, message = 'Drafted by the agent') => ({ message, document: { label, rationale: 'r' } });
  let agentUserId: string;

  beforeAll(async () => {
    agentUserId = (await json(await on('GET', `/documents/User?externalId=${encodeURIComponent(AGENT_EXTERNAL_ID)}`))).body[0]['@id'];
  });

  it('the agent is the author and createdBy; the person is named in the commit\'s trailer, byte for byte in history', async () => {
    const id = `LearningNeed/by-agent-${stamp}`;
    const res = await json(await call(forDesigner)('PUT', `/documents/${id}?branch=${BRANCH}`, doc('Drafted')));
    expect(res.status).toBe(200);
    const stored = (await json(await on('GET', `/documents/${id}?branch=${BRANCH}`))).body;
    expect(stored.createdBy).toBe(agentUserId);
    const head = (await json(await on('GET', `/branches/${BRANCH}`))).body.head;
    expect(head.author).toBe(agentUserId);
    expect(head.message).toBe('Drafted by the agent\n\nArmature-On-Behalf-Of: demo-designer@example.edu');
    const history = (await json(await on('GET', `/documents/${id}/history?branch=${BRANCH}&diff=false`))).body;
    expect(history.entries[0].message).toBe('Drafted by the agent\n\nArmature-On-Behalf-Of: demo-designer@example.edu');
  });

  it('joins an existing trailer block rather than starting a second paragraph', async () => {
    const id = `LearningNeed/by-agent-co-${stamp}`;
    const message = 'Dictated beside the designer\n\nCo-Authored-By: A Subject Expert';
    expect((await call(forDesigner)('PUT', `/documents/${id}?branch=${BRANCH}`, doc('Dictated', message))).status).toBe(200);
    const head = (await json(await on('GET', `/branches/${BRANCH}`))).body.head;
    expect(head.message).toBe(`${message}\nArmature-On-Behalf-Of: demo-designer@example.edu`);
  });

  it("authority is the person's: the agent may do for the reviewer only what the reviewer may", async () => {
    const forReviewer = asAgentFor('demo-reviewer@example.edu');
    const E = `test-authz-agent-for-${stamp}`;
    expect((await on('POST', '/branches', { name: E })).status).toBe(201); // the designer's
    const refused = await json(await call(forReviewer)('PUT', `/documents/LearningNeed/af-${stamp}?branch=${E}`, doc('x')));
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'forbidden', permission: 'write', branch: E });
    expect(refused.body.message).toContain('demo-reviewer@example.edu');
  });

  it('a branch the agent creates for a person is owned by the person, in a commit the agent authored', async () => {
    const B = `test-authz-agent-made-${stamp}`;
    expect((await call(forDesigner)('POST', '/branches', { name: B })).status).toBe(201);
    const owner = (await json(await on('GET', '/documents/Grant?role=Owner'))).body.find((g: TerminusDocument) => g.branch === B);
    expect(owner).toMatchObject({ user: DESIGNER, status: 'Active' });
    const head = (await json(await on('GET', '/branches/main'))).body.head;
    expect(head.author).toBe(agentUserId);
    expect(head.message).toContain('Armature-On-Behalf-Of: demo-designer@example.edu');
  });

  it("refuses the hub's own trailers from a client, on every write envelope (decision 6)", async () => {
    for (const line of ['Armature-On-Behalf-Of: someone@example.edu', 'armature-relayed-by: agent:x']) {
      const res = await json(await on('PUT', `/documents/LearningNeed/rt-${stamp}?branch=${BRANCH}`, doc('x', `Forged\n\n${line}`)));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('reserved_trailer');
    }
    const merge = await json(await on('POST', `/branches/${BRANCH}/merge`, { message: `Merge\n\nArmature-On-Behalf-Of: x`, from: 'main' }));
    expect(merge.body.error).toBe('reserved_trailer');
    const register = await json(await on('POST', '/users', { message: 'Armature-Relayed-By: agent:x', user: { displayName: 'x', externalId: `x-${stamp}` } }));
    expect(register.body.error).toBe('reserved_trailer');
  });

  it('refuses an unregistered agent, a person named as the agent, and an agent as the credential', async () => {
    const unknown = await json(await call({ ...forDesigner, 'Armature-Agent': `agent:test/none-${stamp}` })('PUT', `/documents/LearningNeed/u-${stamp}?branch=${BRANCH}`, doc('x')));
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe('unknown_agent');
    const person = await json(await call({ ...forDesigner, 'Armature-Agent': 'demo-reviewer@example.edu' })('PUT', `/documents/LearningNeed/u-${stamp}?branch=${BRANCH}`, doc('x')));
    expect(person.status).toBe(400);
    expect(person.body.error).toBe('not_an_agent');
    const agentCredential = await json(await call(asAgentFor(AGENT_EXTERNAL_ID))('PUT', `/documents/LearningNeed/u-${stamp}?branch=${BRANCH}`, doc('x')));
    expect(agentCredential.status).toBe(400);
    expect(agentCredential.body.error).toBe('not_a_person');
  });

  it('@armature/client sends the agent with its agent option', async () => {
    const client = createClient({
      baseUrl: 'http://localhost',
      user: 'demo-designer@example.edu',
      agent: AGENT_EXTERNAL_ID,
      fetch: (input, init) => hub.request(input, init),
    });
    const id = `client-agent-${stamp}`;
    const { data } = await client.documents.put('LearningNeed', id, { branch: BRANCH, message: 'Through the client', document: { label: 'x', rationale: 'r' } });
    expect(data.commit).toMatch(/^[a-z0-9]+$/);
    expect((await json(await on('GET', `/documents/LearningNeed/${id}?branch=${BRANCH}`))).body.createdBy).toBe(agentUserId);
  });
});
