# Armature — Session State

This file tracks current work state across sessions. Update it at the end of every session using the workflow in `prompts/update-session.md`.

---

## Current Phase

**Planning complete → Phase 0 of `docs/development-plan.md` is next.** The plan supersedes the earlier "What's Next" sequence (POST /needs, POST /objectives, …): per-type POST routes are replaced by a generic write path with an invariants engine in Phase 3.

History: Schema loaded → Seed data inserted → Demo API documented → Next.js scaffolded → GET endpoints live → Types generator implemented → POST /courses + POST /modules live → CoQui fit analysis (ADRs 0016–0023) → Development plan, TerminusDB verification, docs vendoring, research survey (October 2026).

---

## What's Done

### Planning and research (October 2026)

- `docs/development-plan.md` — eight phases grounded in the position paper's principles; seven reference clients and the two-client test (an ask enters the hub only when a second client would need it); ADR queue 0024–0034; open questions with the evidence that would settle each; declines; §9 platform facts verified against TerminusDB v12.0.7
- TerminusDB v12.0.7 verified against live docs and client source. Two corrections to earlier assumptions: the store has a three-way merge with field-level conflict reports (`apply`), and the JS client cannot set the commit author (writes needing an Armature `User` as author go over the HTTP document API)
- `scripts/sync-terminusdb-docs.js` — vendors TerminusDB docs from the public Markdoc source repo (`dfrnt-labs/terminusdb-docs-static`) at a pinned commit; 50 curated pages committed under `docs/vendor/terminusdb/` with `INDEX.md` and `VERSION.json`; the rest gitignored under `_all/`
- `.claude/skills/terminusdb/SKILL.md` — which vendored page answers what; trust order (installed client source → running store → vendored docs → live site); when to re-sync
- Evaluations recorded in the plan (§6): Epic's Lore (leading candidate for a developed-assets store, deferred on timing: pre-1.0 API churn, QUIC/gRPC/OIDC operations, native SDK); slash-builder/bitchain (not a candidate; its `context` field independently supports the `fragmentId` + attachment-reference split)
- Rich-artifact model recorded in the plan (§3): structure in the graph as a fragment tree, content as attachment references, behaviour as versioned `InteractionType` renderers, rationale via commits and compound targets; ADR-0033 and ADR-0034 queued
- `docs/research/` (from a parallel session, 2026-10-06) — standards-precedents survey, ADR candidates 0035–0053, further-reading list of 85 sources

### Schema

- TerminusDB schema fully designed and documented (`schema/schema.json`)
- 12 enums, 23 classes (including ArmatureDocument base, User, DesignNote, Response, junction documents)
- All types documented in TerminusDB-compliant multi-language array format (`@documentation: [{@language: "en", ...}]`)
- Field-level documentation consolidated into `@properties` on each type
- API constraints documented directly on affected fields
- 23 ADRs (`schema/docs/adr/`). ADRs 0017, 0018, 0019, 0020 are Proposed; 0022 and 0023 are Accepted but not yet implemented in `schema.json` (`Response` still exists; embedded options and `fragmentId` do not). Phase 1 of the plan lands them.

### Infrastructure

- TerminusDB running locally via Docker Compose (`docker/docker-compose.yml`); the local container is the v12.0.7 build under the `v12` tag
- Schema loader script (`scripts/load_schema.js`) — idempotent, JS client, replace semantics
- Schema documentation migration script (`scripts/migrate_schema_docs.js`) — reproducible for future migrations
- Schema loaded and verified in local TerminusDB instance
- GraphQL endpoint confirmed working: `http://127.0.0.1:6363/api/graphql/admin/armature`

### Seed Data

- Complete demo artifact graph inserted (`scripts/seed_data.js`)
- Course: "Introduction to AI for Instructional Designers"
- 69 documents across all major schema types
- Covers: 2 LearningNeeds + evidence, 7 LearningObjectives, 4 PrerequisiteRecords, 3 Modules, 3 Assessments, 6 AssessmentItems, 24 Responses (to be replaced by embedded options in Phase 1), 7 ItemInstances (item reuse demonstrated), 7 ModuleObjectives, 1 DesignNote
- One objective intentionally Uncovered in ModuleObjective.coverageStatus for demo interest

