/**
 * A workspace hub's per-launch secret and the program's own actions
 * (ADR-0065 decision 7, note of 2026-10-30; ./localToken.ts): every write
 * carries `Armature-Local-Token`, a write without it or with another value is
 * 403 `forbidden` (`reason: local_token`), reads stay open, a hub given no
 * token refuses every write, a remote hub ignores the header; push, bring in
 * and deliver are refused (`reason: program_action`) unless the host asked for
 * the routes, and `GET /discover` says which. No request here reaches a store:
 * each is refused before, or malformed.
 */
import { describe, expect, it } from 'vitest';
import { app, createApp } from './app';
import { configFromEnv, type HubConfig } from './config';
import { drawLocalToken, tokenMatches } from './localToken';
import { memoryRecords } from './workspace/records';

const TOKEN = 'local-token-probe';
const base = (): HubConfig => ({ ...configFromEnv(), role: 'workspace', remote: 'http://127.0.0.1:9', workspaces: memoryRecords() });
const workspace = createApp(() => ({ ...base(), localToken: TOKEN }));
const withRoutes = createApp(() => ({ ...base(), localToken: TOKEN, actionRoutes: true }));
const tokenless = createApp(() => base());

const USER = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const send = (hub: typeof app, method: string, path: string, headers: Record<string, string> = USER, body = JSON.stringify({ name: 'x' })) =>
  hub.request(`/api/v1${path}`, { method, headers, body: method === 'GET' ? undefined : body });
const refusal = async (res: Response) => ({ status: res.status, ...(await res.json()) });

describe('the token itself', () => {
  it('is drawn as 64 hexadecimal characters, fresh each time, and compared whole', () => {
    const a = drawLocalToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(drawLocalToken()).not.toBe(a);
    expect(tokenMatches(a, a)).toBe(true);
    expect(tokenMatches(a, a.slice(0, -1))).toBe(false);
    expect(tokenMatches(`${a}0`, a)).toBe(false);
    expect(tokenMatches(undefined, a)).toBe(false);
    expect(tokenMatches('', a)).toBe(false);
    expect(tokenMatches(a, undefined)).toBe(false);
  });

  it('is read from ARMATURE_LOCAL_TOKEN on a workspace hub only, and the action routes from ARMATURE_WORKSPACE_ACTIONS', () => {
    const ws = { ARMATURE_ROLE: 'workspace', ARMATURE_REMOTE_URL: 'http://localhost:3100', ARMATURE_WORKSPACE_DIR: '/tmp/ws' };
    expect(configFromEnv({ ...ws, ARMATURE_LOCAL_TOKEN: ' abc ' })).toMatchObject({ localToken: 'abc', actionRoutes: false });
    expect(configFromEnv(ws).localToken).toBeUndefined();
    expect(configFromEnv({ ...ws, ARMATURE_LOCAL_TOKEN: '' }).localToken).toBeUndefined();
    expect(configFromEnv({ ...ws, ARMATURE_WORKSPACE_ACTIONS: 'routes' }).actionRoutes).toBe(true);
    expect(() => configFromEnv({ ...ws, ARMATURE_WORKSPACE_ACTIONS: 'yes' })).toThrow(/not a setting/);
    // A remote hub has no local token and serves no action routes, whatever the environment says.
    expect(configFromEnv({ ARMATURE_LOCAL_TOKEN: 'abc', ARMATURE_WORKSPACE_ACTIONS: 'routes' })).toMatchObject({ role: 'remote', actionRoutes: false });
    expect(configFromEnv({ ARMATURE_LOCAL_TOKEN: 'abc' }).localToken).toBeUndefined();
  });
});

