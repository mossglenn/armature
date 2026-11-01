import type { Context } from 'hono';
import type { WorkspaceRecords } from './workspace/records';
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

export interface HubConfig {
  /** ARMATURE_ROLE; `remote` by default. */
  role: HubRole;
  /** The remote hub's address, ARMATURE_REMOTE_URL without a trailing slash; required, and only read, when the role is `workspace`. */
  remote?: string;
  /** ARMATURE_WORKSPACE_DIR, the folder a workspace hub keeps its workspaces' records in; required, and only read, when the role is `workspace`. The host turns it into `workspaces`. */
  workspaceDir?: string;
  /** The store, read when a route makes one, so a request that needs none (GET /discover) never requires the TERMINUS_* variables. */
  store: () => StoreConfig;
  /** The identity resolver's name (ADR-0032), ARMATURE_IDENTITY; `header` by default. */
  identity: string;
  /** Host names the hub answers besides loopback, lower case (ADR-0067 decision 7). */
  allowedHosts: ReadonlySet<string>;
  /** Web origins the hub serves, lower case (ADR-0067 decision 7). */
  allowedOrigins: ReadonlySet<string>;
  /** A workspace hub's records of its workspaces (./workspace/records.ts); the host gives a folder, a test memory. */
  workspaces?: WorkspaceRecords;
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
  return {
    role: role as HubRole,
    ...(role === 'workspace' ? { remote: remoteUrl(env.ARMATURE_REMOTE_URL), workspaceDir: workspaceDir(env.ARMATURE_WORKSPACE_DIR) } : {}),
    store: () => storeConfigFromEnv(env),
    identity: env.ARMATURE_IDENTITY?.trim() || 'header',
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

/** A store for one request, bound to the ref it resolved, in the request's hub's database. */
export function storeFor(c: Context, ref: Ref): Store {
  return createStore(ref, hubOf(c).store());
}
