import { createHash, randomUUID } from 'node:crypto';
import type { Context } from 'hono';
import type { TerminusDocument } from './store';
import { CHECK_OVERRIDE_TRAILER, CHECK_TRAILER } from './trailers';

/**
 * Check runs (architecture decision record ADR-0070 decisions 3 and 4): a
 * plugin's verdict about one commit, kept by the hub outside the design graph.
 *
 * A run is derived, recomputable at any commit, and a plugin's opinion, so it
 * is never a record: it is held in memory, bounded to the newest `RUNS_KEPT`
 * per check and branch, and gone after a restart, when the feed's
 * `hub.started` tells plugins to report again (open question 2, decided
 * 2026-11-12: persisted when merges stalled after a restart are seen). What
 * a merge relied on outlives the run as the merge commit's trailers (decision
 * 7). One store per hub (`createApp`), so two hubs in one process keep their
 * runs apart.
 *
 * `paramsHash` is how a run says which settings it ran under: the SHA-256 of
 * a requirement's `params` in a canonical form, keys sorted at every depth, no
 * whitespace, numbers as JSON prints them. The hub computes it over the value
 * as the store returns it and serves it beside `params`, since the store
 * returns a JSON value's keys in an order of its own and `1.0` as `1`
 * (platform check AP2b): a plugin copies the hub's hash rather than hashing
 * the text it sent.
 */

export const RUNS_KEPT = 50;

declare module 'hono' {
  interface ContextVariableMap {
    /** The runs this hub holds, one store per app (`createApp`). */
    runs?: RunStore;
  }
}

/** The run store of the hub serving this request. */
export function runsOf(c: Context): RunStore {
  const runs = c.get('runs');
  if (!runs) throw new Error('No run store on the request; mount the routes through createApp');
  return runs;
}

export const CONCLUSIONS = ['pass', 'fail', 'neutral', 'error'] as const;
export type Conclusion = (typeof CONCLUSIONS)[number];

export interface CheckRun {
  /** Minted by the hub. */
  id: string;
  /** The check's name, as the requirement spells it. */
  check: string;
  /** The commit the verdict is about, which the store holds. */
  commit: string;
  /** The branch the plugin read the commit on. */
  branch: string;
  conclusion: Conclusion;
  /** Text for a person; the hub neither reads nor aggregates it (decision 11). */
  summary?: string;
  /** Counts by a key the plugin chooses, such as `{ require: 2, warn: 5 }`. */
  counts?: Record<string, number>;
  /** The hash of the `params` the plugin ran with (`sha256:<hex>`); absent for a check no requirement names. */
  paramsHash?: string;
  /** Where the full result is, outside the hub. */
  detailsUrl?: string;
  /** `User/<id>`: the author of the request, an agent under `Armature-Agent` (decision 4). */
  reporter: string;
  /** When the hub recorded it, ISO 8601. */
  reportedAt: string;
}

export type RunInput = Omit<CheckRun, 'id' | 'reporter' | 'reportedAt'>;

export interface RunQuery {
  commit?: string;
  branch?: string;
  check?: string;
}

/** The runs a hub holds: newest `RUNS_KEPT` per check and branch, newest first. */
export class RunStore {
  private readonly runs = new Map<string, CheckRun[]>();

  record(input: RunInput, reporter: string, now = new Date()): CheckRun {
    const run: CheckRun = { ...input, id: randomUUID(), reporter, reportedAt: now.toISOString() };
    const key = `${run.branch}\u0000${run.check}`;
    const kept = this.runs.get(key) ?? [];
    kept.unshift(run);
    if (kept.length > RUNS_KEPT) kept.length = RUNS_KEPT;
    this.runs.set(key, kept);
    return run;
  }

  /** Every run matching the query, newest first across checks and branches. */
  list(query: RunQuery = {}): CheckRun[] {
    const all: CheckRun[] = [];
    for (const kept of this.runs.values()) {
      for (const run of kept) {
        if (query.commit !== undefined && run.commit !== query.commit) continue;
        if (query.branch !== undefined && run.branch !== query.branch) continue;
        if (query.check !== undefined && run.check !== query.check) continue;
        all.push(run);
      }
    }
    return all.sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  }
}

/** The canonical text of a JSON value: keys sorted at every depth, no whitespace, numbers as JSON prints them. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** `sha256:<hex>` over the canonical form; the shape a run's `paramsHash` must have. */
export const paramsHash = (params: unknown): string => `sha256:${createHash('sha256').update(canonicalJson(params)).digest('hex')}`;

