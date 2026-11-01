/**
 * A hub's role (ADR-0065; docs/workspace-hub-plan.md §9 and §13, "The
 * refusals"): every route a workspace hub refuses answers 400 `remote_only`
 * there and passes on a remote hub, writes to the mirror of `main` are refused,
 * reads are served, and `GET /discover` says which. A workspace app and the
 * environment's app run side by side in this process over the same store; no
 * request here writes, since every one is refused or malformed.
 */
import { describe, expect, it } from 'vitest';
import { app, createApp } from './app';
import { configFromEnv } from './config';
import { REMOTE_ONLY } from './role';

const workspace = createApp(() => ({ ...configFromEnv(), role: 'workspace', remote: 'http://localhost:3100' }));

const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
/** A body neither hub can act on: past the refusal it is a 400 of another code, or a 404. */
const MALFORMED = JSON.stringify({ message: '' });

const send = (hub: typeof app, method: string, path: string, body: string | undefined = MALFORMED) =>
  hub.request(`/api/v1${path}`, { method, headers: HEADERS, body: method === 'DELETE' ? undefined : body });
const error = async (res: Response) => (await res.json()).error;

/** A route-table path with its parameter filled. */
const concrete = (path: string) => path.replace(':name', 'role-probe-no-such-branch');

describe('the routes only a remote serves (plan §9)', () => {
  it('a workspace hub answers each remote_only, before identity is asked', async () => {
    for (const route of REMOTE_ONLY) {
      const res = await workspace.request(`/api/v1${concrete(route.path)}`, {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
        body: route.method === 'DELETE' ? undefined : MALFORMED,
      });
      expect(res.status, `${route.method} ${route.path}`).toBe(400);
      expect(await error(res), `${route.method} ${route.path}`).toBe('remote_only');
    }
  });

  it('a remote hub passes each to its route', async () => {
    for (const route of REMOTE_ONLY) {
      const res = await send(app, route.method, concrete(route.path));
      expect(await error(res), `${route.method} ${route.path}`).not.toBe('remote_only');
    }
  });
});

describe('the mirror of main (plan §9)', () => {
  it('a workspace hub refuses a write to main, by PUT and by batch', async () => {
    const put = await send(workspace, 'PUT', '/documents/LearningNeed/role-probe?branch=main');
    expect(put.status).toBe(400);
    expect(await error(put)).toBe('remote_only');
    const batch = await send(workspace, 'POST', '/documents');
    expect(batch.status).toBe(400);
    expect(await error(batch)).toBe('remote_only');
  });

  it('a workspace hub takes a write to another branch to the pipeline', async () => {
    const res = await send(workspace, 'PUT', '/documents/LearningNeed/role-probe?branch=role-probe-workspace');
    expect(await error(res)).not.toBe('remote_only');
  });

  it('a workspace hub serves reads of main, the users and the branches', async () => {
    for (const path of ['/documents/LearningObjective?branch=main', '/users', '/users/me', '/branches']) {
      const res = await workspace.request(`/api/v1${path}`, { headers: HEADERS });
      expect(res.status, path).toBe(200);
    }
  });

  it('a workspace hub registers no one: an unknown person is sent to the remote', async () => {
    const res = await workspace.request('/api/v1/users/me', { headers: { 'Armature-User': 'role-probe-nobody@example.edu' } });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unknown_user');
    expect(body.message).toContain('register on the remote');
  });
});

describe('GET /discover names the role and its refusals (plan §3)', () => {
  it('on a workspace hub: the role, the remote-only routes, main read-only', async () => {
    const body = await (await workspace.request('/api/v1/discover')).json();
    expect(body.role).toBe('workspace');
    expect(body.capabilities['armature/branches'].remoteOnly).toEqual([
      'POST /api/v1/branches',
      'POST /api/v1/branches/:name/merge',
      'DELETE /api/v1/branches/:name',
    ]);
    expect(body.capabilities['armature/users'].remoteOnly).toEqual(['POST /api/v1/users']);
    expect(body.capabilities['armature/documents'].readOnlyBranches).toEqual(['main']);
  });

  it('on a remote hub: the role, and nothing refused', async () => {
    const body = await (await app.request('/api/v1/discover')).json();
    expect(body.role).toBe('remote');
    expect(body.capabilities['armature/branches'].remoteOnly).toEqual([]);
    expect(body.capabilities['armature/users'].remoteOnly).toEqual([]);
    expect(body.capabilities['armature/documents'].readOnlyBranches).toEqual([]);
  });

  it('every route the table names is a route of the app', () => {
    const routes = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    for (const route of REMOTE_ONLY) expect(routes.has(`${route.method} /api/v1${route.path}`), route.path).toBe(true);
  });
});

describe('the role from the environment', () => {
  it('is remote by default, and a remote hub reads no remote address', () => {
    expect(configFromEnv({ ARMATURE_REMOTE_URL: 'http://ignored' })).toMatchObject({ role: 'remote' });
    expect(configFromEnv({}).remote).toBeUndefined();
  });

  it('a workspace hub takes its remote without a trailing slash', () => {
    expect(configFromEnv({ ARMATURE_ROLE: 'workspace', ARMATURE_REMOTE_URL: 'https://api.example.org/' })).toMatchObject({
      role: 'workspace',
      remote: 'https://api.example.org',
    });
  });

  it('refuses an unknown role, and a workspace hub with no remote or a remote that is not http', () => {
    expect(() => configFromEnv({ ARMATURE_ROLE: 'mirror' })).toThrow(/names no role/);
    expect(() => configFromEnv({ ARMATURE_ROLE: 'workspace' })).toThrow(/ARMATURE_REMOTE_URL is required/);
    expect(() => configFromEnv({ ARMATURE_ROLE: 'workspace', ARMATURE_REMOTE_URL: 'hub:3100' })).toThrow(/not an http/);
    expect(() => configFromEnv({ ARMATURE_ROLE: 'workspace', ARMATURE_REMOTE_URL: 'not a url' })).toThrow(/not a URL/);
  });
});
