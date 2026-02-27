# Armature — Session State

This file tracks current work state across sessions. Update it at the end of every session using the workflow in `prompts/update-session.md`.

---

## Current Phase

**Schema complete → Repo initialized → Next: API scaffold**

---

## What's Done

### Schema
- TerminusDB schema fully designed and documented (`schema/schema.json`)
- 12 enums, 22 document types (13 primary artifacts inheriting ArmatureDocument, 1 standalone User type, 1 abstract base, 6 junction/structural types)
- All types and non-obvious fields have inline `@documentation` comments
- API constraints documented directly on affected fields

### Architecture Decision Records
- 15 ADRs written covering every significant schema design decision (`schema/docs/adr/`)
- Nygard format: Status / Context / Decision / Consequences
- Each ADR cross-referenced in relevant schema `@documentation` comments

### Repository
- Public GitHub repo initialized: `armature`
- README with project positioning, problem statement, and status
- MIT license
- `.gitignore` for Node, Python, Docker, OS, IDE artifacts
- `docs/schema-guide.md` placeholder

---

## What's Next

Priority order:

1. **Docker Compose** — get TerminusDB running locally with a single command
   - `docker/docker-compose.yml`
   - TerminusDB service with persistent volume
   - Environment variable configuration

2. **Schema loader script** — load `schema/schema.json` into a running TerminusDB instance
   - `scripts/load_schema.py` (Python client) or `scripts/load_schema.js` (JS client)
   - Should be idempotent — safe to re-run against an existing schema

3. **Seed data** — realistic fictional course to support both demo narratives
   - Content domain TBD (see Open Questions in PROJECT_CONTEXT.md)
   - Must include: LearningNeeds with evidence, LearningObjectives with prerequisites, AssessmentItems with Responses, ItemInstances in Assessments, LearningActivities in Modules
   - Must support demo narrative 1 (outcome tracing) and narrative 2 (authoring intelligence)

4. **API scaffold** — Express or Fastify service with TerminusDB connection
   - Decision on framework still open
   - Endpoint design should follow REST conventions with graph semantics
   - Start with read endpoints; writes come after

5. **CoQui integration** — build CoQui fresh against the Armature API (separate repo)

---

## Active Decisions

These are in-progress or recently made — not yet captured as ADRs.

*(none currently)*

---

## Blockers

*(none currently)*

---

## Recent Sessions

### 2026-02-26
- Implemented ArmatureDocument abstract base class (ADR-0014)
  - 13 primary artifact types now inherit from ArmatureDocument
  - label and description defined once, inherited by all
  - DesignNote.subject retyped from Set<xsd:anyURI> to Set<ArmatureDocument> — TerminusDB now enforces referential integrity natively
  - xsd:anyURI stopgap fully removed
- Implemented User type and createdBy authorship field (ADR-0015)
  - User is standalone — does not inherit ArmatureDocument
  - Fields: displayName, externalId, email (Optional), institution (Optional)
  - createdBy: Optional<User> on ArmatureDocument, propagates to all 13 inheriting types
  - createdBy-only model — change history tracked at TerminusDB commit level, not via schema fields
  - User deletion handling flagged as deferred in ADR-0015
- Captured progressive formalization principle (CLAUDE.md Principle 6, ADR-0010 framing)
  - Text fields on rationale-bearing documents are intentionally provisional
  - Schema collects data before designing structure; real usage reveals what formalization is warranted
  - Migration path is clean by design: optional fields alongside existing ones, junction documents without touching endpoints

### 2026-02-22
- Designed and finalized TerminusDB schema
- Added semantic enrichments beyond base Mermaid diagram (ADR-0009)
- Documented all 10 design decisions as ADRs
- Added inline documentation to all schema types and fields
- Initialized GitHub repo with README, LICENSE, .gitignore
- Created `.claude/` directory with CLAUDE.md, PROJECT_CONTEXT.md, SESSION.md

---

## Notes for Next Session

- Check whether Express or Fastify has better TerminusDB client examples before committing to a framework
- Seed data domain: consider a topic that's relatable but not too shallow — something with real prerequisite structure (e.g., a statistics or programming fundamentals course)
- The schema loader script is the quickest win — unlocks testing the schema against a real TerminusDB instance
- ADR-0010 deferred list: DesignDecision structured type, NeedObjectiveDerivation, knowledge components, xAPI/LTI/QTI remain open
