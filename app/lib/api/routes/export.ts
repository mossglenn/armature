import { Hono } from 'hono';
import { ApiError } from '../errors';
import { applyProfile, normalizeSchema, PROFILES, SLICES, selectSlice, unresolvedReferences, type Profile } from '../export/exporter';
import { refFromQuery, requireCommit, setEtag } from '../http';
import { createStore } from '../store';

/**
 * /api/v1/export (architecture decision record ADR-0031).
 *
 *   GET /?branch=|ref=&profile=&slice=   the graph at a ref as one JSON-LD
 *                                        document: the store's @context, the
 *                                        schema as it can be reloaded, and the
 *                                        documents of the slice under the profile
 *   GET /slices                          the declared slices
 *
 * Profiles: `full` (people as stored), `pseudonymous` (every User a stable
 * token, nothing else about the person), `institutional` (the token and the
 * institution). Tokens are an HMAC of the User id under ARMATURE_EXPORT_KEY;
 * without the key one is minted per export and `pseudonyms` says so. The
 * ETag is the commit exported. Re-import is an operator action outside this
 * API (ADR-0062): load the schema, post the documents.
 */
export const exportRoutes = new Hono();

exportRoutes.get('/slices', (c) => c.json(SLICES));

exportRoutes.get('/', async (c) => {
  const profile = (c.req.query('profile') ?? 'full') as Profile;
  if (!PROFILES.includes(profile)) {
    throw new ApiError(400, 'unknown_profile', `profile must be one of ${PROFILES.join(', ')}`);
  }
  const sliceName = c.req.query('slice') ?? 'full';
  const slice = SLICES[sliceName];
  if (!slice) throw new ApiError(400, 'unknown_slice', `slice must be one of ${Object.keys(SLICES).join(', ')}`);

  const ref = refFromQuery(c);
  const store = createStore(ref);
  if ('commit' in ref) await requireCommit(store, ref.commit);

  const { documents: all, commit } = await store.allDocuments();
  const schema = normalizeSchema((await store.getSchema()).entries);
  const selected = selectSlice(all, slice);
  const key = process.env.ARMATURE_EXPORT_KEY?.trim() || undefined;
  const { documents, pseudonyms } = await applyProfile(selected, profile, key);
  const unresolved = unresolvedReferences(documents);

  const byType: Record<string, number> = {};
  for (const d of documents) byType[d['@type']] = (byType[d['@type']] ?? 0) + 1;
  const context = schema.find((e) => e['@type'] === '@context') ?? {};

  setEtag(c, commit);
  return c.json({
    '@context': context,
    armature: { ref: commit, profile, slice: sliceName, pseudonyms, counts: { documents: documents.length, byType }, unresolved },
    schema,
    documents,
  });
});
