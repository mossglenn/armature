/**
 * The standalone hub's entry point (Phase 7; ADR-0026 decision 4).
 *
 * `npm run build:hub` bundles this file and everything it imports (the API,
 * the workspace packages, hono, zod) into one `dist/server.mjs` that Node runs
 * with no further install, and the container image in `docker/hub.Dockerfile`
 * holds nothing else. `npm run start:hub` runs the bundle on the host.
 *
 * Environment:
 *   TERMINUS_URL, TERMINUS_USER, TERMINUS_PASS, TERMINUS_DB  the store (see README.md)
 *   ARMATURE_IDENTITY, ARMATURE_EXPORT_KEY                  optional (see README.md)
 *   ARMATURE_ALLOWED_HOSTS, ARMATURE_ALLOWED_ORIGINS        optional, comma-separated: host names besides
 *                                                            loopback, and web origins, the hub serves
 *                                                            (ADR-0067 decision 7; lib/api/boundary.ts)
 *   ARMATURE_ROLE                                            `remote` (default) or `workspace` (ADR-0065;
 *                                                            lib/api/role.ts)
 *   ARMATURE_REMOTE_URL                                      the remote hub's address, required when the
 *                                                            role is `workspace`
 *   ARMATURE_WORKSPACE_DIR                                   the folder a workspace hub keeps its workspaces in,
 *                                                            their records and the file-backed store, the one
 *                                                            local store (ADR-0066; lib/api/filestore/); required
 *                                                            when the role is `workspace`, and no TERMINUS_*
 *                                                            variable is read then
 *   ARMATURE_SNAPSHOTS                                       how many older remote commits a workspace holds
 *                                                            as snapshots, 20 by default (plan §8)
 *   ARMATURE_LOCAL_TOKEN                                     a workspace hub's per-launch secret, which every
 *                                                            write to it carries as Armature-Local-Token (ADR-0065
 *                                                            decision 7; lib/api/localToken.ts); the desktop program
 *                                                            sets it for the tools it launches; drawn and printed
 *                                                            once at start when unset
 *   ARMATURE_WORKSPACE_ACTIONS                               `routes` serves push, bring in and deliver as routes
 *                                                            on a workspace hub, for the compose profile until the
 *                                                            desktop program exists; unset, they are the program's
 *                                                            own and the routes are refused
 *   PORT                                                     default 3100 (Next.js dev uses 3000)
 *   HOST                                                     default 127.0.0.1: the `header` resolver trusts
 *                                                            the caller, so the hub stays on this machine
 *                                                            unless told otherwise; the container sets 0.0.0.0
 *                                                            and the compose file confines what is published
 *   ARMATURE_TRUST_NETWORK                                   `1` lets a hub under `header` listen on an address
 *                                                            other than loopback, saying a private network is
 *                                                            the gate (ADR-0067 decision 8); the compose file
 *                                                            sets it, the image does not
 *
 * On the host, `.env.local` in the working directory is read first, as Next.js
 * reads it, so the standalone hub and `next dev` reach the same store with the
 * same file; a variable already set in the environment wins. The container
 * has no such file and takes everything from the environment.
 */
import { configFromEnv } from './lib/api/config';
import { loadEnvLocal } from './lib/envLocal';
import { drawLocalToken } from './lib/api/localToken';
import { openFileStore } from './lib/api/filestore/store';
import { bindRefusal, startHub } from './lib/hub';
import { folderFiles, folderRecords, lockFolder } from './lib/workspaceFolder';

async function main(): Promise<void> {
  loadEnvLocal();
  // Read on every request, so read once here too: a setting the hub cannot
  // serve under stops it before it listens, not at each request.
  const config = configFromEnv();
  const port = Number(process.env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a port number, not ${JSON.stringify(process.env.PORT)}`);
  }
  // A remote hub reads its environment on every request; a workspace hub is
  // configured once, with its records in a folder, which only a host can give.
  const hostname = process.env.HOST?.trim() || '127.0.0.1';
  const refusal = bindRefusal({ hostname, identity: config.identity, trustNetwork: process.env.ARMATURE_TRUST_NETWORK?.trim() === '1' });
  if (refusal) throw new Error(refusal);
  // A workspace hub opens its folder once as the file-backed store and locks it against a second process (ADR-0066 decisions 2 and 4).
  const dir = config.workspaceDir;
  const unlock = dir ? await lockFolder(dir) : undefined;
  const files = dir ? openFileStore(folderFiles(dir)) : undefined;
  // A workspace hub's per-launch secret (ADR-0065 decision 7): the program's when it set
  // ARMATURE_LOCAL_TOKEN, else drawn here and shown once, so the hub is never open.
  const drawn = config.role === 'workspace' && !config.localToken ? drawLocalToken() : undefined;
  const hub = await startHub({
    port,
    hostname,
    ...(dir
      ? { config: { ...config, workspaces: folderRecords(dir), ...(files ? { store: () => ({ files }) } : {}), ...(drawn ? { localToken: drawn } : {}) } }
      : {}),
  });
  console.log(`Armature hub (revision ${hub.revision}) listening at ${hub.url}/api/v1`);
  if (config.role === 'workspace') {
    console.log(`  role: workspace, of the remote at ${config.remote}; records in ${config.workspaceDir}`);
    console.log(`  actions: push, bring in and deliver ${config.actionRoutes ? 'served as routes (ARMATURE_WORKSPACE_ACTIONS=routes)' : "are the program's own; the routes are refused"}`);
    if (drawn) console.log(`  local token: ${drawn}\n  (drawn at this start; every write carries it as Armature-Local-Token. Set ARMATURE_LOCAL_TOKEN to choose it)`);
    else console.log('  local token: from ARMATURE_LOCAL_TOKEN; every write carries it as Armature-Local-Token');
  }
  if (files) console.log(`  store: the file-backed store in ${dir}`);
  else console.log(`  store: ${process.env.TERMINUS_URL ?? '(TERMINUS_URL is not set)'} database ${process.env.TERMINUS_DB ?? '(TERMINUS_DB is not set)'}`);

  // Docker sends SIGTERM on `compose down`; close the listener so in-flight
  // requests finish, then exit. A second signal exits at once.
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`${signal} received, stopping`);
    hub
      .close()
      .then(() => unlock?.())
      .then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
