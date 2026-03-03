# Armature — Session State

This file tracks current work state across sessions. Update it at the end of every session using the workflow in `prompts/update-session.md`.

---

## Current Phase

**Implementation** → Schema loaded → Seed data inserted → Demo API documented → Next.js scaffolded → GET endpoints live → Types generator implemented → POST /courses + POST /modules live → Next: POST /needs (first multi-document atomic op)

---

## What's Done

### Schema

- TerminusDB schema fully designed and documented (`schema/schema.json`)
- 12 enums, 24 document types (including ArmatureDocument base, User, DesignNote, junction documents)
- All types documented in TerminusDB-compliant multi-language array format (`@documentation: [{@language: "en", ...}]`)
- Field-level documentation consolidated into `@properties` on each type
- API constraints documented directly on affected fields
- 15 ADRs covering every significant design decision (`schema/docs/adr/`)

### Infrastructure

- TerminusDB running locally via Docker Compose (`docker/docker-compose.yml`)
- Schema loader script (`scripts/load_schema.js`) — idempotent, JS client, replace semantics
- Schema documentation migration script (`scripts/migrate_schema_docs.js`) — reproducible for future migrations
- Schema loaded and verified in local TerminusDB instance
- GraphQL endpoint confirmed working: `http://127.0.0.1:6363/api/graphql/admin/armature`

### Seed Data

- Complete demo artifact graph inserted (`scripts/seed_data.js`)
- Course: "Introduction to AI for Instructional Designers"
- 69 documents across all major schema types
- Covers: 2 LearningNeeds + evidence, 7 LearningObjectives, 4 PrerequisiteRecords, 3 Modules, 3 Assessments, 6 AssessmentItems, 24 Responses, 7 ItemInstances (item reuse demonstrated), 7 ModuleObjectives, 1 DesignNote
- One objective intentionally Uncovered in ModuleObjective.coverageStatus for demo interest

### Demo API

- Full API specification documented (`docs/demo-api.md`)
- 16 endpoints across 8 resource types
- Architecture decision: narrow domain layer (not thin pass-through, not general CRUD)
- Each endpoint maps to a specific demo tool and performs atomic multi-document operations
- Request/response shapes defined for all endpoints
- Deferred scope documented (LearningActivity, LearningDataset, User, etc.)

### Next.js App (`armature/app/`)

- Scaffolded with `create-next-app` — TypeScript, Tailwind CSS, App Router, React Compiler enabled
- Node 23.5 in use; `eslint-visitor-keys` engine warning is cosmetic — Node 23 works fine
- `app/lib/terminusdb.ts` — shared WOQLClient singleton; requires `organization: "admin"` in constructor
- `app/lib/routeHelpers.ts` — `createGetHandler(type)` factory for boilerplate GET routes
- `app/lib/types.ts` — TypeScript interfaces for all schema types, hand-derived from `schema/schema.json`
- All 8 simple GET routes implemented via factory: courses, objectives, modules, needs, assessments, items, prerequisites, notes
- Custom GET `/api/coverage/[moduleId]` — fetches ModuleObjective junctions, joins LearningObjective labels, returns merged coverage data with coverageStatus
- Root `.gitignore` cleaned up — Next.js paths unanchored (no leading `/`), duplicates removed, `.vscode/` exclusion removed (intentionally committed)
- `app/.env.local` — TerminusDB connection vars (not committed)

### Types Generation

- `scripts/generate-types.js` — generates `app/lib/types.ts` from `schema/schema.json`
- `app/lib/types.ts` is now **generated**, not hand-maintained — do not edit directly
- Two npm scripts in `app/package.json`: `generate:types` (write) and `check:types` (drift check, CI-ready)
- Enums emit `VALID_*` const arrays + derived union types (`type X = typeof VALID_X[number]`) — arrays are runtime source of truth, types derived from them
- Type mapping: xsd primitives → TS primitives, `Optional<T>` → optional fields, `Set<T>`/`List<T>` → arrays, Class references → `string` (@id), enum refs → union types, junction types → `extends TerminusDocument`
- `JUNCTION_IDS` and `CLASS_ORDER` in the generator are the two places to update when adding new schema types
- Generator fully documented inline — file header covers mapping decisions, extension guide, Zod deferral note

### Validation Layer (`app/lib/validate.ts`)

