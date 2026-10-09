# Armature

**Graph-based infrastructure for learning engineering.**

Armature is an open schema and API (application programming interface) for recording instructional design as data. It stores design artifacts (learning needs, objectives, assessment items, activities, modules), the relationships between them, and the full history of how both changed, by whom and why. Tools built on Armature can then inspect the design: which objectives lack assessment coverage, which items sit below their objective's cognitive level, which evidence an objective traces back to, and what would be affected by a change.

New to the project? Start with **[How Armature Works](docs/how-armature-works.md)**, a complete explainer written for learning scientists and other readers who know the basics of software but not its details.

## The problem

Current instructional design tools capture *what was built* but not *why design decisions were made* or *how artifacts relate to each other*. Objectives live in one document and assessments in another. The reasoning behind a prerequisite (why one objective must come before another) lives in a designer's head or a chat thread, if it lives anywhere at all.

This makes learning engineering hard to study, reproduce or improve. You can analyze what learners did. You cannot easily analyze what the designer decided, or trace a learning outcome back through the design decisions that shaped it. The position paper (`docs/positionpaper/`) calls the missing thing **design data**: a structured, queryable, versioned record of the design process, as distinct from the **learning data** that learning management systems and analytics platforms already capture.

## What Armature does

Armature models the design process as a graph, from problem definition through outcome evaluation:

- **Learning needs** grounded in **learning evidence** (quantitative metrics and qualitative findings), each link carrying the designer's confidence in that evidence
- **Learning objectives** generated from needs, connected by **prerequisite records** that carry a type (hard, soft or corequisite) and a rationale
- **Assessment items** in a reusable item bank that assess objectives, placed into **assessments** through **item instances**, with a review status on both the item and each placement
- **Learning activities** that target objectives, organized into **modules** and **activity groups** in a defined order
- **Module objectives** that record which objectives each module declares, and the role each plays there
- **Design notes** (why a decision was made) and **design findings** (an evidence-grounded concern that something is wrong, and what became of it)

Every relationship that carries meaning is a first-class record. A prerequisite is not just a line between two objectives; it is a document with its own rationale and type. Every change is a commit with an author and a stated reason, and every read can be made at any point in history.

Coverage is not a field anyone maintains: it is computed from the graph whenever it is read, at any commit, so it can never be stale.

## What this enables

Through the design-intelligence reads under `/api/v1/intelligence/`, tools built on Armature can:

- show which objectives a module declares but does not adequately assess, both as it stands and as it will stand once items in review are approved (**coverage**)
- flag items whose Bloom's level is below the objective they assess, and objectives no activity targets (**alignment**)
- trace an assessment result back through items and objectives to the learning need and evidence behind them, with every design note and finding along the way (**trace**)
- list everything that depends on an artifact before it changes (**impact**)
- answer "why is this prerequisite here?" with a recorded rationale and a commit history, rather than institutional memory

## Status

As of 8 October 2026, Phases 0 to 4 of the [development plan](docs/development-plan.md) are complete:

- the schema (27 classes, 12 controlled vocabularies) with every accepted decision applied
- a version-controlled API: reads at any branch or commit, history and differences per document, branches, three-way merges with conflict reports
- one write path for every document type, enforcing every rule the database cannot (the invariants engine), with the author and reason recorded on every change
- identity resolution for people and AI agents
- the four design-intelligence reads and a read-only Coverage View page
- 95 integration tests

**Next:** a decision on [ADR-0057](schema/docs/adr/0057-records-name-the-commit-they-refer-to.md) (records that name the commit they refer to), then Phase 5 (attestations and the review vocabulary). The first plugin, **CoQui** (an assessment-item review tool, in its own repository), is being built against this API.

