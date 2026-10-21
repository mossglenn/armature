import { Hono } from 'hono';
import { normalizeSchema } from '../export/exporter';
import { refFromQuery, requireCommit, setEtag } from '../http';
import { createStore } from '../store';
import { discovery } from '../version';

/**
 * What a tool can ask a hub about itself (ADR-0059 decision 6, ADR-0027
 * decision 4).
 *
 *   GET /discover               the revisions served, the capabilities with
 *                               their settings, and where the schema is; no
 *                               ref, no identity, the same at every ref
 *   GET /schema?branch=|ref=    the schema graph at a ref, in the form the
 *                               export carries and the store reloads (AE5),
 *                               with the commit in ETag
 */
export const discover = new Hono();

discover.get('/discover', (c) => c.json(discovery()));

discover.get('/schema', async (c) => {
  const ref = refFromQuery(c);
  const store = createStore(ref);
  if ('commit' in ref) await requireCommit(store, ref.commit);
  const { entries, commit } = await store.getSchema();
  setEtag(c, commit);
  return c.json({ ref: commit, schema: normalizeSchema(entries) });
});
