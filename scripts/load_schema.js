// load_schema.js
// Loads schema/schema.json into a local TerminusDB instance.
// Safe to re-run: uses replace semantics so existing schema is overwritten.
//
// Usage:
//   node load_schema.js                     # replace the schema; instance data must conform
//   node load_schema.js --clear-instances   # empty the instance graph first, then replace the schema
//
// A breaking schema change (removing a class, changing a field's type) fails the
// schema check against existing instance data. At demo scale the answer is a
// reload: --clear-instances deletes every instance document in one transaction,
// the schema loads against an empty graph, and seed_data.js repopulates it.
// For a deployment holding real data, use TerminusDB's schema migration
// endpoint (/api/migration, with dry_run) instead; see ADR-0022's consequences.
//
// Environment variables (all have defaults for local dev):
//   TERMINUS_URL    - TerminusDB server URL  (default: http://localhost:6363)
//   TERMINUS_USER   - Admin username          (default: admin)
//   TERMINUS_PASS   - Admin password          (default: admin)
//   TERMINUS_DB     - Database name           (default: armature)

import { WOQLClient } from "terminusdb";
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
  //    One POST to the schema graph with full_replace: true. The server deletes the
  //    existing schema and inserts the posted one in a single transaction, then runs
  //    the schema check against the instance data that is already there.
  //
  //    Why one call: an earlier version posted the @context alone with full_replace
  //    and then the classes without it. On an empty database that worked. On a
  //    database holding seed data the first call replaced the whole schema with just
  //    the context, every instance document failed the schema check, and the loader
  //    died with "Schema check failure". Replacing the whole schema atomically is the
  //    documented purpose of full_replace and is idempotent against existing data as
  //    long as the data still conforms to the new schema.
  //
  //    The commit message is the fourth positional argument of addDocument; the
  //    client does not accept a commit_info parameter.
  // 3b. Optionally empty the instance graph so a breaking schema change can load.
  //     full_replace with an empty document list deletes every instance document
  //     in one commit. Explicit flag because it is destructive.
  if (process.argv.includes("--clear-instances")) {
    console.log(`\nClearing instance data (--clear-instances)...`);
    await client.addDocument([], { full_replace: true }, null, "Clear instance data before schema replace");
    console.log(`  → Instance graph emptied`);
  }

  console.log(`\nLoading schema...`);

  // Strip top-level @comment keys from each entry — TerminusDB rejects @-prefixed
  // properties that aren't part of its schema language. Our @comment entries are
  // human-readable section dividers that don't need to be sent to the database.
  const schemaDocuments = schema.map(({ "@comment": _comment, ...rest }) => rest);
  const typeCount = schemaDocuments.filter(entry => entry["@type"] !== "@context").length;

  console.log(`  → Replacing schema graph: @context + ${typeCount} type definitions...`);
  await client.addDocument(
    schemaDocuments,
    { graph_type: "schema", full_replace: true },
    null,
    "Load Armature schema from schema.json",
  );

  console.log(`  → Schema loaded`);

  console.log(`\nDone. TerminusDB dashboard: http://localhost:6363/dashboard`);
}

main().catch(err => {
  console.error("\nError:", err.message || err);
  process.exit(1);
});