### Demo API

- Full API specification documented (`docs/demo-api.md`) — now partly superseded by the plan's generic document API; the item and coverage shapes in it are stale (Phase 0 reconciliation)
- Architecture decision: narrow domain layer (not thin pass-through, not general CRUD)
- Each endpoint maps to a specific demo tool and performs atomic multi-document operations

### Next.js App (`armature/app/`)

- Scaffolded with `create-next-app` — TypeScript, Tailwind CSS, App Router, React Compiler enabled
- Node 23.5 in use; `eslint-visitor-keys` engine warning is cosmetic — Node 23 works fine
- `app/lib/terminusdb.ts` — shared WOQLClient singleton; requires `organization: "admin"` in constructor. To be replaced by a per-request client bound to a branch or ref (Phase 2)
- `app/lib/routeHelpers.ts` — `createGetHandler(type)` factory for boilerplate GET routes
- `app/lib/types.ts` — generated from `schema/schema.json`
- All 8 simple GET routes implemented via factory: courses, objectives, modules, needs, assessments, items, prerequisites, notes
- Custom GET `/api/coverage/[moduleId]` — fetches ModuleObjective junctions, joins LearningObjective labels. Known defects: returns status `5000` on error (invalid), leaves debug logs in, bypasses `handleTerminusError`, one round trip per objective (Phase 0)
- Root `.gitignore` cleaned up — Next.js paths unanchored, duplicates removed, `.vscode/` exclusion removed (intentionally committed); `docs/vendor/terminusdb/_all/` ignored
- `app/.env.local` — TerminusDB connection vars (not committed)

### Types Generation

- `scripts/generate-types.js` — generates `app/lib/types.ts` from `schema/schema.json`
- `app/lib/types.ts` is **generated**, not hand-maintained — do not edit directly
- Two npm scripts in `app/package.json`: `generate:types` (write) and `check:types` (drift check, CI-ready; CI itself does not exist yet — Phase 0)
- Enums emit `VALID_*` const arrays + derived union types — arrays are runtime source of truth
- Type mapping: xsd primitives → TS primitives, `Optional<T>` → optional fields, `Set<T>`/`List<T>` → arrays, Class references → `string` (@id), enum refs → union types, junction types → `extends TerminusDocument`. Subdocument support still to be added (Phase 1)
- `JUNCTION_IDS` and `CLASS_ORDER` in the generator are the two places to update when adding new schema types — to be replaced by `@metadata.armature.category` (ADR-0027, Phase 1)

### Validation Layer (`app/lib/validate.ts`)

- `validateString`, `validateOptionalString`, `validateEnum`, `validateReference`, `validatePositiveInt`, `ValidationError`, `MAX_LENGTH` — to be absorbed into the invariants registry (Phase 3)

### TerminusDB Error Handling (`app/lib/routeHelpers.ts`)

- `handleTerminusError(error, context)` — maps known TerminusDB error `@type` strings to structured HTTP responses; unknown errors logged for pattern discovery

### POST Endpoints

- `POST /api/courses` and `POST /api/modules` — to be retired or aliased once the generic write path exists (Phase 3)

---

## What's Next

**Phase 0 of `docs/development-plan.md` — ground truth (1 session):**

1. Fix `app/app/api/coverage/[moduleId]/route.ts` (status `5000`, debug logs, error handling, N+1 reads)
2. Reconcile documents: README setup section; CLAUDE.md stack line ("Express or Fastify"); `docs/demo-api.md` item and coverage shapes; remove `docs/terminusdb-schema-doc.md` (superseded by `docs/vendor/terminusdb/schema-reference-guide.md`)
3. Add CI: GitHub Actions running `npm run lint` and `npm run check:types` in `app/`
4. Pin `terminusdb/terminusdb-server:v12.0.7` in compose; replace `@terminusdb/terminusdb-client@12.0.0` with `terminusdb@12.0.5` in `app/` and `scripts/`
5. Resolve the `app/.env.local` credentials mismatch (see Blockers)
6. Write ADR-0026 (API host and route versioning: Next.js under `/api/v1`)
7. Add the reference-clients table to PROJECT_CONTEXT.md and the two-client test to CLAUDE.md's Development Principles

