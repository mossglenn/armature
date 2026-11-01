/**
 * Export profiles and schema slices (ADR-0031; plan §4 Phase 6).
 *
 * Phase 6's exit criterion: an export at a commit, re-imported into an empty
 * database, reproduces the graph, and the pseudonymous profile carries no
 * displayName or email. Integration tests against the running container with
 * the seed loaded. The reproduction test stands up an empty branch through the
 * adapter's operator-side methods, as an operator would (ADR-0062), and deletes
 * it afterwards; `main` is untouched.
 */
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { app } from './app';
import { canonical } from './fragments';
import { createOperatorStore, createStore, type TerminusDocument } from './store';

const stamp = Date.now().toString(36);
const get = (path: string) => app.request(path);
const json = async (path: string) => {
  const res = await get(path);
  expect(res.status).toBe(200);
  return { body: await res.json(), etag: res.headers.get('etag')?.replace(/"/g, '') };
};

interface Export {
  '@context': Record<string, unknown>;
  armature: { ref: string; profile: string; slice: string; pseudonyms: string; counts: { documents: number; byType: Record<string, number> }; unresolved: unknown[] };
  schema: Array<Record<string, unknown>>;
  documents: TerminusDocument[];
}

const byId = (docs: TerminusDocument[]) => new Map(docs.map((d) => [d['@id'], canonical(d)]));

describe('GET /api/v1/export (ADR-0031)', () => {
  const savedKey = process.env.ARMATURE_EXPORT_KEY;
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ARMATURE_EXPORT_KEY;
    else process.env.ARMATURE_EXPORT_KEY = savedKey;
  });

  it('lists the declared slices', async () => {
    const { body } = await json('/api/v1/export/slices');
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['full', 'outcomes-loop', 'review']));
    expect(body.full.classes).toEqual(['DesignRecord', 'User', 'Grant']);
  });

  it('exports the whole graph at a ref: context, reloadable schema, every document, no unresolved reference', async () => {
    const { body, etag } = await json('/api/v1/export');
    const out = body as Export;
    expect(out.armature).toMatchObject({ ref: etag, profile: 'full', slice: 'full', pseudonyms: 'none', unresolved: [] });
    expect(out['@context']).toMatchObject({ '@type': '@context', '@base': 'http://armature.design/data/' });
    expect(out.schema.some((e) => e['@id'] === 'AssessmentItem')).toBe(true);
    // The store's decoration is gone (platform check AE5), so the schema reloads.
    expect(JSON.stringify(out.schema)).not.toContain('"@max_cardinality":"inf"');
    expect(out.documents.length).toBeGreaterThanOrEqual(66);
    expect(out.armature.counts.documents).toBe(out.documents.length);
    const user = out.documents.find((d) => d['@type'] === 'User')!;
    expect(user).toMatchObject({ '@id': 'User/demo-designer', displayName: 'Demo Designer' });

    const atRef = await json(`/api/v1/export?ref=${etag}`);
    expect((atRef.body as Export).armature.ref).toBe(etag);
  });

  it('refuses an unknown profile or slice', async () => {
    expect((await get('/api/v1/export?profile=anonymous')).status).toBe(400);
    expect((await (await get('/api/v1/export?profile=anonymous')).json()).error).toBe('unknown_profile');
    expect((await (await get('/api/v1/export?slice=everything')).json()).error).toBe('unknown_slice');
  });

  it('pseudonymous: no displayName, email or original user id; the same key gives the same tokens, no key gives per-export ones', async () => {
    process.env.ARMATURE_EXPORT_KEY = `test-key-${stamp}`;
    const first = (await json('/api/v1/export?profile=pseudonymous')).body as Export;
    const text = JSON.stringify(first.documents);
    expect(text).not.toContain('displayName');
    expect(text).not.toContain('"email"');
    expect(text).not.toContain('demo-designer');
    expect(first.armature.pseudonyms).toBe('stable');
    const users = first.documents.filter((d) => d['@type'] === 'User');
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(Object.keys(u).sort()).toEqual(['@id', '@type', 'externalId']);
      expect(u['@id']).toMatch(/^User\/[0-9a-f]{32}$/);
      expect(u['@id']).toBe(`User/${String(u.externalId)}`);
    }
    const userIds = new Set(users.map((u) => u['@id']));
    // The seed names its two people in createdBy (the designer, and the reviewer on the
    // finding) and the reviewer in attestedBy. Every user reference must be a token, and
    // two people stay two tokens.
    const authored = first.documents.filter((d) => typeof d.createdBy === 'string');
    expect(authored.length).toBeGreaterThan(0);
    for (const d of authored) expect(userIds.has(String(d.createdBy))).toBe(true);
    expect(new Set(authored.map((d) => d.createdBy)).size).toBe(2);
    const attested = first.documents.filter((d) => d['@type'] === 'Attestation');
    expect(attested.length).toBeGreaterThan(0);
    for (const a of attested) expect(userIds.has(String(a.attestedBy))).toBe(true);
    expect(first.armature.unresolved).toEqual([]);

    const second = (await json('/api/v1/export?profile=pseudonymous')).body as Export;
    expect(second.documents.filter((d) => d['@type'] === 'User').map((u) => u['@id']).sort()).toEqual([...userIds].sort());

    delete process.env.ARMATURE_EXPORT_KEY;
    const third = (await json('/api/v1/export?profile=pseudonymous')).body as Export;
    expect(third.armature.pseudonyms).toBe('per-export');
    const thirdIds = third.documents.filter((d) => d['@type'] === 'User').map((u) => u['@id']);
    expect(thirdIds.some((id) => userIds.has(id))).toBe(false);
  });

  it('institutional: the token and the institution, nothing else about the person', async () => {
    const out = (await json('/api/v1/export?profile=institutional')).body as Export;
    const user = out.documents.find((d) => d['@type'] === 'User')!;
    expect(Object.keys(user).sort()).toEqual(['@id', '@type', 'externalId', 'institution']);
    expect(user.institution).toBe('Example University');
    const institutions = out.documents.filter((d) => d['@type'] === 'User').map((u) => u.institution);
    expect(new Set(institutions)).toEqual(new Set(['Example University', 'Partner College']));
    expect(JSON.stringify(out.documents)).not.toContain('Demo Designer');
  });

  it('a slice keeps only its classes and reports references that leave it', async () => {
    const out = (await json('/api/v1/export?slice=outcomes-loop')).body as Export;
    const types = new Set(out.documents.map((d) => d['@type']));
    expect(types.has('DesignNote')).toBe(false);
    expect(types.has('Attestation')).toBe(false);
    expect(types.has('Module')).toBe(true);
    expect(types.has('AssessmentItem')).toBe(true);
    expect(types.has('User')).toBe(true);
    expect(Array.isArray(out.armature.unresolved)).toBe(true);
    const full = (await json('/api/v1/export')).body as Export;
    expect(out.documents.length).toBeLessThan(full.documents.length);

    const review = (await json('/api/v1/export?slice=review')).body as Export;
    const reviewTypes = new Set(review.documents.map((d) => d['@type']));
    expect(reviewTypes.has('Module')).toBe(false);
    expect(reviewTypes.has('Attestation')).toBe(true);
    // The seed's notes are about items and about other records; a subject outside the slice is reported, not dropped.
    for (const u of review.armature.unresolved as Array<{ id: string; field: string; target: string }>) {
      expect(review.documents.some((d) => d['@id'] === u.id)).toBe(true);
      expect(review.documents.some((d) => d['@id'] === u.target)).toBe(false);
    }
  });

  describe('reproduction (Phase 6 exit criterion)', () => {
    const BRANCH = `export-reimport-${stamp}`;
    afterAll(async () => {
      await createStore({ branch: 'main' }).deleteBranch(BRANCH).catch(() => undefined);
    });

    it('a full export at a commit, loaded into an empty branch, exports again as the same graph', async () => {
      const { body, etag } = await json('/api/v1/export');
      const source = body as Export;

      // The operator's steps (ADR-0062), through the adapter rather than any route.
      const store = createOperatorStore({ branch: BRANCH });
      await store.createEmptyBranch(BRANCH);
      await store.replaceSchema(source.schema, { author: 'User/demo-designer', message: `Schema from export at ${etag}` });
      await store.insertDocuments(source.documents, { author: 'User/demo-designer', message: `Documents from export at ${etag}` });

      const again = (await json(`/api/v1/export?branch=${BRANCH}`)).body as Export;
      expect(again.documents.length).toBe(source.documents.length);
      const a = byId(source.documents);
      const b = byId(again.documents);
      const differing = [...a.keys()].filter((id) => a.get(id) !== b.get(id));
      expect(differing).toEqual([]);
      expect([...b.keys()].filter((id) => !a.has(id))).toEqual([]);
      expect(again.armature.unresolved).toEqual([]);
      // The schema came through too: the same classes, in a form the store accepted.
      expect(again.schema.map((e) => e['@id']).sort()).toEqual(source.schema.map((e) => e['@id']).sort());
    });
  });
});
