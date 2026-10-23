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
- **Learning activities** that target objectives, organized into **modules** and **lessons** in a defined order
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

As of 18 October 2026, Phases 0 to 4 of the [development plan](docs/development-plan.md) are complete, and so are the decisions queued after them (commit ids on records that describe a state of the design, item statistics as measurements). Phase 5's attestations ([ADR-0028](schema/docs/adr/0028-attestation.md)) are built on a branch awaiting review:

- the schema (28 classes, 13 controlled vocabularies) with every accepted decision applied
- a version-controlled API: reads at any branch or commit, history and differences per document, branches, three-way merges with conflict reports
- one write path for every document type, enforcing every rule the database cannot (the invariants engine), with the author and reason recorded on every change
- identity resolution for people and AI agents
- the seven design-intelligence reads (coverage, alignment, trace, impact, attestation staleness, item statistics and a module's content in teaching order) and a read-only Coverage View page that shows each item's statistics beside the coverage it counts toward, and the module's activities in order
- the Design Graph (`/graph`, 2026-10-22): every record on a branch at a commit drawn in lifecycle columns, every relationship a labeled edge, derived in the viewer from the schema as data; filters, search, selection with its fields, annotations (attestations with their state), references and history, neighbors, upstream, downstream or the hub's trace lit in place, every view a URL; and the Focus page (`/graph/<Type>/<id>`), one record's trace drawn the same way, linked from every record on the Coverage View ([the visual language](docs/visual-language.md); [the plan](docs/graph-view-plan.md) for the Narrative 1 walk, lenses and figure export); a Playwright smoke test drives both in CI
- external references and attachments on every artifact and part (ADR-0030), an export of the graph at a commit under a profile and a slice (ADR-0031), and one administration's results in the seed so the outcomes-to-design walk runs on `main` (ADR-0063)
- 197 integration tests, run by CI against a TerminusDB service container on every push and pull request (the contract suite, Phase 7's first piece, 2026-10-21)

- `@armature/types` and `@armature/client`, installable packages a plugin builds on: the schema as TypeScript and every route as a typed function (Phase 7, 2026-10-21)

- the per-request version contract (ADR-0059): `Armature-Version` and `Armature-Capabilities` headers, `GET /discover` and `GET /schema`

- an instance as three containers: the store, the hub (`docker/hub.Dockerfile`, the API bundled into one file and served by Node) and the viewer (`docker/viewer.Dockerfile`, the pages as a client of the hub); `docker compose --profile hub up` runs them on one private network on loopback, and `--profile public` adds Caddy as the only public container ([Running an instance](docs/deployment.md); Phase 7, 2026-10-21)

**Next:** the rest of Phase 7: a standing hosted instance (the deployment was verified on a DigitalOcean Droplet on 2026-10-21 and destroyed by choice) and, before a writing client reaches one from elsewhere, the `oidc` resolver or an authenticating proxy. Phase 6 closed on 2026-10-20 with the hub-managed attachment endpoints deferred until a client has a file to attach. The first plugin, **CoQui** (an assessment-item review tool, in its own repository), is being built against this API.

**Not yet suitable for public writes:** the current identity resolver trusts the caller, so the hub's port stays on the server's loopback and only the read-only viewer is published; writes happen on the server until an authenticating resolver exists. See [Running an instance](docs/deployment.md) and [Limitations](docs/how-armature-works.md#29-limitations-and-risks).

## Documentation map

| If you want to... | Read |
|---|---|
| Understand what Armature is, how it works and why | [How Armature Works](docs/how-armature-works.md) |
| Build a tool on Armature: the schema's concepts and patterns, reading and writing through the client, handling refusals, mapping your own concepts | [Schema guide for tool authors](docs/schema-guide.md) |
| Look up a type or field | [Schema appendix](docs/SCHEMA_APPENDIX.md) (generated from `schema/schema.json`) |
| Call the API | [API reference](docs/api.md) |
| See why a decision was made | [Architecture Decision Records](schema/docs/adr/README.md) |
| See the roadmap and open questions | [Development plan](docs/development-plan.md) |
| Read the argument for Armature | [Position paper](docs/positionpaper/Armature-Position-Paper.html) |
| See what the first plugin asked for | [CoQui handoff](docs/armature-asks-from-Coqui.md) |
| Catch a client tool up with what changed | [Changes for client tools](docs/client-changes.md) |
| Use Armature as a research instrument for one study | [The research path](docs/research-path.md) |
| Stand up an instance on a server, or understand what runs where | [Running an instance](docs/deployment.md) |
| See the standards precedents and literature | [docs/research/](docs/research/) |
| Work on the code (including with an AI assistant) | [.claude/CLAUDE.md](.claude/CLAUDE.md), [.claude/SESSION.md](.claude/SESSION.md) |

## Getting started

You need [Docker](https://www.docker.com/) (to run the database) and [Node.js](https://nodejs.org/) 22 or later (CI uses 22).

```bash
# 1. Start TerminusDB, the graph database (pinned to v12.0.7 in docker/docker-compose.yml)
cd docker && docker compose up -d && cd ..

# 2. Install dependencies: the workspace (the app and packages/*) at the root, and the scripts
npm install
(cd scripts && npm install)

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

# 5. Run the hub: the API on port 3100 (it reads app/.env.local)
cd app && npm run build:hub && npm run start:hub

# 6. In another terminal, run the viewer: the module list and Coverage View on port 3000
cd app && npm run dev
```

Then open <http://localhost:3000> for the viewer, or call the API directly at <http://localhost:3100/api/v1>.

An instance runs store, hub and viewer as three containers on one private network, all on loopback (a hosted one adds Caddy for HTTPS with `--profile public`); the schema and seed are still loaded from the machine as in step 4, or through the `operator` service on a server without Node. [Running an instance](docs/deployment.md) is the administrator's guide:

```bash
cd docker && docker compose --profile hub up -d --build && cd ..
```

```bash
# Every learning objective on main
curl http://localhost:3100/api/v1/documents/LearningObjective

# Coverage of one module (both figures, the counts, and the items behind them)
curl http://localhost:3100/api/v1/intelligence/coverage/how-ai-works

# The same read as the design stood at an earlier commit
curl "http://localhost:3100/api/v1/intelligence/coverage/how-ai-works?ref=<commit-id>"

# A write: every change names who made it and says why
curl -X POST http://localhost:3100/api/v1/branches \
  -H 'Content-Type: application/json' -d '{"name":"my-experiment"}'
curl -X PUT "http://localhost:3100/api/v1/documents/DesignNote/my-note?branch=my-experiment" \
  -H 'Content-Type: application/json' \
  -H 'Armature-User: demo-designer@example.edu' \
  -d '{"message":"Record why the module order changed",
       "document":{"label":"Module order","rationale":"Ethics before limitations, per SME feedback",
                   "subject":["Module/how-ai-works"],"category":"SequencingDecision"}}'
```

Writes need the `Armature-User` header carrying a registered user's external identifier; the seed registers `demo-designer@example.edu`. The [API reference](docs/api.md) documents every route.

**Tests.** `npm test` in `app/` runs the 197 integration tests against the running database. They work on scratch branches and leave `main` and the seed as they found them.

**After a schema change.** Run `npm run generate:types` and `node scripts/generate-schema-appendix.js` at the root; CI fails if the generated types drift from `schema/schema.json`. A change that is not backward-compatible needs `node scripts/load_schema.js --clear-instances` followed by `node scripts/seed_data.js`.

## How it is built

```
Plugins (CoQui, future tools)  →  Armature API (/api/v1)  →  TerminusDB
                                   this repository
```

- **TerminusDB** stores the design graph as typed documents and keeps every change as a commit, with branches and merges built in.
- **The Armature API** is a [Hono](https://hono.dev) application in `app/lib/api/` (ADR-0054). It reaches the database only through one small HTTP adapter (`app/lib/api/store.ts`, ADR-0055). `app/server.ts` serves it as a standalone Node process, bundled into the container image `docker/hub.Dockerfile` builds (ADR-0026; Phase 7). A running API in front of a store is a **hub**: one address, `/api/v1`, that every client talks to.
- **The Armature viewer** is the Next.js app's three read-only pages (`app/app/`: the Design Graph, the module index and the Coverage View), a client of a hub like any plugin: it reads over HTTP through `@armature/client` and knows only the hub's address; the browser never calls the hub.
- **Plugins never talk to the database directly.** The API is where the rules, identity and history are enforced.
- **The schema is the single source of truth.** Type definitions, request validation and the schema appendix are generated from `schema/schema.json`.

## Repository structure

```
schema/
  schema.json                 The schema: every type, field, controlled vocabulary and relationship
  docs/adr/                   Architecture Decision Records, with an index in README.md
docs/
  how-armature-works.md       The complete explainer (start here)
  schema-guide.md             The schema guide for tool authors: concepts, patterns, the work of a tool
  api.md                      Reference for every /api/v1 route
  SCHEMA_APPENDIX.md          Generated reference for every type and field
  development-plan.md         The phased roadmap, principles, open questions and platform facts
  armature-asks-from-Coqui.md What the first plugin asked for and learned (a dated handoff)
  research-path.md            How a learning scientist stands up a constrained Armature for one study
  deployment.md               Running an instance: the terms, the containers, who can do what, the steps, a hosted instance
  graph-view-plan.md          The Design Graph: the plan for the viewer's graph pages (Phase 8), the visual language and Narrative 1 as a walk
  visual-language.md          How Armature draws a record, a relationship and the lifecycle: stages, hues, glyphs, chips, edges; the page's values, for papers and slides
  demo-api.md                 The retired demo-era API (historical)
  positionpaper/              The position paper (March 2026)
  research/                   Standards-precedents survey, candidate ADRs, reading list (2026-10-06); schema-precedents and plugin-candidates survey (2026-10-20); client mappings
  vendor/terminusdb/          Generated: vendored, version-stamped TerminusDB documentation
app/                          The API with its host (server.ts) and the viewer (the Next.js pages); see app/README.md
  app/                        The viewer's pages (no API route: the Next.js app is a client of the hub)
  lib/api/                    The Armature API (Hono): routes, write path, invariants, intelligence
packages/types/               @armature/types: the schema as TypeScript, generated from schema.json; never edit by hand
packages/client/              @armature/client: every /api/v1 route as a typed function (see packages/client/README.md)
package.json                  The npm workspace root (app and packages/*)
scripts/                      Schema loader, seed, types and appendix generators, platform checks, docs sync (its own package)
docker/                       Docker Compose for the store; --profile hub adds the hub and viewer, --profile public Caddy in front; their Dockerfiles, the Caddyfile, the operator entrypoint
.github/workflows/ci.yml      CI: lint, type-check, the generated-types drift check, the hub bundle, the contract suite against a TerminusDB service container, and both container images
.claude/                      Context for AI-assisted development sessions: CLAUDE.md, PROJECT_CONTEXT.md, SESSION.md
```

## Architecture decisions

Every significant decision is recorded as an [Architecture Decision Record](schema/docs/adr/README.md) (ADR): the context, the decision, its consequences, and usually the alternatives rejected. Superseded decisions are kept and marked, not deleted. This is Armature practicing what it preaches: design rationale preserved as structured, inspectable artifacts.

## Contributing

Armature is in early development and its architecture is still being settled. The best way to contribute now is to read the [ADRs](schema/docs/adr/README.md) and open an issue if you see a gap or disagree with a decision. Contribution guidelines will follow as the project matures.

## License

MIT
