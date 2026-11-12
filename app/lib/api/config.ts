import type { Context } from 'hono';
import type { JWTVerifyGetKey } from 'jose';
import type { WorkspaceRecords } from './workspace/records';
import { workspaceStore } from './workspace/store';
import { createStore, storeConfigFromEnv, type Ref, type Store, type StoreConfig } from './store';

/**
 * A hub's configuration, carried on each request rather than read from the
 * environment where it is used.
 *
 * One process has always been one hub, so every setting used to be read from
 * `process.env` at its point of use. The workspace hub plan's cycle test
 * (docs/workspace-hub-plan.md §13) runs a remote hub and a workspace hub in one
 * process, each with its own store and role, so a setting is now read from the
 * request's `HubConfig`: `createApp` takes a source of one, and the default
 * source reads the environment on every request, so an operator or a test that
 * changes a variable is still obeyed at the next request. Besides the store's
 * own default (`storeConfigFromEnv`, for the operator tools and the tests), this
 * module is the only one under `app/lib/api/` that reads the environment, and
 * no route makes a store except through `storeFor`; a test reads the modules
 * for both.
 */
/** A remote hub, as built, or a workspace hub on one person's machine (ADR-0065; ./role.ts). */
export type HubRole = 'remote' | 'workspace';
const ROLES: readonly HubRole[] = ['remote', 'workspace'];

/**
 * What the `oidc` resolver verifies a token against (ADR-0067 decision 1;
 * ./oidc.ts), read when ARMATURE_IDENTITY=oidc and refused incomplete.
 */
export interface OidcConfig {
  /** ARMATURE_OIDC_ISSUER: the identity provider's issuer identifier, the token's `iss`, compared as a string. */
  issuer: string;
  /** ARMATURE_OIDC_AUDIENCE: this hub as the provider names it, the token's `aud`. */
  audience: string;
  /** ARMATURE_OIDC_CLIENT_ID: the client id a native program signs in with, published by `GET /discover` (decision 9); optional. */
  clientId?: string;
  /** ARMATURE_OIDC_JWKS_URL: where the issuer's keys are, when not at the address its metadata names; optional. */
  jwksUrl?: string;
  /**
   * ARMATURE_OIDC_ADMIT (decision 1, note of 2026-10-30): who is registered on first encounter. An entry
   * with `://` is an issuer, any other an email domain matched against the token's `email`; empty admits no one.
   */
  admit: { issuers: ReadonlySet<string>; domains: ReadonlySet<string> };
  /**
   * ARMATURE_OIDC_SERVICES (decision 4, note of 2026-11-12): the client ids that are services, such as the
   * viewer's and a relay's. A token is a service's only when its client is listed here and it carries no
   * `name`; every other token is a person's. Empty, no token is a service's.
   */
  services: ReadonlySet<string>;
  /** The issuer's keys, when a host or a test supplies them; absent, fetched from the issuer and kept (./oidc.ts). */
  keys?: JWTVerifyGetKey;
}

export interface HubConfig {
  /** ARMATURE_ROLE; `remote` by default. */
  role: HubRole;
  /** The remote hub's address, ARMATURE_REMOTE_URL without a trailing slash; required, and only read, when the role is `workspace`. */
  remote?: string;
  /** ARMATURE_WORKSPACE_DIR, the folder a workspace hub keeps its workspaces' records in; required, and only read, when the role is `workspace`. The host turns it into `workspaces`. */
  workspaceDir?: string;
  /**
   * A workspace hub's credential for its remote under `oidc` (ADR-0067 decision 2, note of 2026-11-05):
   * the owner's bearer token, as the host supplies it on each call. The desktop program signs the
   * person in and refreshes from its keychain; `app/server.ts` takes ARMATURE_REMOTE_TOKEN as given.
   * Absent, the remote runs under `header` and every call carries the owner's external identifier.
   * Never read on a remote hub.
   */
  remoteToken?: () => Promise<string>;
  /**
   * The store, read when a route makes one, so a request that needs none (GET /discover)
   * never requires the TERMINUS_* variables. On a workspace hub the host replaces it with
   * the file-backed store opened in `workspaceDir`, the one local store (ADR-0066 decision 4).
   */
  store: () => StoreConfig;
  /** The identity resolver's name (ADR-0032), ARMATURE_IDENTITY; `header` by default. */
  identity: string;
  /** The `oidc` resolver's settings; present exactly when `identity` is `oidc`. */
  oidc?: OidcConfig;
  /** ARMATURE_INSTANCE_NAME: what `GET /discover`'s `instance.name` says of a remote hub; unset, its host name (docs/desktop-program-plan.md §8). */
  instanceName?: string;
  /**
   * ARMATURE_PUBLIC_URL: where a client beyond this server reaches the hub, `GET /discover`'s `instance.api`.
   * Read only under `oidc`: only then is a hub published (ADR-0067 decision 7, note), so a hub under `header`
   * has no public name and the compose file can derive the address without knowing the resolver.
   */
  publicUrl?: string;
  /** Host names the hub answers besides loopback, lower case (ADR-0067 decision 7). */
  allowedHosts: ReadonlySet<string>;
  /** Web origins the hub serves, lower case (ADR-0067 decision 7). */
  allowedOrigins: ReadonlySet<string>;
  /** A workspace hub's records of its workspaces (./workspace/records.ts); the host gives a folder, a test memory. */
  workspaces?: WorkspaceRecords;
  /** ARMATURE_SNAPSHOTS: how many remote commits a workspace holds as snapshots (plan §16 question 3); reads at the rest are forwarded. */
  snapshotBudget: number;
  /**
   * A workspace hub's per-launch secret (ADR-0065 decision 7, note; ./localToken.ts): ARMATURE_LOCAL_TOKEN, or
   * drawn by the host at start when unset. Every write to a workspace hub carries it as `Armature-Local-Token`;
   * a workspace hub with none refuses every write. Unused on a remote hub.
   */
  localToken?: string;
  /**
   * Whether a workspace hub serves push, bring in and deliver as routes, ARMATURE_WORKSPACE_ACTIONS=routes
   * (./localToken.ts): the desktop program's own actions, offered as routes to the compose profile and the
   * suites until the program exists; false by default, and never read on a remote hub.
   */
  actionRoutes: boolean;
  /** The key the pseudonymous and institutional export profiles hash with (ADR-0031); absent, a random one per export. */
  exportKey?: string;
}

