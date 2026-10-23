/**
 * The view state's URL form (docs/graph-view-plan.md §9.3): a query parses to
 * a state, a state writes the query with defaults left out, and the two are
 * inverses of each other.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, queryFromState, stateFromQuery } from './state';

describe('the view state in the URL', () => {
  it('starts from the defaults when the query says nothing', () => {
    expect(stateFromQuery({})).toEqual({ select: undefined, hide: [], ...DEFAULT_STATE });
  });

  it('reads every parameter and ignores what it cannot', () => {
    expect(stateFromQuery({ select: 'AssessmentItem/x', hide: 'DesignNote,,DesignFinding', edges: 'nodes', related: 'upstream', depth: 'all' }))
      .toEqual({ select: 'AssessmentItem/x', hide: ['DesignNote', 'DesignFinding'], junctionsAsEdges: false, direction: 'upstream', depth: Infinity });
    expect(stateFromQuery({ related: 'sideways', depth: '0', edges: 'edges' })).toMatchObject({ direction: 'both', depth: 1, junctionsAsEdges: true });
    expect(stateFromQuery({ related: 'trace' }).direction).toBe('trace');
    expect(stateFromQuery({ depth: '2.7' }).depth).toBe(2);
  });

  it('writes only what differs from the defaults and keeps the ref', () => {
    const current = new URLSearchParams('branch=round-2');
    expect(queryFromState({ select: undefined, hide: [], ...DEFAULT_STATE }, current).toString()).toBe('branch=round-2');
    const q = queryFromState({ select: 'Module/m', hide: ['DesignNote', 'DesignFinding'], junctionsAsEdges: false, direction: 'downstream', depth: Infinity }, current);
    expect(q.toString()).toBe('branch=round-2&select=Module%2Fm&hide=DesignFinding%2CDesignNote&edges=nodes&related=downstream&depth=all');
  });

  it('round-trips', () => {
    const state = { select: 'LearningObjective/o', hide: ['Course'], junctionsAsEdges: true, direction: 'upstream' as const, depth: 2 };
    const q = queryFromState(state, new URLSearchParams());
    expect(stateFromQuery(Object.fromEntries(q))).toEqual(state);
  });
});
