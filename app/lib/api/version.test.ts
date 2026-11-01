/**
 * The per-request version contract (ADR-0059): the two request headers, the
 * response header on every answer including errors, the discovery and schema
 * routes, and the two guards the ADR's consequences ask for: the revision list
 * agrees with docs/client-changes.md, and every route sits under a capability.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { app } from './app';
import { createStore } from './store';
import { CAPABILITIES, capabilitiesOf, CURRENT_REVISION, REVISIONS } from './version';

const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const stamp = Date.now().toString(36);

const get = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers });

describe('Armature-Version (ADR-0059 decision 3)', () => {
  it('every response names the revision that served it, errors included', async () => {
    const ok = await get('/api/v1/branches');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('armature-version')).toBe(CURRENT_REVISION);
    const missing = await get('/api/v1/documents/LearningObjective/no-such');
    expect(missing.status).toBe(404);
    expect(missing.headers.get('armature-version')).toBe(CURRENT_REVISION);
  });

  it('serves a request that names a revision it serves, newest or older', async () => {
    for (const revision of [CURRENT_REVISION, REVISIONS[REVISIONS.length - 1]]) {
      const res = await get('/api/v1/branches', { 'Armature-Version': revision });
      expect(res.status).toBe(200);
    }
  });

  it('refuses a revision older than the oldest, a date that is not a revision, and a malformed value', async () => {
    for (const requested of ['2026-01-01', '2026-10-19', 'v1']) {
      const res = await get('/api/v1/branches', { 'Armature-Version': requested });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('unsupported_version');
      expect(body.requested).toBe(requested);
      expect(body.supported).toEqual([...REVISIONS]);
    }
  });

  it('serves a read from a newer revision under the current one, and refuses a write from it', async () => {
    const newer = { 'Armature-Version': '2099-01-01' };
    const read = await get('/api/v1/documents/LearningObjective', newer);
    expect(read.status).toBe(200);
    expect(read.headers.get('armature-version')).toBe(CURRENT_REVISION);

    const name = `test-version-${stamp}`;
    const write = await app.request('/api/v1/branches', {
      method: 'POST',
      headers: { ...HEADERS, ...newer },
      body: JSON.stringify({ name }),
    });
    expect(write.status).toBe(400);
    expect((await write.json()).error).toBe('unsupported_version');
    expect((await (await get('/api/v1/branches')).json()).map((b: { name: string }) => b.name)).not.toContain(name);
    await createStore({ branch: 'main' }).deleteBranch(name).catch(() => undefined);
  });

  it('the revisions are the dated entries of docs/client-changes.md, newest first', () => {
    const changes = readFileSync(resolve(__dirname, '../../../docs/client-changes.md'), 'utf8');
    const dated = [...new Set(changes.match(/^## (\d{4}-\d{2}-\d{2})/gm)?.map((h) => h.slice(3)) ?? [])];
    expect([...REVISIONS]).toEqual(dated);
    expect([...REVISIONS]).toEqual([...REVISIONS].sort().reverse());
  });
});

describe('Armature-Capabilities (ADR-0059 decision 5)', () => {
  it('serves a request that relies on capabilities the hub has', async () => {
    const res = await get('/api/v1/branches', { 'Armature-Capabilities': 'armature/branches, armature/intelligence.coverage' });
    expect(res.status).toBe(200);
  });

  it('refuses one the hub lacks, naming it and what it does support', async () => {
    const res = await get('/api/v1/branches', { 'Armature-Capabilities': 'armature/branches, edu.example.coqui/review-notes' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_capability');
    expect(body.unsupported).toEqual(['edu.example.coqui/review-notes']);
    expect(body.supported).toEqual(capabilitiesOf('remote').map(([id]) => id));
  });

  it('refuses on a remote hub a capability only a workspace hub serves', async () => {
    const res = await get('/api/v1/branches', { 'Armature-Capabilities': 'armature/workspace' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.unsupported).toEqual(['armature/workspace']);
    expect(body.supported).not.toContain('armature/workspace');
  });

  it('every route sits under a capability (a route added without one fails here)', () => {
    const uncovered = app.routes
      .filter((r) => r.method !== 'ALL')
      .map((r) => r.path)
      .filter((path) => !Object.values(CAPABILITIES).some((cap) => cap.routes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))));
    expect(uncovered).toEqual([]);
  });
});

describe('GET /api/v1/discover and /schema (ADR-0059 decision 6, ADR-0027 decision 4)', () => {
  it('describes the hub: revisions, capabilities with fallback and settings, and the schema route', async () => {
    const res = await get('/api/v1/discover');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeNull();
    const body = await res.json();
    expect(body.versions).toEqual([...REVISIONS]);
    expect(body.capabilities['armature/intelligence.coverage']).toEqual({ fallback: 'reject', fullyAssessedAt: 2, overAssessedAbove: 4 });
    expect(body.capabilities['armature/documents'].fallback).toBe('reject');
    expect(body.schema).toEqual({ route: '/api/v1/schema' });
  });

  it('returns the schema graph at a ref, reloadable, with the commit in ETag', async () => {
    const res = await get('/api/v1/schema');
    expect(res.status).toBe(200);
    const commit = res.headers.get('etag')?.replace(/"/g, '');
    expect(commit).toMatch(/^[a-z0-9]+$/);
    const body = await res.json();
    expect(body.ref).toBe(commit);
    expect(body.schema.find((e: { '@type': string }) => e['@type'] === '@context')).toBeDefined();
    expect(body.schema.find((e: { '@id'?: string }) => e['@id'] === 'LearningObjective')).toMatchObject({ '@type': 'Class' });
    expect(JSON.stringify(body.schema)).not.toContain('"inf"');
    const at = await get(`/api/v1/schema?ref=${commit}`);
    expect(at.status).toBe(200);
    expect((await at.json()).schema).toEqual(body.schema);
    expect((await get('/api/v1/schema?ref=nosuchcommit')).status).toBe(404);
  });
});