// The request's configuration under `hub`, typed for every route group.
declare module 'hono' {
  interface ContextVariableMap {
    hub: HubConfig;
  }
}

/** A name as compared: lower case, without the trailing dot of a fully qualified name. */
export const bareName = (name: string) => name.toLowerCase().replace(/\.$/, '');

/** A comma-separated setting as a set of bare names. */
const list = (raw: string | undefined): ReadonlySet<string> =>
  new Set(
    (raw ?? '')
      .split(',')
      .map((entry) => bareName(entry.trim()))
      .filter(Boolean)
  );

/** The remote's address as given: an http or https URL; throws otherwise. */
function remoteUrl(raw: string | undefined): string {
  const value = raw?.trim().replace(/\/+$/, '');
  if (!value) throw new Error('ARMATURE_REMOTE_URL is required when ARMATURE_ROLE=workspace');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`ARMATURE_REMOTE_URL=${value} is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`ARMATURE_REMOTE_URL=${value} is not an http or https address`);
  }
  return value;
}

/** The folder for a workspace hub's records, as given; throws when absent. */
function workspaceDir(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) throw new Error('ARMATURE_WORKSPACE_DIR is required when ARMATURE_ROLE=workspace');
  return value;
}

/** A token given once in the environment, handed over as it is on every call. */
const remoteToken = (value: string) => async () => value;

/** The snapshot budget as given: a whole number of commits per workspace; 20 when unset (ADR-0066, Verification: measured on the seed). */
export const DEFAULT_SNAPSHOT_BUDGET = 20;
function snapshotBudget(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_SNAPSHOT_BUDGET;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0) throw new Error(`ARMATURE_SNAPSHOTS=${raw} is not a whole number of commits`);
  return value;
}

/** An http or https address as given, without a trailing slash; throws naming the variable otherwise. */
function httpUrl(variable: string, raw: string | undefined): string {
  const value = raw?.trim().replace(/\/+$/, '');
  if (!value) throw new Error(`${variable} is required when ARMATURE_IDENTITY=oidc`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variable}=${value} is not a URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${variable}=${value} is not an http or https address`);
  return value;
}

/** ARMATURE_PUBLIC_URL as given, without a trailing slash, when the hub is published; a value that is not an address stops the hub at start. */
const publicUrl = (raw: string | undefined): string | undefined => (raw?.trim() ? httpUrl('ARMATURE_PUBLIC_URL', raw) : undefined);

/**
 * The `oidc` resolver's settings from the environment: the issuer and the
 * audience are required, the rest optional. The admission list is split by
 * shape: an issuer is a URL, an email domain is not. The services are client
 * ids, listed (decision 4, note of 2026-11-12).
 */
