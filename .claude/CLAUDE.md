# Armature — Claude Code Context

This file is the primary context for AI-assisted development on Armature. Read this first, then read PROJECT_CONTEXT.md and SESSION.md before starting any work session.

---

## What Armature Is

Armature is graph-based infrastructure for learning engineering. It provides an open schema and API that preserves design rationale in the relationships between instructional artifacts — objectives, assessments, activities, and modules.

The core insight: current instructional design tools capture *what was built* but not *why design decisions were made* or *how artifacts connect to each other*. Armature treats the artifact graph as a first-class data structure, making design decisions inspectable, queryable, and reusable.

**The Git analogy:** Git didn't replace text editors — it added a relational layer underneath them that made the history and provenance of changes visible and inspectable. Armature does the same for instructional design tools.

---

## Architecture

### Stack
- **TerminusDB** — graph database storing the artifact graph
- **Armature API** — a Hono application in `app/lib/api/` (ADR-0054), host-neutral: nothing under that directory imports from `next`. Mounted under `/api/v1/` by the one catch-all route `app/app/api/[[...route]]/route.ts`; Next.js is the host for the current phase (ADR-0026). The unversioned routes in `app/app/api/*/route.ts` are legacy Next.js handlers until Phase 3 retires them. A separate process serving the same app with `@hono/node-server` remains the long-term destination
- **CoQui** — first plugin; an assessment authoring tool built on top of the Armature API (separate repo, not here)
- **Docker Compose** — orchestrates TerminusDB + API for local development and deployment

### Topology
```
CoQui (plugin)  →  Armature API  →  TerminusDB
                    (this repo)
```

The API is the boundary. Plugins never talk to TerminusDB directly. This is architecturally important — the separation demonstrates the hub-plugin model and makes the demo narrative coherent.

### Repository Structure
```
schema/
  schema.json              # TerminusDB schema — single source of truth for all types
  docs/adr/                # Architecture Decision Records
docker/                    # Docker Compose configuration (TerminusDB pinned to v12.0.7)
.github/workflows/ci.yml   # CI: npm run lint + npm run check:types in app/
scripts/
  generate-types.js        # Derives app/lib/types.ts from schema.json — run after schema changes
  generate-schema-appendix.js  # Derives docs/SCHEMA_APPENDIX.md from schema.json
  load_schema.js           # Replaces the schema graph in one full_replace; --clear-instances empties data first for breaking changes
  platform_checks.js       # Probes store behaviours the ADRs depend on, in a scratch database it creates and deletes (run before encoding a platform assumption)
  seed_data.js             # Inserts demo artifact graph (69 documents)
  migrate_schema_docs.js   # Reproduces past schema documentation migrations
  sync-terminusdb-docs.js  # Vendors TerminusDB docs into docs/vendor/terminusdb (see skill)
app/
  app/api/
    [[...route]]/route.ts  # The ONLY file that knows Next.js hosts the API: exports handle(app) per method (ADR-0054)
    */route.ts             # Legacy unversioned Next.js handlers (courses, coverage, ...) — retired in Phase 3; write no new ones
  lib/
    api/
      app.ts               # The Armature API: Hono app, basePath /api/v1, routes, onError mapping. Never imports from next
      app.test.ts          # In-process Vitest tests via app.request(); need the TerminusDB container running
    terminusdb.ts          # Legacy WOQLClient singleton for the unversioned routes only; deleted with them in Phase 3. The API layer uses the HTTP store adapter (ADR-0055)
    routeHelpers.ts        # Legacy: createGetHandler + handleTerminusError for the unversioned routes only
    types.ts               # GENERATED — do not edit; run npm run generate:types
  vitest.config.mts        # Vitest: '@' alias, reads .env.local so tests hit the same store as the app
docs/
  schema-guide.md          # Conceptual guide (in progress)
  SCHEMA_APPENDIX.md       # GENERATED — do not edit; run node scripts/generate-schema-appendix.js
  development-plan.md      # Phased plan; §9 lists verified TerminusDB platform facts
  vendor/terminusdb/       # GENERATED — vendored TerminusDB docs; INDEX.md, VERSION.json, 50 curated pages
.claude/
  CLAUDE.md                # This file
  PROJECT_CONTEXT.md       # Problem space, audiences, demo goals
  SESSION.md               # Current state and next steps
  prompts/                 # Reusable workflow prompts
  skills/terminusdb/       # How to answer TerminusDB questions: which vendored page, what to trust, when to re-sync
```

