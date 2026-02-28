// load_schema.js
// Loads schema/schema.json into a local TerminusDB instance.
// Safe to re-run: uses replace semantics so existing schema is overwritten.
//
// Usage:
//   node load_schema.js
//
// Environment variables (all have defaults for local dev):
//   TERMINUS_URL    - TerminusDB server URL  (default: http://localhost:6363)
//   TERMINUS_USER   - Admin username          (default: admin)
//   TERMINUS_PASS   - Admin password          (default: admin)
//   TERMINUS_DB     - Database name           (default: armature)

import { WOQLClient } from "@terminusdb/terminusdb-client";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ---------------------------------------------------------------------------
// Config — reads from environment variables with sensible local defaults
// ---------------------------------------------------------------------------

const TERMINUS_URL  = process.env.TERMINUS_URL  || "http://localhost:6363";
const TERMINUS_USER = process.env.TERMINUS_USER || "admin";
const TERMINUS_PASS = process.env.TERMINUS_PASS || "admin";
const TERMINUS_DB   = process.env.TERMINUS_DB   || "armature";

// ---------------------------------------------------------------------------
// Locate schema.json relative to this script
// (works regardless of which directory you run node from)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const schemaPath = join(__dirname, "..", "schema", "schema.json");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // 1. Read schema from disk
  console.log(`Reading schema from: ${schemaPath}`);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  console.log(`  → ${schema.length} schema entries found`);

  // 2. Create the client
  //    WOQLClient takes the server URL and credentials.
  //    client.db() sets the active database for subsequent operations.
  //    connect() is deprecated — the client is ready to use immediately.
  const client = new WOQLClient(TERMINUS_URL, {
    user: TERMINUS_USER,
    key:  TERMINUS_PASS,
    organization: "admin",  // local TerminusDB always uses "admin" as the org
  });
  client.db(TERMINUS_DB);
  console.log(`\nUsing TerminusDB at ${TERMINUS_URL}`);

  // 3. Create the database if it doesn't exist
  //    We check the list of existing databases first to make this idempotent.
  console.log(`\nChecking for database "${TERMINUS_DB}"...`);
  const databases = await client.getDatabases();
  const exists = databases.some(db => db.name === TERMINUS_DB);

  if (exists) {
    console.log(`  → Database already exists, skipping creation`);
  } else {
    console.log(`  → Database not found, creating...`);
    await client.createDatabase(TERMINUS_DB, {
      label: "Armature",
      comment: "Graph-based infrastructure for learning engineering",
      schema: true,  // creates the schema graph alongside the instance graph
    });
    console.log(`  → Database created`);
  }

  // 4. Load the schema
  //    The schema array has two kinds of entries:
  //      - The @context entry (type "@context") — must be loaded via replaceDocument
  //        with full_replace: true. This sets the namespace prefixes for the whole schema.
  //      - All other entries (Enum and Class definitions) — loaded via addDocument
  //        with graph_type: "schema" and replace semantics.
  console.log(`\nLoading schema...`);

  const contextEntry = schema.find(entry => entry["@type"] === "@context");

  // Strip top-level @comment keys from each entry — TerminusDB rejects @-prefixed
  // properties that aren't part of its schema language. Our @comment entries are
  // human-readable section dividers that don't need to be sent to the database.
  const schemaEntries = schema
    .filter(entry => entry["@type"] !== "@context")
    .map(({ "@comment": _comment, ...rest }) => rest);

  // Load the context first using full replace
  if (contextEntry) {
    console.log(`  → Loading @context...`);
    await client.addDocument([contextEntry], {
      graph_type: "schema",
      full_replace: true,
      commit_info: { message: "Load Armature schema context" },
    });
  }

  // Load all type definitions
  console.log(`  → Loading ${schemaEntries.length} type definitions...`);
  await client.addDocument(schemaEntries, {
    graph_type: "schema",
    commit_info: { message: "Load Armature schema from schema.json" },
  }, null, "replace");

  console.log(`  → Schema loaded`);

  console.log(`\nDone. TerminusDB dashboard: http://localhost:6363/dashboard`);
}

main().catch(err => {
  console.error("\nError:", err.message || err);
  process.exit(1);
});
