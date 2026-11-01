/**
 * The Armature API as a Hono application (ADR-0054; ADRs are the
 * architecture decision records in schema/docs/adr/).
 *
 * This module is host-neutral: nothing here imports from `next`. Its host is
 * `app/server.ts` through `app/lib/hub.ts` (`@hono/node-server`), bundled by
 * `npm run build:hub` and run by the container `docker/hub.Dockerfile` builds.
 * Until 2026-10-21 Next.js also mounted it through a catch-all route; the
 * Next.js app is now the viewer, a client of the hub like any plugin.
 *
 * Route groups live in `./routes/` and reach the store only through the
 * adapter in `./store.ts` (ADR-0055). Phase 2 (ADR-0025) added the branch,
 * merge, history and diff routes; Phase 3 added identity resolution and the
 * users routes (ADR-0032), the generic write path and the invariants engine;
 * Phase 4 adds the design-intelligence reads (coverage, alignment, trace,
 * impact), derived from structure alone (plan P4); Phase 6 adds the export
 * route (ADR-0031): the graph at a commit under a profile and a slice;
 * Phase 7 adds the per-request version contract (ADR-0059): the
 * Armature-Version and Armature-Capabilities headers, read by `negotiate`
 * on every request, and the discovery and schema routes. Phase 8 adds the
 * loopback boundary (ADR-0067 decision 7): `boundary` refuses a request from a
 * host or a web origin the hub does not serve, before anything else runs.
 */
import { bodyLimit } from 'hono/body-limit';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { boundary } from './boundary';
import { ApiError } from './errors';
import { branches } from './routes/branches';
import { discover } from './routes/discover';
import { documents } from './routes/documents';
import { exportRoutes } from './routes/export';
import { intelligence } from './routes/intelligence';
import { users } from './routes/users';
import { isUnknownRef, StoreError } from './store';
import { CURRENT_REVISION, negotiate } from './version';

/** The largest request body the hub reads. */
export const MAX_BODY_BYTES = 10 * 1024 * 1024;

export const app = new Hono().basePath('/api/v1');

// The loopback boundary first (ADR-0067 decision 7): a request from a host or a
// web origin the hub does not serve is refused before anything else reads it.
app.use('*', boundary);
app.use('*', negotiate);
// A body is read whole before it is parsed, so its size is bounded before
// anything reads it (the deep review's HTTP item 4): 10 MiB holds a batch of
// 500 documents with room to spare.
app.use(
  '*',
  bodyLimit({
    maxSize: MAX_BODY_BYTES,
    onError: () => {
      throw new ApiError(413, 'body_too_large', `A request body may be at most ${MAX_BODY_BYTES} bytes`);
    },
  })
);

app.route('/documents', documents);
app.route('/branches', branches);
app.route('/users', users);
app.route('/intelligence', intelligence);
app.route('/export', exportRoutes);
app.route('/', discover);

/**
 * Maps errors to responses. Hub errors render themselves; store errors are
 * matched on the server's `@type` (ADR-0055 decision 6). Anything else is a
 * 500 with the detail in the server log, never in the response.
 */
app.onError((err, c) => {
  // An error answer still says which revision served it (ADR-0059 decision 3).
  c.header('Armature-Version', CURRENT_REVISION);
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message, ...err.details }, err.status);
  }
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof StoreError) {
    if (err.kind === 'not_found') {
      return c.json({ error: 'not_found', message: 'Document not found' }, 404);
    }
    if (err.kind === 'version_mismatch') {
      return c.json({ error: 'precondition_failed', message: 'The branch has moved since the commit in If-Match' }, 412);
    }
    if (err.kind === 'id_prefix') {
      // The store derives the id prefix from the class (platform check X5);
      // a client-supplied id must start with its own type (ADR-0024).
      return c.json({ error: 'bad_id', message: 'A document id must begin with its own type, as Type/<id>' }, 400);
    }
    if (err.kind === 'id_mismatch') {
      // A Hash-keyed class derives its id from its key fields (ADR-0024);
      // a client-supplied id on one can only disagree with it.
      return c.json({ error: 'bad_id', message: 'This type derives its id from its key fields; omit @id and let the hub mint it' }, 400);
    }
    if (isUnknownRef(err)) {
      return c.json({ error: 'unknown_ref', message: 'No such branch, commit or document' }, 404);
    }
    if (err.status === 401) {
      console.error('TerminusDB rejected the credentials; check the TERMINUS_* environment variables');
      return c.json({ error: 'store_unavailable', message: 'Database connection error' }, 500);
    }
    console.error(
      `TerminusDB ${err.status} ${err.type} (${c.req.method} ${c.req.path}):`,
      JSON.stringify(err.body).slice(0, 800)
    );
    return c.json({ error: 'store_error', message: `TerminusDB returned ${err.type}` }, 500);
  }
  console.error(`Unhandled error (${c.req.method} ${c.req.path}):`, err);
  return c.json({ error: 'internal_error', message: 'Internal error' }, 500);
});

export default app;