**Not yet suitable for shared deployment:** the current identity resolver trusts the caller, so the routes that change data must stay on the local machine. See [Limitations](docs/how-armature-works.md#29-limitations-and-risks).

## Documentation map

| If you want to... | Read |
|---|---|
| Understand what Armature is, how it works and why | [How Armature Works](docs/how-armature-works.md) |
| Understand the schema's concepts and patterns | [Schema guide](docs/schema-guide.md) |
| Look up a type or field | [Schema appendix](docs/SCHEMA_APPENDIX.md) (generated from `schema/schema.json`) |
| Call the API | [API reference](docs/api.md) |
| See why a decision was made | [Architecture Decision Records](schema/docs/adr/README.md) |
| See the roadmap and open questions | [Development plan](docs/development-plan.md) |
| Read the argument for Armature | [Position paper](docs/positionpaper/Armature-Position-Paper.html) |
| See what the first plugin asked for | [CoQui handoff](docs/armature-asks-from-Coqui.md) |
| See the standards precedents and literature | [docs/research/](docs/research/) |
| Work on the code (including with an AI assistant) | [.claude/CLAUDE.md](.claude/CLAUDE.md), [.claude/SESSION.md](.claude/SESSION.md) |

## Getting started

You need [Docker](https://www.docker.com/) (to run the database) and [Node.js](https://nodejs.org/) 22 or later (CI uses 22).

```bash
# 1. Start TerminusDB, the graph database (pinned to v12.0.7 in docker/docker-compose.yml)
cd docker && docker compose up -d && cd ..

# 2. Install dependencies for the scripts and the app
(cd scripts && npm install)
(cd app && npm install)

# 3. Configure the app's connection to the database (app/.env.local is not committed)
cat > app/.env.local <<'ENV'
TERMINUS_URL=http://localhost:6363
TERMINUS_USER=admin
TERMINUS_PASS=admin
TERMINUS_DB=armature
# Optional: which identity resolver to use (default: header)
# ARMATURE_IDENTITY=header
ENV
#    TERMINUS_PASS must match TERMINUSDB_ADMIN_PASS given to the container (default: admin).
#    The scripts read the same TERMINUS_* variables from your shell, defaulting to admin/admin.

# 4. Load the schema and the demonstration course
node scripts/load_schema.js
node scripts/seed_data.js

# 5. Run the app, which serves the API and the Coverage View
cd app && npm run dev
```

Then open <http://localhost:3000> for the module list and Coverage View, or call the API directly:

```bash
# Every learning objective on main
curl http://localhost:3000/api/v1/documents/LearningObjective

# Coverage of one module (both figures, the counts, and the items behind them)
curl http://localhost:3000/api/v1/intelligence/coverage/how-ai-works

# The same read as the design stood at an earlier commit
curl "http://localhost:3000/api/v1/intelligence/coverage/how-ai-works?ref=<commit-id>"

# A write: every change names who made it and says why
curl -X POST http://localhost:3000/api/v1/branches \
  -H 'Content-Type: application/json' -d '{"name":"my-experiment"}'
curl -X PUT "http://localhost:3000/api/v1/documents/DesignNote/my-note?branch=my-experiment" \
  -H 'Content-Type: application/json' \
  -H 'Armature-User: demo-designer@example.edu' \
  -d '{"message":"Record why the module order changed",
       "document":{"label":"Module order","rationale":"Ethics before limitations, per SME feedback",
                   "subject":["Module/how-ai-works"],"category":"SequencingDecision"}}'
```

Writes need the `Armature-User` header carrying a registered user's external identifier; the seed registers `demo-designer@example.edu`. The [API reference](docs/api.md) documents every route.

**Tests.** `npm test` in `app/` runs the 95 integration tests against the running database. They work on scratch branches and leave `main` and the seed as they found them.

**After a schema change.** Run `npm run generate:types` in `app/` and `node scripts/generate-schema-appendix.js` at the root; CI fails if the generated types drift from `schema/schema.json`. A change that is not backward-compatible needs `node scripts/load_schema.js --clear-instances` followed by `node scripts/seed_data.js`.

## How it is built

```
Plugins (CoQui, future tools)  →  Armature API (/api/v1)  →  TerminusDB
                                   this repository
```

- **TerminusDB** stores the design graph as typed documents and keeps every change as a commit, with branches and merges built in.
- **The Armature API** is a [Hono](https://hono.dev) application in `app/lib/api/` (ADR-0054). It reaches the database only through one small HTTP adapter (`app/lib/api/store.ts`, ADR-0055). For now a Next.js app hosts it through a single catch-all route; a standalone process is the planned destination (ADR-0026).
- **Plugins never talk to the database directly.** The API is where the rules, identity and history are enforced.
- **The schema is the single source of truth.** Type definitions, request validation and the schema appendix are generated from `schema/schema.json`.

## Repository structure

```
schema/
  schema.json                 The schema: every type, field, controlled vocabulary and relationship
  docs/adr/                   Architecture Decision Records, with an index in README.md
docs/
  how-armature-works.md       The complete explainer (start here)
  schema-guide.md             Conceptual guide to the schema
  api.md                      Reference for every /api/v1 route
  SCHEMA_APPENDIX.md          Generated reference for every type and field
  development-plan.md         The phased roadmap, principles, open questions and platform facts
  armature-asks-from-Coqui.md What the first plugin asked for and learned (a dated handoff)
  demo-api.md                 The retired demo-era API (historical)
  positionpaper/              The position paper (March 2026)
  research/                   Standards-precedents survey, candidate ADRs, reading list
  vendor/terminusdb/          Generated: vendored, version-stamped TerminusDB documentation
app/                          The Next.js app: hosts the API and the Coverage View (see app/README.md)
  app/                        Pages and the one catch-all API route
  lib/api/                    The Armature API (Hono): routes, write path, invariants, intelligence
  lib/types.ts, lib/schemas.ts  Generated from schema.json; never edit by hand
scripts/                      Schema loader, seed, types and appendix generators, platform checks, docs sync
docker/                       Docker Compose for TerminusDB
.github/workflows/ci.yml      CI: lint and the generated-types drift check
.claude/                      Context for AI-assisted development sessions: CLAUDE.md, PROJECT_CONTEXT.md, SESSION.md
```

## Architecture decisions

Every significant decision is recorded as an [Architecture Decision Record](schema/docs/adr/README.md) (ADR): the context, the decision, its consequences, and usually the alternatives rejected. Superseded decisions are kept and marked, not deleted. This is Armature practicing what it preaches: design rationale preserved as structured, inspectable artifacts.

## Contributing

Armature is in early development and its architecture is still being settled. The best way to contribute now is to read the [ADRs](schema/docs/adr/README.md) and open an issue if you see a gap or disagree with a decision. Contribution guidelines will follow as the project matures.

## License

MIT
