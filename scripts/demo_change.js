/**
 * demo_change.js — `npm run demo:change` from the repository root.
 *
 * Beat 3 of the ICICLE demonstration (docs/icicle-demo-script.md), on camera:
 * opens the branch `demo-change` from main on the running hub and writes the
 * change to the lateral-reading objective (CHANGE in seed_icicle_demo.js), as
 * the demo designer, through the API any tool uses. Prints the commit and its
 * message. A branch is never deleted while it holds work, so a second run needs
 * `npm run demo:reset` first.
 *
 * Environment variables:
 *   DEMO_HUB_URL   default http://localhost:3100 (what npm run demo:start runs)
 *   DEMO_USER      default demo-designer@example.edu
 */

import { CHANGE } from "./seed_icicle_demo.js";

const HUB = (process.env.DEMO_HUB_URL || "http://localhost:3100").replace(/\/$/, "");
const USER = process.env.DEMO_USER || "demo-designer@example.edu";
const BRANCH = "demo-change";
const headers = { "Content-Type": "application/json", "Armature-User": USER };

const fail = (lines) => {
  console.error(`\n✗ ${lines.join("\n  ")}\n`);
  process.exit(1);
};
const call = async (method, path, body) => {
  try {
    const res = await fetch(`${HUB}/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  } catch {
    fail([`No hub answers at ${HUB}.`, "Start the demo first: npm run demo:start"]);
  }
};

const made = await call("POST", "/branches", { name: BRANCH, from: { branch: "main" } });
if (made.status === 409) fail([`The branch ${BRANCH} already exists: the change was made in an earlier take.`, "Put the seed back with npm run demo:reset, then run this again."]);
if (made.status !== 201) fail([`The hub refused the branch: ${made.status} ${made.body.error ?? ""}`, made.body.message ?? ""]);

const id = CHANGE.document["@id"].split("/")[1];
const put = await call("PUT", `/documents/LearningObjective/${id}?branch=${BRANCH}`, CHANGE);
if (put.status !== 200) fail([`The hub refused the change: ${put.status} ${put.body.error ?? ""}`, put.body.message ?? ""]);

console.log(`On branch ${BRANCH}, commit ${put.body.commit}:
  ${CHANGE.message}
  "${CHANGE.document.label}" (${CHANGE.document.bloomsLevel})`);
