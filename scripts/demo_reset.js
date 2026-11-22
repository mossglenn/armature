/**
 * demo_reset.js — `npm run demo:reset` from the repository root.
 *
 * Resets the ICICLE demonstration's database to its seed, for practice and
 * recording (docs/icicle-demo-script.md): deletes the database (its data,
 * branches and history), creates it, loads the schema, and writes the seed's
 * three commits (seed_icicle_demo.js). About ten seconds against a local store.
 *
 * The database is `armature_icicle` unless TERMINUS_DB names another, and it is
 * never `armature`: that is the development database on the same store, which
 * the suites and the viewer use, and the seed would replace it whole. A
 * deployed demonstration instance resets with the operator's commands in the
 * script's Setup instead.
 *
 * Environment variables, read by the two scripts it runs:
 *   TERMINUS_URL, TERMINUS_USER, TERMINUS_PASS   as load_schema.js
 *   TERMINUS_DB                                  default armature_icicle
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const db = process.env.TERMINUS_DB || "armature_icicle";

if (db === "armature") {
  console.error("demo:reset refuses the database `armature`: it is the development database, and the demo seed would replace it whole.");
  console.error("Leave TERMINUS_DB unset (armature_icicle), or name another database.");
  process.exit(1);
}

const run = (script, args = []) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: here, stdio: "inherit", env: { ...process.env, TERMINUS_DB: db } });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

console.log(`Resetting the ICICLE demo in database "${db}"\n`);
run("load_schema.js", ["--recreate"]);
run("seed_icicle_demo.js");

console.log(`
Ready: ${db} holds the seed. Start the demo with npm run demo:start (or reload the browser if it is running).`);
