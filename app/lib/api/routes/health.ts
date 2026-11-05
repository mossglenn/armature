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
 *                       yet is live and not ready
 */
export const health = new Hono();

health.get('/live', (c) => c.json({ live: true }));

health.get('/ready', async (c) => {
  try {
    await storeFor(c, { branch: REGISTRY_BRANCH }).head();
    return c.json({ ready: true });
  } catch (err) {
    console.error('Not ready: the store did not answer', err instanceof Error ? err.message : err);
    c.header('Retry-After', '5');
    return c.json({ error: 'not_ready', message: 'The store did not answer; the hub is up and will serve once it does' }, 503);
  }
});
