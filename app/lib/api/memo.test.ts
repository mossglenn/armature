import { describe, expect, it } from 'vitest';
import { CommitMemo } from './memo';

describe('a memo for reads at a commit', () => {
  it('serves a value again under its key and counts hits and misses', () => {
    const memo = new CommitMemo<string>();
    const key = CommitMemo.key('abc123', 'AssessmentItem/x', 0, 20, false);
    expect(memo.get(key)).toBeUndefined();
    memo.set(key, 'answer');
    expect(memo.get(key)).toBe('answer');
    expect(memo.get(CommitMemo.key('def456', 'AssessmentItem/x', 0, 20, false))).toBeUndefined();
    expect({ hits: memo.hits, misses: memo.misses }).toEqual({ hits: 1, misses: 2 });
  });

  it('is bounded: the oldest entry goes when it is full', () => {
    const memo = new CommitMemo<number>(2);
    memo.set('a', 1);
    memo.set('b', 2);
    memo.set('c', 3);
    expect(memo.size).toBe(2);
    expect(memo.get('a')).toBeUndefined();
    expect(memo.get('c')).toBe(3);
    memo.set('c', 4);
    expect(memo.size).toBe(2);
  });
});
