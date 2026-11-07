/**
 * Work kept in order by key, within one process: `run` starts `work` when
 * everything queued under its key has finished, whether that succeeded or not.
 * The hub's per-branch write queue is one of these (`Store.exclusive`; ADR-0025
 * decision 7, note of 2026-11-06), and the file-backed store orders its commits
 * with another. A key with nothing queued holds no entry, so short-lived keys
 * such as a transient branch's name leave nothing behind.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<unknown>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.then(work);
    const tail = run
      .catch(() => undefined)
      .finally(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    this.tails.set(key, tail);
    return run;
  }

  /** The keys with work queued or running. */
  get size(): number {
    return this.tails.size;
  }
}