export const PARAMS_HASH = /^sha256:[0-9a-f]{64}$/;

/**
 * The one question the hub answers about requirements (decision 5): which of
 * those in force apply to a merge from `from` into `target`. Those naming the
 * target (`main` when a record names none), those `locked`, filtered by
 * `fromPrefix` against the source when one is given; with no source every
 * prefix is kept.
 */
export function requirementsFor(requirements: TerminusDocument[], target: string, from?: string): TerminusDocument[] {
  return requirements
    .filter((r) => r.locked === true || ((r.branch as string | undefined) ?? 'main') === target)
    .filter((r) => from === undefined || typeof r.fromPrefix !== 'string' || from.startsWith(r.fromPrefix));
}

/**
 * What the merge gate found for one requirement (decision 6): the newest run
 * at the source's head by the requirement's reporter under its current
 * `paramsHash`, or `pending` when there is none. A run by anyone else, or
 * under other settings, is advisory and does not count.
 */
export interface CheckVerdict {
  check: string;
  /** The `CheckRequirement`'s id. */
  requirement: string;
  level: 'Required' | 'Advisory';
  locked: boolean;
  /** `User/<id>`, the agent whose runs count. */
  reporter: string;
  paramsHash: string;
  conclusion: Conclusion | 'pending';
  /** The run that counted. */
  run?: { id: string; reportedAt: string; summary?: string; detailsUrl?: string };
  /** `pass` or `neutral` (decision 6, step 3). */
  satisfied: boolean;
  /** A person with the right to merge took the requirement on themselves, with this reason; set only where the requirement was not satisfied. */
  overridden?: { reason: string };
}

/** The verdict for each requirement at `commit`, the source's head; `overrides` maps a check's name to the reason given. */
export function verdictsOf(requirements: TerminusDocument[], runs: RunStore, commit: string, overrides: ReadonlyMap<string, string> = new Map()): CheckVerdict[] {
  return requirements.map((requirement) => {
    const check = String(requirement.check);
    const hash = paramsHash(requirement.params);
    const run = runs.list({ commit, check }).find((r) => r.reporter === requirement.reporter && r.paramsHash === hash);
    const satisfied = run?.conclusion === 'pass' || run?.conclusion === 'neutral';
    const level = requirement.level === 'Advisory' ? 'Advisory' : 'Required';
    const reason = overrides.get(check);
    return {
      check,
      requirement: requirement['@id'],
      level,
      locked: requirement.locked === true,
      reporter: String(requirement.reporter),
      paramsHash: hash,
      conclusion: run?.conclusion ?? 'pending',
      ...(run ? { run: { id: run.id, reportedAt: run.reportedAt, ...(run.summary !== undefined ? { summary: run.summary } : {}), ...(run.detailsUrl !== undefined ? { detailsUrl: run.detailsUrl } : {}) } } : {}),
      satisfied,
      ...(level === 'Required' && !satisfied && reason !== undefined ? { overridden: { reason } } : {}),
    };
  });
}

/** Whether a verdict stops the merge: a `Required` requirement neither satisfied nor overridden. An `Advisory` one is shown and never refuses. */
export const blocks = (verdict: CheckVerdict): boolean => verdict.level === 'Required' && !verdict.satisfied && !verdict.overridden;

/** A check's name as a trailer carries it: as it is, or quoted when it holds a space or a quote. */
const named = (check: string): string => (/^[^\s"]+$/.test(check) ? check : JSON.stringify(check));

/**
 * The merge commit's record of what it relied on (decision 7): one
 * `Armature-Check` line per requirement that applied, and one
 * `Armature-Check-Override` per check overridden, with the reason on one
 * line. They outlive the runs, which are held in memory.
 */
export function checkTrailers(verdicts: CheckVerdict[]): string[] {
  const lines = verdicts.map((v) =>
    [`${CHECK_TRAILER}: ${named(v.check)}`, v.conclusion, ...(v.run ? [`run=${v.run.id}`] : []), `params=${v.paramsHash}`, ...(v.level === 'Advisory' ? ['advisory'] : []), ...(v.overridden ? ['overridden'] : [])].join(' ')
  );
  const reasons = new Map<string, string>();
  for (const v of verdicts) if (v.overridden) reasons.set(v.check, v.overridden.reason);
  for (const [check, reason] of reasons) lines.push(`${CHECK_OVERRIDE_TRAILER}: ${named(check)} reason=${JSON.stringify(reason.replace(/\s+/g, ' ').trim())}`);
  return lines;
}