function oidcConfig(env: Readonly<Record<string, string | undefined>>): OidcConfig {
  const issuer = httpUrl('ARMATURE_OIDC_ISSUER', env.ARMATURE_OIDC_ISSUER);
  const audience = env.ARMATURE_OIDC_AUDIENCE?.trim();
  if (!audience) throw new Error('ARMATURE_OIDC_AUDIENCE is required when ARMATURE_IDENTITY=oidc');
  const admit = { issuers: new Set<string>(), domains: new Set<string>() };
  for (const entry of (env.ARMATURE_OIDC_ADMIT ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    if (entry.includes('://')) admit.issuers.add(entry.replace(/\/+$/, ''));
    else admit.domains.add(bareName(entry));
  }
  return {
    issuer,
    audience,
    ...(env.ARMATURE_OIDC_CLIENT_ID?.trim() ? { clientId: env.ARMATURE_OIDC_CLIENT_ID.trim() } : {}),
    ...(env.ARMATURE_OIDC_JWKS_URL?.trim() ? { jwksUrl: httpUrl('ARMATURE_OIDC_JWKS_URL', env.ARMATURE_OIDC_JWKS_URL) } : {}),
    admit,
    // Client ids as given: a provider compares them exactly, so nothing is lowered.
    services: new Set((env.ARMATURE_OIDC_SERVICES ?? '').split(',').map((e) => e.trim()).filter(Boolean)),
  };
}

/** Whether the host asked for the program's actions as routes: `routes`, or unset; anything else is refused. */
function actionRoutes(raw: string | undefined): boolean {
  const value = raw?.trim();
  if (!value) return false;
  if (value === 'routes') return true;
  throw new Error(`ARMATURE_WORKSPACE_ACTIONS=${value} is not a setting (routes, or unset)`);
}

/**
 * The hub's configuration from the environment (app/server.ts lists the
 * variables); throws on a role it does not know or a workspace hub without a
 * remote or a folder, which the entry reads once at startup so the hub never starts with one.
 */
export function configFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): HubConfig {
  const role = env.ARMATURE_ROLE?.trim() || 'remote';
  if (!(ROLES as readonly string[]).includes(role)) {
    throw new Error(`ARMATURE_ROLE=${role} names no role (known: ${ROLES.join(', ')})`);
  }
  // The role names the store: a workspace hub runs over the folder of ADR-0066, opened by
  // its host, and a remote hub over TerminusDB. The setting that chose between them while
  // TerminusDB was the test bed (ARMATURE_STORE, 2026-11-02) is retired by decision 4 of
  // that ADR, and refused rather than ignored so a stale .env.local is noticed.
  if (env.ARMATURE_STORE?.trim()) {
    throw new Error('ARMATURE_STORE is retired (ADR-0066 decision 4): a workspace hub runs over the folder in ARMATURE_WORKSPACE_DIR, a remote hub over TerminusDB');
  }
  const identity = env.ARMATURE_IDENTITY?.trim() || 'header';
  // A workspace hub resolves its owner from the trusted header and signs in to its
  // remote from its host (ADR-0067 decision 2; docs/workspace-hub-plan.md §7).
  if (identity === 'oidc' && role === 'workspace') {
    throw new Error('ARMATURE_IDENTITY=oidc is a remote hub\'s resolver; a workspace hub runs under header (ADR-0067 decision 8)');
  }
  return {
    role: role as HubRole,
    ...(role === 'workspace' ? { remote: remoteUrl(env.ARMATURE_REMOTE_URL), workspaceDir: workspaceDir(env.ARMATURE_WORKSPACE_DIR) } : {}),
    ...(role === 'workspace' && env.ARMATURE_REMOTE_TOKEN?.trim() ? { remoteToken: remoteToken(env.ARMATURE_REMOTE_TOKEN.trim()) } : {}),
    store: () => storeConfigFromEnv(env),
    snapshotBudget: snapshotBudget(env.ARMATURE_SNAPSHOTS),
    ...(role === 'workspace' && env.ARMATURE_LOCAL_TOKEN?.trim() ? { localToken: env.ARMATURE_LOCAL_TOKEN.trim() } : {}),
    actionRoutes: role === 'workspace' && actionRoutes(env.ARMATURE_WORKSPACE_ACTIONS),
    identity,
    ...(identity === 'oidc' ? { oidc: oidcConfig(env), publicUrl: publicUrl(env.ARMATURE_PUBLIC_URL) } : {}),
    ...(role === 'remote' && env.ARMATURE_INSTANCE_NAME?.trim() ? { instanceName: env.ARMATURE_INSTANCE_NAME.trim() } : {}),
    allowedHosts: list(env.ARMATURE_ALLOWED_HOSTS),
    allowedOrigins: list(env.ARMATURE_ALLOWED_ORIGINS),
    exportKey: env.ARMATURE_EXPORT_KEY?.trim() || undefined,
  };
}

/** The request's configuration, set by the app's first middleware. */
export function hubOf(c: Context): HubConfig {
  const hub: HubConfig | undefined = c.get('hub');
  if (!hub) throw new Error('No hub configuration on the request; mount the routes through createApp');
  return hub;
}

/**
 * A store for one request, bound to the ref it resolved, in the request's
 * hub's database. On a workspace hub a read this hub cannot serve is forwarded
 * to the remote as the caller (plan §8), so the caller's external identifier
 * travels with the store; under `header` that is the header as sent, and the
 * remote resolves it again.
 */
export function storeFor(c: Context, ref: Ref): Store {
  return storeOf(hubOf(c), ref, c.req.header('Armature-User')?.trim() || undefined);
}

/**
 * A store of a hub's own database, for work the hub does outside a request's
 * context (a workspace hub's push). On a workspace hub with records it is the
 * workspace store (./workspace/store.ts), which answers remote commit
 * identifiers too; a remote hub's is the adapter as it is.
 */
export function storeOf(hub: HubConfig, ref: Ref, as?: string): Store {
  const store = createStore(ref, hub.store());
  return hub.role === 'workspace' && hub.workspaces ? workspaceStore(hub, store, as) : store;
}
