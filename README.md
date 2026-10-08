# Armature

**Graph-based infrastructure for learning engineering.**

Armature is an open schema and API for preserving design rationale in the relationships between instructional artifacts — objectives, assessments, activities, and modules. It treats the artifact graph as a first-class data structure, making the decisions behind a course design inspectable, queryable, and reusable.

## The Problem

Current instructional design tools capture _what was built_ but not _why design decisions were made_ or _how artifacts relate to each other_. Objectives live in one document. Assessments live in another. The reasoning behind a prerequisite relationship — why one objective must precede another — lives in a designer's head or a Slack thread, if it lives anywhere at all.

This makes learning engineering difficult to study, reproduce, or improve. You can analyze what learners did. You can't easily analyze what the designer decided, or trace a learning outcome back through the design decisions that shaped it.

## What Armature Does

Armature models the full design process as a graph, from problem definition through outcome evaluation:

- **LearningNeeds** grounded in **LearningEvidence** (quantitative metrics and qualitative findings)
- **LearningObjectives** generated from needs, connected by **PrerequisiteRecords** that carry rationale
- **AssessmentItems** that assess objectives, placed into **Assessments** via **ItemInstances**
- **LearningActivities** that target objectives, organized into **Modules** and **ActivityGroups**
- **ModuleObjectives** that declare what each module intends to cover and compute how well its assessments actually do

Every relationship in the graph is a first-class artifact. A prerequisite isn't just an edge — it's a document with a rationale and a type (Hard, Soft, or Corequisite). A module's coverage status isn't a manual field — it's computed from the graph after each change to the assessment structure.

## What This Enables

Tools built on Armature can:

- Surface which objectives have no assessment coverage before a course launches
- Trace a low-performing item back through its objective to the learning need that generated it
- Show a designer which instructional strategies have been applied to an objective and which are missing
- Answer "why is this prerequisite here?" with a recorded rationale rather than institutional memory

## Status

Early development. The schema is defined and documented. The API and first plugin (CoQui, an assessment authoring tool) are in progress.

## Repository Structure

```
schema/
  schema.json          # TerminusDB schema — all types, enums, and relationships
  docs/
    adr/               # Architecture Decision Records — one per design decision
      README.md        # ADR index
      0001-*.md        # Abstract base type for evidence
      0002-*.md        # References, not ownership
      ...

docs/
  schema-guide.md      # Conceptual guide to the schema (in progress)
```

## Architecture Decisions

Every significant schema design decision is documented as an [Architecture Decision Record](schema/docs/adr/README.md). This is Armature practicing what it preaches: design rationale preserved as structured, inspectable artifacts.

## Getting Started

The schema is designed for [TerminusDB](https://terminusdb.com) v12. The repository runs the store in Docker and the API as a Next.js app on the host.

```bash
# 1. Start TerminusDB (pinned to v12.0.7 in docker/docker-compose.yml)
cd docker && docker compose up -d && cd ..

# 2. Install dependencies for the scripts and the app
(cd scripts && npm install)
(cd app && npm install)

# 3. Configure the app's connection (not committed)
#    app/.env.local needs TERMINUS_URL, TERMINUS_USER, TERMINUS_PASS, TERMINUS_DB.
#    TERMINUS_PASS must match TERMINUSDB_ADMIN_PASS given to the container (default: admin).

# 4. Load the schema and the demo seed data
node scripts/load_schema.js
node scripts/seed_data.js

# 5. Run the API
cd app && npm run dev
# GET http://localhost:3000/api/objectives, /api/coverage/<moduleId>, ...
```

The API is a [Hono](https://hono.dev) application in `app/lib/api/`, mounted under `/api/v1/` by one catch-all Next.js route (ADR-0054); the Next.js app is its host for now and a standalone process is the destination (ADR-0026). It reaches TerminusDB only through the HTTP adapter in `app/lib/api/store.ts` (ADR-0055). Phase 2 landed the version-control surface (ADR-0025): documents read at a branch or commit with the commit in `ETag`, a provisional write with `If-Match`, per-document history with diffs, diff between commits, branches, a three-way merge with a 409 conflict report, and changes since a commit. Writes name their author in the `Armature-User` header until identity resolution lands in Phase 3. The unversioned routes (`/api/courses`, `/api/coverage/...`) are the demo-era API described in `docs/demo-api.md` and are retired in Phase 3 of `docs/development-plan.md`, which specifies the full `/api/v1/` surface.

After any change to `schema/schema.json`, run `npm run generate:types` in `app/`; CI fails if the generated types drift. `npm test` in `app/` runs the in-process API tests against the running TerminusDB container.

## Contributing

Armature is in early development. Architecture decisions are being established now — the best way to contribute at this stage is to read the [ADRs](schema/docs/adr/README.md) and open an issue if you see a gap or disagree with a decision.

Contribution guidelines coming as the project matures.

## License

MIT
