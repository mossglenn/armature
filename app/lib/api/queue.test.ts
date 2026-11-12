import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

/**
 * "Don't commit to a branch outside `Store.exclusive`" (ADR-0025 decision 7,
 * notes of 2026-11-06 and 2026-11-11), read from the modules as the rule
 * against skipping the invariants is (`operator.test.ts`). It was a rule
 * with no test until the 2026-11-09 review's T9: the workspace actions
 * committed outside the queue (its W3 and W4) and nothing failed.
 *
 * A reading cannot prove a call is inside the queue; the tests that send a
 * write beside each action do that (`writeQueue.test.ts`, `cycle.test.ts`).
 * What this holds is the list: every module that commits is named here with
 * how many calls it makes and where their queue is taken, so a new commit, or
 * a new module that commits, fails until someone has looked at its queue and
 * written it down.
 */
describe('every commit of the API is in the write queue', () => {
  const root = __dirname;
  const COMMIT = /\.(putDocuments?|insertDocuments?|deleteDocument|replaceSchema|createBranch|createEmptyBranch|deleteBranch|apply)\(/g;
  /** The stores themselves: they define these methods, or hand them to the store beneath. */
  const STORES = ['store.ts', 'filestore/store.ts', 'workspace/store.ts'];
  /** Each committing module: its calls, the module whose `exclusive` they run in, and any left outside with the decision. */
  const COMMITTING: Record<string, { calls: number; queue: string; outside?: string }> = {
    'identity.ts': { calls: 1, queue: 'identity.ts' },
    'write.ts': { calls: 1, queue: 'write.ts' },
    'routes/users.ts': { calls: 1, queue: 'routes/users.ts' },
    'routes/branches.ts': {
      calls: 6,
      queue: 'routes/branches.ts',
      outside: "A merge's check: a transient branch made, merged into and deleted (three calls), which no one else writes (the note of 2026-11-06)",
    },
    'workspace/bringIn.ts': { calls: 1, queue: 'workspace/bringIn.ts' },
    'workspace/merged.ts': { calls: 1, queue: 'workspace/bringIn.ts', outside: 'None: a bring-in holds the queue, and push takes it to settle one (workspace/push.ts)' },
    'workspace/clone.ts': { calls: 6, queue: 'routes/workspace.ts', outside: 'None: the mirror takes its own queue here, the clone runs in the one its route holds' },
    'workspace/snapshots.ts': { calls: 3, queue: 'workspace/snapshots.ts' },
  };

  const modules = readdirSync(root, { recursive: true, encoding: 'utf8' })
    .map((f) => f.split('\\').join('/'))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !STORES.includes(f));
  const text = (file: string) => readFileSync(join(root, file), 'utf8');

  it('names every module that commits, with its number of commits', () => {
    const found = Object.fromEntries(modules.map((f) => [f, text(f).match(COMMIT)?.length ?? 0] as const).filter(([, calls]) => calls > 0));
    expect(found).toEqual(Object.fromEntries(Object.entries(COMMITTING).map(([file, { calls }]) => [file, calls])));
  });

  it('finds the queue taken where each module says it is', () => {
    for (const [file, { queue }] of Object.entries(COMMITTING)) {
      expect(text(queue), `${file} says its commits run in the queue ${queue} takes`).toMatch(/\.exclusive\(/);
    }
  });
});
