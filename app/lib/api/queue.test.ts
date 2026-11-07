import { describe, expect, it } from 'vitest';
import { KeyedQueue } from './queue';

/** A piece of work that finishes when told to, recording when it starts. */
const held = (log: string[], name: string) => {
  let finish: () => void = () => undefined;
  const done = new Promise<void>((resolve) => (finish = resolve));
  return {
    finish,
    work: async () => {
      log.push(name);
      await done;
      return name;
    },
  };
};
const settled = () => new Promise((resolve) => setImmediate(resolve));

describe('KeyedQueue', () => {
  it('runs work under one key one at a time, in the order it arrived', async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const [a, b, c] = ['a', 'b', 'c'].map((name) => held(log, name));
    const runs = [queue.run('k', a.work), queue.run('k', b.work), queue.run('k', c.work)];
    await settled();
    expect(log).toEqual(['a']);
    a.finish();
    await settled();
    expect(log).toEqual(['a', 'b']);
    b.finish();
    c.finish();
    expect(await Promise.all(runs)).toEqual(['a', 'b', 'c']);
  });

  it('runs work under different keys side by side', async () => {
    const queue = new KeyedQueue();
    const log: string[] = [];
    const [a, b] = ['a', 'b'].map((name) => held(log, name));
    const runs = [queue.run('one', a.work), queue.run('two', b.work)];
    await settled();
    expect(log).toEqual(['a', 'b']);
    a.finish();
    b.finish();
    await Promise.all(runs);
  });

  it('gives a failure to its own caller and goes on to the next', async () => {
    const queue = new KeyedQueue();
    const failed = queue.run('k', async () => {
      throw new Error('refused');
    });
    const next = queue.run('k', async () => 'ran');
    await expect(failed).rejects.toThrow('refused');
    await expect(next).resolves.toBe('ran');
  });

  it('keeps a work that throws before its first await from stopping the queue', async () => {
    const queue = new KeyedQueue();
    const failed = queue.run('k', () => {
      throw new Error('at once');
    });
    await expect(failed).rejects.toThrow('at once');
    await expect(queue.run('k', async () => 'ran')).resolves.toBe('ran');
  });

  it('holds nothing for a key once its work is done', async () => {
    const queue = new KeyedQueue();
    await Promise.all(['a', 'b', 'c'].map((key) => queue.run(key, async () => key)));
    await queue.run('a', async () => {
      throw new Error('refused');
    }).catch(() => undefined);
    await settled();
    expect(queue.size).toBe(0);
  });
});
