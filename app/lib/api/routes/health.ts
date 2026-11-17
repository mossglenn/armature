import { Hono } from 'hono';
import { storeFor } from '../config';
import { REGISTRY_BRANCH } from '../identity';

/**
 * Health (ADR-0067 decision 7, note of 2026-10-30, built 2026-11-05): two
 * routes for whatever watches a hub, a container runtime's health check or
 * a proxy's, open without a token under `oidc` as `GET /discover` is, since a
 * probe cannot sign in, and saying nothing about the graph.
 *
 *   GET /health/live    the process answers: 200 { live: true }, no store
 *   GET /health/ready   the store answers too: 200 { ready: true } when the
 *                       registry branch's head can be read, else 503
 *                       not_ready; a hub that is up but whose store is not
 *                       yet is live and not ready; the answer is kept
 *                       for READY_KEPT_MS
 */
/**
 * How long an answer of `/ready` is kept. The probe is open to anyone who can
 * reach the hub, through the proxy too under `oidc`, and each read of it was a
 * read of the store (the 2026-11-09 review's A7); kept this long, a caller
 * asking in a loop costs the store one read per period, and requests that
 * arrive together share the one in flight. Short against every probe's own
 * interval, so a store that goes or comes back is said within a period.
 */
export const READY_KEPT_MS = 2000;

/** The health routes of one app, which keeps its own last answer: two hubs in one process never answer for each other. */
export function healthRoutes(now: () => number = Date.now): Hono {
  const health = new Hono();
  let kept: { until: number; ready: Promise<boolean> } | undefined;

  health.get('/live', (c) => c.json({ live: true }));

  health.get('/ready', async (c) => {
    if (!kept || kept.until <= now()) {
      const ready = storeFor(c, { branch: REGISTRY_BRANCH })
        .head()
        .then(
          () => true,
          (err: unknown) => {
            console.error('Not ready: the store did not answer', err instanceof Error ? err.message : err);
            return false;
          }
        );
      const mine = (kept = { until: Number.POSITIVE_INFINITY, ready });
      // The period runs from the store's answer, so a slow store is not asked again while it is still answering.
      void ready.then(() => (mine.until = now() + READY_KEPT_MS));
    }
    if (await kept.ready) return c.json({ ready: true });
    c.header('Retry-After', '5');
    return c.json({ error: 'not_ready', message: 'The store did not answer; the hub is up and will serve once it does' }, 503);
  });

  return health;
}
