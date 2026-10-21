// Vitest global setup: runs once in the main process before any test file.
//
// The tests are integration tests against a live TerminusDB holding the seeded
// `armature` database, and a store that has just started on a cold machine
// answers slowly or wrongly for a while. Seen on 2026-10-20 (two runs within
// about two minutes of `docker compose up`) and reproduced on 2026-10-21 by
// relaunching Docker Desktop: one request mid-suite took more than the 15-second
// test timeout, and the rest of that describe block cascaded. A cheap read
// answered at once both times, so a probe is not enough: this setup also does
// the work the tests do (a branch, a write through the pipeline, an
// intelligence read) once before any test's clock starts, and reports how long
// the store took. A failure here is reported, not thrown: the tests will fail
// with a clearer message than this file could give.
import { app } from './lib/api/app';
import { createStore } from './lib/api/store';
import { envLocal } from './vitest.env';

const PROBE_TIMEOUT_MS = 120_000;
const POLL_MS = 1_000;
const HEADERS = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Waits until the seeded database answers a document read on main. */
async function waitForStore(): Promise<void> {
  const need = (key: string): string => {
    const value = process.env[key];
    if (!value) throw new Error(`${key} is not set: the tests need a TerminusDB to run against`);
    return value;
  };
  const url = need('TERMINUS_URL').replace(/\/+$/, '');
  const db = need('TERMINUS_DB');
  const auth = `Basic ${btoa(`${need('TERMINUS_USER')}:${need('TERMINUS_PASS')}`)}`;

  // One User document is cheap and always present (the seed registers one).
  const probe = new URL(`${url}/api/document/admin/${db}/local/branch/main`);
  probe.searchParams.set('type', 'User');
  probe.searchParams.set('as_list', 'true');

  const started = Date.now();
  let last = 'no answer';
  while (Date.now() - started < PROBE_TIMEOUT_MS) {
    try {
      const res = await fetch(probe, {
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: AbortSignal.timeout(5_000),
      });
      if (res.status === 200) {
        const waited = Date.now() - started;
        if (waited > POLL_MS) console.log(`[global-setup] store answered after ${seconds(waited)}`);
        return;
      }
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `TerminusDB at ${url} did not answer a read of ${db}/main within ${seconds(PROBE_TIMEOUT_MS)} (last: ${last}). ` +
      'Is the container up, and have load_schema.js and seed_data.js run?'
  );
}

/** The operations the tests do, once, on a scratch branch that is deleted afterward. */
async function warmUp(): Promise<void> {
  const branch = `warmup-${Date.now().toString(36)}`;
  const q = `?branch=${branch}`;
  const timings: string[] = [];
  const step = async (name: string, run: () => Response | Promise<Response>, expected: number) => {
    const started = Date.now();
    const res = await run();
    timings.push(`${name} ${seconds(Date.now() - started)}`);
    if (res.status !== expected) {
      throw new Error(`${name} answered ${res.status}, expected ${expected}: ${(await res.text()).slice(0, 300)}`);
    }
  };
  const started = Date.now();
  try {
    await step(
      'branch',
      () => app.request('/api/v1/branches', { method: 'POST', headers: HEADERS, body: JSON.stringify({ name: branch }) }),
      201
    );
    await step(
      'write',
      () =>
        app.request(`/api/v1/documents${q}`, {
          method: 'POST',
          headers: HEADERS,
          body: JSON.stringify({
            message: 'Warm the store before the test suite',
            documents: [
              {
                '@type': 'DesignNote',
                '@id': `DesignNote/${branch}`,
                label: 'Warm-up',
                rationale: 'Written by vitest.global-setup.mts and deleted with its branch.',
                subject: ['LearningObjective/describe-model-training'],
              },
            ],
          }),
        }),
      200
    );
    await step('coverage', () => app.request(`/api/v1/intelligence/coverage/how-ai-works${q}`), 200);
    const total = Date.now() - started;
    if (total > 5_000) console.log(`[global-setup] warm-up took ${seconds(total)} (${timings.join(', ')})`);
  } catch (err) {
    console.warn(`[global-setup] warm-up failed after ${seconds(Date.now() - started)}: ${err instanceof Error ? err.message : err}`);
  } finally {
    // The branch holds a commit no other branch has, so the API refuses to
    // delete it; the tests' own cleanup goes through the adapter the same way.
    await createStore({ branch: 'main' }).deleteBranch(branch).catch(() => undefined);
  }
}

export default async function setup(): Promise<void> {
  // The config's `test.env` reaches the workers, not this process; apply the
  // same file here so the setup hits the store the tests will.
  Object.assign(process.env, envLocal());
  await waitForStore();
  await warmUp();
}
