// wait_for_store.js
// Blocks until the TerminusDB server answers, then exits 0. Exits 1 if it has
// not answered by the deadline.
//
// Why: the server takes a few seconds to accept connections after its container
// starts, and in CI (continuous integration) the schema loader runs right after
// the service container is started. Locally, the first test runs within about
// two minutes of `docker compose up` failed twice on 2026-10-20 with a store 500
// or a wrong branch-head answer; the Vitest setup in app/vitest.global-setup.mts
// probes the seeded database for the same reason. This script probes only the
// server, since it runs before the database exists.
//
// Usage:
//   node scripts/wait_for_store.js              # wait up to 120 seconds
//   node scripts/wait_for_store.js --timeout 30 # wait up to 30 seconds
//
// Environment variables (the same ones every script reads):
//   TERMINUS_URL    - TerminusDB server URL  (default: http://localhost:6363)
//   TERMINUS_USER   - Admin username          (default: admin)
//   TERMINUS_PASS   - Admin password          (default: admin)
//
// No dependencies: Node 22's global fetch is enough, so this runs before
// `npm ci` in scripts/ if it has to.

const TERMINUS_URL  = (process.env.TERMINUS_URL  || "http://localhost:6363").replace(/\/+$/, "");
const TERMINUS_USER = process.env.TERMINUS_USER || "admin";
const TERMINUS_PASS = process.env.TERMINUS_PASS || "admin";

const flagIndex = process.argv.indexOf("--timeout");
const timeoutSeconds = flagIndex === -1 ? 120 : Number(process.argv[flagIndex + 1]);
if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
  console.error("Error: --timeout takes a positive number of seconds");
  process.exit(1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// GET /api/info answers 200 with the server version once the server is up.
// Anything else (a refused connection, a 502 from a proxy, a 500 while the
// server is still initializing its store) counts as not ready.
async function serverAnswers() {
  try {
    const res = await fetch(`${TERMINUS_URL}/api/info`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${TERMINUS_USER}:${TERMINUS_PASS}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(5_000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

async function main() {
  const started = Date.now();
  const deadline = started + timeoutSeconds * 1000;
  console.log(`Waiting for TerminusDB at ${TERMINUS_URL} (up to ${timeoutSeconds}s)...`);
  while (Date.now() < deadline) {
    if (await serverAnswers()) {
      const waited = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`  → Server answered after ${waited}s`);
      return;
    }
    await sleep(1_000);
  }
  console.error(`Error: TerminusDB at ${TERMINUS_URL} did not answer within ${timeoutSeconds}s`);
  process.exit(1);
}

main();
