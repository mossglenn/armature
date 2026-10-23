/**
 * A memo for reads at a commit (2026-10-23). A read at a commit is immutable
 * (ADR-0025), so an answer keyed by the commit it was read at can be kept
 * and served again while the branch head stands still, with no invalidation
 * beyond the head moving. Bounded: the oldest entry goes when it is full.
 * In-process, per host; a second host reads for itself.
 */
export class CommitMemo<T> {
  private readonly entries = new Map<string, T>();
  hits = 0;
  misses = 0;

  constructor(private readonly max = 500) {}

  /** The key for a read: the commit, the document, and the read's own parameters. */
  static key(commit: string, ...parts: Array<string | number | boolean>): string {
    return [commit, ...parts].join('|');
  }

  get(key: string): T | undefined {
    const value = this.entries.get(key);
    if (value === undefined) this.misses++;
    else this.hits++;
    return value;
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.max && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, value);
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
  }
}