describe('every write to a workspace hub carries the token', () => {
  it('refuses a write without it, or with another value, before identity, and names the reason', async () => {
    const missing = await refusal(await send(workspace, 'POST', '/workspace'));
    expect(missing).toMatchObject({ status: 403, error: 'forbidden', reason: 'local_token' });
    expect(missing.message).toContain('Armature-Local-Token');
    const wrong = await refusal(await send(workspace, 'POST', '/workspace', { ...USER, 'Armature-Local-Token': 'not-it' }));
    expect(wrong).toMatchObject({ status: 403, error: 'forbidden', reason: 'local_token' });
    // Before identity: no identity at all is still the token's refusal, not 401.
    const nobody = await refusal(await send(workspace, 'PUT', '/documents/LearningNeed/x?branch=main', { 'Content-Type': 'application/json' }));
    expect(nobody).toMatchObject({ status: 403, reason: 'local_token' });
    // Every write method, the remote-only routes included: the token is asked first.
    for (const [method, path] of [['PUT', '/documents/LearningNeed/x?branch=main'], ['POST', '/documents?branch=main'], ['DELETE', '/documents/LearningNeed/x?branch=main'], ['POST', '/branches'], ['POST', '/users']]) {
      expect((await refusal(await send(workspace, method, path))).reason, `${method} ${path}`).toBe('local_token');
    }
  });

  it('passes a write with it on to the route, and leaves reads open', async () => {
    // Past the token the body is judged: a malformed one is 400, not 403.
    const past = await refusal(await send(workspace, 'POST', '/workspace', { ...USER, 'Armature-Local-Token': TOKEN }, JSON.stringify({})));
    expect(past.status).toBe(400);
    const list = await send(workspace, 'GET', '/workspace');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual([]);
    expect((await send(workspace, 'GET', '/discover')).status).toBe(200);
  });

  it('a workspace hub given no token refuses every write, token or not; a remote hub ignores the header', async () => {
    expect(await refusal(await send(tokenless, 'POST', '/workspace'))).toMatchObject({ status: 403, reason: 'local_token' });
    expect(await refusal(await send(tokenless, 'POST', '/workspace', { ...USER, 'Armature-Local-Token': TOKEN }))).toMatchObject({ status: 403, reason: 'local_token' });
    expect((await send(tokenless, 'GET', '/workspace')).status).toBe(200);
    // On a remote hub the header is neither required nor checked: a malformed body is judged as such.
    expect((await send(app, 'POST', '/branches', USER, JSON.stringify({ message: '' }))).status).toBe(400);
    expect((await send(app, 'POST', '/branches', { ...USER, 'Armature-Local-Token': 'anything' }, JSON.stringify({ message: '' }))).status).toBe(400);
  });
});

describe("push, bring in and deliver are the program's own actions", () => {
  const WITH = { ...USER, 'Armature-Local-Token': TOKEN };

  it('are refused as routes unless the host asked for them, before the workspace is looked up', async () => {
    for (const action of ['push', 'bring-in', 'deliver'] as const) {
      const res = await refusal(await send(workspace, 'POST', `/workspace/no-such-ws/${action}`, WITH, JSON.stringify({ message: 'm' })));
      expect(res, action).toMatchObject({ status: 403, error: 'forbidden', reason: 'program_action', permission: action });
      // Asked for, the route runs and finds no such workspace.
      expect((await send(withRoutes, 'POST', `/workspace/no-such-ws/${action}`, WITH, JSON.stringify({ message: 'm' }))).status, action).toBe(404);
    }
  });

  it('GET /discover says which, with the token required either way', async () => {
    const settings = async (hub: typeof app) => (await (await send(hub, 'GET', '/discover')).json()).capabilities['armature/workspace'];
    expect(await settings(workspace)).toEqual({ fallback: 'reject', profile: 'full', localToken: 'required', actions: 'program' });
    expect(await settings(withRoutes)).toEqual({ fallback: 'reject', profile: 'full', localToken: 'required', actions: 'routes' });
    expect((await (await send(app, 'GET', '/discover')).json()).capabilities['armature/workspace']).toBeUndefined();
  });
});
