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
- **Armature API** — Node.js (Express or Fastify) service exposing domain endpoints; translates REST calls to WOQL queries
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
  schema.json              # TerminusDB schema — source of truth
  docs/adr/                # Architecture Decision Records
api/                       # Armature API (Express/Fastify) — to be built
docker/                    # Docker Compose configuration — to be built
scripts/                   # Utility scripts (schema loading, seed data)
docs/
  schema-guide.md          # Conceptual guide (in progress)
.claude/
  CLAUDE.md                # This file
  PROJECT_CONTEXT.md       # Problem space, audiences, demo goals
  SESSION.md               # Current state and next steps
  prompts/                 # Reusable workflow prompts
```

---

## The Schema

The schema is the source of truth for everything. Read `schema/schema.json` before working on the API or any data-related code. The inline `@documentation` comments on every type and field are authoritative.

### Key types and their roles

| Type | Role |
|---|---|
| `LearningObjective` | Central node — everything connects to it |
| `AssessmentItem` | Reusable question in the item bank; placed into Assessments via `ItemInstance` |
| `ItemInstance` | Assessment-context wrapper around an `AssessmentItem` |
| `ModuleObjective` | Programmatic junction; carries computed `coverageStatus` |
| `PrerequisiteRecord` | Junction doc; carries `rationale` and `prerequisiteType` — design decision preserved as data |
| `NeedEvidenceLink` | Junction doc; links LearningNeed to LearningEvidence with `confidence` weighting |
| `ModuleActivityLink` | Junction doc; places LearningActivity in Module with `sequence` |
| `ModuleActivityGroupLink` | Junction doc; places ActivityGroup in Module with `sequence` |
| `ActivityGroupMember` | Junction doc; places LearningActivity in ActivityGroup with sub-`sequence` |

### Critical API constraints (not enforced by TerminusDB schema)

These must be enforced by the API on every write:

1. `AssessmentItem.assesses` — must contain at least one `LearningObjective`
2. `LearningActivity.targets` — must contain at least one `LearningObjective`
3. `ModuleActivityLink.sequence` and `ModuleActivityGroupLink.sequence` — must be unique across both types for a given Module (they share one integer namespace)
4. `ActivityGroupMember.sequence` — must be unique within a group
5. `ItemInstance.sequence` — must be unique within an Assessment
6. `ActivityGroup` — must not contain other `ActivityGroup` instances (flatness constraint)
7. `ModuleObjective.coverageStatus` — must be recomputed after any change to `AssessmentItem.assesses`, `ItemInstance` membership, or `ModuleObjective.role`

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

### 2. Constraints belong in the API
TerminusDB enforces type safety. Business logic constraints (minimum cardinality, sequence uniqueness, coverageStatus recomputation) belong in the API layer. See ADR-0006.

### 3. Design rationale is explicit
Every non-obvious decision should have a rationale — in code comments, in ADRs, or in the schema documentation. This is Armature practicing what it preaches.

### 4. Schema changes require an ADR
Any modification to `schema/schema.json` that changes existing types or adds new ones warrants an ADR. Adding an ADR first, then implementing, is the preferred order.

### 5. Framework vs. plugin boundary
Ask before adding anything: "Does this belong in the graph infrastructure, or in a specific tool's UX?" System-of-record concerns (artifact typing, relationships, schema versioning) belong here. Editing workflows, import/export formats, and UI patterns belong in plugins.

### 6. Text fields on rationale-bearing documents are intentionally provisional
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

---

## Workflow

### Session startup
1. Read SESSION.md for current state and next steps
2. Check git log for recent commits
3. Read any files relevant to today's work

### Session end
Say "update session" and follow the prompt in `.claude/prompts/update-session.md`.

### Commits
Follow the guide in `.claude/prompts/commit-message-guide.md`. Descriptive, conventional commit format. Show the message for approval before committing.

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
- **Don't** leave API constraints undocumented — if TerminusDB can't enforce it, the schema comment must say the API will
