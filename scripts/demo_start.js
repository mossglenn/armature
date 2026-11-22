/**
 * demo_start.js — `npm run demo:start` from the repository root.
 *
 * Starts the ICICLE demonstration on this machine (docs/icicle-demo-script.md):
 * a hub over the database `npm run demo:reset` seeded, on http://localhost:3100,
 * and the viewer over that hub, on http://localhost:3000. Ctrl-C stops both.
 *
 * Before starting anything it checks what has gone wrong before, and says what
 * to do: the store not running, the demo database not seeded, a port taken.
 * It rebuilds the hub every time (a fraction of a second, so the hub is never an
 * older build than the code) and the viewer when it has no build or when asked
 * with --build (about half a minute).
 *
 * Environment variables:
 *   TERMINUS_URL, TERMINUS_USER, TERMINUS_PASS   the store, as the other scripts
 *   TERMINUS_DB                                  default armature_icicle, never armature
 *   DEMO_HUB_PORT, DEMO_VIEWER_PORT              default 3100 and 3000
 *   DEMO_INSTANCE_NAME                           the instance's name, which the viewer's
 *                                                tab, its Connect page and the assistant
 *                                                show; default "Example University ·
 *                                                Information Literacy", the seed's
 *                                                institution (unset, a hub names itself
 *                                                by its host name, localhost)
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));
const app = join(root, "app");
const TERMINUS_URL = process.env.TERMINUS_URL || "http://localhost:6363";
const TERMINUS_USER = process.env.TERMINUS_USER || "admin";
const TERMINUS_PASS = process.env.TERMINUS_PASS || "admin";
const DB = process.env.TERMINUS_DB || "armature_icicle";
const HUB_PORT = Number(process.env.DEMO_HUB_PORT || 3100);
const VIEWER_PORT = Number(process.env.DEMO_VIEWER_PORT || 3000);
const INSTANCE_NAME = process.env.DEMO_INSTANCE_NAME || "Example University · Information Literacy";
const rebuildViewer = process.argv.includes("--build");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const fail = (lines) => {
  console.error(`\n✗ ${lines.join("\n  ")}\n`);
  process.exit(1);
};

if (DB === "armature") fail(["demo:start refuses the database `armature`, the development database.", "Leave TERMINUS_DB unset (armature_icicle)."]);

// 1. The store answers, and holds the demo database.
const auth = "Basic " + Buffer.from(`${TERMINUS_USER}:${TERMINUS_PASS}`).toString("base64");
try {
  const info = await fetch(`${TERMINUS_URL}/api/info`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(5000) });
  if (!info.ok) fail([`The store at ${TERMINUS_URL} answered ${info.status}.`, "Check TERMINUS_USER and TERMINUS_PASS, which default to admin and admin."]);
} catch {
  fail([`The store at ${TERMINUS_URL} does not answer.`, "Start Docker Desktop, then the store: cd docker && docker compose up -d", "then run npm run demo:start again."]);
}
const log = await fetch(`${TERMINUS_URL}/api/log/admin/${DB}?count=1`, { headers: { Authorization: auth } });
if (!log.ok) fail([`The store has no database ${DB}.`, "Seed it first: npm run demo:reset"]);

// 2. Both ports are free.
const free = (port) => new Promise((resolve) => {
  const s = createServer().once("error", () => resolve(false)).once("listening", () => s.close(() => resolve(true)));
  s.listen(port, "127.0.0.1");
});
for (const [port, what] of [[HUB_PORT, "hub"], [VIEWER_PORT, "viewer"]]) {
  if (!(await free(port))) fail([`Port ${port}, for the ${what}, is taken: a hub or viewer from an earlier run, or another program.`, `See what holds it: lsof -nP -iTCP:${port} -sTCP:LISTEN`, "Stop that, or set DEMO_HUB_PORT / DEMO_VIEWER_PORT."]);
}

// 3. The builds.
const build = (script, label) => {
  console.log(`Building the ${label}…`);
  // Its output only when it fails: the bundler's size notes read like warnings and are not.
  const r = spawnSync(npm, ["run", script, "--silent"], { cwd: app, encoding: "utf8" });
  if (r.status !== 0) {
    process.stderr.write(`${r.stdout ?? ""}${r.stderr ?? ""}`);
    fail([`The ${label}'s build failed (npm run ${script} in app/); its output is above.`, "npm install at the repository root first if it cannot find a module."]);
  }
};
build("build:hub", "hub");
if (rebuildViewer || !existsSync(join(app, ".next", "BUILD_ID"))) build("build", "viewer");

// 4. Start both, each line of output marked with its source.
const children = [];
const start = (label, command, args, env) => {
  const child = spawn(command, args, { cwd: app, env: { ...process.env, ...env } });
  const relay = (stream, out) => {
    let rest = "";
    stream.on("data", (chunk) => {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop();
      // next start's note about the standalone output is about deployment, not a failure here.
      for (const line of lines) if (line.trim() && !line.includes('"output: standalone"')) out.write(`[${label}] ${line}\n`);
    });
  };
  relay(child.stdout, process.stdout);
  relay(child.stderr, process.stderr);
  child.on("exit", (code) => {
    if (!stopping) {
      console.error(`\n✗ The ${label} stopped (exit ${code}). Its last lines are above.`);
      stop(1);
    }
  });
  children.push(child);
  return child;
};
let stopping = false;
const stop = (code = 0) => {
  stopping = true;
  for (const c of children) c.kill();
  process.exit(code);
};
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const ready = async (url, label) => {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error(`\n✗ The ${label} did not answer at ${url} within a minute.`);
  stop(1);
};

start("hub", process.execPath, ["dist/server.mjs"], { TERMINUS_DB: DB, PORT: String(HUB_PORT), HOST: "127.0.0.1", ARMATURE_INSTANCE_NAME: INSTANCE_NAME });
await ready(`http://localhost:${HUB_PORT}/api/v1/health/ready`, "hub");
start("viewer", process.execPath, [join(root, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(VIEWER_PORT)], { ARMATURE_HUB_URL: `http://localhost:${HUB_PORT}` });
await ready(`http://localhost:${VIEWER_PORT}/`, "viewer");

console.log(`
✓ The ICICLE demo is running, over the database ${DB}.

  Beat 1  http://localhost:${VIEWER_PORT}/history          (the inherited trail)
          http://localhost:${VIEWER_PORT}/graph            (the Design Graph)
  Beat 3  npm run demo:change, in another terminal; then the branch picker → demo-change,
          and the Alignment lens in the Design Graph
  The hub's API is http://localhost:${HUB_PORT}/api/v1, as demo-designer@example.edu.

  Ctrl-C stops both. npm run demo:reset puts the seed back (stop this first or not; the hub reads it fresh).
`);
