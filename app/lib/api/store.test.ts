import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isDroppedConnection, isUnknownRef, StoreError, TerminusStore } from './store';

// The adapter over a stubbed fetch: a connection the store closes under a
// request (check AG) is retried once for a read and never for a write; the
// store's error names reach callers as kinds. Then the seam itself: the rest
// of the API sees the interfaces, never the class.

const store = new TerminusStore({ url: 'http://store.test', user: 'u', pass: 'p', org: 'admin', db: 'db' }, { branch: 'main' });

const socketError = (code: string, message: string) => Object.assign(new Error(message), { code });
const dropped = () => new TypeError('fetch failed', { cause: socketError('UND_ERR_SOCKET', 'other side closed') });
const answer = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'TerminusDB-Data-Version': 'branch:c1' },
  });
const logEntry = { identifier: 'c1', author: 'a', message: 'm', timestamp: 1 };

function stubFetch(...outcomes: Array<Error | (() => Response)>) {
  const queue = [...outcomes];
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const next = queue.shift();
    if (!next) throw new Error('fetch called more often than the test expected');
    if (next instanceof Error) throw next;
    return next();
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a dropped connection', () => {
  it('is recognized by the code on the error’s cause', () => {
    expect(isDroppedConnection(dropped())).toBe(true);
    expect(isDroppedConnection(new TypeError('terminated', { cause: socketError('ECONNRESET', 'reset') }))).toBe(true);
    expect(isDroppedConnection(new TypeError('fetch failed', { cause: socketError('ECONNREFUSED', 'refused') }))).toBe(false);
    expect(isDroppedConnection(new Error('other'))).toBe(false);
  });

  it('is retried once on a GET read', async () => {
    const fetch = stubFetch(dropped(), () => answer([logEntry]));
    expect(await store.log({ count: 1 })).toEqual([{ id: 'c1', author: 'a', message: 'm', timestamp: 1 }]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is retried once on a read sent as a POST with the GET override', async () => {
    const fetch = stubFetch(dropped(), () => answer([{ '@id': 'Module/m1', '@type': 'Module' }]));
    const { documents, commit } = await store.queryDocuments('Module', {});
    expect(documents.map((d) => d['@id'])).toEqual(['Module/m1']);
    expect(commit).toBe('c1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is retried once on the diff, a POST that changes nothing', async () => {
    const fetch = stubFetch(dropped(), () => answer([]));
    expect(await store.diff('c0', 'c1')).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is retried when it comes while the body is read', async () => {
    const midBody = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new TypeError('terminated', { cause: socketError('UND_ERR_SOCKET', 'other side closed') }));
          },
        })
      );
    const fetch = stubFetch(midBody, () => answer([logEntry]));
    expect(await store.log({ count: 1 })).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('surfaces when the retry is dropped too', async () => {
    const fetch = stubFetch(dropped(), dropped());
    await expect(store.log()).rejects.toThrow('fetch failed');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('is never retried on a write, which the store may have committed', async () => {
    const fetch = stubFetch(dropped());
    await expect(
      store.putDocument({ '@id': 'Module/m1', '@type': 'Module' }, { author: 'a', message: 'm' })
    ).rejects.toThrow('fetch failed');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves other failures of a read alone', async () => {
    const refused = new TypeError('fetch failed', { cause: socketError('ECONNREFUSED', 'connect ECONNREFUSED') });
    const fetch = stubFetch(refused);
    await expect(store.log()).rejects.toBe(refused);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('a refusal from the store', () => {
  const refusal = (status: number, type: string) => () =>
    new Response(JSON.stringify({ 'api:error': { '@type': type } }), { status, headers: { 'Content-Type': 'application/json' } });
  const refused = async (status: number, type: string): Promise<StoreError> => {
    stubFetch(refusal(status, type));
    return store.getDocument('Module/m1').then(
      () => expect.fail('the read should have been refused'),
      (err: unknown) => err as StoreError
    );
  };

  it('carries a kind mapped from the store\'s error name, and keeps the name', async () => {
    const err = await refused(404, 'api:DocumentNotFound');
    expect(err).toBeInstanceOf(StoreError);
    expect(err.kind).toBe('not_found');
    expect(err.type).toBe('api:DocumentNotFound');
    expect((await refused(412, 'api:DataVersionMismatch')).kind).toBe('version_mismatch');
    expect((await refused(400, 'api:BranchExistsError')).kind).toBe('exists');
    expect((await refused(400, 'api:SubmittedIdDoesNotMatchGeneratedId')).kind).toBe('id_mismatch');
  });

  it('is an unknown ref for a missing branch or commit, or any 404', async () => {
    const missing = await refused(400, 'api:UnresolvableAbsoluteDescriptor');
    expect(missing.kind).toBe('unknown_ref');
    expect(isUnknownRef(missing)).toBe(true);
    expect(isUnknownRef(await refused(404, 'api:SomethingElse'))).toBe(true);
  });

  it('is other for a name the adapter does not map', async () => {
    const err = await refused(400, 'api:SomethingElse');
    expect(err.kind).toBe('other');
    expect(isUnknownRef(err)).toBe(false);
  });
});

describe('the adapter stays behind its interfaces (workspace hub plan §13)', () => {
  const root = __dirname;
  const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'store.ts')
    .map((f) => ({ file: f, text: readFileSync(join(root, f), 'utf8') }));

  it('no module of the API but the adapter names the class', () => {
    expect(sources.filter((s) => /\bTerminusStore\b/.test(s.text)).map((s) => s.file)).toEqual([]);
  });

  it('no module of the API reaches the operator-side methods (ADR-0062)', () => {
    expect(sources.filter((s) => /\b(createOperatorStore|OperatorStore)\b/.test(s.text)).map((s) => s.file)).toEqual([]);
  });
});
