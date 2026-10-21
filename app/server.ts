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
 *   ARMATURE_IDENTITY, ARMATURE_EXPORT_KEY                  optional, as for the Next.js host
 *   PORT                                                     default 3100 (Next.js dev uses 3000)
 *   HOST                                                     default 0.0.0.0
 *
 * On the host, `.env.local` in the working directory is read first, as Next.js
 * reads it, so the standalone hub and `next dev` reach the same store with the
 * same file; a variable already set in the environment wins. The container
 * has no such file and takes everything from the environment.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startHub } from './lib/hub';

function loadEnvLocal(): void {
  const file = resolve(process.cwd(), '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    if (!(key in process.env)) process.env[key] = trimmed.slice(i + 1).trim();
  }
}

async function main(): Promise<void> {
  loadEnvLocal();
  const port = Number(process.env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a port number, not ${JSON.stringify(process.env.PORT)}`);
  }
  const hub = await startHub({ port, hostname: process.env.HOST ?? '0.0.0.0' });
  console.log(`Armature hub (revision ${hub.revision}) listening at ${hub.url}/api/v1`);
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
