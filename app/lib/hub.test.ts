/**
 * The standalone hub (Phase 7): the same Hono app served by Node over a real
 * socket, through `startHub`. What is checked is that a plugin talking HTTP to
 * the standalone process gets what the in-process app gives, headers included:
 * the version contract on a read that needs no store, a list read with its
 * commit, a write on a scratch branch with identity and If-Match, a 404 by
 * stable code, and a clean stop. The routes themselves are the other suites.
 */
import { request } from 'node:http';
import { createClient, HubError } from '@armature/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './api/app';
import { CURRENT_REVISION } from './api/version';
import { createStore } from './api/store';
import { startHub, type RunningHub } from './hub';

const stamp = Date.now().toString(36);
const BRANCH = `test-hub-${stamp}`;

describe('the hub as its own process', () => {
  let running: RunningHub;
  let hub: ReturnType<typeof createClient>;

  beforeAll(async () => {
    // Port 0: the operating system picks a free one, so the suite never
    // collides with a hub already running on 3100 or with Next on 3000.
    running = await startHub({ port: 0, hostname: '127.0.0.1' });
    hub = createClient({ baseUrl: running.url, user: 'demo-designer@example.edu' });
  });

  afterAll(async () => {
    await createStore({ branch: 'main' }).deleteBranch(BRANCH).catch(() => undefined);
    await running?.close();
  });

  it('listens on the port it was given and reports the revision it serves', () => {
    expect(running.port).toBeGreaterThan(0);
    expect(running.url).toBe(`http://127.0.0.1:${running.port}`);
    expect(running.revision).toBe(CURRENT_REVISION);
  });

  it('serves GET /discover over the socket exactly as the app does in-process', async () => {
    const overHttp = await fetch(`${running.url}/api/v1/discover`);
    const inProcess = await app.request('/api/v1/discover');
    expect(overHttp.status).toBe(200);
    expect(overHttp.headers.get('Armature-Version')).toBe(CURRENT_REVISION);
    expect(await overHttp.json()).toEqual(await inProcess.json());
  });

  it('answers a list read with the commit in the ETag, the same commit the app reports', async () => {
    const { data, commit, version } = await hub.documents.list('LearningObjective');
    expect(data.length).toBeGreaterThan(0);
    expect(version).toBe(CURRENT_REVISION);
    const inProcess = await app.request('/api/v1/documents/LearningObjective');
    expect(`"${commit}"`).toBe(inProcess.headers.get('ETag'));
  });

  it('takes a write on a branch with the identity header and If-Match', async () => {
    await hub.branches.create(BRANCH);
    const id = `hub-note-${stamp}`;
    const first = await hub.documents.put('DesignNote', id, {
      branch: BRANCH,
      message: 'Written over HTTP to the standalone hub',
      document: { label: 'Hub note', rationale: 'First version', subject: ['Module/how-ai-works'] },
    });
    expect(first.data).toEqual({ id: `DesignNote/${id}`, commit: first.commit });

    const stale = await hub.documents
      .put('DesignNote', id, {
        branch: BRANCH,
        ifMatch: 'nosuchcommit',
        message: 'A stale write',
        document: { label: 'Hub note', rationale: 'Should not land', subject: ['Module/how-ai-works'] },
      })
      .catch((e) => e);
    expect(stale).toBeInstanceOf(HubError);
    expect((stale as HubError).status).toBe(412);

    const read = await hub.documents.get('DesignNote', id, { branch: BRANCH });
    expect(read.data.rationale).toBe('First version');
    expect(read.data.createdBy).toBe('User/demo-designer');
  });

  it('answers a missing document with the stable code', async () => {
    const err = await hub.documents.get('Module', 'no-such-module').catch((e) => e);
    expect(err).toBeInstanceOf(HubError);
    expect((err as HubError).status).toBe(404);
    expect((err as HubError).code).toBe('not_found');
  });

  it('refuses a request whose Host header names another site, as a rebinding page sends (ADR-0067 decision 7)', async () => {
    // fetch will not send a Host of the caller's choosing; a raw request does, as a browser
    // does for a page whose domain was pointed at this machine.
    const ask = (host: string) =>
      new Promise<{ status: number; body: string }>((resolve, reject) => {
        const req = request({ host: '127.0.0.1', port: running.port, path: '/api/v1/discover', headers: { Host: host } }, (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        });
        req.on('error', reject);
        req.end();
      });
    const refused = await ask(`attacker.example:${running.port}`);
    expect(refused.status).toBe(403);
    expect(JSON.parse(refused.body).error).toBe('host_not_allowed');
    expect((await ask(`localhost:${running.port}`)).status).toBe(200);
  });

  it('stops cleanly and refuses connections afterward', async () => {
    const other = await startHub({ port: 0, hostname: '127.0.0.1' });
    expect((await fetch(`${other.url}/api/v1/discover`)).status).toBe(200);
    await other.close();
    await expect(fetch(`${other.url}/api/v1/discover`)).rejects.toThrow();
  });
});
