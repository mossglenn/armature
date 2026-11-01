/**
 * The loopback boundary (ADR-0067 decision 7): the `Host` and `Origin` checks
 * that run before anything else. In-process through `app.request` with full
 * URLs, since the hub reads the host from the request's URL as Node's server
 * builds it from the `Host` header; hub.test.ts sends a raw `Host` over a
 * socket. The reads used here need no store, and the writes are refused before
 * they reach one.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { app, createApp } from './app';
import { hostAllowed, originAllowed } from './boundary';
import { configFromEnv } from './config';

const saved = { hosts: process.env.ARMATURE_ALLOWED_HOSTS, origins: process.env.ARMATURE_ALLOWED_ORIGINS };
afterEach(() => {
  for (const [name, value] of [['ARMATURE_ALLOWED_HOSTS', saved.hosts], ['ARMATURE_ALLOWED_ORIGINS', saved.origins]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const discover = (host: string, headers: Record<string, string> = {}) =>
  app.request(`http://${host}/api/v1/discover`, { headers });
/** A write with no identity: past the boundary it is 401, so a 403 shows the boundary answered first. */
const write = (host: string, headers: Record<string, string> = {}) =>
  app.request(`http://${host}/api/v1/documents/LearningNeed/boundary-probe?branch=main`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ message: 'x', document: { label: 'x', rationale: 'x' } }),
  });
const error = async (res: Response) => (await res.json()).error;

describe('Host', () => {
  it('answers loopback names, with any port and a trailing dot', async () => {
    for (const host of ['localhost', 'localhost:3100', '127.0.0.1:3100', '[::1]:3100', 'localhost.', 'quiver.localhost']) {
      expect((await discover(host)).status, host).toBe(200);
    }
  });

  it('refuses any other name, a rebinding page included, before identity is resolved', async () => {
    for (const host of ['attacker.example', 'attacker.example:3100', '192.168.1.20', 'hub']) {
      const res = await discover(host);
      expect(res.status, host).toBe(403);
      expect(await error(res)).toBe('host_not_allowed');
    }
    const refused = await write('attacker.example:3100', { 'Armature-User': 'demo-designer@example.edu' });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toBe('host_not_allowed');
    expect((await write('localhost')).status).toBe(401);
  });

  it('answers the names ARMATURE_ALLOWED_HOSTS adds, as the compose file adds hub', async () => {
    process.env.ARMATURE_ALLOWED_HOSTS = 'hub, Armature.Example.org';
    expect((await discover('hub:3100')).status).toBe(200);
    expect((await discover('armature.example.org')).status).toBe(200);
    expect((await discover('attacker.example')).status).toBe(403);
    expect(hostAllowed('HUB', configFromEnv().allowedHosts)).toBe(true);
  });

  it('is each app\'s own, so two hubs in one process answer different hosts', async () => {
    const other = createApp(() => ({ ...configFromEnv(), allowedHosts: new Set(['hub']) }));
    expect((await other.request('http://hub:3100/api/v1/discover')).status).toBe(200);
    expect((await discover('hub:3100')).status).toBe(403);
  });
});

describe('Origin', () => {
  it('serves a request with no Origin, as every tool outside a browser sends', async () => {
    const res = await discover('localhost');
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('refuses a remote web origin, on a write before identity, and null', async () => {
    for (const origin of ['https://attacker.example', 'http://192.168.1.20:8080', 'null', 'not an origin']) {
      const res = await discover('localhost', { Origin: origin });
      expect(res.status, origin).toBe(403);
      expect(await error(res)).toBe('origin_not_allowed');
    }
    const refused = await write('localhost:3100', { Origin: 'https://attacker.example', 'Armature-User': 'demo-designer@example.edu' });
    expect(refused.status).toBe(403);
    expect(await error(refused)).toBe('origin_not_allowed');
  });

  it("serves a desktop shell's origin and a loopback page's, without CORS answers", async () => {
    // Tauri's HTTP plugin sends its webview's origin on every request (Quiver).
    for (const origin of ['tauri://localhost', 'http://tauri.localhost', 'http://localhost:1420', 'http://127.0.0.1:5173']) {
      const res = await discover('localhost', { Origin: origin });
      expect(res.status, origin).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    }
  });

  it('serves a listed origin with CORS answers: a preflight, a read, and a refusal the page can read', async () => {
    process.env.ARMATURE_ALLOWED_ORIGINS = 'https://coqui.example.org';
    const origin = 'https://coqui.example.org';
    const preflight = await app.request('http://localhost/api/v1/documents/LearningNeed/x', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type, armature-user, if-match' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Armature-User');
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('PUT');

    const read = await discover('localhost', { Origin: origin });
    expect(read.status).toBe(200);
    expect(read.headers.get('Access-Control-Allow-Origin')).toBe(origin);
    expect(read.headers.get('Access-Control-Expose-Headers')).toBe('ETag, Armature-Version');
    expect(read.headers.get('Vary')).toContain('Origin');

    const refusal = await write('localhost', { Origin: origin });
    expect(refusal.status).toBe(401);
    expect(refusal.headers.get('Access-Control-Allow-Origin')).toBe(origin);
  });

  it('decides an origin by its listing, its scheme and its host', () => {
    process.env.ARMATURE_ALLOWED_ORIGINS = 'https://coqui.example.org';
    expect(originAllowed('https://coqui.example.org', configFromEnv().allowedOrigins)).toBe(true);
    expect(originAllowed('https://COQUI.example.org', configFromEnv().allowedOrigins)).toBe(true);
    expect(originAllowed('https://coqui.example.org.attacker.example', configFromEnv().allowedOrigins)).toBe(false);
    expect(originAllowed('chrome-extension://abcdef', configFromEnv().allowedOrigins)).toBe(true);
    expect(originAllowed('null', configFromEnv().allowedOrigins)).toBe(false);
  });
});
