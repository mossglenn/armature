/**
 * The view state's URL form (docs/graph-view-plan.md §9.3): a query parses to
 * a state, a state writes the query with defaults left out, and the two are
 * inverses of each other; a lens's parameters are written only with their lens.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_STATE, queryFromState, stateFromQuery, type GraphState } from './state';

const base: GraphState = { select: undefined, hide: [], ...DEFAULT_STATE };

describe('the view state in the URL', () => {
  it('starts from the defaults when the query says nothing', () => {
    expect(stateFromQuery({})).toEqual(base);
  });

  it('reads every parameter and ignores what it cannot', () => {
    expect(stateFromQuery({ select: 'AssessmentItem/x', hide: 'DesignNote,,DesignFinding', edges: 'nodes', related: 'upstream', depth: 'all' }))
      .toMatchObject({ select: 'AssessmentItem/x', hide: ['DesignNote', 'DesignFinding'], junctionsAsEdges: false, direction: 'upstream', depth: Infinity });
    expect(stateFromQuery({ related: 'sideways', depth: '0', edges: 'edges' })).toMatchObject({ direction: 'both', depth: 1, junctionsAsEdges: true });
    expect(stateFromQuery({ related: 'trace' }).direction).toBe('trace');
    expect(stateFromQuery({ depth: '2.7' }).depth).toBe(2);
  });

  it('reads a lens and its parameters, figure mode and its legend', () => {
    expect(stateFromQuery({ lens: 'coverage', projected: '1', fullyAssessedAt: '3', overAssessedAbove: '6' }))
      .toMatchObject({ lens: 'coverage', projected: true, fullyAssessedAt: 3, overAssessedAbove: 6 });
    expect(stateFromQuery({ lens: 'changes', since: 'abc123' })).toMatchObject({ lens: 'changes', since: 'abc123' });
    expect(stateFromQuery({ lens: 'outcomes', unit: 'proportion correct' })).toMatchObject({ lens: 'outcomes', unit: 'proportion correct' });
    expect(stateFromQuery({ lens: 'sideways', fullyAssessedAt: '0', overAssessedAbove: 'x' })).toMatchObject({ lens: undefined, fullyAssessedAt: undefined, overAssessedAbove: undefined });
    expect(stateFromQuery({ figure: '1', legend: '1' })).toMatchObject({ figure: true, legend: true });
  });

  it('writes only what differs from the defaults and keeps the ref', () => {
    const current = new URLSearchParams('branch=round-2');
    expect(queryFromState(base, current).toString()).toBe('branch=round-2');
    const q = queryFromState({ ...base, select: 'Module/m', hide: ['DesignNote', 'DesignFinding'], junctionsAsEdges: false, direction: 'downstream', depth: Infinity }, current);
    expect(q.toString()).toBe('branch=round-2&select=Module%2Fm&hide=DesignFinding%2CDesignNote&edges=nodes&related=downstream&depth=all');
  });

  it("writes a lens's parameters with the lens only, and the legend with figure mode only", () => {
    const q = queryFromState({ ...base, lens: 'coverage', projected: true, fullyAssessedAt: 3, since: 'abc', unit: 'u' }, new URLSearchParams());
    expect(q.toString()).toBe('lens=coverage&projected=1&fullyAssessedAt=3');
    expect(queryFromState({ ...base, lens: 'changes', since: 'abc', projected: true }, new URLSearchParams()).toString()).toBe('lens=changes&since=abc');
    expect(queryFromState({ ...base, lens: 'outcomes', unit: 'proportion correct' }, new URLSearchParams()).toString()).toBe('lens=outcomes&unit=proportion+correct');
    expect(queryFromState({ ...base, legend: true }, new URLSearchParams()).toString()).toBe('');
    expect(queryFromState({ ...base, figure: true, legend: true }, new URLSearchParams()).toString()).toBe('figure=1&legend=1');
  });

  it('round-trips', () => {
    const state: GraphState = {
      ...base, select: 'LearningObjective/o', hide: ['Course'], direction: 'upstream', depth: 2,
      lens: 'coverage', projected: true, fullyAssessedAt: 3, overAssessedAbove: 5, figure: true, legend: true,
    };
    const q = queryFromState(state, new URLSearchParams());
    expect(stateFromQuery(Object.fromEntries(q))).toEqual(state);
  });
});
