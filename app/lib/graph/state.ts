/**
 * The Design Graph's view state and its URL form (docs/graph-view-plan.md
 * §9.3): what a reader chose (a selection, the relation and its depth, hidden
 * classes, edges or nodes, a lens and its parameters, figure mode), parsed
 * from the query by the server page and written back by the client view.
 * Pure, so both sides share it and it is tested without a browser. `branch`
 * and `ref` are not view state: the page reads them itself and they are kept
 * as they are.
 */
import type { Direction } from './relations';

/** A relation from the selected record: the three the viewer derives, or the hub's trace. */
export type RelationKind = Direction | 'trace';

/** A lens recolors the drawing by one intelligence read (plan §8), one at a time. */
export type LensName = 'coverage' | 'alignment' | 'attestations' | 'outcomes' | 'changes';

export const LENSES: readonly LensName[] = ['coverage', 'alignment', 'attestations', 'outcomes', 'changes'];

export interface GraphState {
  select?: string;
  hide: string[];
  junctionsAsEdges: boolean;
  direction: RelationKind;
  depth: number;
  lens?: LensName;
  /** The coverage lens: the projected figure instead of the delivered one. */
  projected: boolean;
  /** The coverage lens's thresholds, when they differ from the hub's defaults. */
  fullyAssessedAt?: number;
  overAssessedAbove?: number;
  /** The outcomes lens: the unit shown, when a reader chose one. */
  unit?: string;
  /** The changes lens: the commit changes are counted from. */
  since?: string;
  /** Figure mode (plan §3.4): light, no chrome, the stamp; and its legend tile. */
  figure: boolean;
  legend: boolean;
}

export const RELATIONS: readonly RelationKind[] = ['both', 'upstream', 'downstream', 'trace'];

export const DEFAULT_STATE: Readonly<Pick<GraphState, 'junctionsAsEdges' | 'direction' | 'depth' | 'projected' | 'figure' | 'legend'>> = {
  junctionsAsEdges: true,
  direction: 'both',
  depth: 1,
  projected: false,
  figure: false,
  legend: false,
};

const positiveInt = (value: string | undefined): number | undefined => {
  const n = Number(value);
  return value !== undefined && Number.isInteger(n) && n >= 1 ? n : undefined;
};

/** The state a page starts from, read from its query; anything unreadable is the default. */
export function stateFromQuery(q: Record<string, string | undefined>): GraphState {
  const direction = RELATIONS.includes(q.related as RelationKind) ? (q.related as RelationKind) : DEFAULT_STATE.direction;
  const depth = q.depth === 'all' ? Infinity : Number(q.depth) >= 1 ? Math.floor(Number(q.depth)) : DEFAULT_STATE.depth;
  const lens = LENSES.includes(q.lens as LensName) ? (q.lens as LensName) : undefined;
  return {
    select: q.select || undefined,
    hide: q.hide ? q.hide.split(',').filter(Boolean) : [],
    junctionsAsEdges: q.edges !== 'nodes',
    direction,
    depth,
    lens,
    projected: q.projected === '1',
    fullyAssessedAt: positiveInt(q.fullyAssessedAt),
    overAssessedAbove: positiveInt(q.overAssessedAbove),
    unit: q.unit || undefined,
    since: q.since || undefined,
    figure: q.figure === '1',
    legend: q.legend === '1',
  };
}

/** The query for a state: defaults left out, other parameters (`branch`, `ref`, `walk`) kept. */
export function queryFromState(s: GraphState, current: URLSearchParams): URLSearchParams {
  const p = new URLSearchParams(current);
  const set = (key: string, value: string | undefined) => (value ? p.set(key, value) : p.delete(key));
  set('select', s.select);
  set('hide', s.hide.length ? [...s.hide].sort().join(',') : undefined);
  set('edges', s.junctionsAsEdges ? undefined : 'nodes');
  set('related', s.direction === DEFAULT_STATE.direction ? undefined : s.direction);
  set('depth', s.depth === DEFAULT_STATE.depth ? undefined : s.depth === Infinity ? 'all' : String(s.depth));
  set('lens', s.lens);
  set('projected', s.lens === 'coverage' && s.projected ? '1' : undefined);
  set('fullyAssessedAt', s.lens === 'coverage' && s.fullyAssessedAt ? String(s.fullyAssessedAt) : undefined);
  set('overAssessedAbove', s.lens === 'coverage' && s.overAssessedAbove ? String(s.overAssessedAbove) : undefined);
  set('unit', s.lens === 'outcomes' ? s.unit : undefined);
  set('since', s.lens === 'changes' ? s.since : undefined);
  set('figure', s.figure ? '1' : undefined);
  set('legend', s.figure && s.legend ? '1' : undefined);
  return p;
}

/** The parameters whose change needs the server (a read for the selected record or the lens), as opposed to the view alone. */
export const SERVER_KEYS: ReadonlySet<string> = new Set(['select', 'related', 'lens', 'since', 'fullyAssessedAt', 'overAssessedAbove']);
