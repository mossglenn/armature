/**
 * The two-store contract test (ADR-0066 decision 3 and Verification; the
 * workspace hub plan's §10): the seed loaded into the file-backed store, then
 * every read the API makes asked of both hubs, the seeded TerminusDB one and
 * one over the file store, with the same answers; the write pipeline run on
 * both with the same ids minted; and the operator's `check` over both. The
 * Hash ids of the seed are compared to what the file store mints from the
 * key fields, class by class (ADR-0066 decision 6, note of 2026-11-02).
 */
import { CLASS_CATEGORY, CLASS_KEY } from '@armature/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkBranch } from '../../operator/check';
import { deleteScratchBranch } from '../../operator/repair';
import { app, createApp } from '../app';
import { configFromEnv } from '../config';
import { canonical } from '../fragments';
import { createOperatorStore, type OperatorStore, type StoreConfig, type TerminusDocument } from '../store';
import { memoryFiles } from './files';
import { hashId, SchemaIndex } from './ids';
import { openFileStore } from './store';

const DESIGNER = 'demo-designer@example.edu';
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': DESIGNER };
const stamp = Date.now().toString(36);
const BRANCH = `test-contract-${stamp}`;
const REQUIREMENTS = `test-contract-requirements-${stamp}`;
/** Hash-keyed classes the seed holds no record of; each has its own test below. */
const NOT_SEEDED = ['CheckRequirement'];
/** A document's route path: the type, then the id's local part. */
const local = (id: string) => id.slice(id.indexOf('/') + 1);

let files: StoreConfig;
let fileHub: ReturnType<typeof createApp>;
let exported: { schema: Record<string, unknown>[]; documents: TerminusDocument[] };
let index: SchemaIndex;

const get = (hub: ReturnType<typeof createApp>, path: string) => hub.request(`/api/v1${path}`, { headers: HEADERS });
const post = (hub: ReturnType<typeof createApp>, path: string, body: unknown) =>
  hub.request(`/api/v1${path}`, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });

/**
 * A response body as compared across the two stores: without the commit ids
 * (`commit`, `ref`, `asOf`, which differ by construction), the export's
 * time, and the store-minted ids of parts (regenerated on every write; a
 * part's identity is its `fragmentId`, ADR-0033); arrays of identified
 * objects in id order and of edges or nodes in canonical order, since the two
 * stores list types in different orders and a walk follows the listing.
 */
function comparable(value: unknown): unknown {
  if (Array.isArray(value)) {
    const items = value.map(comparable);
    const idOf = (item: unknown): string | undefined => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined;
      const o = item as Record<string, unknown>;
      const id = o['@id'] ?? o.id;
      return typeof id === 'string' ? id : undefined;
    };
    if (items.every((item) => idOf(item) !== undefined)) return [...items].sort((a, b) => (idOf(a)! < idOf(b)! ? -1 : 1));
    // Edges and nodes of a read (objects with no `@type`) in canonical order; a document's parts keep theirs.
    const isPart = (item: unknown) => !item || typeof item !== 'object' || Array.isArray(item) || '@type' in (item as object);
    return items.some(isPart) ? items : [...items].sort((a, b) => (canonical(a) < canonical(b) ? -1 : 1));
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, held] of Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (key === 'commit' || key === 'ref' || key === 'asOf' || key === 'exportedAt') continue;
      if (key === '@id' && typeof held === 'string' && held.split('/').length > 2) continue;
      out[key] = comparable(held);
    }
    return out;
  }
  return value;
}

/** The same request of both hubs, the same answer. */
async function agree(path: string): Promise<void> {
  const [seed, file] = await Promise.all([get(app, path), get(fileHub, path)]);
  expect(file.status, path).toBe(seed.status);
  const [seedBody, fileBody] = await Promise.all([seed.json(), file.json()]);
  expect(comparable(fileBody), path).toEqual(comparable(seedBody));
}

