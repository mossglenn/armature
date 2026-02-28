# Armature — Session State

This file tracks current work state across sessions. Update it at the end of every session using the workflow in `prompts/update-session.md`.

---

## Current Phase

**Implementation** → Schema loaded → Seed data inserted → Demo API documented → Next: Scaffold Next.js app

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

### Key Learnings This Phase

- TerminusDB GraphQL back-reference syntax: `_fieldName_of_TypeName` (not `_TypeName_fieldName`)
- `_path_to_*` fields require arguments — use direct field traversal instead where possible
- Abstract types (LearningEvidence) not accessible via inline GraphQL fragments — use `_path_to_ConcreteType` or query concrete type directly
- Hash-keyed types cannot have explicit `@id` in insert documents — TerminusDB generates from field values
- TerminusDB dashboard deprecated as of v11.2 — use GraphQL playground or DFRNT instead
- Next.js API routes run server-side — TerminusDB credentials never exposed to browser
- `addDocument` is transactional per call — bundle related documents for atomic commits

---

## What's Next

**Immediate: Scaffold Next.js app**

1. Run `create-next-app` inside `armature/app/`
2. Configure TypeScript, Tailwind, App Router
3. Set up shared TerminusDB client (`app/lib/terminusdb.ts`)
4. Implement GET endpoints first (reads only, no side effects)
5. Implement POST endpoints
6. Build demo tool UI pages

**App structure:**
```
armature/app/
  app/
    api/
      courses/route.ts
      modules/route.ts
      needs/route.ts
      objectives/route.ts
      items/route.ts
      assessments/route.ts
      prerequisites/route.ts
      notes/route.ts
      coverage/[moduleId]/route.ts
    (demo tool pages)
  lib/
    terminusdb.ts     ← shared client instance
    ids.ts            ← ID generation utilities
  package.json
```

**Environment variables needed:**
```
TERMINUS_URL=http://localhost:6363
TERMINUS_USER=admin
TERMINUS_PASS=admin
TERMINUS_DB=armature
```

---

## Active Decisions

- Next.js app lives inside the Armature repo (`armature/app/`) — demo is part of the project
- Next.js runs locally (not containerized) — TerminusDB stays in Docker
- Containerizing Next.js deferred until demo deployment is needed
- No auth system in demo scope — TerminusDB credentials in environment variables only

---

## Blockers

None currently.

---

## Recent Sessions

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
