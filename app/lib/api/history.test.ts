/**
 * The history route's memo (2026-10-23): an answer is kept by the commit it
 * was read at and served again while the branch head stands still; a write
 * moves the head and the next read is fresh. On a scratch branch, deleted afterwards.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from './app';
import { historyMemo } from './routes/documents';

const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
const BRANCH = `test-history-${Date.now().toString(36)}`;
const q = `?branch=${BRANCH}`;
const ID = 'DesignNote/history-memo-note';

const put = (path: string, body: unknown) => app.request(path, { method: 'PUT', headers: HEADERS, body: JSON.stringify(body) });
const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: HEADERS, body: JSON.stringify(body) });
const history = async () => {
  const res = await app.request(`/api/v1/documents/${ID}/history${q}&diff=false`);
  expect(res.status).toBe(200);
  return { entries: ((await res.json()) as { entries: unknown[] }).entries, etag: res.headers.get('etag') };
};

describe('the history memo', () => {
  beforeAll(async () => {
    const res = await post('/api/v1/branches', { name: BRANCH, from: { branch: 'main' } });
    expect(res.status).toBe(201);
    const written = await put(`/api/v1/documents/${ID}${q}`, { message: 'A note for the history memo test', document: { '@type': 'DesignNote', label: 'A note whose history is read twice', subject: ['LearningObjective/identify-ai-limitations'], rationale: 'The memo test.' } });
    expect([200, 201], await written.text()).toContain(written.status);
  });
  afterAll(async () => {
    await app.request(`/api/v1/branches/${BRANCH}`, { method: 'DELETE', headers: HEADERS });
  });

  it('serves the same answer from memory while the head stands still, and a fresh one after a write', async () => {
    historyMemo.clear();
    const first = await history();
    expect(first.entries).toHaveLength(1);
    expect({ hits: historyMemo.hits, misses: historyMemo.misses }).toEqual({ hits: 0, misses: 1 });
    const second = await history();
    expect(second).toEqual(first);
    expect(historyMemo.hits).toBe(1);

    const changed = await put(`/api/v1/documents/${ID}${q}`, { message: 'The note revised, so the head moves', document: { '@type': 'DesignNote', label: 'A note whose history is read twice, revised', subject: ['LearningObjective/identify-ai-limitations'], rationale: 'The memo test.' } });
    expect(changed.status, await changed.text()).toBe(200);
    const third = await history();
    expect(third.entries).toHaveLength(2);
    expect(third.etag).not.toBe(first.etag);
    expect(historyMemo.misses).toBe(2);
  });
});
