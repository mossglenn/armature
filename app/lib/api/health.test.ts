/**
 * The health probes (ADR-0067 decision 7, note; routes/health.ts): live
 * without a store, ready with one, both open without a token under `oidc`.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { app, createApp } from './app';
import { configFromEnv } from './config';
import { healthRoutes, READY_KEPT_MS } from './routes/health';
import { storeConfigFromEnv } from './store';

describe('GET /api/v1/health', () => {
  it('is live whatever the store does, and ready when the registry branch answers', async () => {
    const live = await app.request('/api/v1/health/live');
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ live: true });
    const ready = await app.request('/api/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(await ready.json()).toEqual({ ready: true });
  });

  it('is live and not ready while the store cannot be reached, with Retry-After', async () => {
    const stranded = createApp(() => ({ ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), url: 'http://127.0.0.1:9' }) }));
    expect((await stranded.request('/api/v1/health/live')).status).toBe(200);
    const ready = await stranded.request('/api/v1/health/ready');
    expect(ready.status).toBe(503);
    expect(ready.headers.get('Retry-After')).toBe('5');
    expect((await ready.json()).error).toBe('not_ready');
  });

  it("keeps its answer for a short while, so a caller without a token cannot make the store work on every request (the 2026-11-09 review's A7)", async () => {
    const there = storeConfigFromEnv().url;
    let url = there;
    const config = () => ({ ...configFromEnv(), store: () => ({ ...storeConfigFromEnv(), url }) });
    // The app's own routes: ready, then the store gone, and the answer still the one kept.
    const hub = createApp(config);
    expect((await hub.request('/api/v1/health/ready')).status).toBe(200);
    url = 'http://127.0.0.1:9';
    expect((await hub.request('/api/v1/health/ready')).status).toBe(200);

    // With the clock in hand: the kept answer ends after READY_KEPT_MS, and a refusal is kept as long.
    let clock = 1_000_000;
    const routes = healthRoutes(() => clock);
    const probed = new Hono()
      .use('*', async (c, next) => {
        c.set('hub' as never, config() as never);
        await next();
      })
      .route('/health', routes);
    const ready = async (reachable: boolean) => {
      url = reachable ? there : 'http://127.0.0.1:9';
      return (await probed.request('/health/ready')).status;
    };
    expect(await ready(true)).toBe(200);
    expect(await ready(false)).toBe(200);
    clock += READY_KEPT_MS + 1;
    expect(await ready(false)).toBe(503);
    expect(await ready(true)).toBe(503);
    clock += READY_KEPT_MS + 1;
    expect(await ready(true)).toBe(200);
  });

  it('needs no token under oidc, as a probe cannot sign in', async () => {
    const oidc = createApp(() => ({
      ...configFromEnv(),
      identity: 'oidc',
      oidc: { issuer: 'https://login.example.edu', audience: 'armature-hub', admit: { issuers: new Set(), domains: new Set() }, services: new Set() },
    }));
    expect((await oidc.request('/api/v1/health/live')).status).toBe(200);
    expect((await oidc.request('/api/v1/health/ready')).status).toBe(200);
    expect((await oidc.request('/api/v1/users/me')).status).toBe(401);
  });
});
