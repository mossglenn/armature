# Armature — Session State

This file tracks current work state across sessions. Update it at the end of every session using the workflow in `prompts/update-session.md`.

---

## Current Phase

**Phase 2 (the version-control model) complete on `phase-2/version-control`, 2026-10-08; PR open for rebase merge → Phase 3 of `docs/development-plan.md` (generic writes and the invariants engine) is next.** Phases 0 and 1 merged on 2026-10-07 (PRs #1 to #4). The plan supersedes the earlier "What's Next" sequence (POST /needs, POST /objectives, …): per-type POST routes are replaced by a generic write path with an invariants engine in Phase 3.

History: Schema loaded → Seed data inserted → Demo API documented → Next.js scaffolded → GET endpoints live → Types generator implemented → POST /courses + POST /modules live → CoQui fit analysis (ADRs 0016–0023) → Development plan, TerminusDB verification, docs vendoring, research survey → Phase 0 hygiene, CI, ADR-0026 → ADR-0054 Hono → Phase 1 schema catch-up → ADR-0055, ADR-0025, Phase 2 version control (October 2026).

---

## What's Done

### Phase 2: the version-control model (2026-10-08)

- **ADR-0055 (Accepted):** the API layer reaches TerminusDB only through one `fetch`-based adapter, `app/lib/api/store.ts`; the JavaScript client stays in `scripts/`. Decided on a reading of the installed client source: author welded to the connection user, a supplied data version kept in instance headers forever, errors flattened to strings, history `diff` option missing
- **ADR-0025 (Accepted):** design process data lives in the commit graph. No version fields ever (ADR-0010 amended); every write is a commit with the resolved `User` id as author and a required `message` in a JSON envelope; reads at `?branch=` or `?ref=`; `/api/v1` exposes bare commit ids as `ETag` and accepts `If-Match` (412 when stale), closing ADR-0054's open question; merge wraps `apply` three-way with a hub-computed base; no reset, squash or rebase exposed or called; interim `Armature-User` header until ADR-0032
- `scripts/platform_checks.js` checks M to V, all passing on v12.0.7, with corrections to the vendored docs: `apply` takes bare commit ids and reports a conflict as HTTP 409 with `@expected`/`@found` witnesses; a stale data version is HTTP 400; rebase runs X onto Y for `POST /api/rebase/X` with `rebase_from: Y`; branch DELETE needs a `{}` body; a read at a non-existent commit path is a 500, so commit ids are validated via `ValidCommit/<id>` in `local/_commits`; `Commit.parent` is single-valued and `apply` stores `commit_info.metadata`
- Routes, all Hono, all through the adapter: `GET /api/v1/documents/:type/:id?branch=|ref=`, provisional `PUT` (artifact and relationship classes only, until the invariants engine), `/history?branch=` with per-commit diffs, `/diff?from=&to=`, `GET/POST /api/v1/branches`, `GET /branches/:name`, `POST /branches/:name/merge` (409 `merge_conflict` with base, target and source values), `GET /branches/:name/changes?since=`
- Merge commits carry `{ armature: { mergeSource } }` in commit metadata because an `apply` commit has one parent and does not record the source it merged; the merge-base walk reads it from the log. First built as a `Merge-Source` message trailer, moved to metadata once check V showed the store keeps it
- `app.onError` maps typed `StoreError` by the server's `@type`; hub errors are `ApiError` with stable codes
- Seed gains `User/demo-designer` (48 documents); live store re-seeded
- Phase 2 exit criterion met by the walkthrough in `app/lib/api/app.test.ts` (25 tests, scratch branches, `main` untouched). `tsc`, lint, `check:types`, `next build` clean
- Security review of the interim header acknowledged: the provisional write cannot mint `User` documents; mutating routes stay local until ADR-0032

### Phase 1: schema catch-up (2026-10-07)

- `scripts/platform_checks.js`: reproducible probes of store behaviour in a scratch database (checks A to L). All Phase 1 platform assumptions verified on v12.0.7: subdocuments inline by default, polymorphic `List<Fragment>`, `sys:JSON` on subdocuments, four-level inheritance, `@metadata` survival, empty abstract root, client-supplied `@id` under `@key Random`, nested diffs
- **New platform fact, corrected in plan §9:** the store does not check the class of a referenced document, only that it exists. `DesignNote.subject → User` and `Module.course → AssessmentItem` were accepted. Reference class is now CLAUDE.md constraint 0 for the invariants engine; ADR-0014 and ADR-0017 amended
- `schema/schema.json`: 27 classes, 13 enums. `Response` removed; `Fragment` (abstract subdocument) with `TextFragment` and `ItemOption`; `AssessmentItem` carries `stem`, `options`, `correctFeedback`, `incorrectFeedback` as fragments and a required `status`; `DesignRecord` abstract root above `ArmatureDocument` and the junctions; `DesignNote.subject: Set<DesignRecord>`; `DesignFinding` and `FindingStatus`; `@metadata.armature.category` on every class; explicit `@key Random` on every primary artifact
- ADRs: 0017, 0018, 0020 Accepted and implemented; 0022, 0023 marked implemented; 0024 (client-supplied identifiers), 0027 (schema self-description), 0033 (items as a tree of fragments) written and Accepted; 0019 stays Proposed until Phase 4; 0014 amended
- Generators rewritten: `generate-types.js` groups by category, inlines subdocuments, exports `CLASS_CATEGORY` and `SUBDOCUMENT_CLASSES`, fails on a missing category; `JUNCTION_IDS` and `CLASS_ORDER` deleted from both generators. `generate-schema-appendix.js` badges subdocuments and relationships from metadata and renders unplaced classes rather than dropping them
- `load_schema.js --clear-instances` for breaking schema changes (reload chosen over the migration endpoint at demo scale; recorded in ADR-0022)
- Seed rewritten: 47 documents; items with real option text and fragment ids, one with general incorrect feedback and two options with `purpose`; statuses Approved ×4, InReview, Draft with matching ItemInstance statuses; one `DesignFinding` on the Draft item; one `DesignNote` on a `ModuleObjective` via `@capture`/`@ref`
- Live store reloaded and re-seeded; `npm run lint`, `check:types`, `tsc`, `npm test` all pass

### Phase 0: ground truth (2026-10-07)

- `app/app/api/coverage/[moduleId]/route.ts` rewritten: HTTP 500 via `handleTerminusError` (was status `5000`), debug logs removed, two round trips regardless of module size (server-side document template query for the module's ModuleObjectives, one list read of LearningObjectives joined in memory). Verified on seed data: `how-ai-works` returns three objectives, one `Uncovered`
- **The coverage route had never been committed.** The root `.gitignore`'s unanchored `coverage/` (a Jest pattern) ignored `app/app/api/coverage/`. Anchored to `/app/coverage/`; the route is now tracked
- Generator fix: a class with no own properties emits `export type X = Base` instead of an empty interface, which `@typescript-eslint/no-empty-object-type` rejected. `npm run lint` is clean for the first time; `check:types` and `tsc --noEmit` pass
- CI: `.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm run check:types` in `app/` on push to `main` and on pull requests (Node 22)
- Store pinned: `docker/docker-compose.yml` uses `terminusdb/terminusdb-server:v12.0.7`. Client renamed: `terminusdb@12.0.5` replaces `@terminusdb/terminusdb-client@12.0.0` in `app/` and `scripts/`; the renamed package ships its own TypeScript types; imports updated in `app/lib/terminusdb.ts`, `scripts/load_schema.js`, `scripts/seed_data.js`
- Credentials blocker resolved: recreating the container from compose (default `TERMINUSDB_ADMIN_PASS=admin`) made `app/.env.local` authenticate; the data volume and all 69 seed documents survived
- `scripts/load_schema.js` was not idempotent on a database with data: it full-replaced the schema graph with the `@context` alone, which wiped every class and failed the schema check. Now one `full_replace` POST of context plus all types. `scripts/seed_data.js` now actually does the `full_replace` its comment claimed. Both passed an unsupported `commit_info` option and the string `"replace"` as the commit message; both now set real commit messages (verified in the store's log). Both re-run cleanly
- **ADR-0026: API host and route versioning** (Accepted). Next.js routes are the API for this phase; new routes under `/api/v1/`; unversioned routes are legacy until Phase 3; triggers for moving to a separate service recorded
- Documents reconciled: README setup section rewritten for the real stack; CLAUDE.md stack line and repo tree (no `api/`, CI added), two-client test added as Development Principle 6; PROJECT_CONTEXT.md gained the reference-clients table, the "separate API service" decision now points at ADR-0026, and the resolved open questions (API framework, seed domain) are closed; `docs/demo-api.md` carries a status banner and in-place "stale shape" notes on the item and coverage sections; `docs/terminusdb-schema-doc.md` removed (the vendored `schema-reference-guide.md` supersedes it); the `terminusdb` skill updated accordingly

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
- 13 enums, 27 classes: `User`; abstract roots `DesignRecord` and `ArmatureDocument`; subdocument fragments `Fragment`, `TextFragment`, `ItemOption`; 14 artifacts including `DesignNote` and `DesignFinding`; 7 relationship (junction) documents. Every class carries `@metadata.armature.category` and an explicit `@key`
- All types documented in TerminusDB-compliant multi-language array format (`@documentation: [{@language: "en", ...}]`)
- Field-level documentation consolidated into `@properties` on each type
- API constraints documented directly on affected fields
- 31 ADR files (`schema/docs/adr/`, 0001–0027, 0033, 0054, 0055). All Accepted and implemented except ADR-0019 (Proposed; promoted with the coverage algorithm in Phase 4). Reserved by the plan and not yet written: 0028–0032, 0034. Numbers 0035–0053 are research candidates, not ADRs.

### Infrastructure

- TerminusDB running locally via Docker Compose (`docker/docker-compose.yml`), image pinned to `v12.0.7`
- Schema loader script (`scripts/load_schema.js`) — idempotent: one `full_replace` POST of the whole schema graph; safe to re-run against a database holding data
- Schema documentation migration script (`scripts/migrate_schema_docs.js`) — reproducible for future migrations
- Schema loaded and verified in local TerminusDB instance
- GraphQL endpoint confirmed working: `http://127.0.0.1:6363/api/graphql/admin/armature`

### Seed Data

- Complete demo artifact graph inserted (`scripts/seed_data.js`)
- Course: "Introduction to AI for Instructional Designers"
- 48 documents across all major schema types (was 69 before `Response` was embedded; `User/demo-designer` added 2026-10-08 as the author of Phase 2 writes)
- Covers: 2 LearningNeeds + evidence, 7 LearningObjectives, 4 PrerequisiteRecords, 3 Modules, 3 Assessments, 6 AssessmentItems each with a stem fragment and 4 embedded options (real option text, fragment ids, one general feedback, two `purpose` notes), 7 ItemInstances (item reuse demonstrated), 7 ModuleObjectives, 2 DesignNotes (one on a ModuleObjective junction via `@capture`/`@ref`), 1 DesignFinding
- Item statuses: 4 Approved, 1 InReview (`appropriate-use-mc`), 1 Draft (`hallucination-mc`, the finding's subject); ItemInstance statuses match (ADR-0018)
- One objective intentionally Uncovered in ModuleObjective.coverageStatus for demo interest. Coverage values are hand-seeded until Phase 4 recomputes them; `identify-ai-limitations` is seeded FullyAssessed although its only item is Draft (ADR-0019 will change that)

### Demo API

- Full API specification documented (`docs/demo-api.md`) — now partly superseded by the plan's generic document API; the item and coverage shapes in it are stale (Phase 0 reconciliation)
- Architecture decision: narrow domain layer (not thin pass-through, not general CRUD)
- Each endpoint maps to a specific demo tool and performs atomic multi-document operations

### Next.js App (`armature/app/`)

- Scaffolded with `create-next-app` — TypeScript, Tailwind CSS, App Router, React Compiler enabled
- Node 23.5 in use; `eslint-visitor-keys` engine warning is cosmetic — Node 23 works fine
- `app/lib/terminusdb.ts` — WOQLClient singleton; requires `organization: "admin"` in constructor. Legacy: serves only the unversioned routes until Phase 3 deletes both. The API layer uses the per-request HTTP store adapter (ADR-0055, Phase 2)
- `app/lib/routeHelpers.ts` — `createGetHandler(type)` factory for boilerplate GET routes
- `app/lib/types.ts` — generated from `schema/schema.json`
- All 8 simple GET routes implemented via factory: courses, objectives, modules, needs, assessments, items, prerequisites, notes
- Custom GET `/api/coverage/[moduleId]` — server-side template query for the module's ModuleObjective junctions, one list read of LearningObjectives, joined in memory; errors go through `handleTerminusError`. Returns a flat array; the summary shape arrives with `GET /api/v1/intelligence/coverage/:moduleId` in Phase 4
- Root `.gitignore` — Next.js paths unanchored, `.vscode/` intentionally committed, `docs/vendor/terminusdb/_all/` ignored, test-coverage output anchored as `/app/coverage/` so API routes named `coverage` are tracked
- `app/.env.local` — TerminusDB connection vars (not committed)

### Types Generation

- `scripts/generate-types.js` — generates `app/lib/types.ts` from `schema/schema.json`
- `app/lib/types.ts` is **generated**, not hand-maintained — do not edit directly
- Two npm scripts in `app/package.json`: `generate:types` (write) and `check:types` (drift check, runs in CI)
- Enums emit `VALID_*` const arrays + derived union types — arrays are runtime source of truth
- Type mapping: xsd primitives → TS primitives, `sys:JSON` → `unknown`, `Optional<T>` → optional fields, `Set<T>`/`List<T>` → arrays, document Class references → `string` (@id), `@subdocument` references → the inline interface, enum refs → union types, inheritance as declared (`@inherits` or `TerminusDocument`), property-less classes → type aliases
- Output grouped by `@metadata.armature.category` (infrastructure, fragment, artifact, relationship); no hand-maintained type lists remain. Exports `CLASS_CATEGORY` and `SUBDOCUMENT_CLASSES` for runtime use. A class with no category fails generation (ADR-0027)

### Validation Layer (`app/lib/validate.ts`)

- `validateString`, `validateOptionalString`, `validateEnum`, `validateReference`, `validatePositiveInt`, `ValidationError`, `MAX_LENGTH` — to be absorbed into the invariants registry (Phase 3)

### TerminusDB Error Handling (`app/lib/routeHelpers.ts`)

- `handleTerminusError(error, context)` — maps known TerminusDB error `@type` strings to structured HTTP responses; unknown errors logged for pattern discovery

### POST Endpoints

- `POST /api/courses` and `POST /api/modules` — to be retired or aliased once the generic write path exists (Phase 3)

---

## What's Next

**First:** merge the Phase 2 PR (rebase merge, delete branch), confirm CI on `main`, then close the session so this file says "merged".

**Phase 3 of `docs/development-plan.md` — generic writes and the invariants engine (2 to 3 sessions):**

1. **ADR-0032: identity resolution.** Replaces the interim `Armature-User` header in `app/lib/api/identity.ts` with resolution of an authenticated identity to a `User` document (ADR-0015's boundary); `GET /api/v1/users`, `POST /api/v1/users`; agent users are ordinary `User` documents. No route changes
2. **The generic write path** over the provisional `PUT /api/v1/documents/:type/:id`: the write envelope stays (`{ message, document }`); Zod request schemas generated from `schema.json` by the generator, guarded by `check:types`
3. **The invariants engine:** per-type validators and recompute hooks keyed by `@type`, run on every write regardless of route. CLAUDE.md lists thirteen constraints; constraint 0 (reference class, which the store does not check) comes first because every typed slot depends on it. `app/lib/validate.ts` is absorbed
4. Retire the legacy unversioned routes, `app/lib/terminusdb.ts` and `app/lib/routeHelpers.ts`; the client package leaves `app/`
5. Decide `DELETE /api/v1/branches/:name` (reserved by ADR-0025 decision 6: refuse when another document references the branch's commits)

Carried from Phase 2, not blocking: merge policy (who may merge, per-type filtering, fragment-level conflict view) stays in plan §6; `If-None-Match` unsupported; the merge-base walk is log-based and can move to a commit-graph query if logs grow.

---

## Active Decisions

- `docs/development-plan.md` is the roadmap; SESSION.md tracks state against it
- The two-client test: a CoQui ask enters the hub only in the generic form a second reference client would need; CoQui's round, craft grid, claim version and workflow states never enter the schema
- Generic document API (`/api/v1/documents/:type/:id`) with a per-type invariants registry replaces per-type routes (Phase 3); type behaviour is a validator, not a handler
- Attachments are references with a mandatory content hash and optional revision and path; the graph never embeds binaries; the backend is a deployment choice; tool-managed stores write through the ordinary path (ADR-0030)
- Items are a tree of fragments; `ItemOption` is a `Fragment` specialisation so generic kinds can sit beside it (ADR-0033); behaviour is a versioned `InteractionType`, and the hub never serves executable content from a graph document (ADR-0034)
- **ADR-0025 (Accepted 2026-10-08):** design process data lives in the commit graph; the graph is a projection of any asset store's history, never a replay. No version fields, ever. Author is the resolved `User` id; reason is a required message in a JSON write envelope; reads at a named ref; `ETag`/`If-Match` carry bare commit ids and a stale match is 412; shared history is never rewritten; merge commits record the source head in commit metadata under `armature.mergeSource`
- **ADR-0055 (Accepted 2026-10-08):** the API layer reaches TerminusDB only through one `fetch`-based adapter under `app/lib/api/` that owns URLs, credentials, `author` and `message`, the data-version header and typed `@type` errors. The JavaScript client stays in `scripts/` and may re-enter the API layer only to build WOQL JSON. Supersedes "keep the JS client" (2026-03-03) and the later "client for reads, HTTP for writes" split. Evidence: the client welds author to the connection user, keeps a supplied data version in instance headers forever, flattens errors to strings, and lacks the history `diff` option
- Next.js routes remain the API host for this phase under `/api/v1` (ADR-0026); separate service stays the destination
- **ADR-0054 (Accepted 2026-10-07):** the API is a Hono app in `app/lib/api/`, mounted in Next.js through one catch-all route via `@hono/vercel`; nothing under `app/lib/api/` imports from `next`. ADR-0026 decision 1 now reads "Next.js is the host, Hono is the API". New routes are Hono routes only; the legacy Next.js handlers are not ported and die in Phase 3; Zod request validation derives from `schema.json` via the generator (Phase 3)
- One ADR-0054 knock-on still open: the standalone build step that resolves the `@/` alias (Phase 7). The data-version token shape was decided by ADR-0025 decision 7
- `npm test` is Vitest, integration-only against the running container; not in CI until Phase 7's service container
- **The store does not check reference class.** Typed references in `schema.json` are the contract and the generator's input; the invariants engine enforces class on every write (CLAUDE.md constraint 0). Never claim "schema-enforced" for a reference's type
- **Part identity is `fragmentId`, never a nested store id.** A replace regenerates every subdocument `@id`. Nothing may store `AssessmentItem/x/options/0/ItemOption/...`
- **Client-supplied `@id` on primary artifacts; `@key Random` declared on each; junctions keep Hash keys and are reached in a batch via `@capture`/`@ref`** (ADR-0024)
- **Breaking schema changes at demo scale are a reload:** `load_schema.js --clear-instances` then `seed_data.js`. Real data would use the migration endpoint (ADR-0022)
- **Platform assumptions get a check in `scripts/platform_checks.js` before an ADR depends on them.** The script owns a scratch database and never touches `armature`
- `ItemType` is the built-in interaction-type registry until ADR-0034; no type-version field until then (ADR-0033 §6)
- TerminusDB docs are vendored, dated and pinned by `scripts/sync-terminusdb-docs.js`; never hand-copied; the `terminusdb` skill governs their use
- Next.js app lives inside the Armature repo (`armature/app/`) — demo is part of the project
- Next.js runs locally (not containerized) — TerminusDB stays in Docker; containerizing deferred to Phase 7
- No auth system in demo scope — TerminusDB credentials in environment variables only; identity resolution hook comes in Phase 3 (ADR-0032). Until then writes name their author in the `Armature-User` header, which trusts the caller; the provisional write refuses `User` documents and the mutating routes stay local
- **Store facts the vendored docs get wrong** (checks P, Q, T; recorded in plan §9 and the `terminusdb` skill): `apply` wants bare commit ids and returns `@expected`/`@found` witnesses; `POST /api/rebase/X` with `rebase_from: Y` rebases X onto Y; branch DELETE needs a `{}` body. The running store outranks the docs
- `createGetHandler` factory for simple GET routes until Phase 3 retires them
- `app/lib/types.ts` is generated from `schema/schema.json` — committed artifact, drift caught by `npm run check:types`
- `VALID_*` arrays in `types.ts` are the runtime source of truth for enums
- `handleTerminusError` matches on `@type` substrings, not `api:message` text
- `deleteDocument({ id: string | string[] })` — object with `id` key, not a bare array

---

## Blockers

None. The 2026-10-05 credentials failure was the previously running container having been started with a different `TERMINUSDB_ADMIN_PASS`; `docker compose up -d` recreated it from the compose defaults and `app/.env.local` authenticates. If it recurs, recreate the container rather than editing `.env.local`.

---

## Notes for Next Session

Merge the Phase 2 PR first, then start Phase 3 on a new branch with ADR-0032. Every Phase 3 route is a Hono route in `app/lib/api/routes/` reaching the store only through `createStore(ref)` in `app/lib/api/store.ts`; request conventions (`?branch=|?ref=`, `ETag`/`If-Match`, the write envelope, `requireCommit`) are in `app/lib/api/http.ts`. The provisional `PUT` in `routes/documents.ts` is where the invariants engine attaches.

Phase 2 facts worth carrying forward:
- Validate any caller-supplied commit id with `requireCommit` before using it as a ref; the store answers a read at a non-existent commit path with a bare 500 (check U).
- A merge commit has one parent. The source head is in `commit.metadata.armature.mergeSource` (from `/api/log`, not `/api/history`); anything that reasons about merges reads it there (check V).
- The store's conflict witness is `{ "@op": "Conflict", "@expected", "@found" }` per field; the source value is not in it, so the merge route reads it from the source head.
- `ETag` is the branch head, not a document hash; a stale `If-Match` means the branch moved, not necessarily this document.
- Tests write only on scratch branches they create and delete through the adapter; `main` and the seed are never touched by `npm test`.

Phase 1 facts worth carrying forward:
- `scripts/platform_checks.js` is the place to prove a store behaviour before an ADR relies on it. Checks A–L exist; add a lettered check, run it, cite it in the ADR.
- The store accepts wrong-class references. Phase 3's invariants engine must implement the generic reference-class check (CLAUDE.md constraint 0) before anything else, because every other typed slot in the schema depends on it.
- `load_schema.js --clear-instances` then `seed_data.js` is the reload procedure for any breaking schema change at demo scale.
- Subdocument store ids are not stable across replaces. Routes and tests must address parts by `fragmentId`.
- `@capture`/`@ref` work in a `full_replace` batch, including for Hash-keyed junctions; the seed's junction note shows the pattern Phase 3's atomic multi-document write will expose.

Phase 0 facts worth carrying forward:
- Anything under a directory named `coverage` was silently ignored by git until 2026-10-07. Check `git ls-files` when a route seems to exist locally but not in history.
- `addDocument(json, params, dbId, message)`: the commit message is the fourth positional argument. There is no `commit_info` parameter. `full_replace: true` replaces a whole graph atomically and is the right way to reload the schema or the seed.
- The client passes URL parameters through unvalidated. A document template query (`query: { '@type': ..., field: value }`) filters server-side and is used by the coverage route. The HTTP API's `ids` list parameter has not been verified on the store; verify before relying on it.
- TerminusDB is running in Docker (container recreated 2026-10-07); the app connects with `app/.env.local` as is.

Key context:
- The plan's §9 lists every TerminusDB platform fact relied on, with two corrections to what the CoQui handoff assumed (merge exists; JS client cannot set commit author). The CoQui handoff's "no three-way merge" line should be corrected on CoQui's side when PR 6 is picked up.
- For any TerminusDB question, load the `terminusdb` skill; the installed client source outranks the docs.
- `docs/research/adr-candidates.md` contains amendments to the reserved ADRs 0024–0034 and new candidates from 0035. Nothing in it is accepted. Items 0035 and 0036 must be read before Phase 1 schema work.
- `docs/armature-asks-from-Coqui.md` remains the authoritative statement of what CoQui needs; the plan's §7 maps CoQui's PRs to phases.
- The user's standing preference (saved to memory): judge scope by the position paper's full vision (complex learning objects, versioned asset development), not by near-term clients; record simplifications as timing decisions, never scope decisions.

---

## Recent Sessions

### 2026-10-08 (Phase 2)

- Answered how the JS client differs from the HTTP API by reading the installed client source; wrote **ADR-0055** (Accepted): one `fetch` adapter under `app/lib/api/`, client confined to `scripts/`. Merged into the Phase 2 branch rather than a PR of its own
- Added platform checks M to V and ran them repeatedly against the scratch database; corrected five vendored-doc claims (apply refs and witness shape, stale-token status, rebase direction, DELETE body) and found two store behaviours the ADR had to design around (500 on an unknown commit path; single-parent merge commits)
- Wrote **ADR-0025** (Accepted) with the verification table; amended ADR-0010; decided `ETag`/`If-Match` bare commit ids, the write envelope, and the no-rewrite rule
- Built `store.ts`, `http.ts`, `identity.ts`, `errors.ts`, `routes/documents.ts`, `routes/branches.ts`; rewired `app.ts`; rewrote the tests as the Phase 2 walkthrough (25 passing). Seeded `User/demo-designer`
- Found during the walkthrough that a second merge from the same branch replayed the fork's insert; fixed by recording the merged source head, first as a message trailer, then as commit metadata once check V showed `apply` keeps `commit_info.metadata`
- Acknowledged the automated security finding on the interim identity header: documented in ADR-0025, `User` writes refused, routes local until ADR-0032
- Twelve commits on `phase-2/version-control`, pushed; PR opened

### 2026-10-07 (Phase 1)

- Merged PR #2 (ADR-0054); started Phase 1 on `phase-1/schema-catch-up`
- Wrote `scripts/platform_checks.js` and ran it: every Phase 1 platform assumption holds on v12.0.7. Found one the repo had wrong since ADR-0014: the store does not check the class of a referenced document. Recorded in plan §9, CLAUDE.md constraint 0, ADR-0014 and ADR-0017
- Applied ADRs 0017, 0018, 0020, 0022, 0023, 0024, 0027, 0033 to `schema.json` via a transform script (kept in the scratchpad; the result and the ADRs are the record); validated the new schema in a scratch database before loading it
- Rewrote both generators to derive everything from `@metadata.armature.category` and inline subdocuments; deleted `JUNCTION_IDS` and `CLASS_ORDER`
- Rewrote the seed to the fragment shape with real option text, varied statuses, a `DesignFinding`, and a `DesignNote` on a junction via `@capture`/`@ref`; added `load_schema.js --clear-instances`; reloaded and re-seeded the live store (47 documents)
- Wrote ADR-0024, ADR-0027, ADR-0033; promoted 0017, 0018, 0020; annotated 0014, 0019, 0022, 0023; regenerated `types.ts` and `SCHEMA_APPENDIX.md`; updated CLAUDE.md (constraints 0 and 8–12, key types, add-a-type procedure, repo tree) and the plan (Phase 1 checkboxes, §9 facts)
- Verified: lint, `check:types`, `tsc`, `npm test`, coverage route and generic read against the re-seeded store

### 2026-10-07 (ADR-0054 spike)

- Phase 0 merged via PR #1 (rebase merge, ten commits); CI green on `main`
- Ran the six-check Hono spike on `spike/adr-0054-hono`: route inside Next via `@hono/vercel`, legacy routes coexist with the catch-all, `TerminusDB-Data-Version` header passes through, build and all checks clean, same app served by `@hono/node-server`, three in-process Vitest tests. All pass; results in ADR-0054
- Added Vitest (`npm test`, `vitest.config.mts` reading `.env.local`, `@/` alias); tests are integration tests against the running container and are not in CI until Phase 7
- `@types/node` bumped 20 → 22 to satisfy Vitest's peer range (matches CI's Node 22). Local Node is now 24.21
- One tooling note: Node cannot resolve the `@/` alias on its own; serving the app standalone for the check used `npx tsx`. Phase 7's container entry needs a real build step or relative imports
- ADR-0054 accepted on the result. Amended ADR-0026 (decision 1), CLAUDE.md (stack, repo tree, Principle 1, Tests workflow, three What-Not-To-Do rules), PROJECT_CONTEXT.md, README, and the development plan (§3 host bullet, Phase 2 data-version decision and Hono routes, Phase 3 middleware and `onError`, Phase 7 container entry and build step, ADR queue row 0054, Phase 0 checkboxes marked done). The two unanticipated consequences are recorded in ADR-0054 §Consequences and as Phase 2 and Phase 7 work items
- Committed on `spike/adr-0054-hono`, merged as PR #2

### 2026-10-07 (Phase 0)

- Report on project state, then executed Phase 0 of the development plan end to end
- Found two defects no document recorded: `npm run lint` failed on generated empty interfaces (generator now emits type aliases), and the coverage route was never tracked by git because of an unanchored `coverage/` ignore pattern
- Rewrote the coverage route (status 500, `handleTerminusError`, two round trips via a template query); verified against seed data through the running app
- Swapped the client to `terminusdb@12.0.5`, pinned the store to `v12.0.7`, recreated the container, confirmed `.env.local` authenticates and the 69 seed documents survived
- Fixed `load_schema.js` (full replace of the whole schema graph; it previously wiped the classes and failed on a database with data) and `seed_data.js` (real `full_replace`, real commit message); both re-run cleanly
- Added CI, ADR-0026, the reference-clients table, the two-client test, and reconciled README, CLAUDE.md, PROJECT_CONTEXT.md, demo-api.md; removed the hand-copied TerminusDB page
- Discussed API hosts: no prior document compared them; the risk is the absence of a host-neutral seam growing with each route. Wrote **ADR-0054 (Proposed): the API as a Hono app** mounted inside Next.js via `@hono/vercel`, with a one-session verification spike as the acceptance gate; cross-referenced from ADR-0026
- Nothing committed yet. Proposed commit sequence, one logical change each (add `docs(adr): propose ADR-0054, the API as a Hono app` after item 7):
  1. `chore(app): emit type aliases for property-less classes so lint passes` (generate-types.js, types.ts)
  2. `fix(app): track and repair the coverage route` (.gitignore, coverage route)
  3. `chore(docker): pin terminusdb-server to v12.0.7` (compose)
  4. `chore(deps): replace @terminusdb/terminusdb-client with terminusdb@12.0.5` (both package.json, lockfiles, three imports)
  5. `fix(scripts): make schema loader and seed idempotent with real commit messages` (load_schema.js, seed_data.js)
  6. `chore(ci): add lint and generated-types drift check` (.github/workflows/ci.yml)
  7. `docs(adr): add ADR-0026 API host and route versioning`
  8. `docs: reconcile README, CLAUDE.md, PROJECT_CONTEXT, demo-api with the actual stack; remove hand-copied TerminusDB page` (README, .claude/*, docs/demo-api.md, docs/terminusdb-schema-doc.md, skill)
  9. `docs(.claude): update session state for 2026-10-07`

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