- `validateString(val, name, maxLength?)` — required string, trims, rejects empty, enforces limit (default 500)
- `validateOptionalString(val, name, maxLength?)` — optional string, returns `undefined` if absent (default 5000)
- `validateEnum(val, name, VALID_*, required?)` — validates against `VALID_*` arrays from `types.ts`; error includes valid options
- `validateReference(val, name)` — required `@id` string; format only, not existence
- `validatePositiveInt(val, name)` — optional positive integer; used for all `sequence` fields
- `ValidationError` class — distinguishes user errors (400) from system errors (500) in catch blocks
- `MAX_LENGTH` constants: `label: 500`, `description: 5000`, `rationale: 10000`

### TerminusDB Error Handling (`app/lib/routeHelpers.ts`)

- `handleTerminusError(error, context)` — maps known TerminusDB error `@type` strings to structured HTTP responses
- Matches on `@type` substrings (e.g. `api:InsertDocumentErrorResponse`) not `api:message` text — more stable
- Known patterns: insert schema failure → 400, delete missing target → 404, auth failure → 500 (logs env var warning)
- Unknown errors log full message with context string for pattern discovery
- `createGetHandler` factory now uses `handleTerminusError` internally

### POST Endpoints

- `POST /api/courses` — creates Course; validates label (required), description (optional)
- `POST /api/modules` — creates Module; validates label, description, courseId (required reference), sequence (optional positive int)

---

## What's Next

**Immediate: POST /needs** — first multi-document atomic operation

1. `POST /api/needs` — create LearningNeed + optional DescriptiveEvidence + NeedEvidenceLink in one `addDocument` call
2. `POST /api/objectives` — create LearningObjective, optional link to need, optional ModuleObjective
3. `POST /api/prerequisites` — create PrerequisiteRecord between two objectives (rationale required)
4. Coverage View UI — first frontend page; read-only, visually demonstrates graph value

**App structure (current):**
```
armature/app/
  app/
    api/
      courses/route.ts     ← GET + POST ✓
      modules/route.ts     ← GET + POST ✓
      needs/route.ts       ← GET only
      objectives/route.ts  ← GET only
      items/route.ts       ← GET only
      assessments/route.ts ← GET only
      prerequisites/route.ts ← GET only
      notes/route.ts       ← GET only
      coverage/[moduleId]/route.ts ← GET only
  lib/
    terminusdb.ts
    routeHelpers.ts    ← createGetHandler + handleTerminusError
    types.ts           ← GENERATED — VALID_* arrays + interfaces
    validate.ts        ← validation utilities
  package.json
```

---

## Active Decisions

- Next.js app lives inside the Armature repo (`armature/app/`) — demo is part of the project
- Next.js runs locally (not containerized) — TerminusDB stays in Docker
- Containerizing Next.js deferred until demo deployment is needed
- No auth system in demo scope — TerminusDB credentials in environment variables only
- `createGetHandler` factory for simple GET routes — deviations stand out by contrast
- ModuleObjectives filtered in JS not WOQL — acceptable at demo scale, noted as tech debt
- `app/lib/types.ts` is generated from `schema/schema.json` via `scripts/generate-types.js` — committed artifact, drift caught by `npm run check:types`
- `VALID_*` arrays in `types.ts` are the runtime source of truth for enums — union types derived from them, never duplicated
- `handleTerminusError` matches on `@type` substrings, not `api:message` text — more stable across TerminusDB versions
- JS client retained over raw HTTP API — client quirks are absorbed, switching cost exceeds benefit at demo stage
- `deleteDocument({ id: string | string[] })` — object with `id` key, not a bare array

---

## Blockers

None currently.

---

## Notes for Next Session

Start with `POST /needs` — the first endpoint that creates multiple documents atomically.

Key context:
- Request shape: `{ label, rationale, priority?, evidence?: { label, method, finding, collectedAt, source, confidence } }`
- Three documents to create in one `addDocument([...])` call: LearningNeed + DescriptiveEvidence + NeedEvidenceLink
- `evidence` is optional — need can be created alone and linked later
- NeedEvidenceLink is a junction document (no label/description/createdBy) — extends TerminusDocument
- DescriptiveEvidence extends LearningEvidence extends ArmatureDocument — needs `collectedAt` (xsd:dateTime) and `source`
- Validate: `rationale` against `MAX_LENGTH.rationale`, `priority` against `VALID_NeedPriority`, `method` against `VALID_EvidenceMethod`, `confidence` against `VALID_ConfidenceLevel`
- Zod for input validation is deferred — hand-validate per field using `validate.ts` helpers
- Response shape per spec: return created need with evidence and link if provided

---

## Recent Sessions

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