beforeAll(async () => {
  exported = (await (await get(app, '/export')).json()) as typeof exported;
  const store = openFileStore(memoryFiles());
  files = { files: store };
  const main = createOperatorStore({ branch: 'main' }, files);
  await main.ensureDatabase();
  await main.replaceSchema(exported.schema, { author: 'User/demo-designer', message: 'The seed schema, for the contract suite' });
  // As cycle.test.ts loads its copy: the undated records first, then the dated ones with their asOf naming that commit.
  const dated = exported.documents.filter((doc) => doc.asOf !== undefined);
  const { commit } = await main.insertDocuments(
    exported.documents.filter((doc) => doc.asOf === undefined),
    { author: 'User/demo-designer', message: 'The seed, for the contract suite' }
  );
  await main.insertDocuments(
    dated.map((doc) => ({ ...doc, asOf: commit })),
    { author: 'User/demo-designer', message: 'The seed\'s dated records, for the contract suite' }
  );
  index = new SchemaIndex(exported.schema);
  fileHub = createApp(() => ({ ...configFromEnv(), store: () => files }));
});

afterAll(async () => {
  await deleteScratchBranch(BRANCH, { as: DESIGNER }).catch(() => undefined);
  await deleteScratchBranch(REQUIREMENTS, { as: DESIGNER }).catch(() => undefined);
});

describe('the ids the seed holds are the ids the file store mints (check AI)', () => {
  it('reproduces every Hash id in the seed from its key fields, class by class', async () => {
    const hashed = Object.entries(CLASS_KEY)
      .filter(([, key]) => (key as { type: string }).type === 'Hash')
      .map(([name]) => name);
    const compared = new Map<string, number>();
    for (const doc of exported.documents) {
      if (!hashed.includes(doc['@type'])) continue;
      expect(await hashId(index, doc), doc['@id']).toBe(doc['@id']);
      compared.set(doc['@type'], (compared.get(doc['@type']) ?? 0) + 1);
    }
    // The seed holds every Hash-keyed class, in each form its key takes (an absent Optional included),
    // but CheckRequirement, whose ids the next test mints on a scratch branch.
    expect([...compared.keys()].sort()).toEqual(hashed.filter((name) => !NOT_SEEDED.includes(name)).sort());
    expect(compared.get('Attestation')).toBeGreaterThan(0);
    expect(compared.get('Grant')).toBeGreaterThan(0);
  });

  it('reproduces a CheckRequirement\'s id in each form its key takes, as the store mints it (check AP1)', async () => {
    // The seed holds no CheckRequirement: one on main would bind merges once ADR-0070's gate is
    // built, and its reporter would be an agent the seed does not register. So the TerminusDB store
    // mints one of each key form here, on a scratch branch, through its operator side (no route,
    // since constraint 23 keeps requirements on main), and the file store's formula is held to it.
    // The branch has no Owner grant, which the operator's check reports, so it is gone before that
    // test runs.
    const server = createOperatorStore({ branch: 'main' });
    await server.createBranch(REQUIREMENTS, { branch: 'main' });
    try {
      const forms = [{}, { branch: 'b' }, { fromPrefix: 'b' }, { branch: 'release', fromPrefix: 'coqui-' }];
      await server.at({ branch: REQUIREMENTS }).insertDocuments(
        // No @id: the store mints a Hash-keyed record's id, which is what is compared.
        forms.map((form) => ({ '@type': 'CheckRequirement', check: 'lint/team', reporter: 'User/demo-designer', level: 'Advisory', locked: false, params: { n: 1 }, status: 'Revoked', ...form }) as unknown as TerminusDocument),
        { author: 'User/demo-designer', message: 'Contract: one requirement of each key form' }
      );
      const minted = (await server.at({ branch: REQUIREMENTS }).allDocuments()).documents.filter((doc) => doc['@type'] === 'CheckRequirement');
      expect(minted).toHaveLength(forms.length);
      for (const doc of minted) expect(await hashId(index, doc), doc['@id']).toBe(doc['@id']);
    } finally {
      await deleteScratchBranch(REQUIREMENTS, { as: DESIGNER });
    }
  });

  it('holds a Random-keyed document under the id the seed gave it, and every document the seed has', async () => {
    const main = createOperatorStore({ branch: 'main' }, files);
    const { documents } = await main.allDocuments();
    expect(documents.length).toBe(exported.documents.length);
    expect(documents.map((d) => d['@id']).sort()).toEqual(exported.documents.map((d) => d['@id']).sort());
  });
});

