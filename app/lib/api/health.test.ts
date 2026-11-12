/**
 * The health probes (ADR-0067 decision 7, note; routes/health.ts): live
 * without a store, ready with one, both open without a token under `oidc`.
 */
import { describe, expect, it } from 'vitest';
import { app, createApp } from './app';
import { configFromEnv } from './config';
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
