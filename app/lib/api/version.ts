import type { MiddlewareHandler } from 'hono';
import { hubOf, type HubConfig, type HubRole } from './config';
import { ApiError } from './errors';
import { AUTHORIZATION_SETTINGS } from './authorization';
import { readOnlyBranches, remoteOnlyRoutes } from './role';

/**
 * The per-request version contract (architecture decision record ADR-0059).
 *
 * Nothing is negotiated up front and the hub keeps nothing between requests.
 * A request may name the contract revision it was written against
 * (`Armature-Version: YYYY-MM-DD`) and the capabilities it relies on
 * (`Armature-Capabilities: a/b, c/d`); the hub answers each request on its
 * own, refusing with a list of what it does support when it cannot honor one,
 * and every response says which revision served it.
 */

/**
 * The revisions this hub serves, newest first. A revision is a dated entry of
 * docs/client-changes.md (ADR-0059 decision 2); version.test.ts checks this
 * list against that file's headings. Revisions under /api/v1 are additive, so
 * a hub at the newest serves every earlier one.
 */
export const REVISIONS = ['2026-11-01', '2026-10-31', '2026-10-30', '2026-10-22', '2026-10-21', '2026-10-20', '2026-10-18', '2026-10-08', '2026-10-07'] as const;

export const CURRENT_REVISION = REVISIONS[0];
const OLDEST_REVISION = REVISIONS[REVISIONS.length - 1];

export interface Capability {
  /** Every capability the hub defines is `reject`: a client that relies on one the hub lacks is refused, never served under core behavior. */
  fallback: 'reject';
  /** The route paths (as the app's route table spells them) this capability covers; version.test.ts fails on a route under none. */
  routes: string[];
  /** What the behavior's parameters default to, for a client to read before relying on them. */
  settings: Record<string, unknown>;
  /** The roles of hub that serve it, when not every role does (ADR-0065); a hub of another role neither lists nor accepts it. */
  roles?: HubRole[];
}

/**
 * Named features of hub behavior (ADR-0059 decision 4), prefixed `armature`
 * because the hub defined them. Added, never renamed.
 */
export const CAPABILITIES: Record<string, Capability> = {
  'armature/documents': {
    fallback: 'reject',
    routes: ['/api/v1/documents'],
    settings: { batchLimit: 500, historyCount: 20 },
  },
  'armature/branches': { fallback: 'reject', routes: ['/api/v1/branches'], settings: { logCount: 20, logPage: 100 } },
  'armature/users': { fallback: 'reject', routes: ['/api/v1/users'], settings: {} },
  'armature/intelligence.coverage': {
    fallback: 'reject',
    routes: ['/api/v1/intelligence/coverage'],
    settings: { fullyAssessedAt: 2, overAssessedAbove: 4 },
  },
  'armature/intelligence.alignment': { fallback: 'reject', routes: ['/api/v1/intelligence/alignment'], settings: {} },
  'armature/intelligence.trace': { fallback: 'reject', routes: ['/api/v1/intelligence/trace'], settings: {} },
  'armature/intelligence.impact': { fallback: 'reject', routes: ['/api/v1/intelligence/impact'], settings: {} },
  'armature/intelligence.attestations': { fallback: 'reject', routes: ['/api/v1/intelligence/attestations'], settings: {} },
  'armature/intelligence.item-statistics': { fallback: 'reject', routes: ['/api/v1/intelligence/item-statistics'], settings: {} },
  'armature/intelligence.module-content': { fallback: 'reject', routes: ['/api/v1/intelligence/module-content'], settings: {} },
  'armature/export': { fallback: 'reject', routes: ['/api/v1/export'], settings: { profiles: ['full', 'pseudonymous', 'institutional'] } },
  'armature/discover': { fallback: 'reject', routes: ['/api/v1/discover', '/api/v1/schema'], settings: {} },
  'armature/workspace': { fallback: 'reject', routes: ['/api/v1/workspace'], settings: { profile: 'full' }, roles: ['workspace'] },
  /** The hub authorizes (ADR-0068 decision 7): a 403 `forbidden` is possible, and `GET /users/me` carries the caller's grants. No route of its own. */
  'armature/authorization': { fallback: 'reject', routes: [], settings: AUTHORIZATION_SETTINGS, roles: ['remote'] },
};

