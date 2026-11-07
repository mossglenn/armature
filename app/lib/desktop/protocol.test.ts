/**
 * The control protocol over a pair of streams (./protocol.ts;
 * docs/desktop-program-plan.md §12): a request in, its reply out, an
 * `ApiError` as the route would send it, a line that is not a request, events,
 * concurrency and the input's end. No store.
 */
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../api/errors';
import { answerFromResponse, answerOf, ok, openChannel, type Handler } from './protocol';

function harness(handlers: Record<string, Handler>) {
  const input = new PassThrough();
  const output = new PassThrough();
  const messages: Record<string, unknown>[] = [];
  let buffered = '';
  const waiters: Array<() => void> = [];
  output.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      messages.push(JSON.parse(buffered.slice(0, end)));
      buffered = buffered.slice(end + 1);
    }
    waiters.splice(0).forEach((wake) => wake());
  });
  const channel = openChannel({ input, output, handlerFor: (type) => handlers[type] });
  const send = (line: unknown) => input.write(`${typeof line === 'string' ? line : JSON.stringify(line)}\n`);
  /** Resolves once `count` messages have arrived. */
  const received = async (count: number) => {
    while (messages.length < count) await new Promise<void>((wake) => waiters.push(wake));
    return messages;
  };
  return { input, output, channel, send, received, messages };
}

describe('the control protocol', () => {
  it('answers a request with its id, the status and the body', async () => {
    const h = harness({ echo: async (request) => ok({ said: request.text }) });
    h.send({ id: 1, type: 'echo', text: 'hello' });
    expect(await h.received(1)).toEqual([{ id: 1, status: 200, body: { said: 'hello' } }]);
  });

  it('answers an ApiError as the route would send it', async () => {
    const h = harness({
      push: async () => {
        throw new ApiError(403, 'forbidden', 'Not yours', { reason: 'remote_identity', owner: 'a' });
      },
    });
    h.send({ id: 'p', type: 'push' });
    expect(await h.received(1)).toEqual([{ id: 'p', status: 403, body: { error: 'forbidden', message: 'Not yours', reason: 'remote_identity', owner: 'a' } }]);
  });

  it('answers any other failure 500 with its message, since the only reader is the shell', async () => {
    const h = harness({
      broken: async () => {
        throw new Error('the folder vanished');
      },
    });
    h.send({ id: 2, type: 'broken' });
    expect(await h.received(1)).toEqual([{ id: 2, status: 500, body: { error: 'internal_error', message: 'the folder vanished' } }]);
  });

  it('refuses a line that is not a request and goes on', async () => {
    const h = harness({ echo: async () => ok({}) });
    h.send('not json');
    h.send('[1, 2]');
    h.send({ type: 'echo' });
    h.send({ id: '', type: 'echo' });
    h.send({ id: 3 });
    h.send({ id: 4, type: 'nothing' });
    h.send('   ');
    h.send({ id: 5, type: 'echo' });
    const messages = await h.received(7);
    expect(messages.slice(0, 4).map((m) => [m.id, m.status, (m.body as { error: string }).error])).toEqual([
      [null, 400, 'bad_request'],
      [null, 400, 'bad_request'],
      [null, 400, 'bad_request'],
      [null, 400, 'bad_request'],
    ]);
    expect(messages[4]).toMatchObject({ id: 3, status: 400, body: { error: 'bad_request' } });
    expect(messages[5]).toMatchObject({ id: 4, status: 400, body: { error: 'unknown_request' } });
    expect(messages[6]).toEqual({ id: 5, status: 200, body: {} });
  });

  it('runs requests concurrently and answers them as they finish', async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      slow: async () => {
        await slow;
        return ok('slow');
      },
      fast: async () => ok('fast'),
    });
    h.send({ id: 'a', type: 'slow' });
    h.send({ id: 'b', type: 'fast' });
    await h.received(1);
    release();
    expect((await h.received(2)).map((m) => m.id)).toEqual(['b', 'a']);
  });

  it('sends events, before a request’s reply when the handler emits them', async () => {
    const h = harness({
      signIn: async (request, { emit }) => {
        emit({ event: 'open', request: request.id, url: 'https://login.example.edu/auth' });
        return ok({ person: 'p' });
      },
    });
    h.channel.emit({ event: 'log', line: 'started' });
    h.send({ id: 9, type: 'signIn' });
    expect(await h.received(3)).toEqual([
      { event: 'log', line: 'started' },
      { event: 'open', request: 9, url: 'https://login.example.edu/auth' },
      { id: 9, status: 200, body: { person: 'p' } },
    ]);
  });

  it('closes when the input ends, after every request in flight is answered', async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const h = harness({
      push: async () => {
        await pending;
        return ok({ pushed: [] });
      },
    });
    h.send({ id: 1, type: 'push' });
    let closed = false;
    void h.channel.closed.then(() => (closed = true));
    h.input.end();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closed).toBe(false);
    release();
    await h.channel.closed;
    expect(h.messages).toEqual([{ id: 1, status: 200, body: { pushed: [] } }]);
  });

  it('survives a reader that is gone: a write error is not the core’s end', async () => {
    const h = harness({ echo: async () => ok({}) });
    h.output.destroy(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    h.send({ id: 1, type: 'echo' });
    h.input.end();
    await h.channel.closed;
  });
});

describe('answers', () => {
  it('reads a response as a route answered it', async () => {
    expect(await answerFromResponse(Response.json({ error: 'not_found' }, { status: 404 }))).toEqual({ status: 404, body: { error: 'not_found' } });
    expect(await answerFromResponse(new Response(null, { status: 204 }))).toEqual({ status: 204, body: null });
    expect(await answerFromResponse(new Response('plain', { status: 502 }))).toEqual({ status: 502, body: 'plain' });
  });

  it('renders a thrown value that is not an Error', () => {
    expect(answerOf('odd')).toEqual({ status: 500, body: { error: 'internal_error', message: 'odd' } });
  });
});