### TerminusDB documentation

Questions about what the store does (schema language, document API, branches and merge,
history, access control, the JS client) are answered from the vendored docs in
`docs/vendor/terminusdb/`, following the `terminusdb` skill in `.claude/skills/`. The installed
client source under `app/node_modules` is authoritative for client behaviour; the running Docker
container is authoritative for server behaviour. Re-run `node scripts/sync-terminusdb-docs.js`
after a TerminusDB release; `docs/vendor/terminusdb/VERSION.json` records the last sync.

---

## The Schema

The schema is the single source of truth for everything. Read `schema/schema.json` before working on the API or any data-related code. The inline `@documentation` comments on every type and field are authoritative.

### Types are generated, not hand-maintained

`app/lib/types.ts` is **generated** from `schema/schema.json` by `scripts/generate-types.js`. Never edit it directly.

After any change to `schema/schema.json`:
```bash
# From armature/app/
npm run generate:types

# Verify (also runs in CI)
npm run check:types
```

The generator handles: xsd primitives → TS primitives, `Optional<T>` → optional fields, `Set<T>`/`List<T>` → arrays, Class references → `string` (@id), enum references → union types, `@abstract` → JSDoc comment, junction types → `extends TerminusDocument`.

To add a new type: (1) update `schema.json` (with ADR), giving the class `@metadata.armature.category` (`infrastructure`, `fragment`, `artifact` or `relationship`; ADR-0027) and an explicit `@key` (ADR-0024), (2) run `generate:types` and `node scripts/generate-schema-appendix.js`, (3) commit schema, types and appendix together. There is no list of types in the generators; a class without a category fails generation, which CI catches. Before relying on any store behaviour a change depends on, add a check to `scripts/platform_checks.js` and run it against the scratch database it creates.

### Key types and their roles

| Type | Role |
|---|---|
| `DesignRecord` | Abstract root of every artifact and relationship; the type `DesignNote.subject` and `DesignFinding.subject` point at. `User` is outside it (ADR-0017) |
| `LearningObjective` | Central node — everything connects to it |
| `AssessmentItem` | Reusable question in the item bank; a tree of fragments (stem, options, feedbacks) with its own `status`; placed into Assessments via `ItemInstance` |
| `Fragment` / `TextFragment` / `ItemOption` | Subdocument parts of an item, returned inline; identity is the client-assigned `fragmentId`, never the nested store id (ADR-0022, ADR-0023, ADR-0033) |
| `ItemInstance` | Assessment-context wrapper around an `AssessmentItem`; its `status` is placement clearance, distinct from the item's own (ADR-0018) |
| `DesignFinding` | An evidence-grounded concern about any design record, with `status` and resolution rationale (ADR-0020) |
| `ModuleObjective` | Programmatic junction; carries computed `coverageStatus` |
| `PrerequisiteRecord` | Junction doc; carries `rationale` and `prerequisiteType` — design decision preserved as data |
| `NeedEvidenceLink` | Junction doc; links LearningNeed to LearningEvidence with `confidence` weighting |
| `ModuleActivityLink` | Junction doc; places LearningActivity in Module with `sequence` |
| `ModuleActivityGroupLink` | Junction doc; places ActivityGroup in Module with `sequence` |
| `ActivityGroupMember` | Junction doc; places LearningActivity in ActivityGroup with sub-`sequence` |

### Critical API constraints (not enforced by TerminusDB schema)

These must be enforced by the API on every write (the invariants engine, Phase 3). TerminusDB enforces field types, required fields, `@min_cardinality`, enum values and that a referenced document *exists*. It does **not** check the class of a referenced document (verified 2026-10-07, `scripts/platform_checks.js` check L), and it cannot express cross-document or conditional rules.

