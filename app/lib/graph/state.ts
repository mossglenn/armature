/**
 * The Design Graph's view state and its URL form (docs/graph-view-plan.md
 * §9.3): what a reader chose (a selection, the relation and its depth, hidden
 * classes, edges or nodes), parsed from the query by the server page and
 * written back by the client view with replaceState. Pure, so both sides
 * share it and it is tested without a browser. `branch` and `ref` are not
 * view state: the page reads them itself and they are kept as they are.
 */
import type { Direction } from './relations';

export interface GraphState {
  select?: string;
  hide: string[];
  junctionsAsEdges: boolean;
  direction: Direction;
  depth: number;
}

export const DIRECTIONS: readonly Direction[] = ['both', 'upstream', 'downstream'];

export const DEFAULT_STATE: Readonly<Pick<GraphState, 'junctionsAsEdges' | 'direction' | 'depth'>> = {
  junctionsAsEdges: true,
  direction: 'both',
  depth: 1,
};

/** The state a page starts from, read from its query; anything unreadable is the default. */
export function stateFromQuery(q: Record<string, string | undefined>): GraphState {
  const direction = DIRECTIONS.includes(q.related as Direction) ? (q.related as Direction) : DEFAULT_STATE.direction;
  const depth = q.depth === 'all' ? Infinity : Number(q.depth) >= 1 ? Math.floor(Number(q.depth)) : DEFAULT_STATE.depth;
  return {
    select: q.select || undefined,
    hide: q.hide ? q.hide.split(',').filter(Boolean) : [],
    junctionsAsEdges: q.edges !== 'nodes',
    direction,
    depth,
  };
}

/** The query for a state: defaults left out, other parameters (`branch`, `ref`) kept. */
export function queryFromState(s: GraphState, current: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(current);
  const set = (key: string, value: string | undefined) => (value ? p.set(key, value) : p.delete(key));
  set('select', s.select);
  set('hide', s.hide.length ? [...s.hide].sort().join(',') : undefined);
  set('edges', s.junctionsAsEdges ? undefined : 'nodes');
  set('related', s.direction === DEFAULT_STATE.direction ? undefined : s.direction);
  set('depth', s.depth === DEFAULT_STATE.depth ? undefined : s.depth === Infinity ? 'all' : String(s.depth));
  return p;
}