describe('every read of the API answers alike on both stores', () => {
  const classes = Object.entries(CLASS_CATEGORY)
    .filter(([, category]) => category === 'artifact' || category === 'relationship')
    .map(([name]) => name);

  it('the schema, the users and every type listed', async () => {
    await agree('/schema');
    await agree('/users');
    for (const type of classes) await agree(`/documents/${type}`);
  });

  it('every document by id', async () => {
    for (const doc of exported.documents) {
      if (doc['@type'] === 'User') continue;
      await agree(`/documents/${doc['@type']}/${local(doc['@id'])}`);
    }
  });

  it('coverage, alignment, item statistics and module content', async () => {
    await agree('/intelligence/coverage');
    await agree('/intelligence/alignment');
    await agree('/intelligence/item-statistics');
    for (const mod of exported.documents.filter((d) => d['@type'] === 'Module')) {
      await agree(`/intelligence/coverage/${local(mod['@id'])}`);
      await agree(`/intelligence/alignment?module=${mod['@id']}`);
      await agree(`/intelligence/module-content/${local(mod['@id'])}`);
    }
  });

  it('the trace, the attestations and the impact of a record', async () => {
    await agree('/intelligence/trace/LearningMetric/mod3-bias-type-difficulty');
    await agree('/intelligence/trace/AssessmentItem/bias-type-mc');
    for (const objective of exported.documents.filter((d) => d['@type'] === 'LearningObjective')) {
      await agree(`/intelligence/trace/LearningObjective/${local(objective['@id'])}`);
      await agree(`/intelligence/impact/LearningObjective/${local(objective['@id'])}`);
    }
    await agree('/intelligence/attestations/AssessmentItem/bias-type-mc');
    await agree('/intelligence/impact/AssessmentItem/bias-type-mc');
  });

  it('the export', async () => {
    await agree('/export');
  });
});

describe('the write pipeline and the operator’s check run alike on both stores', () => {
  const objective = 'LearningObjective/describe-model-training';
  const declaration = { '@type': 'ModuleObjective', module: 'Module/ai-in-learning-design', references: objective, role: 'Supporting', roleRationale: 'The contract test declares it.' };
  const attestation = { '@type': 'Attestation', subject: objective, verdict: 'Affirmed', reason: 'The contract test affirms it.' };

  it('creates the branch, writes a junction and an attestation and gets the same ids from both', async () => {
    for (const hub of [app, fileHub]) {
      expect((await post(hub, '/branches', { name: BRANCH, from: { branch: 'main' } })).status).toBe(201);
    }
    const results = await Promise.all(
      [app, fileHub].map(async (hub) => {
        const res = await post(hub, `/documents?branch=${BRANCH}`, { message: 'Contract: a declaration and an attestation', documents: [declaration, attestation] });
        return { status: res.status, body: (await res.json()) as { ids: string[] } };
      })
    );
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(results[1].body.ids).toEqual(results[0].body.ids);
    expect(results[0].body.ids[0]).toMatch(/^ModuleObjective\/[0-9a-f]{64}$/);
    expect(results[0].body.ids[1]).toMatch(/^Attestation\/[0-9a-f]{64}$/);
    for (const id of results[0].body.ids) {
      const path = `/documents/${id.split('/')[0]}/${local(id)}?branch=${BRANCH}`;
      const [seed, file] = await Promise.all([get(app, path), get(fileHub, path)]);
      expect(canonical(comparable(await file.json()))).toBe(canonical(comparable(await seed.json())));
    }
    // A replace through the pipeline finds the junction by its key and keeps its id.
    const again = await Promise.all(
      [app, fileHub].map(async (hub) => ((await (await post(hub, `/documents?branch=${BRANCH}`, { message: 'Contract: again', documents: [{ ...declaration, roleRationale: 'Revised.' }] })).json()) as { ids: string[] }).ids)
    );
    expect(again[0]).toEqual([results[0].body.ids[0]]);
    expect(again[1]).toEqual(again[0]);
  });

  it('refuses the same invariant on both', async () => {
    // Constraint 14: a claim reference without its text.
    const bad = { '@type': 'Attestation', subject: objective, verdict: 'Declined', claimRef: 'contract:half-a-claim' };
    const statuses = await Promise.all([app, fileHub].map(async (hub) => (await post(hub, `/documents?branch=${BRANCH}`, { message: 'bad', documents: [bad] })).status));
    expect(statuses).toEqual([422, 422]);
  });

  it('the operator’s check finds nothing to report on either main', async () => {
    const seedCheck = await checkBranch(createOperatorStore({ branch: 'main' }) as OperatorStore);
    const fileCheck = await checkBranch(createOperatorStore({ branch: 'main' }, files));
    expect(fileCheck.violations).toEqual(seedCheck.violations);
    expect(fileCheck.violations).toEqual([]);
  });
});
