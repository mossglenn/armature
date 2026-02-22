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

The schema is designed for [TerminusDB](https://terminusdb.com). To load it:

```bash
# Start TerminusDB (Docker)
docker run -p 6363:6363 terminusdb/terminusdb-server

# Load the schema (using the TerminusDB Python client)
python3 scripts/load_schema.py  # coming soon
```

Full setup instructions will be added when the Docker Compose configuration and API are ready.

## Contributing

Armature is in early development. Architecture decisions are being established now — the best way to contribute at this stage is to read the [ADRs](schema/docs/adr/README.md) and open an issue if you see a gap or disagree with a decision.

Contribution guidelines coming as the project matures.

## License

MIT
