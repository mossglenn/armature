/**
 * The viewer's connection to a hub (Phase 7, 2026-10-21).
 *
 * Armature's pages are a client of the hub like any plugin: they call the
 * API over HTTP through `@armature/client` and know nothing about the store.
 * The hub's address is the viewer's one piece of configuration,
 * `ARMATURE_HUB_URL`, by default the standalone hub on this machine
 * (`npm run start:hub`, or the `hub` container in docker/docker-compose.yml).
 * The pages only read, so the client carries no identity.
 *
 * Until 2026-10-21 the pages called the Hono app in-process and the Next.js
 * app also hosted the API through a catch-all route; that made the viewer a
 * second hub with its own store credentials. Now there is one hub and the
 * viewer consumes it (ADR-0026 decision 4, ADR-0054).
 */
import { createClient } from '@armature/client';

const origin = (value: string | undefined): string | undefined => value?.trim().replace(/\/+$/, '') || undefined;

/** The hub's origin as the pages reach it, without a trailing slash. */
export function hubUrl(): string {
  return origin(process.env.ARMATURE_HUB_URL) ?? 'http://localhost:3100';
}

/**
 * The hub's origin as a reader's browser could reach it, for the raw-data
 * links in the page footers. Inside a compose network the pages reach the hub
 * as `http://hub:3100`, which no browser can; the links then need the
 * published address (ARMATURE_HUB_PUBLIC_URL), and are omitted when there is
 * none, which is the usual case for a hub kept private behind the viewer.
 * On a machine where both are localhost, the hub's own address serves.
 */
export function hubPublicUrl(): string | undefined {
  const explicit = origin(process.env.ARMATURE_HUB_PUBLIC_URL);
  if (explicit) return explicit;
  const url = hubUrl();
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(url) ? url : undefined;
}

/** A read-only client of the configured hub. */
export function viewerHub() {
  return createClient({ baseUrl: hubUrl() });
}
