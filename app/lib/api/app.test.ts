/**
 * In-process tests for the Hono API (ADR-0054 spike, check 6).
 *
 * Integration tests: they need the TerminusDB container from
 * docker/docker-compose.yml running with the seed loaded. No HTTP server is
 * started; `app.request()` invokes the app directly.
 */
import { describe, expect, it } from 'vitest';
import { app } from './app';

describe('GET /api/v1/documents/:type/:id', () => {
  it('returns a seeded module with the data version it was read at', async () => {
    const res = await app.request('/api/v1/documents/Module/how-ai-works');
    expect(res.status).toBe(200);
    expect(res.headers.get('terminusdb-data-version')).toMatch(/^branch:/);
    const body = await res.json();
    expect(body['@id']).toBe('Module/how-ai-works');
    expect(body['@type']).toBe('Module');
  });

  it('returns 404 for an id that does not exist', async () => {
    const res = await app.request('/api/v1/documents/Module/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 when the id exists under another type', async () => {
    const res = await app.request('/api/v1/documents/Course/how-ai-works');
    expect(res.status).toBe(404);
  });
});
