# Armature — Claude Code Context

This file is the primary context for AI-assisted development on Armature. Read this first, then read PROJECT_CONTEXT.md and SESSION.md before starting any work session. Human readers new to the project should start with `docs/how-armature-works.md`.

Abbreviations used here: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CI (continuous integration), SME (subject-matter expert), WOQL (TerminusDB's query language), OIDC (OpenID Connect).

---

## What Armature Is

Armature is graph-based infrastructure for learning engineering. It provides an open schema and API that preserves design rationale in the relationships between instructional artifacts — objectives, assessments, activities, and modules.

The core insight: current instructional design tools capture *what was built* but not *why design decisions were made* or *how artifacts connect to each other*. Armature treats the artifact graph as a first-class data structure, making design decisions inspectable, queryable, and reusable.

**The Git analogy:** Git didn't replace text editors — it added a relational layer underneath them that made the history and provenance of changes visible and inspectable. Armature does the same for instructional design tools.

---

## Architecture

### Stack
- **TerminusDB** — graph database storing the artifact graph
- **Armature API** — a Hono application in `app/lib/api/` (ADR-0054), host-neutral: nothing under that directory imports from `next`. Mounted under `/api/v1/` by the one catch-all route `app/app/api/[[...route]]/route.ts`, the only route file; Next.js is the host for the current phase (ADR-0026). The demo-era unversioned routes were retired in Phase 3 (2026-10-08). A separate process serving the same app with `@hono/node-server` remains the long-term destination
- **CoQui** — first plugin; an assessment-item review tool built on top of the Armature API (separate repo, not here)
- **Docker Compose** — runs TerminusDB only (`docker/docker-compose.yml`); the API runs on the host with `npm run dev` until Phase 7 containerizes it

- **Identity locally** — writes need `Armature-User: <externalId>` (the seed registers `demo-designer@example.edu`); `ARMATURE_IDENTITY` in `app/.env.local` selects the resolver (`header`, the default, trusts the caller, so mutating routes stay local). The app's `.env.local` holds `TERMINUS_URL`, `TERMINUS_USER`, `TERMINUS_PASS`, `TERMINUS_DB`; the scripts read the same variables from the shell, defaulting to admin/admin
- **Node.js** — CI uses Node 22; the scripts and tests also run on later versions

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
  docs/adr/                # Architecture Decision Records; README.md is the index with every ADR's status
docker/                    # Docker Compose configuration (TerminusDB pinned to v12.0.7)
.github/workflows/ci.yml   # CI: npm run lint + npm run check:types in app/
scripts/
  generate-types.js        # Derives app/lib/types.ts (types + schema as data) and app/lib/schemas.ts (Zod) from schema.json — run after schema changes
  generate-schema-appendix.js  # Derives docs/SCHEMA_APPENDIX.md from schema.json
  load_schema.js           # Replaces the schema graph in one full_replace; --clear-instances empties data first for breaking changes
  platform_checks.js       # Probes store behaviors the ADRs depend on, in a scratch database it creates and deletes (run before encoding a platform assumption)
  seed_data.js             # Inserts the demo course (48 documents plus their embedded fragments; no activities, datasets or metrics)
  migrate_schema_docs.js   # Reproduces past schema documentation migrations
  sync-terminusdb-docs.js  # Vendors TerminusDB docs into docs/vendor/terminusdb (see skill); also npm run sync:terminusdb-docs
app/
  app/api/
    [[...route]]/route.ts  # The ONLY file that knows Next.js hosts the API: exports handle(app) per method (ADR-0054); the only route file
  app/page.tsx             # Index: a branch's modules, each linking to its Coverage View; calls the Hono app in-process, never the store
  app/coverage/[moduleId]/page.tsx  # The read-only Coverage View over GET /api/v1/intelligence/coverage/:moduleId (Phase 4)
  app/layout.tsx           # Page shell (titled Armature)
  README.md                # What the app hosts, its env vars, scripts and layout
  lib/
    api/
      app.ts               # The Armature API: Hono app, basePath /api/v1, mounts routes/, onError mapping. Never imports from next
      app.test.ts          # In-process Vitest tests via app.request(): reads, the Phase 2 walkthrough, users and identity; need the container running (users tests write to and clean up main)
      write.test.ts        # The generic write path and every CLAUDE.md constraint, failing and passing (Phase 3 exit criterion)
      intelligence.test.ts # The four intelligence reads on the seed; both PROJECT_CONTEXT narratives walked through routes alone, Narrative 1 on a scratch branch that writes its own dataset and metric (Phase 4 exit criterion)
      store.ts             # The store adapter (ADR-0055): the ONLY module that talks to TerminusDB; createStore(ref) per request
      http.ts              # Request/response conventions: ?branch=|?ref=, ETag/If-Match as bare commit ids, write envelopes
      identity.ts          # Identity resolution (ADR-0032): pluggable resolver (header now, oidc later) → User on main, the registry; carries a User copy onto a branch when a write needs it
      classes.ts           # What the generated maps say about a class: known, writable, inherits (CLASS_ANCESTORS), carries createdBy
      write.ts             # The one write pipeline: Zod shape → 409 on a foreign id → createdBy → invariants → one commit
      invariants/          # The invariants engine: index.ts (context, registry, 422), references.ts (constraint 0), one module per constrained type
      intelligence/
        coverage.ts        # The coverage algorithm (ADR-0029 decisions 1 to 3) and its vocabulary; computed on read, never stored (ADR-0056)
        graph.ts           # Per-request cached reads at one ref for the intelligence routes; schema-driven reverse lookups (Optional and Set references listed and filtered: check Y)
      errors.ts            # ApiError: status + stable code + message, rendered by onError
      routes/
        documents.ts       # list with field filters, GET at ref, PUT, batch POST (@capture/@ref), history, diff
        branches.ts        # list, create, head, merge (three-way via apply; source recorded in commit metadata; InsertConflict reported), changes since a commit, delete (only when another branch holds the head)
        users.ts           # list at ref, /me, register on main (ADR-0032)
        intelligence.ts    # coverage/:moduleId and coverage?course=, alignment, trace/:type/:id, impact/:type/:id: design intelligence from structure alone, at any ref (plan P4, ADR-0056)
    types.ts               # GENERATED — do not edit; run npm run generate:types. Interfaces plus the schema as data: CLASS_CATEGORY, SUBDOCUMENT_CLASSES, CLASS_ANCESTORS, CLASS_KEY, CLASS_FIELDS, and the VALID_* enum arrays
    schemas.ts             # GENERATED — do not edit; Zod request schemas, one per concrete class, from the same generator
  vitest.config.mts        # Vitest: '@' alias, reads .env.local so tests hit the same store as the app
docs/
  how-armature-works.md    # The complete explainer for academic readers: purpose, history, every mechanism, decisions, future
  schema-guide.md          # Conceptual guide to the schema: patterns, rules, worked examples
  api.md                   # Reference for every /api/v1 route, envelope, query parameter and error code
  SCHEMA_APPENDIX.md       # GENERATED — do not edit; run node scripts/generate-schema-appendix.js (not drift-checked in CI)
  development-plan.md      # Phased plan; §6 open questions; §9 lists verified TerminusDB platform facts
  armature-asks-from-Coqui.md  # CoQui's dated handoff (2026-10-05): its asks and lessons; a status banner says what landed
  demo-api.md              # RETIRED demo-era API spec, kept for history
  positionpaper/           # The position paper (March 2026); not edited
  research/                # Standards-precedents survey, candidate ADRs 0035–0053, reading list (2026-10-06 snapshot)
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
client source under `scripts/node_modules/terminusdb` (the only copy; `app/` has no client) is authoritative for client behavior; the running Docker
container is authoritative for server behavior. Re-run `node scripts/sync-terminusdb-docs.js`
after a TerminusDB release; `docs/vendor/terminusdb/VERSION.json` records the last sync.

---

## The Schema

The schema is the single source of truth for everything. Read `schema/schema.json` before working on the API or any data-related code. The inline `@documentation` comments on every type and field are authoritative.

### Types are generated, not hand-maintained

`app/lib/types.ts` and `app/lib/schemas.ts` are **generated** from `schema/schema.json` by `scripts/generate-types.js`. Never edit them directly. `types.ts` carries the interfaces and the schema as runtime data (`CLASS_CATEGORY`, `CLASS_ANCESTORS`, `CLASS_KEY`, `CLASS_FIELDS`); `schemas.ts` carries one strict Zod schema per concrete class for the write routes.

After any change to `schema/schema.json`:
```bash
# From armature/app/
npm run generate:types

# Verify (also runs in CI)
npm run check:types
```

The generator handles: xsd primitives → TS primitives, `sys:JSON` → `unknown`, `Optional<T>` → optional fields, `Set<T>`/`List<T>` → arrays, document class references → `string` (@id), `@subdocument` references → the inline interface, enum references → union types plus `VALID_*` arrays, `@abstract` → JSDoc comment, inheritance as declared (junctions extend `DesignRecord`), property-less classes → type aliases. Its second output, `schemas.ts`, holds strict Zod request schemas (`@min_cardinality` → `.min(n)`, references as an id or `{ "@ref" }`, abstract subdocuments as discriminated unions).

To add a new type: (1) update `schema.json` (with ADR), giving the class `@metadata.armature.category` (`infrastructure`, `fragment`, `artifact` or `relationship`; ADR-0027) and an explicit `@key` (ADR-0024), (2) run `generate:types` and `node scripts/generate-schema-appendix.js`, (3) commit `schema.json`, `types.ts`, `schemas.ts` and `SCHEMA_APPENDIX.md` together. If the type has rules the store cannot express, add a validator in `app/lib/api/invariants/` with a failing and a passing test. There is no list of types in the generators; a class without a category fails generation, which CI catches. Before relying on any store behavior a change depends on, add a check to `scripts/platform_checks.js` and run it against the scratch database it creates.

### Key types and their roles

| Type | Role |
|---|---|
| `DesignRecord` | Abstract root of every artifact and relationship; the type `DesignNote.subject` and `DesignFinding.subject` point at. `User` is outside it (ADR-0017) |
| `LearningObjective` | Central node — everything connects to it |
| `AssessmentItem` | Reusable question in the item bank; a tree of fragments (stem, options, feedbacks) with its own `status`; placed into Assessments via `ItemInstance` |
| `Fragment` / `TextFragment` / `ItemOption` | Subdocument parts of an item, returned inline; identity is the client-assigned `fragmentId`, never the nested store id (ADR-0022, ADR-0023, ADR-0033) |
| `ItemInstance` | Assessment-context wrapper around an `AssessmentItem`; its `status` is placement clearance, distinct from the item's own (ADR-0018) |
| `DesignFinding` | An evidence-grounded concern about any design record, with `status` and resolution rationale (ADR-0020) |
| `ModuleObjective` | Junction carrying a module's declaration of an objective and its design intent (`role`, `roleRationale`, `sequence`); written by clients through the generic document API (ADR-0007's "programmatic, not UI-editable" was not what was built); it stores no coverage, which is computed on read (ADR-0056) |
| `PrerequisiteRecord` | Junction doc; carries `rationale` and `prerequisiteType` — design decision preserved as data |
| `NeedEvidenceLink` | Junction doc; links LearningNeed to LearningEvidence with `confidence` weighting |
| `ModuleActivityLink` | Junction doc; places LearningActivity in Module with `sequence` |
| `ModuleActivityGroupLink` | Junction doc; places ActivityGroup in Module with `sequence` |
| `ActivityGroupMember` | Junction doc; places LearningActivity in ActivityGroup with sub-`sequence` |

