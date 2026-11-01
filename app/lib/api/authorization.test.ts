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