0. **Every reference field's target must be an instance of the declared class or a subclass.** Generic, applies to every type. This is what keeps a `User` out of `DesignNote.subject` and an `AssessmentItem` out of `Module.course` (ADR-0014, ADR-0017 amended)
1. `AssessmentItem.assesses` — must contain at least one `LearningObjective`
2. `LearningActivity.targets` — must contain at least one `LearningObjective`
3. `ModuleActivityLink.sequence` and `ModuleActivityGroupLink.sequence` — must be unique across both types for a given Module (they share one integer namespace)
4. `ActivityGroupMember.sequence` — must be unique within a group
5. `ItemInstance.sequence` — must be unique within an Assessment
6. `ActivityGroup` — must not contain other `ActivityGroup` instances (flatness constraint)
7. `ModuleObjective.coverageStatus` — must be recomputed after any change to `AssessmentItem.assesses`, `ItemInstance` membership, `ItemInstance` or `AssessmentItem` status, or `ModuleObjective.role`
8. `fragmentId` — unique across all fragments (stem, options, feedbacks) of one `AssessmentItem`; never regenerated by the hub (ADR-0023, ADR-0033)
9. `ItemOption.text` — present, and unique within one item; the number of correct options must suit `itemType` (ADR-0022)
10. `ItemInstance.status` — may not be `Approved` while its `AssessmentItem.status` is `Draft` or `InReview` (ADR-0018)
11. `DesignFinding.resolutionRationale` — required when `status` is `Dismissed` (ADR-0020)
12. A write whose `@id` exists under a different `@type` — rejected with 409 (ADR-0024)

### Junction document pattern

Armature uses junction documents extensively for M:M relationships and semantically rich associations. This is intentional — relationships are first-class artifacts, not just edges. See ADR-0003.

Every junction document follows the same pattern:
- Named after both sides: `NeedEvidenceLink`, `ModuleActivityLink`, `ActivityGroupMember`
- Carries the relationship-level data that makes it worth reifying
- Back-reference pattern: children carry the parent reference, not the other way around (ADR-0004)

---

## Development Principles

### 1. The API is the boundary
Plugins never touch TerminusDB directly. All reads and writes go through Armature API endpoints. This is both an architectural principle and a demo narrative requirement.

The API is also host-neutral (ADR-0054). Every `/api/v1` route is a Hono route in `app/lib/api/`, written against Web-standard `Request` and `Response`. Nothing under `app/lib/api/` imports from `next`; the one catch-all route file is the only place the host appears. This is what makes moving to a separate process a deployment change rather than a rewrite.

### 2. Constraints belong in the API
TerminusDB enforces type safety. Business logic constraints (minimum cardinality, sequence uniqueness, coverageStatus recomputation) belong in the API layer. See ADR-0006.

### 3. Design rationale is explicit
Every non-obvious decision should have a rationale — in code comments, in ADRs, or in the schema documentation. This is Armature practicing what it preaches.

### 4. Schema changes require an ADR
Any modification to `schema/schema.json` that changes existing types or adds new ones warrants an ADR. Adding an ADR first, then implementing, is the preferred order. After schema changes, always regenerate `app/lib/types.ts` (see The Schema section above) and commit both files together.

### 5. Framework vs. plugin boundary
Ask before adding anything: "Does this belong in the graph infrastructure, or in a specific tool's UX?" System-of-record concerns (artifact typing, relationships, schema versioning) belong here. Editing workflows, import/export formats, and UI patterns belong in plugins.

### 6. The two-client test
A capability requested by one client enters the hub only in the generic form a second reference client would also need. Test every ask against the reference-clients table in PROJECT_CONTEXT.md: if at least two clients need it, adopt the generic form; if only one does, it stays in that plugin. CoQui's round, craft grid, claim version and workflow states are the standing examples of asks that fail the test and map onto branches, `claimRef`, `ItemStatus` and `User` at CoQui's boundary. See `docs/development-plan.md` §2.

