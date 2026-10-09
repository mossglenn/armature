# Armature — Session State

This file tracks current work state across sessions. Update it at the end of every session using the workflow in `prompts/update-session.md`.

---

## Current Phase

**Phase 4 (design intelligence) complete and merged on 2026-10-08 (PRs #8, #9 and #10, rebase merges, 19 commits, CI green on `main`); its exit criterion is met → next is deciding ADR-0057 (`asOf`) and then Phase 5 of `docs/development-plan.md` (findings and attestations).** Phases 0 to 3 merged 2026-10-07 and 2026-10-08 (PRs #1 to #7). The intelligence reads (coverage, alignment, trace, impact) derive everything from structure at any ref; nothing derived is stored in the graph (ADR-0056); a read-only Coverage View is the app's first page.

History: Schema loaded → Seed data inserted → Demo API documented → Next.js scaffolded → GET endpoints live → Types generator implemented → POST /courses + POST /modules live → CoQui fit analysis (ADRs 0016–0023) → Development plan, TerminusDB verification, docs vendoring, research survey → Phase 0 hygiene, CI, ADR-0026 → ADR-0054 Hono → Phase 1 schema catch-up → ADR-0055, ADR-0025, Phase 2 version control → ADR-0032, generic writes, invariants engine, legacy retired → ADR-0029 coverage algorithm, intelligence reads, ADR-0056 nothing derived is stored, Coverage View (October 2026).

---

## What's Done

### Phase 4: design intelligence (2026-10-08)

- **ADR-0029 (Accepted, decisions 1 to 3):** the coverage algorithm. A module's declaration is covered by the distinct `AssessmentItem`s placed in the module's assessments whose `assesses` names the objective, never the bank; two populations, Approved items with Approved placements and everything not Retired (ADR-0019 adopted and promoted); the default cut 0 `Uncovered`, 1 `PartiallyAssessed`, 2 to 4 `FullyAssessed`, 5 or more `OverAssessed`, provisional (P9). Decisions 4 to 6 (stored fields, write-time recompute, merge recompute) were built, weighed and superseded the same day
- **ADR-0056 (Accepted):** coverage is computed on read, never stored. The graph stores what people decided and what was observed; the intelligence reads derive the rest at a ref. `coverageStatus`, `projectedCoverageStatus` and the `CoverageStatus` enum left the schema; `ModuleObjective` is design intent only; the generators lost computed-field support; the write pipeline lost its coverage step; a merge is the store's `apply` and nothing else. Reversed ADR-0007's computed field, which PROJECT_CONTEXT had listed as settled, on the evidence of the machinery it required
- **ADR-0057 (Proposed):** records that refer to a state of the graph name its commit: an optional `asOf` on `LearningDataset`, `LearningMetric`, `DesignFinding` and Attestation, filled from the branch head when absent, validated as constraint 13 when supplied. Closes Narrative 1's "adequate when". Awaiting decision
- **Intelligence reads** in `app/lib/api/routes/intelligence.ts` over a per-request cached `Graph` (`intelligence/graph.ts`): `coverage/:moduleId` and `coverage?course=` (both figures with counts, thresholds as parameters, items behind each with eligibility, undeclared assessment), `alignment?module=` (items below an objective's level, objectives no item reaches at level, objectives without an activity, the unleveled), `trace/:type/:id` (the lifecycle walk evidence to metric both ways, hops naming field and junction, modules as context, notes and findings about what is reached), `impact/:type/:id` (every referencing document from `CLASS_FIELDS`, with the artifact each junction sits in). All at `?branch=|ref=` with the commit in `ETag`
- **Platform checks Y and Z.** Y: a template query filters on a required reference field; on an Optional or a Set reference field it is a 500 (`Graph.where` lists and filters). Z: a field conflict is cleared by restoring the base value on the target before `apply`; kept as a fact nothing now uses
- **Two 400 fixes:** each unrecognized key is reported at its own path; a client id on a Hash-keyed type is `bad_id`, not a 500
- **Placement key kept:** one placement per item per assessment (`ItemInstance`'s Hash key); two forms are two `Assessment`s; the reopening triggers are in the schema comment and plan §6
- **Coverage View:** `/` lists a branch's modules, `/coverage/<module>` renders the coverage read; both call the Hono app in-process. The app is titled Armature
- **Exit criterion met:** `intelligence.test.ts` walks Narrative 2 through coverage and alignment and Narrative 1 from a metric to the declaring module through trace. 95 tests; lint, types drift, `tsc` and `next build` clean

### Phase 3: generic writes and the invariants engine (2026-10-08)

- **ADR-0032 (Accepted):** identity resolution. A pluggable resolver chosen by `ARMATURE_IDENTITY` (`header`, carrying the caller's `externalId`; `oidc` named for later) yields claims; the hub resolves them to a `User` on `main`, the registry of record, by template query, registering one there on first encounter when the claims carry a `displayName`. Commit author and `createdBy` come from the resolved `User`, never the body: set on create, preserved on replace. A write on a branch that lacks the `User` carries `main`'s copy in the same commit; identical copies merge clean. `GET /api/v1/users`, `GET /api/v1/users/me`, `POST /api/v1/users` (main only, 409 `user_exists`). Agent users are `User` documents with an `agent:` `externalId`, registered by a person
- **ADR-0025 decision 6 amended:** `DELETE /api/v1/branches/:name` only when another branch holds the head (in its log or as a merge commit's `mergeSource`), never `main`, no force, because a deletion is the one mutation the store records nowhere. `If-Match` honored (412), head re-read before the delete (409 `branch_moved`)
- **Platform checks W and X** (all passing on v12.0.7): template query over HTTP via `POST` + `X-HTTP-Method-Override: GET`; identical inserts on two branches merge as an empty patch, differing ones are a 409 `InsertConflict` witness; a `PUT` list with `create=true` writes Hash-keyed documents without `@id`, honors `@capture`/`@ref`, returns the ids and fails as a whole; **`POST overwrite=true` merges values into a list rather than replacing**; `GET ids=[...]` batch-reads and drops missing ids
- **Generator:** `types.ts` now carries the schema as data (`CLASS_ANCESTORS`, `CLASS_KEY`, `CLASS_FIELDS`); a second output `app/lib/schemas.ts` holds strict Zod schemas per concrete class (`@min_cardinality` as `.min(n)`, enums from `VALID_*`, references as an id or `{ "@ref" }`, abstract subdocuments as discriminated unions, Set/List without a minimum optional). `check:types` covers both. `zod@4.3.6` is a direct dependency
- **One write pipeline** (`app/lib/api/write.ts`) behind `PUT /api/v1/documents/:type/:id` and the batch `POST /api/v1/documents`: Zod shape (400 `invalid_document`), what each document replaces (by `@id` or by Hash key fields), 409 `type_conflict`, `createdBy`, the invariants (422 `invariant_violation` with every violation), one `PUT create=true` over the list, `If-Match` as 412, afterWrite hooks. `GET /api/v1/documents/:type?field=value&count=&skip=` lists with filters
- **Invariants engine** in `app/lib/api/invariants/`: `index.ts` (context, registry, 422), `references.ts` (constraint 0, walking into fragments), `assessmentItem.ts` (8, 9, 10), `itemInstance.ts` (5, 10), `moduleContent.ts` (3, 4), `designFinding.ts` (11), `recompute.ts` (7, afterWrite stub naming affected modules; removed in Phase 4 by ADR-0056). Constraints 1 and 2 are Zod minimums; 6 falls out of constraint 0; 12 is the pipeline. The merge route reports the `InsertConflict` witness
- **Retired:** the eleven unversioned routes (eight GET lists, the coverage route, two POSTs), `lib/terminusdb.ts`, `lib/routeHelpers.ts`, `lib/validate.ts`; the `terminusdb` client left `app/` (scripts keeps its own). The catch-all is the only route file. A module's coverage is two list reads until Phase 4
- **Exit criterion met:** every CLAUDE.md constraint has a failing and a passing test in `app/lib/api/write.test.ts`; 68 tests across two files pass; lint, `check:types`, `tsc`, `next build` clean. The automated security review's two findings on the delete route (check-then-delete race, unbounded holder walk) were fixed in the PR

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

- `scripts/platform_checks.js`: reproducible probes of store behavior in a scratch database (checks A to L). All Phase 1 platform assumptions verified on v12.0.7: subdocuments inline by default, polymorphic `List<Fragment>`, `sys:JSON` on subdocuments, four-level inheritance, `@metadata` survival, empty abstract root, client-supplied `@id` under `@key Random`, nested diffs
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

- `docs/development-plan.md` — eight phases grounded in the position paper's principles; eight reference clients beside CoQui and the two-client test (an ask enters the hub only when a second client would need it); ADR queue 0024–0034; open questions with the evidence that would settle each; declines; §9 platform facts verified against TerminusDB v12.0.7
- TerminusDB v12.0.7 verified against live docs and client source. Two corrections to earlier assumptions: the store has a three-way merge with field-level conflict reports (`apply`), and the JS client cannot set the commit author (writes needing an Armature `User` as author go over the HTTP document API)
- `scripts/sync-terminusdb-docs.js` — vendors TerminusDB docs from the public Markdoc source repo (`dfrnt-labs/terminusdb-docs-static`) at a pinned commit; 50 curated pages committed under `docs/vendor/terminusdb/` with `INDEX.md` and `VERSION.json`; the rest gitignored under `_all/`
- `.claude/skills/terminusdb/SKILL.md` — which vendored page answers what; trust order (installed client source → running store → vendored docs → live site); when to re-sync
- Evaluations recorded in the plan (§6): Epic's Lore (leading candidate for a developed-assets store, deferred on timing: pre-1.0 API churn, QUIC/gRPC/OIDC operations, native SDK); slash-builder/bitchain (not a candidate; its `context` field independently supports the `fragmentId` + attachment-reference split)
- Rich-artifact model recorded in the plan (§3): structure in the graph as a fragment tree, content as attachment references, behavior as versioned `InteractionType` renderers, rationale via commits and compound targets; ADR-0033 and ADR-0034 queued
- `docs/research/` (from a parallel session, 2026-10-06) — standards-precedents survey, ADR candidates 0035–0053, further-reading list of 85 sources

### Schema

- TerminusDB schema fully designed and documented (`schema/schema.json`)
- 12 enums (`CoverageStatus` left with ADR-0056), 27 classes: `User`; abstract roots `DesignRecord` and `ArmatureDocument`; subdocument fragments `Fragment`, `TextFragment`, `ItemOption`; 14 artifacts including `DesignNote` and `DesignFinding`; 7 relationship (junction) documents. Every class carries `@metadata.armature.category` and an explicit `@key`
- All types documented in TerminusDB-compliant multi-language array format (`@documentation: [{@language: "en", ...}]`)
- Field-level documentation consolidated into `@properties` on each type
- API constraints documented directly on affected fields
- 34 ADR files (`schema/docs/adr/`, 0001–0027, 0029, 0032, 0033, 0054–0057), indexed with their statuses in `schema/docs/adr/README.md`. ADR-0057 is Proposed; 0006 and 0016 are superseded (0016 in part); 0007 and 0029 are superseded in part by 0056; the rest are Accepted. Reserved by the plan and not yet written: 0028, 0030, 0031, 0034. Numbers 0035–0053 are research candidates, not ADRs.

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
- Coverage is not seeded; the coverage read computes it (ADR-0056). On the seed, `describe-model-training` reads Uncovered on both figures, `identify-ai-limitations` and `evaluate-appropriate-use` read Uncovered delivered and PartiallyAssessed projected (each has one unreviewed item), and no declaration reaches FullyAssessed
- The seed has no LearningActivity, ActivityGroup, LearningDataset or LearningMetric, so the alignment read reports every objective without an activity and Narrative 1 needs a scratch-branch dataset

### Demo API

- `docs/demo-api.md` is retired (2026-10-08); it records where each old route's work went. The "narrow domain layer" framing survives as context for what the generic API must make possible

### Next.js App (`armature/app/`)

- Scaffolded with `create-next-app` — TypeScript, Tailwind CSS, App Router, React Compiler enabled
- Node: CI uses 22; local development has used 23.5 and now 24.21, both fine (an `eslint-visitor-keys` engine warning under Node 23 was cosmetic). No `engines` field or `.nvmrc` pins a version
- `app/app/api/[[...route]]/route.ts` is the only route file; the Hono app in `app/lib/api/` is the API (ADR-0054), reaching the store through `store.ts` only (ADR-0055)
- Root `.gitignore` — Next.js paths unanchored, `.vscode/` intentionally committed, `docs/vendor/terminusdb/_all/` ignored, test-coverage output anchored as `/app/coverage/`
- `app/.env.local` — TerminusDB connection vars (not committed); `ARMATURE_IDENTITY` selects the resolver (`header` by default)
- Dependencies: `hono`, `@hono/vercel`, `zod`, `next`, `react`. No `terminusdb` client in `app/`

### Types Generation

- `scripts/generate-types.js` — generates `app/lib/types.ts` and `app/lib/schemas.ts` from `schema/schema.json`; both **generated**, never hand-edited
- Two npm scripts in `app/package.json`: `generate:types` (write both) and `check:types` (drift check on both, runs in CI)
- Enums emit `VALID_*` const arrays + derived union types — arrays are runtime source of truth, and the Zod schemas use the same arrays
- Type mapping: xsd primitives → TS primitives, `sys:JSON` → `unknown`, `Optional<T>` → optional fields, `Set<T>`/`List<T>` → arrays, document Class references → `string` (@id), `@subdocument` references → the inline interface, enum refs → union types, inheritance as declared, property-less classes → type aliases
- Schema as data: `CLASS_CATEGORY`, `SUBDOCUMENT_CLASSES`, `CLASS_ANCESTORS`, `CLASS_KEY`, `CLASS_FIELDS` (every field, own and inherited, with kind, target type and cardinality). The hub keeps no second copy of the schema; a class with no category fails generation (ADR-0027)
- Zod mapping: strings non-empty and ≤ 10,000 chars, `@min_cardinality` → `.min(n)`, a Set/List without a minimum optional, references an id or `{ "@ref" }`, subdocuments inline with abstract ones as discriminated unions, strict objects

---

## What's Next

1. **Decide ADR-0057.** If accepted: `asOf: Optional<xsd:string>` on `LearningDataset`, `LearningMetric` and `DesignFinding` (non-breaking), the pipeline fills it with the branch head when absent (like `createdBy`), constraint 13 validates a supplied id (commit exists via `ValidCommit`; the subject exists at it), the trace summary carries it. A platform check for reading a document at a commit from another branch is already covered by O and U
2. **Fix the branch-route race.** `GET /branches` and the delete's holder search read the branch list and then each head in separate calls; a branch deleted in between surfaces as an error. Seen once as a failed `app.test.ts` branch-delete case during a full run with three test files in parallel. Tolerate a vanished branch in both places
3. **Fix the list route's filter gap.** `GET /api/v1/documents/:type?<field>=` on an `Optional` or `Set` reference field (`?createdBy=`, `?generatedBy=`, `?assesses=`) returns a 500, because the store answers that template query with an internal error (check Y; reproduced 2026-10-08). List and filter in the hub as `Graph.where` does, or refuse with 400; Phase 5's non-aggregation guard refuses `createdBy` anyway (plan §6)
4. **Decide the item statistics.** `difficultyIndex` and `discriminationIndex` are described as written back by the API, which ADR-0056 would forbid for derived values; decide stored observation or computed read before Phase 6 (plan §6)
5. **Decide how `ModuleObjective` is written.** ADR-0007 said the API would create declarations "programmatically" and they would not be edited through a UI; what was built lets any client write them through the generic document routes, and the docs now describe that. Either amend ADR-0007 to record the generic path as the decision, or restrict writes (plan §6)
6. **Seed:** no declaration is `FullyAssessed`; a second Approved item placed for one objective would show the full story. Content decision
7. **Phase 5 of `docs/development-plan.md`:** ADR-0028 Attestation (with `asOf` from ADR-0057), findings and attestations as the review vocabulary
8. Carried, not blocking: lossless writes across schema versions (ADR-0024, candidate 0035; plan §6); `GET /api/v1/schema` unbuilt and unowned (ADR-0027; plan §6); the ordered module-content view ADR-0005 assigns to the API, unbuilt and unowned (plan §6); the running store's schema still carries the pre-2026-10-08 `@documentation` strings until `node scripts/load_schema.js` is re-run (harmless; no instance data changes); merge policy (plan §6); `If-None-Match` unsupported; the merge-base and branch-holder walks are log-based (capped at 5,000 commits per branch); `oidc` resolver when a deployment leaves the local demo; `User` edits when a client needs them; the research exporter treating `asOf` as a reference type (ADR-0057 open)

---

## Active Decisions

- `docs/development-plan.md` is the roadmap; SESSION.md tracks state against it
- **ADR-0056 (Accepted 2026-10-08): nothing derived is stored in the graph.** Coverage, alignment and any future score are computed by the intelligence reads at a ref; a judgment someone wants on record is a `DesignFinding` or an Attestation with a person's name. The schema holds what people decided and what was observed. Supersedes ADR-0007's computed field and ADR-0029 decisions 4 to 6
- **ADR-0029 decisions 1 to 3 (Accepted 2026-10-08):** coverage counts distinct items placed in the module's assessments, over two populations (ADR-0019); the default thresholds are the hub's provisional cut and the coverage read takes them as parameters and returns the counts
- **ADR-0057 (Proposed 2026-10-08):** `asOf`, a bare commit id, on records that refer to a state of the graph; hub-filled from the branch head when absent, validated when supplied
- **The intelligence reads are the only place coverage exists**: `GET /api/v1/intelligence/coverage/:moduleId`, `coverage?course=`, `alignment`, `trace/:type/:id`, `impact/:type/:id`, all at `?branch=|ref=`. Reverse lookups go through `Graph.where`: a required reference is a store template, an Optional or Set reference is listed and filtered (check Y)
- **One placement per item per assessment** (`ItemInstance` Hash key over `(assessment, implements)`): two forms are two `Assessment`s; reopened only by a container inside `Assessment` or an importer meeting a source that references one item twice (plan §6)
- **The app's pages call the Hono app in-process** and never the store; they are clients of the API like any plugin
- The two-client test: a CoQui ask enters the hub only in the generic form a second reference client would need; CoQui's round, craft grid, claim version and workflow states never enter the schema
- Generic document API (`/api/v1/documents/:type/:id`, batch `POST /api/v1/documents`, list `GET /api/v1/documents/:type`) with the invariants engine replaced the per-type routes (Phase 3, 2026-10-08); type behavior is a validator in `app/lib/api/invariants/`, request shape is the generated `schemas.ts`. Shape failures are 400 `invalid_document`; rule failures are 422 `invariant_violation` with every violation
- **ADR-0032 (Accepted 2026-10-08):** identity is resolved by a pluggable resolver (`ARMATURE_IDENTITY`: `header` now, `oidc` later); `main` is the `User` registry; author and `createdBy` come from the resolved identity, never the body; a branch that lacks the `User` gets `main`'s copy in the same commit; users are created on `main` only; agents are `User`s with an `agent:` `externalId`
- **Branch delete (ADR-0025 decision 6, amended 2026-10-08):** only when another branch holds the head; never `main`; no force; `If-Match` honored and the head re-read before deleting
- **The hub never uses `POST overwrite=true`:** it merges values into a list rather than replacing (check X3a). The upsert is `PUT create=true` over a list
- Attachments are references with a mandatory content hash and optional revision and path; the graph never embeds binaries; the backend is a deployment choice; tool-managed stores write through the ordinary path (ADR-0030)
- Items are a tree of fragments; `ItemOption` is a `Fragment` specialization so generic kinds can sit beside it (ADR-0033); behavior is a versioned `InteractionType`, and the hub never serves executable content from a graph document (ADR-0034)
- **ADR-0025 (Accepted 2026-10-08):** design process data lives in the commit graph; the graph is a projection of any asset store's history, never a replay. No version fields, ever. Author is the resolved `User` id; reason is a required message in a JSON write envelope; reads at a named ref; `ETag`/`If-Match` carry bare commit ids and a stale match is 412; shared history is never rewritten; merge commits record the source head in commit metadata under `armature.mergeSource`
- **ADR-0055 (Accepted 2026-10-08):** the API layer reaches TerminusDB only through one `fetch`-based adapter under `app/lib/api/` that owns URLs, credentials, `author` and `message`, the data-version header and typed `@type` errors. The JavaScript client stays in `scripts/` and may re-enter the API layer only to build WOQL JSON. Supersedes "keep the JS client" (2026-03-03) and the later "client for reads, HTTP for writes" split. Evidence: the client welds author to the connection user, keeps a supplied data version in instance headers forever, flattens errors to strings, and lacks the history `diff` option
- Next.js remains the API's host for this phase, serving the Hono app under `/api/v1` (ADR-0026 as amended by ADR-0054); a separate service stays the destination
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
- No auth system in demo scope — TerminusDB credentials in environment variables only. The `header` resolver trusts the caller (`Armature-User: <externalId>`), so the mutating routes stay local while it is the configured resolver (ADR-0032 decision 1)
- **Store facts the vendored docs get wrong** (checks P, Q, T; recorded in plan §9 and the `terminusdb` skill): `apply` wants bare commit ids and returns `@expected`/`@found` witnesses; `POST /api/rebase/X` with `rebase_from: Y` rebases X onto Y; branch DELETE needs a `{}` body. The running store outranks the docs
- `app/lib/types.ts` and `app/lib/schemas.ts` are generated from `schema/schema.json` — committed artifacts, drift caught by `npm run check:types`
- `VALID_*` arrays in `types.ts` are the runtime source of truth for enums; the Zod schemas use them
- `app.onError` matches store errors on the server's `@type`, never on message text

---

## Blockers

None. One intermittent: a branch-delete test in `app.test.ts` failed once in a full run and passed alone and in two further full runs; the three test files run in parallel against one store and the branch routes assume the branch set is stable across two calls (What's Next, item 2). The 2026-10-05 credentials failure was the previously running container having been started with a different `TERMINUSDB_ADMIN_PASS`; `docker compose up -d` recreated it from the compose defaults and `app/.env.local` authenticates. If it recurs, recreate the container rather than editing `.env.local`.

---

## Notes for Next Session

Start with ADR-0057: read it, decide, and if accepted implement it on a branch (`phase-5/asof` or fold into Phase 5's attestation branch). The `asOf` fill belongs in `write.ts` step 3 beside `createdBy`; the validation is a new module in `invariants/` registered for the three types; the branch head is `branch.head()` on the store. Then the branch-route race (What's Next, item 2), which is a small change in `routes/branches.ts`.

Phase 4 facts worth carrying forward:
- The store answers a template query on an `Optional` reference field, or on a `Set` reference field in either value form, with a 500; only required reference fields filter (check Y). `Graph.where` in `intelligence/graph.ts` is the one place that knows this.
- `Graph` caches every read for one request and records the first commit it was served from, which is the ETag; `Graph.referencing(id, type)` is constraint 0 read backwards through `CLASS_FIELDS` and is what the impact route is.
- The trace walks a fixed lifecycle (evidence to metric) in `upstream` and `downstream` tables in `routes/intelligence.ts`; `Module` is attached as context after the walk and never walked through. Adding a type to the lifecycle is a case in each table.
- Node 24 imports a `.ts` module from a plain script with no flag (type-only imports erased), which the seed used for one commit and no longer needs; `scripts/` can import from `app/lib/` this way when it must.
- A client can never supply an id for a Hash-keyed type (`SubmittedIdDoesNotMatchGeneratedId`, now a 400 `bad_id`); writing the same key fields again is a replace. One item appears once per assessment and many times per module, which is why coverage counts distinct items.
- Zod's strict object reports unknown keys as one issue with an empty path and a `keys` list; `parseDocuments` splits them into one issue per key at its path.
- Check Z: a conflict on a field is cleared by restoring the base value on the target in a new commit, after which the same `apply` succeeds and the target's other work is kept. Nothing uses it since ADR-0056.
- The Next.js pages fetch through `app.request()` on the imported Hono app; `export const dynamic = 'force-dynamic'`; `params` and `searchParams` are Promises (Next 16). An `<a>` to an `/api` URL trips `no-html-link-for-pages` because the catch-all route matches; disable it with the reason.
- The reload procedure (`load_schema.js --clear-instances`, `seed_data.js`) was run three times this session; the store now carries the schema without coverage fields and only `main` with `User/demo-designer`.

Phase 3 facts worth carrying forward:
- The store's `POST overwrite=true` merges, never replaces (X3a). The only upsert is `PUT create=true`, which takes a list and returns the written ids as IRIs in input order (`idFromIri` strips the base).
- A Hash-keyed document is found for replace by querying its key fields (X1c); `CLASS_KEY` says which. `ModuleObjective`'s key is `(module, references)`, so a declaration can be found and replaced by those fields without knowing its id (the recompute that first used this was removed by ADR-0056).
- `createWriteContext(branch, batch, replacing, alongside)`: `alongside` documents are resolvable but not validated; that is how the carried `User` copy passes constraint 0.
- `siblings(type, template)` returns the branch as it will look after the write; validators compare documents by object identity (`d !== doc`) to exclude themselves, since batch documents may lack ids.
- Every string in a request is non-empty and at most 10,000 characters; a `Set`/`List` without `@min_cardinality` may be omitted.
- Tests: `app.test.ts` writes test users to `main` and deletes them through `store.deleteDocument` (the documented exception); `write.test.ts` writes everything to one scratch branch. After a run, `main` holds only `User/demo-designer`.
- `fullLog` caps a branch walk at 5,000 commits; both the merge base and the delete's holder search use it.

Phase 2 facts worth carrying forward:
- Validate any caller-supplied commit id with `requireCommit` before using it as a ref; the store answers a read at a non-existent commit path with a bare 500 (check U).
- A merge commit has one parent. The source head is in `commit.metadata.armature.mergeSource` (from `/api/log`, not `/api/history`); anything that reasons about merges reads it there (check V).
- The store's conflict witness is `{ "@op": "Conflict", "@expected", "@found" }` per field; the source value is not in it, so the merge route reads it from the source head.
- `ETag` is the branch head, not a document hash; a stale `If-Match` means the branch moved, not necessarily this document.
- Tests write only on scratch branches they create and delete through the adapter; `main` and the seed are never touched by `npm test` (exception since Phase 3: the users tests write test users to `main` and delete them).

Phase 1 facts worth carrying forward:
- `scripts/platform_checks.js` is the place to prove a store behavior before an ADR relies on it. Checks A–L existed then (A–Z now); add a lettered check, run it, cite it in the ADR.
- The store accepts wrong-class references. The generic reference-class check (CLAUDE.md constraint 0) is `app/lib/api/invariants/references.ts`, run on every write since Phase 3.
- `load_schema.js --clear-instances` then `seed_data.js` is the reload procedure for any breaking schema change at demo scale.
- Subdocument store ids are not stable across replaces. Routes and tests must address parts by `fragmentId`.
- `@capture`/`@ref` work in a `full_replace` batch and in the `PUT create=true` list (check X2b), including for Hash-keyed junctions; the batch `POST /api/v1/documents` exposes the pattern the seed's junction note uses.

Phase 0 facts worth carrying forward:
- Anything under a directory named `coverage` was silently ignored by git until 2026-10-07. Check `git ls-files` when a route seems to exist locally but not in history.
- `addDocument(json, params, dbId, message)`: the commit message is the fourth positional argument. There is no `commit_info` parameter. `full_replace: true` replaces a whole graph atomically and is the right way to reload the schema or the seed.
- The client passes URL parameters through unvalidated. A document template query (`query: { '@type': ..., field: value }`) filters server-side and was used by the (since retired) coverage route; today the list route and `Graph.where` use it. The HTTP API's `ids` list parameter was verified later by checks X4 and X4b.
- TerminusDB is running in Docker (container recreated 2026-10-07); the app connects with `app/.env.local` as is.

Key context:
- The plan's §9 lists every TerminusDB platform fact relied on, with two corrections to what the CoQui handoff assumed (merge exists; JS client cannot set commit author). The CoQui handoff's "no three-way merge" line should be corrected on CoQui's side when PR 6 is picked up.
- For any TerminusDB question, load the `terminusdb` skill; the installed client source outranks the docs.
- `docs/research/adr-candidates.md` contains amendments to the reserved ADRs 0024–0034 and new candidates from 0035. Nothing in it is accepted as written: 0036's no-rewrite rule was absorbed by ADR-0025 decision 6, 0037 and 0046 were deferred by ADR-0025, and 0035 (lossless writes) is still open (plan §6).
- `docs/armature-asks-from-Coqui.md` remains the authoritative statement of what CoQui needs; the plan's §7 maps CoQui's PRs to phases.
- The user's standing preference (saved to memory): judge scope by the position paper's full vision (complex learning objects, versioned asset development), not by near-term clients; record simplifications as timing decisions, never scope decisions.

---

## Recent Sessions

### 2026-10-08 (Phase 4)

- Started `phase-4/design-intelligence` with the two open decisions explained and confirmed (same-commit recompute; computed fields rejected on write); wrote **ADR-0029**, added `projectedCoverageStatus` and `@metadata.armature.computed`, taught the generator to omit computed fields, built the pre-commit recompute and the pure algorithm module the seed also imported; ten constraint 7 tests; two 400 fixes the tests exposed. Kept the one-placement-per-assessment key and recorded its reopening triggers. Merged as PR #8
- `phase-4/intelligence-routes`: platform check Y (template queries on reference shapes), the `Graph` reader and the four reads, fifteen tests including Narrative 1 from a metric to the declaring module. Merged as PR #9
- `phase-4/merge-recompute-and-coverage-view`: built the merge-route recompute and the resolution path for computed-only conflicts (check Z), then, on the question whether a computed field belongs in the graph at all, reversed the stored-field decision: **ADR-0056** (Accepted) and **ADR-0057** (Proposed) written, the fields and enum removed, the pipeline and merge machinery removed, the coverage read given counts, thresholds and a course-wide form, the Coverage View added. A first commit script failed partway and pushed a broken sequence; rebuilt the seven commits from `origin/main` and force-pushed with a lease before opening the PR. Merged as PR #10
- Phase 4's exit criterion met; 95 tests; the store reloaded three times for the schema changes

- Started `phase-3/generic-writes`; added platform check W (template query over HTTP, identical and differing inserts under `apply`, list writes) and designed **ADR-0032** on its results: pluggable resolver, `main` as the `User` registry, carried copies on branches, author and `createdBy` from the resolved identity. Built `identity.ts`, `classes.ts`, `routes/users.ts`, `CLASS_ANCESTORS` in the generator; the merge route learned the `InsertConflict` witness
- Added platform check X for the write path and found that `POST overwrite=true` merges rather than replaces; chose `PUT create=true` over a list as the only upsert
- Extended the generator with the schema as data (`CLASS_KEY`, `CLASS_FIELDS`) and a Zod output (`app/lib/schemas.ts`); wrote the write pipeline, the batch route, the list route and the invariants engine; every CLAUDE.md constraint got a failing and a passing test (`write.test.ts`)
- Retired the eleven unversioned routes (eight GET lists, the coverage route, two POSTs), the client singleton, `routeHelpers.ts` and `validate.ts`; the `terminusdb` package left `app/`; `demo-api.md` marked Retired
- Decided and built `DELETE /api/v1/branches/:name` (ADR-0025 decision 6 amended): only when another branch holds the head; fixed the automated security review's two findings (check-then-delete race, unbounded holder walk) with `If-Match`, a head re-read and a `main`-first bounded search
- Nineteen commits, merged as PR #7 (rebase merge); CI green on `main`; ADR-0032 promoted to Accepted at session close

### 2026-10-08 (Phase 2)

- Answered how the JS client differs from the HTTP API by reading the installed client source; wrote **ADR-0055** (Accepted): one `fetch` adapter under `app/lib/api/`, client confined to `scripts/`. Merged into the Phase 2 branch rather than a PR of its own
- Added platform checks M to V and ran them repeatedly against the scratch database; corrected five vendored-doc claims (apply refs and witness shape, stale-token status, rebase direction, DELETE body) and found two store behaviors the ADR had to design around (500 on an unknown commit path; single-parent merge commits)
- Wrote **ADR-0025** (Accepted) with the verification table; amended ADR-0010; decided `ETag`/`If-Match` bare commit ids, the write envelope, and the no-rewrite rule
- Built `store.ts`, `http.ts`, `identity.ts`, `errors.ts`, `routes/documents.ts`, `routes/branches.ts`; rewired `app.ts`; rewrote the tests as the Phase 2 walkthrough (25 passing). Seeded `User/demo-designer`
- Found during the walkthrough that a second merge from the same branch replayed the fork's insert; fixed by recording the merged source head, first as a message trailer, then as commit metadata once check V showed `apply` keeps `commit_info.metadata`
- Acknowledged the automated security finding on the interim identity header: documented in ADR-0025, `User` writes refused, routes local until ADR-0032
- Thirteen commits on `phase-2/version-control`, merged as PR #5 (rebase merge); CI green on `main`

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