/** The capabilities a hub of this role serves. */
export const capabilitiesOf = (role: HubRole): [string, Capability][] =>
  Object.entries(CAPABILITIES).filter(([, cap]) => !cap.roles || cap.roles.includes(role));

/**
 * The body of GET /api/v1/discover (ADR-0059 decision 6): the hub, not the
 * graph; the same at every ref. Since 2026-11-01 it names the hub's role and
 * what the role refuses (docs/workspace-hub-plan.md §3 and §9): the routes a
 * workspace hub answers `remote_only` under each capability (`remoteOnly`),
 * and the branches it serves only for reading (`readOnlyBranches`); both empty
 * on a remote hub. A workspace hub also lists `armature/workspace`, its
 * routes for creating, listing and reading the status of workspaces.
 */
export function discovery(hub: HubConfig) {
  const capabilities: Record<string, Record<string, unknown>> = {};
  for (const [id, cap] of capabilitiesOf(hub.role)) {
    capabilities[id] = { fallback: cap.fallback, ...cap.settings };
  }
  capabilities['armature/documents'].readOnlyBranches = readOnlyBranches(hub.role);
  for (const id of ['armature/branches', 'armature/users']) {
    capabilities[id].remoteOnly = remoteOnlyRoutes(hub.role, id);
  }
  return { role: hub.role, versions: [...REVISIONS], capabilities, schema: { route: '/api/v1/schema' } };
}

const isRevision = (value: string): value is (typeof REVISIONS)[number] =>
  (REVISIONS as readonly string[]).includes(value);

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Reads both headers, refuses what the hub cannot honor, and stamps every
 * response with the revision that served it. Errors thrown here reach
 * app.onError, which stamps its responses too.
 */
export const negotiate: MiddlewareHandler = async (c, next) => {
  const requested = c.req.header('Armature-Version')?.trim();
  if (requested && !isRevision(requested)) {
    const refuse = (why: string) =>
      new ApiError(400, 'unsupported_version', `This hub does not serve revision ${requested}: ${why}`, {
        requested,
        supported: [...REVISIONS],
      });
    const wellFormed = /^\d{4}-\d{2}-\d{2}$/.test(requested);
    if (!wellFormed) throw refuse('a revision is a date, YYYY-MM-DD');
    if (requested < OLDEST_REVISION) throw refuse(`the oldest it serves is ${OLDEST_REVISION}`);
    if (requested > CURRENT_REVISION) {
      // Decided at acceptance (ADR-0059 decision 3): a newer client may read
      // an older hub, since revisions are additive; it may not write to it,
      // since it may rely on a rule this hub does not enforce.
      if (!READ_METHODS.has(c.req.method)) {
        throw refuse(`the newest it serves is ${CURRENT_REVISION}, and a write from a newer revision may rely on a rule this hub lacks; reads are served`);
      }
    } else {
      throw refuse('it is not a revision of this contract');
    }
  }

  const declared = c.req.header('Armature-Capabilities');
  if (declared) {
    const ids = declared.split(',').map((s) => s.trim()).filter(Boolean);
    const served = capabilitiesOf(hubOf(c).role).map(([id]) => id);
    const unsupported = ids.filter((id) => !served.includes(id));
    if (unsupported.length) {
      throw new ApiError(400, 'unsupported_capability', `This hub does not support ${unsupported.join(', ')}`, {
        unsupported,
        supported: served,
      });
    }
  }

  await next();
  c.header('Armature-Version', CURRENT_REVISION);
};
