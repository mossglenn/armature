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
import { paramsHash } from './checks';

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
  // Two commits, so that every asOf names a commit this copy holds (constraint 13; the
  // merge route checks the whole branch since 2026-11-01): the undated records first,
  // then the dated ones with their asOf naming that commit, where their subjects exist.
  const { commit: undated } = await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf === undefined),
    { author: DESIGNER, message: 'The seed, for the authorization suite' }
  );
  await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf !== undefined).map((doc) => ({ ...doc, asOf: undated })),
    { author: DESIGNER, message: "The seed's dated records, for the authorization suite" }
  );
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
    expect(relay.body).toMatchObject({ role: 'Relay', relayedUsers: [REVIEWER] });
    // The instant, not the text: the store writes a time without the trailing zeros of its fraction, so one in ten differs as a string.
    expect(Date.parse(relay.body.expires)).toBe(Date.parse(expires));
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
    // Since 2026-11-20 a merge into main is made through a merge request (ADR-0072 decision 5): the designer's
    // direct merge is refused for that, not for want of authority, and the request is theirs to merge and not the reviewer's.
    const direct = await json(await on('POST', '/branches/main/merge', { message: 'Deliver', from: M }));
    expect(direct.status).toBe(409);
    expect(direct.body.error).toBe('request_required');
    const opened = await json(await on('POST', '/merge-requests', { source: M, target: 'main', message: 'Deliver' }));
    expect(opened.status).toBe(201);
    const id = opened.body['@id'].split('/')[1];
    await forbidden(await reviewer('POST', `/merge-requests/${id}/merge`), { permission: 'merge', branch: 'main' });
    const merged = await json(await on('POST', `/merge-requests/${id}/merge`));
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

