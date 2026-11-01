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
 *   PORT                                                     default 3100 (Next.js dev uses 3000)
 *   HOST                                                     default 127.0.0.1: the `header` resolver trusts
 *                                                            the caller, so the hub stays on this machine
 *                                                            unless told otherwise; the container sets 0.0.0.0
 *                                                            and the compose file confines what is published
 *
 * On the host, `.env.local` in the working directory is read first, as Next.js
 * reads it, so the standalone hub and `next dev` reach the same store with the
 * same file; a variable already set in the environment wins. The container
 * has no such file and takes everything from the environment.
 */
import { configFromEnv } from './lib/api/config';
import { loadEnvLocal } from './lib/envLocal';
import { startHub } from './lib/hub';

async function main(): Promise<void> {
  loadEnvLocal();
  // Read on every request, so read once here too: a setting the hub cannot
  // serve under stops it before it listens, not at each request.
  const config = configFromEnv();
  const port = Number(process.env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a port number, not ${JSON.stringify(process.env.PORT)}`);
  }
  const hub = await startHub({ port, hostname: process.env.HOST?.trim() || '127.0.0.1' });
  console.log(`Armature hub (revision ${hub.revision}) listening at ${hub.url}/api/v1`);
  if (config.role === 'workspace') console.log(`  role: workspace, of the remote at ${config.remote}`);
  console.log(`  store: ${process.env.TERMINUS_URL ?? '(TERMINUS_URL is not set)'} database ${process.env.TERMINUS_DB ?? '(TERMINUS_DB is not set)'}`);

  // Docker sends SIGTERM on `compose down`; close the listener so in-flight
  // requests finish, then exit. A second signal exits at once.
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`${signal} received, stopping`);
    hub.close().then(() => process.exit(0), () => process.exit(1));
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