### Critical API constraints (not enforced by TerminusDB schema)

These are enforced by the invariants engine in `app/lib/api/invariants/` on every write, whatever the route; its `index.ts` maps each number below to the module that checks it. TerminusDB enforces field types, required fields, `@min_cardinality`, enum values and that a referenced document *exists*. It does **not** check the class of a referenced document (verified 2026-10-07, `scripts/platform_checks.js` check L), and it cannot express cross-document or conditional rules. Shape (types, required fields, enums, minimum cardinality) is checked first by the generated Zod schemas and answered with 400; the rules below are answered with 422 `invariant_violation`, every violation at once, except where a rule says otherwise (1 and 2 are shape, 400; 12 is 409). `docs/api.md` lists every violation code.

0. **Every reference field's target must be an instance of the declared class or a subclass.** Generic, applies to every type. This is what keeps a `User` out of `DesignNote.subject` and an `AssessmentItem` out of `Module.course` (ADR-0014, ADR-0017 amended)
1. `AssessmentItem.assesses` — must contain at least one `LearningObjective` (schema `@min_cardinality`, ADR-0013; checked as shape by Zod, 400)
2. `LearningActivity.targets` — must contain at least one `LearningObjective` (same: shape, 400)
3. `ModuleActivityLink.sequence` and `ModuleActivityGroupLink.sequence` — must be unique across both types for a given Module (they share one integer namespace)
4. `ActivityGroupMember.sequence` — must be unique within a group
5. `ItemInstance.sequence` — must be unique within an Assessment
6. `ActivityGroup` — must not contain other `ActivityGroup` instances (flatness constraint; falls out of constraint 0, since `ActivityGroupMember.activity` is a `LearningActivity`)
7. Coverage is never stored (ADR-0056). `GET /api/v1/intelligence/coverage/:moduleId` computes it at the requested ref from the distinct items placed in the module's assessments that assess each declared objective, twice: Approved placements of Approved items, and everything not Retired (ADR-0029 decisions 1 to 3; default cut 0 `Uncovered`, 1 `PartiallyAssessed`, 2 to 4 `FullyAssessed`, 5 or more `OverAssessed`, with the thresholds as query parameters and the counts in the response). No write recomputes anything; a `ModuleObjective` with a coverage field is an unknown key, 400. Nothing in the invariants engine checks this; the schema simply has no such field
8. `fragmentId` — unique across all fragments (stem, options, feedbacks) of one `AssessmentItem`; never regenerated by the hub (ADR-0023, ADR-0033)
9. `ItemOption.text` — present, and unique within one item; the number of correct options must suit `itemType` (ADR-0022)
10. `ItemInstance.status` — may not be `Approved` while its `AssessmentItem.status` is `Draft` or `InReview` (ADR-0018)
11. `DesignFinding.resolutionRationale` — required when `status` is `Dismissed` (ADR-0020)
12. A write whose `@id` exists under a different `@type` — rejected with 409 `type_conflict` by the write pipeline (ADR-0024)