describe("CheckRequirement documents through the routes (ADR-0070 decision 5; ADR-0068 decision 4's row)", () => {
  const asReviewer = { 'Content-Type': 'application/json', 'Armature-User': 'demo-reviewer@example.edu' };
  const REPORTER = `agent:test/lint-${stamp}`;
  const asReporter = { 'Content-Type': 'application/json', 'Armature-User': REPORTER };
  // What the permissions suite left: the reviewer owns MINE, maintains BRANCH and holds nothing on main.
  const MINE = `test-authz-reviewers-${stamp}`;
  const as = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) =>
    hub.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const reviewer = as(asReviewer);
  const reporter = as(asReporter);
  let agentId = '';
  const requirement = (fields: Record<string, unknown>) => ({
    '@type': 'CheckRequirement',
    reporter: agentId,
    level: 'Required',
    locked: false,
    params: { severity: 'error' },
    status: 'Active',
    ...fields,
  });
  const forbidden = async (res: Response, details: Record<string, unknown>) => {
    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body).toMatchObject({ error: 'forbidden', ...details });
    return body;
  };

  beforeAll(async () => {
    const registered = await json(await on('POST', '/users', { message: 'A lint service for the tests', user: { displayName: 'Lint (test)', externalId: REPORTER } }));
    expect(registered.status).toBe(201);
    agentId = registered.body.id;
  });

  it('lives on main whatever branch it binds (constraint 23), judged before the permission reads anything', async () => {
    const res = await json(await reviewer('POST', `/documents?branch=${MINE}`, { message: 'x', documents: [requirement({ check: `test/here-${stamp}`, branch: MINE })] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('requirements_live_on_main');
  });

  it("a branch's owner requires a check of merges into it, on main, without the right to write main", async () => {
    const written = await json(await reviewer('POST', '/documents', { message: 'Lint before anything merges here', documents: [requirement({ check: `test/lint-${stamp}`, branch: MINE })] }));
    expect(written.status).toBe(200);
    expect(written.body.ids[0]).toMatch(/^CheckRequirement\/[0-9a-f]{64}$/);
    // The requirement alone is judged by its record; anything beside it needs main.
    await forbidden(
      await reviewer('POST', '/documents', {
        message: 'x',
        documents: [requirement({ check: `test/beside-${stamp}`, branch: MINE }), { '@type': 'LearningNeed', '@id': `LearningNeed/beside-${stamp}`, label: 'b', rationale: 'r' }],
      }),
      { permission: 'write', branch: 'main' }
    );
    // A maintainer of the branch, not its owner, may too.
    expect((await reviewer('POST', '/documents', { message: 'x', documents: [requirement({ check: `test/lint-${stamp}`, branch: BRANCH })] })).status).toBe(200);
  });

  it('merges into main are the maintainers of main to gate; the refusal names the target', async () => {
    const body = await forbidden(await reviewer('POST', '/documents', { message: 'x', documents: [requirement({ check: `test/lint-${stamp}` })] }), {
      permission: 'write_requirement',
      branch: 'main',
      locked: false,
    });
    expect(body.message).toContain('Maintainer of main');
    expect((await write([requirement({ check: `test/lint-${stamp}` })], 'Lint gates main')).status).toBe(200);
  });

  it('a locked requirement is an administrator\'s, on the record written and on the one it replaces', async () => {
    const locked = requirement({ check: `test/locked-${stamp}`, branch: MINE, locked: true });
    await forbidden(await reviewer('POST', '/documents', { message: 'x', documents: [locked] }), { permission: 'write_requirement', branch: MINE, locked: true });
    const written = await json(await write([locked], 'Locked by the administrator'));
    expect(written.status).toBe(200);
    // The owner of MINE may write an unlocked requirement for it, but not by unlocking this one: `locked` is not in the key, so the stored record is read.
    await forbidden(await reviewer('POST', '/documents', { message: 'x', documents: [requirement({ check: `test/locked-${stamp}`, branch: MINE, locked: false })] }), {
      permission: 'write_requirement',
      branch: MINE,
      locked: true,
    });
    expect((await write([requirement({ check: `test/locked-${stamp}`, branch: MINE, locked: false })], 'Unlocked')).status).toBe(200);
    // Unlocked, it is the owner's to withdraw, as a grant is: a replace under the same key, never a delete.
    const revoked = await json(
      await reviewer('POST', '/documents', { message: 'Withdrawn', documents: [requirement({ check: `test/locked-${stamp}`, branch: MINE, status: 'Revoked', rationale: 'No longer wanted' })] })
    );
    expect(revoked.status).toBe(200);
    expect(revoked.body.ids[0]).toBe(written.body.ids[0]);
  });

  it('a branch with no owner gets no requirement but from a maintainer, migration window or not', async () => {
    const OWNERLESS = `test-authz-unclaimed-${stamp}`;
    await scratch('main').createBranch(OWNERLESS, { branch: 'main' });
    await forbidden(await reviewer('POST', '/documents', { message: 'x', documents: [requirement({ check: `test/lint-${stamp}`, branch: OWNERLESS })] }), {
      permission: 'write_requirement',
      branch: OWNERLESS,
      locked: false,
    });
    expect((await write([requirement({ check: `test/lint-${stamp}`, branch: OWNERLESS })], 'The designer maintains every branch')).status).toBe(200);
  });

  it('an agent as the credential itself writes none (ADR-0067 decision 10); requirements are listed by reporter, never by branch', async () => {
    await forbidden(await reporter('POST', '/documents', { message: 'x', documents: [requirement({ check: `test/self-${stamp}`, branch: MINE })] }), {
      permission: 'write_requirement',
      credential: REPORTER,
    });
    const byReporter = await json(await on('GET', `/documents/CheckRequirement?reporter=${agentId}`));
    expect(byReporter.status).toBe(200);
    expect(byReporter.body.map((r: TerminusDocument) => [r.check, r.branch ?? 'main', r.status]).sort()).toEqual(
      [
        [`test/lint-${stamp}`, MINE, 'Active'],
        [`test/lint-${stamp}`, BRANCH, 'Active'],
        [`test/lint-${stamp}`, 'main', 'Active'],
        [`test/locked-${stamp}`, MINE, 'Revoked'],
        [`test/lint-${stamp}`, `test-authz-unclaimed-${stamp}`, 'Active'],
      ].sort()
    );
    // `branch` in the query names the branch read (docs/api.md), where no requirement lives, never
    // the field: a client filters main's list itself until `GET /checks/requirements?target=` (ADR-0070 decision 5).
    expect((await json(await on('GET', `/documents/CheckRequirement?branch=${MINE}`))).body).toEqual([]);
    const forMine = byReporter.body.filter((r: TerminusDocument) => r.branch === MINE).map((r: TerminusDocument) => r.check);
    expect(forMine.sort()).toEqual([`test/lint-${stamp}`, `test/locked-${stamp}`]);
  });

  it('exports requirements in the full slice, and the pseudonymous profile rewrites the reporter', async () => {
    const mine = (d: TerminusDocument) => d['@type'] === 'CheckRequirement' && d.branch === MINE;
    const full = (await json(await on('GET', '/export'))).body;
    const requirements = full.documents.filter(mine);
    expect(requirements.map((r: TerminusDocument) => r.check).sort()).toEqual([`test/lint-${stamp}`, `test/locked-${stamp}`]);
    expect(requirements.every((r: TerminusDocument) => r.reporter === agentId)).toBe(true);
    expect(full.armature.unresolved).toEqual([]);
    const hidden = (await json(await on('GET', '/export?profile=pseudonymous'))).body.documents.filter(mine);
    expect(hidden.length).toBe(requirements.length);
    for (const r of hidden) {
      expect(r.reporter).toMatch(/^User\/[0-9a-f]{32}$/);
      expect(r.params).toEqual(requirements.find((f: TerminusDocument) => f['@id'] === r['@id']).params);
    }
  });

  it('GET /checks/requirements answers which apply to a merge into a target from a source: by target, by lock, by prefix, each with its paramsHash (ADR-0070 decisions 3 and 5)', async () => {
    // A requirement bound to review-round branches only, and a locked one that binds every target.
    expect((await write([requirement({ check: `test/rounds-${stamp}`, branch: MINE, fromPrefix: 'coqui-', params: { b: 1, a: [1.0] } })], 'Rounds only')).status).toBe(200);
    expect((await write([requirement({ check: `test/everywhere-${stamp}`, branch: BRANCH, locked: true })], 'Everywhere')).status).toBe(200);
    const read = async (query: string) => json(await reviewer('GET', `/checks/requirements?${query}`));
    const byCheck = (body: { requirements: Array<{ check: string }> }) => body.requirements.map((r) => r.check).sort();

    const fromRound = await read(`target=${MINE}&from=coqui-round-7`);
    expect(fromRound.status).toBe(200);
    expect(byCheck(fromRound.body)).toEqual([`test/everywhere-${stamp}`, `test/lint-${stamp}`, `test/rounds-${stamp}`]);
    const rounds = fromRound.body.requirements.find((r: TerminusDocument) => r.check === `test/rounds-${stamp}`);
    expect(rounds.paramsHash).toBe(paramsHash({ a: [1], b: 1 })); // over the value as the store returns it, not the text sent
    expect(rounds.level).toBe('Required');
    // Another source: the prefixed requirement drops out; no source: it stays for the client to filter.
    expect(byCheck((await read(`target=${MINE}&from=${BRANCH}`)).body)).toEqual([`test/everywhere-${stamp}`, `test/lint-${stamp}`]);
    expect(byCheck((await read(`target=${MINE}`)).body)).toEqual([`test/everywhere-${stamp}`, `test/lint-${stamp}`, `test/rounds-${stamp}`]);
    // main is the default target; the revoked requirement is never listed; a locked one reaches a branch no requirement names.
    const toMain = await read('');
    expect(toMain.body.target).toBe('main');
    expect(byCheck(toMain.body)).toEqual([`test/everywhere-${stamp}`, `test/lint-${stamp}`]);
    expect(byCheck((await read(`target=test-nothing-${stamp}`)).body)).toEqual([`test/everywhere-${stamp}`]);
    expect((await read('target=not a branch')).status).toBe(400);
  });

  it('the event feed tells a requirement written as requirement.changed, naming the record, beside its commit on main (ADR-0070 decision 2)', async () => {
    const { cursor } = (await json(await on('GET', '/events'))).body;
    const written = await json(await reviewer('POST', '/documents', { message: 'A second check here', documents: [requirement({ check: `test/feed-${stamp}`, branch: MINE })] }));
    expect(written.status).toBe(200);
    const { events } = (await json(await on('GET', `/events?since=${cursor}&wait=0`))).body;
    expect(events).toEqual([
      expect.objectContaining({ type: 'commit', branch: 'main', commit: written.body.commit, changed: { CheckRequirement: 1 } }),
      { type: 'requirement.changed', branch: 'main', commit: written.body.commit, requirements: written.body.ids },
    ]);
    // It concerns every branch, so a plugin following one branch is still told.
    const following = (await json(await on('GET', `/events?since=${cursor}&wait=0&branch=${MINE}`))).body;
    expect(following.events.map((e: { type: string }) => e.type)).toEqual(['requirement.changed']);
  });
});

describe('the merge gate (ADR-0070 decisions 6 and 7)', () => {
  const asReviewer = { 'Content-Type': 'application/json', 'Armature-User': 'demo-reviewer@example.edu' };
  const REPORTER = `agent:test/gate-${stamp}`;
  const as = (headers: Record<string, string>) => (method: string, path: string, body?: unknown) =>
    hub.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const reviewer = as(asReviewer);
  const service = as({ 'Content-Type': 'application/json', 'Armature-User': REPORTER });
  const TARGET = `test-gate-${stamp}`;
  const LINT = `gate/lint-${stamp}`;
  const ADVICE = `gate/advice-${stamp}`;
  const PARAMS = { severity: 'error' };
  let agentId = '';
  let n = 0;

  const requirement = (fields: Record<string, unknown>) => ({ '@type': 'CheckRequirement', reporter: agentId, level: 'Required', locked: false, params: PARAMS, status: 'Active', ...fields });
  /** A branch cut from `from` with one commit of its own; its name and head. */
  const work = async (from: string, who = on) => {
    const name = `${TARGET}-s${++n}`;
    expect((await who('POST', '/branches', { name, from: { branch: from } })).status).toBe(201);
    const written = await json(await who('PUT', `/documents/LearningNeed/gate-${stamp}-${n}?branch=${name}`, { message: 'Work to merge', document: { label: `Gate ${n}`, rationale: 'r' } }));
    expect(written.status).toBe(200);
    return { name, head: written.body.commit as string };
  };
  const merge = async (target: string, from: string, extra: Record<string, unknown> = {}, who = on) => json(await who('POST', `/branches/${target}/merge`, { message: `Merge ${from}`, from, ...extra }));
  const report = (branch: string, commit: string, conclusion: string, extra: Record<string, unknown> = {}, who = service) =>
    who('POST', '/checks/runs', { check: LINT, branch, commit, conclusion, paramsHash: paramsHash(PARAMS), ...extra });
  const headMessage = async (branch: string) => (await json(await on('GET', `/branches/${branch}/log?count=1`))).body.commits[0].message as string;

  beforeAll(async () => {
    const registered = await json(await on('POST', '/users', { message: 'A check service for the gate', user: { displayName: 'Gate (test)', externalId: REPORTER } }));
    expect(registered.status).toBe(201);
    agentId = registered.body.id;
    expect((await on('POST', '/branches', { name: TARGET })).status).toBe(201);
    // The groups above leave a locked requirement in force, which binds every merge: withdrawn, as an administrator would.
    const left = (await json(await on('GET', `/checks/requirements?target=${TARGET}`))).body.requirements as Array<Record<string, unknown>>;
    for (const requirement of left) {
      // The key fields find the record; a Hash-keyed write carries no id, and paramsHash is the read's, not the record's.
      const record: Record<string, unknown> = { ...requirement, status: 'Revoked', rationale: 'Withdrawn before the gate is tested' };
      delete record['@id'];
      delete record.paramsHash;
      expect((await write([record], 'Withdraw')).status).toBe(200);
    }
  });

  it('a merge no requirement applies to is as before: no checks in the answer, no trailer on the commit', async () => {
    const source = await work(TARGET);
    const merged = await merge(TARGET, source.name);
    expect(merged.status).toBe(200);
    expect(merged.body).not.toHaveProperty('checks');
    expect(await headMessage(TARGET)).toBe(`Merge ${source.name}`);
  });

  it('with a required check and no run at the source head: 409 checks_pending, and the dry run says the same without refusing', async () => {
    expect((await write([requirement({ check: LINT, branch: TARGET })], 'Lint before anything merges here')).status).toBe(200);
    const source = await work(TARGET);
    const refused = await merge(TARGET, source.name);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ error: 'checks_pending', pending: [LINT], source: source.head });
    expect(refused.body.checks).toEqual([
      { check: LINT, requirement: expect.stringMatching(/^CheckRequirement\//), level: 'Required', locked: false, reporter: agentId, paramsHash: paramsHash(PARAMS), conclusion: 'pending', satisfied: false },
    ]);
    const dry = await merge(TARGET, source.name, { dryRun: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ dryRun: true, bringInFirst: false, conflicts: [], violations: [] });
    expect(dry.body.checks[0]).toMatchObject({ check: LINT, conclusion: 'pending', satisfied: false });

    // A run by anyone but the requirement's reporter is advisory, and one under other settings is stale: neither counts.
    expect((await report(source.name, source.head, 'pass', {}, on)).status).toBe(201);
    expect((await report(source.name, source.head, 'pass', { paramsHash: paramsHash({ severity: 'warn' }) })).status).toBe(201);
    expect((await merge(TARGET, source.name)).body.error).toBe('checks_pending');

    // The reporter's own, failing: 422 checks_failed, naming the run and where its detail is; the target unchanged.
    const before = (await json(await on('GET', `/branches/${TARGET}`))).body.head.commit;
    const failing = await json(await report(source.name, source.head, 'fail', { summary: '2 required', detailsUrl: 'https://lint.example.edu/runs/7' }));
    const failed = await merge(TARGET, source.name);
    expect(failed.status).toBe(422);
    expect(failed.body).toMatchObject({ error: 'checks_failed', failed: [LINT] });
    expect(failed.body.checks[0]).toMatchObject({ conclusion: 'fail', satisfied: false, run: { id: failing.body.id, summary: '2 required', detailsUrl: 'https://lint.example.edu/runs/7' } });
    expect((await json(await on('GET', `/branches/${TARGET}`))).body.head.commit).toBe(before);

    // An override is a list of { check, reason } naming a required check of this merge.
    for (const overrides of ['yes', [{ check: LINT }], [{ check: LINT, reason: ' ' }], [{ check: LINT, reason: 'a' }, { check: LINT, reason: 'b' }], [{ check: `gate/other-${stamp}`, reason: 'x' }]]) {
      const bad = await merge(TARGET, source.name, { overrides });
      expect(bad.status, JSON.stringify(overrides)).toBe(400);
      expect(bad.body.error).toBe('bad_request');
    }
    // Whoever may merge overrides an unlocked requirement, with a reason; the commit records both.
    const overridden = await merge(TARGET, source.name, { overrides: [{ check: LINT, reason: 'The two findings are\nfalse positives; see "note 12"' }] });
    expect(overridden.status).toBe(200);
    expect(overridden.body.checks[0]).toMatchObject({ conclusion: 'fail', overridden: { reason: 'The two findings are\nfalse positives; see "note 12"' } });
    expect(await headMessage(TARGET)).toBe(
      [
        `Merge ${source.name}`,
        '',
        `Armature-Check: ${LINT} fail run=${failing.body.id} params=${paramsHash(PARAMS)} overridden`,
        `Armature-Check-Override: ${LINT} reason="The two findings are false positives; see \\"note 12\\""`,
      ].join('\n')
    );
  });

  it('a passing run by the reporter at the source head opens the gate; an advisory requirement is shown and recorded, and never refuses', async () => {
    expect((await write([requirement({ check: ADVICE, branch: TARGET, level: 'Advisory' })], 'Shown, never required')).status).toBe(200);
    const source = await work(TARGET);
    const run = await json(await report(source.name, source.head, 'neutral'));
    const merged = await merge(TARGET, source.name);
    expect(merged.status).toBe(200);
    const byCheck = Object.fromEntries(merged.body.checks.map((v: { check: string }) => [v.check, v]));
    expect(byCheck[LINT]).toMatchObject({ conclusion: 'neutral', satisfied: true, run: { id: run.body.id } });
    expect(byCheck[LINT]).not.toHaveProperty('overridden');
    expect(byCheck[ADVICE]).toMatchObject({ level: 'Advisory', conclusion: 'pending', satisfied: false });
    const message = await headMessage(TARGET);
    expect(message).toContain(`Armature-Check: ${LINT} neutral run=${run.body.id} params=${paramsHash(PARAMS)}`);
    expect(message).toContain(`Armature-Check: ${ADVICE} pending params=${paramsHash(PARAMS)} advisory`);
    expect(message).not.toContain('Armature-Check-Override');
  });

  it('an override given where the check passes is not used: the commit records the pass', async () => {
    const source = await work(TARGET);
    await report(source.name, source.head, 'pass');
    const merged = await merge(TARGET, source.name, { overrides: [{ check: LINT, reason: 'In case it fails' }] });
    expect(merged.status).toBe(200);
    expect(await headMessage(TARGET)).not.toContain('overridden');
  });

  it('the source must hold the target\'s head: 409 bring_in_first before anything else, until the target is merged in and the check runs on the result', async () => {
    const source = await work(TARGET);
    await report(source.name, source.head, 'pass');
    // The target moves on: a pass at the source's head no longer describes what would land.
    expect((await on('PUT', `/documents/LearningNeed/gate-ahead-${stamp}?branch=${TARGET}`, { message: 'Meanwhile', document: { label: 'Ahead', rationale: 'r' } })).status).toBe(200);
    const refused = await merge(TARGET, source.name);
    expect(refused.status).toBe(409);
    expect(refused.body.error).toBe('bring_in_first');
    expect((await merge(TARGET, source.name, { dryRun: true })).body).toMatchObject({ bringInFirst: true });
    // Bringing the target in is a merge into the source, which no requirement binds.
    const broughtIn = await merge(source.name, TARGET);
    expect(broughtIn.status).toBe(200);
    expect(broughtIn.body).not.toHaveProperty('checks');
    expect((await merge(TARGET, source.name)).body.error).toBe('checks_pending');
    await report(source.name, broughtIn.body.commit, 'pass');
    expect((await merge(TARGET, source.name)).status).toBe(200);
  });

  it('a merge from main is not gated: it is how a branch brings main in', async () => {
    const merged = await merge(TARGET, 'main');
    expect(merged.status).toBe(200);
    expect(merged.body.upToDate).toBe(false);
    expect(merged.body).not.toHaveProperty('checks');
  });

  it("refuses the gate's trailers from a client (400 reserved_trailer)", async () => {
    for (const line of [`Armature-Check: ${LINT} pass`, `Armature-Check-Override: ${LINT} reason="mine"`]) {
      const res = await json(await on('POST', `/branches/${TARGET}/merge`, { message: `Merge\n\n${line}`, from: 'main' }));
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('reserved_trailer');
    }
  });

  it('a locked requirement binds merges into every branch, and only an administrator overrides it', async () => {
    const LOCKED = `gate/locked-${stamp}`;
    const theirs = `${TARGET}-reviewers`;
    expect((await reviewer('POST', '/branches', { name: theirs })).status).toBe(201);
    const source = await work(theirs, reviewer);
    expect((await write([requirement({ check: LOCKED, branch: TARGET, locked: true })], 'Everywhere')).status).toBe(200);
    try {
      expect((await merge(theirs, source.name, {}, reviewer)).body).toMatchObject({ error: 'checks_pending', pending: [LOCKED] });
      // The branch's owner may merge into it, and may not set a locked requirement aside.
      const refused = await merge(theirs, source.name, { overrides: [{ check: LOCKED, reason: 'Mine to decide' }] }, reviewer);
      expect(refused.status).toBe(403);
      expect(refused.body).toMatchObject({ error: 'forbidden', permission: 'override_check', branch: theirs, check: LOCKED, locked: true });
      const merged = await merge(theirs, source.name, { overrides: [{ check: LOCKED, reason: 'The service is down today' }] });
      expect(merged.status).toBe(200);
      expect(await headMessage(theirs)).toContain(`Armature-Check-Override: ${LOCKED} reason="The service is down today"`);
    } finally {
      expect((await write([requirement({ check: LOCKED, branch: TARGET, locked: true, status: 'Revoked', rationale: 'The test is over' })], 'Withdraw')).status).toBe(200);
    }
  });
});
