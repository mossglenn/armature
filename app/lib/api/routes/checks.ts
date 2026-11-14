import { Hono } from 'hono';
import { requirePermission } from '../authorization';
import { CONCLUSIONS, PARAMS_HASH, paramsHash, runsOf, type Conclusion, type RunInput } from '../checks';
import { storeFor } from '../config';
import { ApiError } from '../errors';
import { activeRequirements } from '../grants';
import { BRANCH_NAME, readJson, requireCommit, setEtag } from '../http';
import { registry, REGISTRY_BRANCH, resolveUser } from '../identity';
import { isRecord } from '../store';

/**
 * /api/v1/checks (architecture decision record ADR-0070 decisions 3, 4 and 5;
 * since 2026-11-13). Both roles serve it: a plugin on a person's machine posts
 * to the workspace hub on loopback as one more tool there (decision 8).
 *
 *   POST /runs                 { check, commit, branch, conclusion, summary?, counts?, paramsHash?, detailsUrl? }
 *                              records a verdict → 201 the run, with the reporter, the time and an id
 *   GET  /?commit=&branch=&check=   the runs held, newest first
 *   GET  /requirements?target=&from=   the requirements in force that apply to a merge into
 *                              `target` (main by default) from `from`, each with its paramsHash
 *
 * A run is not a write to the graph: no envelope, no commit, no ETag on the
 * post. Anyone who may read a branch may post a run about it, as advisory
 * (decision 4, the `report_check` row); whether a run counts toward a
 * requirement is the merge gate's comparison of its reporter and paramsHash
 * with the requirement's (decision 6), not a refusal here. Nothing is
 * enforced by these routes.
 */
export const checks = new Hono();

const RUN_FIELDS = new Set(['check', 'commit', 'branch', 'conclusion', 'summary', 'counts', 'paramsHash', 'detailsUrl']);
const MAX_TEXT = 10_000;

/** The shape of a posted run, 400 `invalid_run` with every problem at once. */
function parseRun(input: Record<string, unknown>): RunInput {
  const issues: Array<{ path: string; message: string }> = [];
  for (const key of Object.keys(input)) {
    if (!RUN_FIELDS.has(key)) issues.push({ path: key, message: `${key} is not a field of a run` });
  }
  const text = (key: string, max: number, required: boolean): string | undefined => {
    const value = input[key];
    if (value === undefined) {
      if (required) issues.push({ path: key, message: `${key} is required` });
      return undefined;
    }
    if (typeof value !== 'string' || !value.trim() || value.length > max) {
      issues.push({ path: key, message: `${key} is a non-empty string of at most ${max} characters` });
      return undefined;
    }
    return value;
  };
  const check = text('check', 200, true);
  const commit = text('commit', 200, true);
  const branch = text('branch', 100, true);
  if (branch !== undefined && !BRANCH_NAME.test(branch)) issues.push({ path: 'branch', message: 'branch is not a branch name' });
  const conclusion = input.conclusion;
  if (!CONCLUSIONS.includes(conclusion as Conclusion)) issues.push({ path: 'conclusion', message: `conclusion is one of ${CONCLUSIONS.join(', ')}` });
  const summary = text('summary', MAX_TEXT, false);
  const hash = text('paramsHash', 80, false);
  if (hash !== undefined && !PARAMS_HASH.test(hash)) issues.push({ path: 'paramsHash', message: 'paramsHash is sha256:<64 hex digits>, as the hub serves it beside params' });
  const detailsUrl = text('detailsUrl', 2000, false);
  if (detailsUrl !== undefined && !/^https?:\/\//.test(detailsUrl)) issues.push({ path: 'detailsUrl', message: 'detailsUrl is an http or https URL' });
  let counts: Record<string, number> | undefined;
  if (input.counts !== undefined) {
    if (!isRecord(input.counts) || !Object.values(input.counts).every((n) => Number.isInteger(n) && (n as number) >= 0)) {
      issues.push({ path: 'counts', message: 'counts is an object of non-negative integers' });
    } else counts = input.counts as Record<string, number>;
  }
  if (issues.length) throw new ApiError(400, 'invalid_run', `${issues.length} problem(s) with the run`, { issues });
  return {
    check: check!,
    commit: commit!,
    branch: branch!,
    conclusion: conclusion as Conclusion,
    ...(summary !== undefined ? { summary } : {}),
    ...(counts !== undefined ? { counts } : {}),
    ...(hash !== undefined ? { paramsHash: hash } : {}),
    ...(detailsUrl !== undefined ? { detailsUrl } : {}),
  };
}

checks.post('/runs', async (c) => {
  const input = parseRun(await readJson(c));
  const who = await resolveUser(c);
  await requirePermission(c, who, { permission: 'report_check', branch: input.branch });
  // A verdict is about a commit that exists (the ADR's Context, point 2): the
  // branch is read, 404 `unknown_ref` when the hub has neither it nor the commit.
  const store = storeFor(c, { branch: input.branch });
  await store.head();
  await requireCommit(store, input.commit);
  // The author is the reporter: the agent under Armature-Agent, else the caller (decision 4).
  const run = runsOf(c).record(input, who.id);
  return c.json(run, 201);
});

checks.get('/', async (c) => {
  await resolveUser(c); // any identity that may read; the runs name no document
  const { commit, branch, check } = c.req.query();
  if (branch !== undefined && !BRANCH_NAME.test(branch)) throw new ApiError(400, 'bad_query', 'branch is not a branch name');
  return c.json(runsOf(c).list({ commit, branch, check }));
});

/**
 * The one question the hub answers about requirements (decision 5): which
 * apply to a merge from `from` into `target`. Those naming the target, those
 * `locked`, filtered by `fromPrefix` against the source when one is given;
 * with no source, every prefix is kept and the client filters. Layering their
 * `params` is the plugin's. On a workspace hub `main` is the mirror, which
 * holds none until the remote's are mirrored (decision 8, not built).
 */
checks.get('/requirements', async (c) => {
  await resolveUser(c);
  const target = c.req.query('target') || REGISTRY_BRANCH;
  const from = c.req.query('from');
  if (!BRANCH_NAME.test(target) || (from !== undefined && !BRANCH_NAME.test(from))) {
    throw new ApiError(400, 'bad_query', 'target and from are branch names');
  }
  const { requirements, commit } = await activeRequirements(registry(c));
  const applicable = requirements
    .filter((r) => r.locked === true || (r.branch ?? REGISTRY_BRANCH) === target)
    .filter((r) => from === undefined || typeof r.fromPrefix !== 'string' || from.startsWith(r.fromPrefix))
    .map((r) => ({ ...r, paramsHash: paramsHash(r.params) }));
  setEtag(c, commit);
  return c.json({ target, ...(from !== undefined ? { from } : {}), requirements: applicable });
});
