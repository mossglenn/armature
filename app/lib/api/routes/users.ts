import { Hono } from 'hono';
import { ApiError } from '../errors';
import { ifMatchFrom, readEnvelope, refFromQuery, requireCommit, setEtag } from '../http';
import { findUserByExternalId, mintUserId, registry, resolveAuthor, resolveUser, type UserDocument } from '../identity';
import { createStore, isRecord, StoreError } from '../store';

/**
 * /api/v1/users (architecture decision record ADR-0032, decision 6).
 *
 *   GET  /?branch=|ref=    every User at a ref; ETag (entity tag) is the commit
 *   GET  /me               the User the request resolved to (401 otherwise)
 *   POST /                 { message, user }  register a User on main → 201
 *
 * Users are created on `main` only, the registry of record (decision 2), so
 * POST refuses branch= and ref=. One User by id is the generic
 * GET /documents/User/:id. No edit or delete route in this phase.
 */
export const users = new Hono();

const USER_FIELDS = new Set(['@id', '@type', 'displayName', 'externalId', 'email', 'institution']);

users.get('/', async (c) => {
  const ref = refFromQuery(c);
  const store = createStore(ref);
  if ('commit' in ref) await requireCommit(store, ref.commit);
  const { documents, commit } = await store.queryDocuments('User', {});
  setEtag(c, commit);
  return c.json(documents);
});

users.get('/me', async (c) => {
  const who = await resolveUser(c);
  return c.json(who.user);
});

users.post('/', async (c) => {
  if (c.req.query('branch') || c.req.query('ref')) {
    throw new ApiError(400, 'users_live_on_main', 'User documents are created on main only (ADR-0032 decision 2)');
  }
  const envelope = await readEnvelope(c);
  const input = envelope.user;
  if (!isRecord(input)) throw new ApiError(400, 'bad_request', 'user must be an object');
  for (const key of Object.keys(input)) {
    if (!USER_FIELDS.has(key)) throw new ApiError(400, 'unknown_field', `User has no field ${key}`);
  }
  if (input['@type'] !== undefined && input['@type'] !== 'User') {
    throw new ApiError(400, 'type_mismatch', `user @type ${String(input['@type'])} is not User`);
  }
  const text = (key: string, required: boolean): string | undefined => {
    const value = input[key];
    if (value === undefined) {
      if (required) throw new ApiError(400, 'bad_request', `user.${key} is required`);
      return undefined;
    }
    if (typeof value !== 'string' || !value.trim()) {
      throw new ApiError(400, 'bad_request', `user.${key} must be a non-empty string`);
    }
    return value.trim();
  };
  const displayName = text('displayName', true) as string;
  const externalId = text('externalId', true) as string;
  const email = text('email', false);
  const institution = text('institution', false);
  let id: string | undefined;
  if (input['@id'] !== undefined) {
    if (typeof input['@id'] !== 'string' || !/^User\/[^\s/]+$/.test(input['@id'])) {
      throw new ApiError(400, 'bad_id', 'user @id must be User/<id>');
    }
    id = input['@id'];
  }

  const author = await resolveAuthor(c);
  const main = registry();
  const ifMatch = ifMatchFrom(c);

  // Two passes, as in resolveUser: a registration that loses a race on the
  // main head re-reads and reports the winner as user_exists.
  for (let attempt = 0; attempt < 2; attempt++) {
    const { user: taken, commit: head } = await findUserByExternalId(main, externalId);
    if (taken) {
      throw new ApiError(409, 'user_exists', `${externalId} is already registered as ${taken['@id']}`, { id: taken['@id'] });
    }
    if (id) {
      try {
        const held = (await main.getDocument(id)).document;
        const type = held['@type'];
        throw new ApiError(409, type === 'User' ? 'user_exists' : 'type_conflict', `${id} already exists as ${type}`);
      } catch (err) {
        if (!(err instanceof StoreError && err.type === 'api:DocumentNotFound')) throw err;
      }
    }
    const document: UserDocument = {
      '@id': id ?? mintUserId(),
      '@type': 'User',
      displayName,
      externalId,
      ...(email ? { email } : {}),
      ...(institution ? { institution } : {}),
    };
    try {
      const { commit } = await main.insertDocument(document, {
        author,
        message: envelope.message,
        ifMatch: ifMatch ?? (head || undefined),
      });
      setEtag(c, commit);
      return c.json({ id: document['@id'], commit }, 201);
    } catch (err) {
      if (err instanceof StoreError && err.type === 'api:DataVersionMismatch') {
        if (ifMatch) {
          const current = await main.head();
          throw new ApiError(412, 'precondition_failed', `main has moved since commit ${ifMatch}`, {
            expected: ifMatch,
            current: current?.id,
          });
        }
        continue;
      }
      throw err;
    }
  }
  throw new ApiError(409, 'registration_conflict', `Could not register ${externalId}; retry`);
});