Pending, not yet enforced: 13 (`asOf` names an existing commit at which the subject exists) if ADR-0057 is accepted; `LearningDataset.producedBy` required for Armature-administered assessments (Phase 6). Known gap: the list route passes `?field=` filters on `Optional` or `Set` reference fields to the store, which answers with a 500 (check Y); see plan §6.

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
TerminusDB enforces field types, required fields, enum values, minimum cardinality and reference existence. Everything else (reference class, sequence uniqueness, conditional and cross-document rules) belongs in the API layer, in the invariants engine. See ADR-0006 (the original principle; superseded for minimum cardinality by ADR-0013) and the constraints above. Derived values are not constraints to maintain: they are computed on read (ADR-0056).

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
- **ADR-0013** — Minimum cardinality at schema level (supersedes ADR-0006, whose "the API enforces what the store cannot" principle the invariants engine now carries)
- **ADR-0007** — ModuleObjective as the junction for a module's declaration (its computed field superseded by ADR-0056)
- **ADR-0024** — Client-supplied identifiers and replace semantics; 409 on an id held by another type (constraint 12)
- **ADR-0025** — Design process data lives in the commit graph (author and reason on every commit, reads at a ref, ETag/If-Match, merge, no history rewriting)
- **ADR-0026** — API host and route versioning (as amended by ADR-0054: Hono is the API, Next.js the host; routes under `/api/v1`)
- **ADR-0027** — Schema self-description: `@metadata.armature.category` on every class
- **ADR-0029** — Coverage algorithm (decisions 1 to 3: counted over the module's placements, two eligibility rules, the default thresholds)
- **ADR-0056** — Coverage is computed on read, never stored (the graph holds decisions and observations; derived values are reads at a ref; supersedes the stored field)
- **ADR-0032** — Identity resolution (`main` is the `User` registry; author and `createdBy` come from the resolved identity, never the body; a branch that lacks the `User` gets `main`'s copy in the same commit)
- **ADR-0054** — The API is a Hono application (host-neutral; nothing under `app/lib/api/` imports from `next`)
- **ADR-0055** — The API layer reaches TerminusDB over HTTP through one adapter (the JavaScript client stays in `scripts/`)
- **ADR-0057** — (Proposed) records that refer to a state of the graph name its commit (`asOf`); would add constraint 13

The full index, with every ADR's status, is `schema/docs/adr/README.md`.

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

### Branches, commits and pull requests
1. Work happens on a branch named for the unit of work (`phase-2/version-control`, `spike/adr-0054-hono`, `docs/...`), never directly on `main`. The one exception is the session-close commit, `docs(.claude): update session state for <date>`, made on `main`.
2. Before committing, show the proposed commit sequence (one logical change per commit, Conventional Commits per `.claude/prompts/commit-message-guide.md`) and wait for approval.
3. Commit, push and open a pull request only when asked; merge only when asked, with a rebase merge (`--rebase --delete-branch`) so each commit stays visible on `main`, then confirm CI on `main`.
4. Platform assumptions get a lettered check in `scripts/platform_checks.js` before an ADR relies on them; cite the letter in the ADR.

### After schema changes
1. Write or update the ADR in `schema/docs/adr/`
2. Update `schema/schema.json`
3. Run `npm run generate:types` from `armature/app/`
4. Run `npm run check:types` to verify output
5. Run `node scripts/generate-schema-appendix.js` from the repository root
6. Commit `schema.json`, `app/lib/types.ts`, `app/lib/schemas.ts` and `docs/SCHEMA_APPENDIX.md` together in the same commit

### Adding an ADR
1. Find the next available number in `schema/docs/adr/`
2. Use the format: `NNNN-short-decision-title.md`
3. Follow the Nygard format: Status / Context / Decision / Consequences
4. Reference the ADR number in any related schema `@documentation` comments

---

## What Not To Do

- **Don't** write directly to TerminusDB — always go through the API layer
- **Don't** add owned subdocuments for relationships — every relationship between documents is a reference (ADR-0002). The one embedded exception is an item's parts (`Fragment`, `TextFragment`, `ItemOption`; ADR-0022, ADR-0033), addressed by `fragmentId`, never by their nested store ids
- **Don't** put UI logic, import/export formats, or plugin-specific code in this repo
- **Don't** change `schema.json` without an ADR
- **Don't** edit `app/lib/types.ts` manually — it's generated; change `schema.json` and run `generate:types`
- **Don't** write API routes as Next.js route handlers — every route is a Hono route in `app/lib/api/` under `/api/v1` (ADR-0054); the catch-all is the only file under `app/app/api/`
- **Don't** import from `next` anywhere under `app/lib/api/` — the host appears only in `app/app/api/[[...route]]/route.ts`
- **Don't** add the `terminusdb` client to `app/` — the API layer reaches the store through its HTTP adapter (ADR-0055); the client is a dependency of `scripts/` only. The one exception would be `lib/woql.js` to build query JSON the adapter posts, and the first such use amends the ADR
- **Don't** write a per-type route or hand-write a request schema — type behavior is a validator in `app/lib/api/invariants/`, and request shape comes from the generated `schemas.ts`
- **Don't** let the store's `TerminusDB-Data-Version` header or its `branch:`/`commit:` prefixes into `/api/v1` — responses carry `ETag: "<commit-id>"`, writes accept `If-Match`, a stale match is 412; the adapter does the translation (ADR-0025 decision 7)
- **Don't** expose or call reset, squash or rebase — shared history is never rewritten; a mistake is undone by a new commit (ADR-0025 decision 6). A branch is deleted only when another branch holds its head; there is no force
- **Don't** take the commit author or `createdBy` from a request body — both come from the identity the request resolved to; `User` documents are created on `main` only (ADR-0032)
- **Don't** store a derived value in the graph — coverage, alignment and any future score are computed by the intelligence reads at a ref, never written into a document (ADR-0056); a judgment someone wants on record is a `DesignFinding` or an Attestation with a person's name on it
- **Don't** leave API constraints undocumented — if TerminusDB can't enforce it, the schema comment must say the API will