### 7. Text fields on rationale-bearing documents are intentionally provisional
Fields like `LearningNeed.rationale`, `PrerequisiteRecord.rationale`, and `DesignNote.rationale` are free-text placeholders, not design failures. The schema cannot pre-design structure for design decisions it doesn't yet understand — real usage patterns in the graph will reveal what structure is warranted. When those patterns emerge, text fields can be progressively formalized: add an optional enum alongside the existing text field, introduce a structured type, or reify the relationship as a junction document. Do not suggest replacing text fields with structured types without concrete evidence from real usage. The migration path is intentionally clean: optional field additions don't break existing records, and TerminusDB schema migration supports incremental formalization. See ADR-0010.

---

## ADR Reference

All architecture decisions are documented in `schema/docs/adr/`. The filenames are self-descriptive. Key decisions to read before working on the API:

- **ADR-0002** — References, not ownership (affects all relationship queries)
- **ADR-0003** — Set vs. junction document (affects all write operations)
- **ADR-0004** — Back-references on children (affects all list queries)
- **ADR-0005** — Module content sequencing (affects activity ordering logic)
- **ADR-0006** — Minimum cardinality enforced by API (affects all create/update validators)
- **ADR-0007** — ModuleObjective as programmatic junction (affects coverage computation)
- **ADR-0026** — API host and route versioning (Next.js routes are the API; new routes under `/api/v1`)
- **ADR-0054** — The API is a Hono application (host-neutral; nothing under `app/lib/api/` imports from `next`)
- **ADR-0055** — The API layer reaches TerminusDB over HTTP through one adapter (the JavaScript client stays in `scripts/`)

---

## Workflow

### Session startup
1. Read SESSION.md for current state and next steps
2. Check git log for recent commits
3. Read any files relevant to today's work

### Tests
`npm test` in `app/` runs Vitest. The tests under `app/lib/api/` call the Hono app in-process with `app.request()` and read from the TerminusDB container, so the container must be up with the seed loaded. They are integration tests and are not in CI until Phase 7 adds a TerminusDB service container; CI runs lint and the types drift check only.

### Session end
Say "update session" and follow the prompt in `.claude/prompts/update-session.md`.

### Commits
Follow the guide in `.claude/prompts/commit-message-guide.md`. Descriptive, conventional commit format. Show the message for approval before committing.

### After schema changes
1. Write or update the ADR in `schema/docs/adr/`
2. Update `schema/schema.json`
3. Run `npm run generate:types` from `armature/app/`
4. Run `npm run check:types` to verify output
5. Commit `schema.json` and `app/lib/types.ts` together in the same commit

### Adding an ADR
1. Find the next available number in `schema/docs/adr/`
2. Use the format: `NNNN-short-decision-title.md`
3. Follow the Nygard format: Status / Context / Decision / Consequences
4. Reference the ADR number in any related schema `@documentation` comments

---

## What Not To Do

- **Don't** write directly to TerminusDB — always go through the API layer
- **Don't** add owned subdocuments — all relationships use references (ADR-0002)
- **Don't** put UI logic, import/export formats, or plugin-specific code in this repo
- **Don't** change `schema.json` without an ADR
- **Don't** edit `app/lib/types.ts` manually — it's generated; change `schema.json` and run `generate:types`
- **Don't** write new API routes as Next.js route handlers — new routes are Hono routes in `app/lib/api/` under `/api/v1` (ADR-0054); the files under `app/app/api/*/route.ts` are legacy
- **Don't** import from `next` anywhere under `app/lib/api/` — the host appears only in `app/app/api/[[...route]]/route.ts`
- **Don't** import the `terminusdb` client under `app/lib/api/` — the API layer reaches the store through its HTTP adapter (ADR-0055); the client lives in `scripts/`. The one exception is `lib/woql.js` to build query JSON the adapter posts, and the first such use amends the ADR
- **Don't** forward store-internal tokens into the API contract without deciding their shape — the `TerminusDB-Data-Version` value is the store's `branch:<commit>` token today; Phase 2 decides what `/api/v1` exposes (ADR-0054 consequences)
- **Don't** leave API constraints undocumented — if TerminusDB can't enforce it, the schema comment must say the API will
