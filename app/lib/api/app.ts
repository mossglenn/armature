/**
 * The Armature API as a Hono application (ADR-0054).
 *
 * This module is host-neutral: nothing here imports from `next`. The Next.js
 * app mounts it from `app/app/api/[[...route]]/route.ts` through `@hono/vercel`;
 * a standalone process serves the same object with `@hono/node-server`.
 *
 * Route groups live in `./routes/` and reach the store only through the
 * adapter in `./store.ts` (ADR-0055). Phase 2 (ADR-0025) added the branch,
 * merge, history and diff routes; Phase 3 adds identity resolution and the
 * users routes (ADR-0032), the generic write path and the invariants engine.
 */
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { ApiError } from './errors';
import { branches } from './routes/branches';
import { documents } from './routes/documents';
import { users } from './routes/users';
import { StoreError } from './store';

export const app = new Hono().basePath('/api/v1');

app.route('/documents', documents);
app.route('/branches', branches);
app.route('/users', users);

/** Store error types that mean "the ref or id you named does not exist". */
const UNKNOWN_REF_TYPES = new Set([
  'api:NotValidRefError',
  'api:BadDataVersion',
  'api:UnresolvableAbsoluteDescriptor',
  'api:BranchDoesNotExist',
  'api:DocumentAccessImpossible',
]);

/**
 * Maps errors to responses. Hub errors render themselves; store errors are
 * matched on the server's `@type` (ADR-0055 decision 6). Anything else is a
 * 500 with the detail in the server log, never in the response.
 */
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: err.code, message: err.message, ...err.details }, err.status);
  }
  if (err instanceof HTTPException) return err.getResponse();
  if (err instanceof StoreError) {
    if (err.type === 'api:DocumentNotFound') {
      return c.json({ error: 'not_found', message: 'Document not found' }, 404);
    }
    if (err.type === 'api:DataVersionMismatch') {
      return c.json({ error: 'precondition_failed', message: 'The branch has moved since the commit in If-Match' }, 412);
    }
    if (err.type === 'api:SubmittedDocumentIdDoesNotHaveExpectedPrefix') {
      // The store derives the id prefix from the class (platform check X5);
      // a client-supplied id must start with its own type (ADR-0024).
      return c.json({ error: 'bad_id', message: 'A document id must begin with its own type, as Type/<id>' }, 400);
    }
    if (err.type === 'api:SubmittedIdDoesNotMatchGeneratedId') {
      // A Hash-keyed class derives its id from its key fields (ADR-0024);
      // a client-supplied id on one can only disagree with it.
      return c.json({ error: 'bad_id', message: 'This type derives its id from its key fields; omit @id and let the hub mint it' }, 400);
    }
    if (err.status === 404 || UNKNOWN_REF_TYPES.has(err.type)) {
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