**Then Phase 1 — schema catch-up.** Before any schema change, read `docs/research/adr-candidates.md` items 0035 (lossless writes under replace semantics) and 0036 (immutable shared history), which the research flags as data-loss risks; and run the platform checks the plan names (subdocument keys and inline return, polymorphic subdocument lists, four-level inheritance, `@metadata` survival).

---

## Active Decisions

- `docs/development-plan.md` is the roadmap; SESSION.md tracks state against it
- The two-client test: a CoQui ask enters the hub only in the generic form a second reference client would need; CoQui's round, craft grid, claim version and workflow states never enter the schema
- Generic document API (`/api/v1/documents/:type/:id`) with a per-type invariants registry replaces per-type routes (Phase 3); type behaviour is a validator, not a handler
- Attachments are references with a mandatory content hash and optional revision and path; the graph never embeds binaries; the backend is a deployment choice; tool-managed stores write through the ordinary path (ADR-0030)
- Items are a tree of fragments; `ItemOption` is a `Fragment` specialisation so generic kinds can sit beside it (ADR-0033); behaviour is a versioned `InteractionType`, and the hub never serves executable content from a graph document (ADR-0034)
- Design process data lives in the commit graph; the graph is a projection of any asset store's history, never a replay (ADR-0025)
- Document writes that must carry an Armature `User` as author go over the HTTP document API (`author`, `message` params); the JS client is retained for reads and version-control calls only — narrows the earlier "JS client over raw HTTP" decision
- Next.js routes remain the API host for this phase under `/api/v1` (ADR-0026 to record it); separate service stays the destination
- TerminusDB docs are vendored, dated and pinned by `scripts/sync-terminusdb-docs.js`; never hand-copied; the `terminusdb` skill governs their use
- Next.js app lives inside the Armature repo (`armature/app/`) — demo is part of the project
- Next.js runs locally (not containerized) — TerminusDB stays in Docker; containerizing deferred to Phase 7
- No auth system in demo scope — TerminusDB credentials in environment variables only; identity resolution hook comes in Phase 3 (ADR-0032)
- `createGetHandler` factory for simple GET routes until Phase 3 retires them
- `app/lib/types.ts` is generated from `schema/schema.json` — committed artifact, drift caught by `npm run check:types`
- `VALID_*` arrays in `types.ts` are the runtime source of truth for enums
- `handleTerminusError` matches on `@type` substrings, not `api:message` text
- `deleteDocument({ id: string | string[] })` — object with `id` key, not a bare array

---

## Blockers

- **App cannot connect to the local TerminusDB.** On 2026-10-05 the credentials in `app/.env.local` were rejected by the running container (`api:IncorrectAuthenticationError`); the documented default and the compose default were also rejected. Likely the container was started with a different `TERMINUSDB_ADMIN_PASS`. Diagnose before any route work (Phase 0, item 5).

---

## Notes for Next Session

Start Phase 0 of `docs/development-plan.md`. It is one session of hygiene with no design decisions in it, and everything after it depends on CI existing and the documents agreeing with each other.

Key context:
- The plan's §9 lists every TerminusDB platform fact relied on, with two corrections to what the CoQui handoff assumed (merge exists; JS client cannot set commit author). The CoQui handoff's "no three-way merge" line should be corrected on CoQui's side when PR 6 is picked up.
- For any TerminusDB question, load the `terminusdb` skill; the installed client source outranks the docs.
- `docs/research/adr-candidates.md` contains amendments to the reserved ADRs 0024–0034 and new candidates from 0035. Nothing in it is accepted. Items 0035 and 0036 must be read before Phase 1 schema work.
- `docs/armature-asks-from-Coqui.md` remains the authoritative statement of what CoQui needs; the plan's §7 maps CoQui's PRs to phases.
- The user's standing preference (saved to memory): judge scope by the position paper's full vision (complex learning objects, versioned asset development), not by near-term clients; record simplifications as timing decisions, never scope decisions.

---

## Recent Sessions

### 2026-10-05 to 2026-10-07

