/**
 * The Armature API as a Hono application (ADR-0054, spike).
 *
 * This module is host-neutral: nothing here imports from `next`. The Next.js
 * app mounts it from `app/app/api/[[...route]]/route.ts` through `@hono/vercel`;
 * a standalone process serves the same object with `@hono/node-server`.
 *
 * Spike scope: one read route plus the error mapping it needs. Phase 2 of
 * docs/development-plan.md adds branch, ref, history and diff routes here.
 */
import { Hono } from 'hono';
import client from '@/lib/terminusdb';

/** Shape returned by the client when `getDataVersion` is true. */
interface VersionedResult<T> {
  result: T;
  dataVersion: string;
}

interface TerminusDocument {
  '@id': string;
  '@type': string;
  [key: string]: unknown;
}

export const app = new Hono().basePath('/api/v1');

/**
 * GET /api/v1/documents/:type/:id
 *
 * Reads one document by its TerminusDB id (`<type>/<id>`) on the client's
 * current branch and returns it with the commit it was read at in the
 * `TerminusDB-Data-Version` header. Phase 2 adds `?branch=` and `?ref=`.
 */
app.get('/documents/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  const docId = `${type}/${id}`;

  const { result, dataVersion } = (await client.getDocument(
    { id: docId },
    undefined,
    undefined,
    '',
    true
  )) as VersionedResult<TerminusDocument>;

  if (result['@type'] !== type) {
    // The id exists but under another type. ADR-0024 territory; for a read,
    // "not found under this type" is the honest answer.
    return c.json(
      { error: `No ${type} with id ${docId}` },
      404
    );
  }

  c.header('TerminusDB-Data-Version', dataVersion);
  return c.json(result);
});

/**
 * Maps TerminusDB client errors to HTTP responses. The client throws plain
 * Errors whose message concatenates the server's JSON error fields, so the
 * mapping matches on `@type` substrings, as `handleTerminusError` does for
 * the legacy routes. Replaces that helper's Next-bound return type.
 */
app.onError((err, c) => {
  const msg = err instanceof Error ? err.message : String(err);

  if (msg.includes('api:DocumentNotFound') || msg.includes('api:GetDocumentErrorResponse')) {
    return c.json({ error: 'Document not found' }, 404);
  }
  if (msg.includes('Incorrect authentication')) {
    console.error('TerminusDB auth failure; check TERMINUS_* env vars');
    return c.json({ error: 'Database connection error' }, 500);
  }

  console.error(`TerminusDB unclassified error (${c.req.method} ${c.req.path}):`, msg);
  return c.json({ error: 'Database error' }, 500);
});

export default app;
