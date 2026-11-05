import { Hono } from 'hono';
import { mayListUsers } from '../authorization';
import { hubOf, storeFor } from '../config';
import { ApiError } from '../errors';
import { applyProfile, normalizeSchema, PROFILES, SLICES, selectSlice, unresolvedReferences, withoutUnreferencedUsers, type Profile } from '../export/exporter';
import { resolveUser } from '../identity';
import { refFromQuery, setEtag, snapshot } from '../http';

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
 *
 * Under `oidc`, where anyone with a token may read, the default profile is
 * `pseudonymous`, and `full` carries every `User` only for a maintainer of
 * `main` or an administrator: anyone else gets the users the exported records
 * name and themselves, `armature.users: "referenced"`, since those are
 * readable one by one already and the registry is what the user list keeps
 * (ADR-0068 decision 4, notes of 2026-10-30 and 2026-11-05; a workspace hub's
 * clone, snapshots and forwarded reads take `full` this way). Under `header`
 * the default stays `full` and every user is carried.
 */
export const exportRoutes = new Hono();

exportRoutes.get('/slices', (c) => c.json(SLICES));

/** The profile an export takes when the caller names none. */
export const defaultProfile = (identity: string): Profile => (identity === 'oidc' ? 'pseudonymous' : 'full');

exportRoutes.get('/', async (c) => {
  const profile = (c.req.query('profile') ?? defaultProfile(hubOf(c).identity)) as Profile;
  if (!PROFILES.includes(profile)) {
    throw new ApiError(400, 'unknown_profile', `profile must be one of ${PROFILES.join(', ')}`);
  }
  const everyUser = profile !== 'full' || (await mayListUsers(c));
  const sliceName = c.req.query('slice') ?? 'full';
  const slice = SLICES[sliceName];
  if (!slice) throw new ApiError(400, 'unknown_slice', `slice must be one of ${Object.keys(SLICES).join(', ')}`);

  // The documents and the schema at one commit, the ETag (B1).
  const { at, commit } = await snapshot(storeFor(c, refFromQuery(c)));
  const all = (await at.allDocuments()).documents;
  const schema = normalizeSchema((await at.getSchema()).entries);
  const selected = selectSlice(all, slice);
  const key = hubOf(c).exportKey;
  const { documents: profiled, pseudonyms } = await applyProfile(selected, profile, key);
  const documents = everyUser ? profiled : withoutUnreferencedUsers(profiled, [(await resolveUser(c)).id]);
  const unresolved = unresolvedReferences(documents);

  const byType: Record<string, number> = {};
  for (const d of documents) byType[d['@type']] = (byType[d['@type']] ?? 0) + 1;
  const context = schema.find((e) => e['@type'] === '@context') ?? {};

  setEtag(c, commit);
  return c.json({
    '@context': context,
    armature: { ref: commit, profile, slice: sliceName, pseudonyms, users: everyUser ? 'all' : 'referenced', counts: { documents: documents.length, byType }, unresolved },
    schema,
    documents,
  });
});