- Reviewed the repo against the CoQui handoff; wrote `docs/development-plan.md` (eight phases, reference clients, two-client test, ADR queue 0024–0034), then amended it for attachments, Lore, rich artifacts and bitchain
- Verified every platform assumption against TerminusDB v12.0.7 docs and the installed client source; corrected two (three-way merge exists; JS client hardcodes commit author); recorded all facts in plan §9
- Built `scripts/sync-terminusdb-docs.js` and the `terminusdb` skill; vendored 243 pages from the public Markdoc source repo, 50 curated pages committed with INDEX.md and VERSION.json
- Evaluated Epic's Lore (leading candidate for developed assets, deferred on timing) and bitchain (not a candidate; supports the `fragmentId` split); recorded the four-layer rich-artifact model and ADRs 0033–0034
- A parallel session added `docs/research/` (standards precedents, ADR candidates 0035–0053, reading list)
- Found the `app/.env.local` credentials are rejected by the running container; left as a blocker for Phase 0

### 2026-03-03 (afternoon)

- Built `app/lib/validate.ts` — `validateString`, `validateOptionalString`, `validateEnum`, `validateReference`, `validatePositiveInt`, `ValidationError`, `MAX_LENGTH`
- Updated `generate-types.js` to emit `VALID_*` const arrays alongside union types — arrays are runtime source of truth, types derived from them
- Added `handleTerminusError(error, context)` to `routeHelpers.ts` — maps TerminusDB `@type` substrings to structured HTTP responses; unknown errors log for pattern discovery
- Implemented and tested `POST /courses` and `POST /modules` with full validation
- Confirmed `deleteDocument({ id: [...] })` signature (not bare array) — documented in Active Decisions
- Decided: keep JS client, not worth switching to raw HTTP API mid-project

### 2026-03-03 (morning)

- Implemented `scripts/generate-types.js` — derives `app/lib/types.ts` from `schema/schema.json`
- Added `generate:types` and `check:types` npm scripts to `app/package.json`
- `app/lib/types.ts` is now a committed generated artifact — not hand-maintained
- Fully documented generator inline: file header covers mapping decisions, extension guide, and Zod deferral note; all functions have JSDoc
- Updated CLAUDE.md: repo structure, types workflow section, schema change procedure, What Not To Do
- Updated SESSION.md: resolved open decision, types generation added to What's Done

### 2026-03-02

- Scaffolded Next.js app (`armature/app/`) — TypeScript, Tailwind, App Router, React Compiler
- Installed and configured `@terminusdb/terminusdb-client` (WOQLClient, not TerminusDBClient)
- Built shared TerminusDB client singleton (`app/lib/terminusdb.ts`)
- Built `createGetHandler` factory (`app/lib/routeHelpers.ts`) — eliminates boilerplate GET routes
- Implemented all 8 simple GET API routes via factory
- Implemented custom Coverage View route (`/api/coverage/[moduleId]`) with junction join
- Debugged: missing `organization: "admin"`, wrong field name (`references` not `objective`), Next.js 15 async params
- Created `app/lib/types.ts` — full TypeScript interfaces derived from schema
- Identified types drift problem — `types.ts` is a manual copy of `schema.json`; generation approach deferred to next session
- Cleaned up root `.gitignore` for Next.js compatibility

### 2026-02-27

- Migrated `@documentation` to TerminusDB-compliant multi-language array format
- Set up Docker Compose for local TerminusDB
- Implemented schema loader script (`scripts/load_schema.js`)
- Loaded and verified schema in local TerminusDB
- Confirmed GraphQL endpoint working with Authorization header
- Designed seed data course ("Introduction to AI for Instructional Designers")
- Implemented and ran seed data script (69 documents)
- Explored GraphQL query patterns — documented correct back-reference syntax
- Planned demo API: 16 endpoints, narrow domain layer architecture
- Documented full API spec in `docs/demo-api.md`
- Decided: Next.js app in Armature repo, running locally against Docker TerminusDB

### 2026-02-22

- Designed and finalized TerminusDB schema
- Added semantic enrichments beyond base Mermaid diagram (ADR-0009)
- Documented all 10 design decisions as ADRs
- Added inline documentation to all schema types and fields
- Initialized GitHub repo with README, LICENSE, .gitignore
- Created `.claude/` directory with CLAUDE.md, PROJECT_CONTEXT.md, SESSION.md
