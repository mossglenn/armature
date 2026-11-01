# Armature — Claude Code Context

The primary context for AI-assisted development on Armature: the rules and the map. Read this first, then `PROJECT_CONTEXT.md` (the problem, audiences, reference clients) and `SESSION.md` (the state) before any work session; read `HISTORY.md`, the log, only when `SESSION.md` points at it or no ADR or document answers a "why". Human readers start with `docs/how-armature-works.md`. Budget: 32 KB (`docs/context-files-plan.md`).

Abbreviations: ADR (Architecture Decision Record), API, CI, WOQL (TerminusDB's query language), OIDC (OpenID Connect).

---

## What Armature Is

Armature is graph-based infrastructure for learning engineering. It provides an open schema and API that preserves design rationale in the relationships between instructional artifacts: objectives, assessments, activities, modules.

The core insight: current instructional design tools capture *what was built* but not *why design decisions were made* or *how artifacts connect to each other*. Armature treats the artifact graph as a first-class data structure, making design decisions inspectable, queryable and reusable.

**The Git analogy:** Git did not replace text editors; it added a relational layer underneath them that made the history and provenance of changes visible. Armature does the same for instructional design tools.

---

## Architecture

### Stack

- **TerminusDB** stores the graph: one database per store, with its own commit history, branches and `User` registry. Pinned to v12.0.7 in `docker/docker-compose.yml`, on loopback.
- **The Armature API** is a Hono application in `app/lib/api/` (ADR-0054), host-neutral: nothing there imports from `next`. It reaches the store only through `store.ts` (ADR-0055). Its host is `app/server.ts`, bundled by `npm run build:hub` into one file and packaged by `docker/hub.Dockerfile`. Next.js hosts no API.
- **The viewer** is the Next.js app's pages (modules, the Coverage View, the Design Graph), a client of a hub over HTTP through `@armature/client` (`app/lib/viewer.ts`, `ARMATURE_HUB_URL`, default `http://localhost:3100`); no store credentials, reads only.
- **The packages**: `@armature/types` (generated: interfaces, the schema as data, Zod schemas) and `@armature/client` (every route as a typed function), in an npm workspace with `app`; `scripts/` stays outside so the TerminusDB client resolves only there.
- **Docker Compose** (`docker/`) runs the store alone by default; `--profile hub` adds the hub and the viewer, all on loopback; `--profile public` adds Caddy in front of the viewer, the only public container, refused while `TERMINUSDB_ADMIN_PASS` is unset or `admin`; `--profile workspace` a workspace hub on port 3101; the `operator` profile runs `scripts/` in a Node container. Two networks: `armature-store` (the store, the hubs, the operator) and `armature` (the hubs, the viewer, Caddy); a client beside an instance joins `armature`, calls `http://hub:3100` and never reaches the store. Its hubs set `ARMATURE_TRUST_NETWORK=1` (ADR-0067 decision 8). Settings live in `docker/.env`. `docs/deployment.md` is the administrator's guide.
- **Identity** is resolved by `identity.ts` (ADR-0032). The built resolver, `header`, trusts `Armature-User: <externalId>`, so a hub under it stays on its server's loopback; every hub answers only loopback host names and `ARMATURE_ALLOWED_HOSTS`, and refuses unlisted remote web origins (`ARMATURE_ALLOWED_ORIGINS`; ADR-0067 decision 7). `Armature-Agent` names a registered agent acting for that person: the agent is the author, the person's authority applies, and the hub appends `Armature-On-Behalf-Of` to the message and refuses that trailer from clients (ADR-0067 decisions 3 and 6; `trailers.ts`). **Authorization** (ADR-0068, built 2026-11-01; `authorization.ts`): a remote hub checks every write, merge, delete, grant and registration against the `Grant` documents in force on `main` (`grants.ts`), 403 `forbidden`; whoever creates a branch owns it, only a maintainer merges into `main`, an administrator grants; a branch with no owner stays writable while `GET /discover` says `ownerlessBranches: writable`; a workspace hub does not check. The seed registers `demo-designer@example.edu` as `Administrator` and `Maintainer` of every branch, and `demo-reviewer@example.edu` with nothing. `app/.env.local` holds the `TERMINUS_*` variables, `ARMATURE_IDENTITY` and `ARMATURE_EXPORT_KEY`; the scripts read the same from the shell.
- **Export**: `GET /api/v1/export?branch=|ref=&profile=full|pseudonymous|institutional&slice=<name>` is the graph at a ref as one JSON-LD document with its reloadable schema (ADR-0031). There is no import route; re-import is operator work (ADR-0062).
- **Accepted, built in part**: the workspace hub (ADR-0065; its role, `remote_only`, create and clone are built), its file-backed store (ADR-0066, Proposed), authentication beyond decisions 3, 6, 7 and 8 (ADR-0067: the `oidc` resolver, services, relays, discovery's `identity`). Authorization (ADR-0068) is built except the migration window's close, its `oidc` rows and the workspace hub's warning at creation. `docs/workspace-hub-plan.md` §14 is the build order; the ADRs' dated notes hold every later decision. Nothing changes for a client of the hub as built.
- **Clients**: CoQui (item review) is built in its own repository; Quiver (a local-first item manager) is paused until the workspace hub exists; `docs/demo-coverage.md` maps every built, planned and proposed client.
- **Node.js** 22 in CI; later versions work.

### Topology

```
CoQui, Quiver, the MCP server ─┐
                               ├─▶  a hub  =  the Armature API (Hono)  →  one store (TerminusDB)
the viewer (Next.js)          ─┘     one address, /api/v1
```

The API is the boundary: plugins never talk to a store directly. A second role for the same code, the *workspace hub* on a person's machine pushing through a remote's `/api/v1`, is accepted and built in part (ADR-0065).

### Terms

Used the same way in every document. The table is `docs/deployment.md` § "The terms" (`docs/workspace-hub-plan.md` §2 has the same): a server, the schema, the API, a store, a host, a hub, an instance, a client or plugin, the viewer; and the workspace terms of ADR-0065 (remote hub, workspace hub, workspace, base, local commit, push, bring in `main`, deliver), with §9 saying what a workspace hub refuses.

### Repository Structure

One line per entry: what it is and where its rules are. The code's own comments and the documents hold the rest.

```
schema/schema.json         # The schema, single source of truth; its @documentation is authoritative
schema/docs/adr/           # The ADRs; README.md is the index with every status
docker/                    # docker-compose.yml, Caddyfile, hub.Dockerfile, viewer.Dockerfile, operator-entrypoint.sh; docs/deployment.md explains them
.github/workflows/ci.yml   # Lint, typecheck, drift check, context budgets, the hub bundle; the contract suite against a store container; the client install check; the browser test; both images
package.json               # The npm workspace root: app and packages/*
packages/types/            # @armature/types, GENERATED src/ (types.ts, schemas.ts); do not edit
packages/client/           # @armature/client, every route as a typed function; takes a fetch; install-check/ is CI's consumer test
scripts/                   # Outside the workspace: generate-types.js, generate-schema-appendix.js, load_schema.js (--clear-instances, --recreate),
                           #   seed_data.js (six commits; its header says what each adds), platform_checks.js (lettered probes; its header lists them), check_context_size.js
app/server.ts              # The hub's entry (.env.local, PORT, HOST loopback by default); what build:hub bundles
app/operator.ts            # The operator tools' command line: check, delete, put (ADR-0062); bundled, shipped in the hub image
app/app/                   # The viewer: page.tsx (modules), coverage/[moduleId], graph/ (the Design Graph, Focus page, Walkthrough; docs/graph-view-plan.md), layout.tsx
app/e2e/graph.spec.ts      # The browser smoke test (Playwright); CI's viewer job
app/lib/viewer.ts          # The viewer's client of the hub (ARMATURE_HUB_URL); hub.ts starts the API on a port; envLocal.ts reads .env.local
app/lib/graph/             # The Design Graph's pure modules (no React, no DOM), each tested; stages.ts is the visual language as data
app/lib/operator/          # check.ts (the engine over a whole branch), repair.ts (every repair a marked commit through a transient branch)
app/lib/api/               # The Armature API, the Hono app (app.ts, basePath /api/v1; never imports from next)
  config.ts, role.ts       #   HubConfig per request (createApp, storeFor), the only env reader; remote_only
  boundary.ts, version.ts  #   Then: Host and Origin checks (ADR-0067 d7); then negotiate: REVISIONS mirrors docs/client-changes.md, every route under a CAPABILITY (ADR-0059)
  store.ts                 #   The store adapter: the ONLY module that talks to TerminusDB; routes reach it by storeFor; a dropped read resent once, a write never
  identity.ts, write.ts    #   The resolver → a User on main (ADR-0032), Armature-Agent → the agent as author; the one write pipeline: shape → attestedBy → 409 → createdBy and asOf → invariants → one commit, the hub's trailer appended
  authorization.ts, grants.ts, trailers.ts  # Who may (ADR-0068 decision 4's table, 403); the hub's own grant writes and reads; the hub-written trailers, refused from clients
  http.ts, classes.ts, fragments.ts, errors.ts, memo.ts  # Conventions (?branch=|?ref=, ETag/If-Match); the class maps; parts by fragmentId; ApiError; reads kept by commit
  invariants/              #   The engine; index.ts maps each constraint number to its module
  intelligence/            #   coverage.ts (ADR-0029, computed on read), graph.ts (per-request cached reads at one ref)
  export/                  #   exporter.ts (slices, profiles, schema normalization), slices.json (a study's slice is an entry here)
  routes/                  #   documents, branches, users, intelligence, export, discover, workspace; docs/api.md is their reference
  workspace/               #   A workspace hub's clone (the one route-side use of the operator methods), its records, its remote client
  *.test.ts                #   The contract suite over app.request(): write (every constraint failing and passing), intelligence (both narratives), client, store, boundary, ...
app/vitest.config.mts      # '@' alias; reads .env.local; files run one at a time
docs/                      # how-armature-works.md (the explainer), api.md (the reference), schema-guide.md (for tool authors), client-changes.md (the revision list),
                           #   SCHEMA_APPENDIX.md (GENERATED), development-plan.md (§2 clients, §6 questions, §9 platform facts), deployment.md, research-path.md,
                           #   the plans (workspace-hub, graph-view, mcp-server, storyline-bridge, context-files), visual-language.md, demo-coverage.md,
                           #   the kept records with banners (armature-asks-from-Coqui.md, armature-deep-review-2026-10-30.md, demo-api.md RETIRED),
                           #   positionpaper/, research/, figures/, vendor/terminusdb/ (GENERATED; _all/ gitignored)
.claude/                   # CLAUDE.md (this file), PROJECT_CONTEXT.md, SESSION.md (the state), HISTORY.md (the log, read on demand),
                           #   prompts/ (update-session.md, commit-message-guide.md), skills/terminusdb/
```

### TerminusDB documentation

Questions about what the store does are answered from the vendored docs in `docs/vendor/terminusdb/`, following the `terminusdb` skill. The installed client source under `scripts/node_modules/terminusdb` is authoritative for client behavior; the running container for server behavior; `docs/development-plan.md` §9 lists where the docs are known wrong.

---

## The Schema

The schema is the single source of truth. Read `schema/schema.json` before working on the API or any data-related code. The inline `@documentation` on every type and field is authoritative.

### Types are generated, not hand-maintained

`packages/types/src/types.ts` and `schemas.ts` (`@armature/types`, imported as `@armature/types` and `@armature/types/schemas`) are **generated** from `schema/schema.json` by `scripts/generate-types.js`. Never edit them. `types.ts` carries the interfaces and the schema as runtime data (`CLASS_CATEGORY`, `CLASS_ANCESTORS`, `CLASS_KEY`, `CLASS_FIELDS`); `schemas.ts` one strict Zod schema per concrete class for the write routes.

After any change to `schema/schema.json`, from the repository root: `npm run generate:types`, then `npm run check:types` (also in CI).

The generator's header documents every mapping, TypeScript and Zod.

To add a type: an ADR, then Workflow § "After schema changes", giving the class `@metadata.armature.category` (`infrastructure`, `fragment`, `artifact` or `relationship`; ADR-0027) and an explicit `@key` (ADR-0024). Rules the store cannot express are a validator in `app/lib/api/invariants/` with a failing and a passing test. A class without a category fails generation. Before relying on a store behavior, add a lettered check to `scripts/platform_checks.js` and run it.

### Key types and their roles

| Type | Role |
|---|---|
| `DesignRecord` | Abstract root of every artifact and relationship; what `DesignNote.subject` and `DesignFinding.subject` point at. `User` is outside it (ADR-0017) |
| `LearningObjective` | The central node; everything connects to it |
| `AssessmentItem` | A reusable question: a tree of fragments with its own `status`; placed via `ItemInstance`; may assess no objective yet (ADR-0060) |
| `Fragment` / `TextFragment` / `ItemOption` | Subdocument parts of an item, returned inline; identity is the client-assigned `fragmentId`, never the nested store id (ADR-0022, ADR-0023, ADR-0033). A part carries text or at least one attachment (constraint 19) |
| `ExternalRef` | Subdocument on every `ArmatureDocument` (`externalRefs`): an identifier in another system; points outward, copies nothing in (ADR-0030) |
| `Attachment` | Subdocument on every `ArmatureDocument` and `Fragment` (`attachments`): a verifiable coordinate for bytes, never the bytes (`contentHash` and `hashAlgorithm` mandatory; `revision` for Git and Lore); a changed hash on a fragment's attachment is a change to the part (ADR-0030) |
| `ItemInstance` | A placement of an item in an Assessment; its `status` is placement clearance, distinct from the item's own (ADR-0018); Hash key over `(assessment, implements)`, one placement per item per assessment |
| `DesignFinding` | An evidence-grounded concern about any design record or one part of it (`fragmentId`), with `status` and resolution rationale (ADR-0020, ADR-0028) |
| `Attestation` | One person's verdict (`Affirmed`, `Declined`) about a record or a part, as of a commit; with a claim or as an endorsement; Hash key over `(subject, fragmentId, claimRef, attestedBy)`, no client `@id`; staleness is a read (ADR-0028) |
| `ModuleObjective` | Junction: a module's declaration of an objective and its design intent (`role`, `roleRationale`, `sequence`); written through the generic document API (ADR-0007); stores no coverage (ADR-0056) |
| `LearningMetric` | A measurement from a `LearningDataset` (`derivedFrom`) about the record in `subject`; an item statistic is a metric whose `subject` is the item, never a field on it (ADR-0058) |
| `PrerequisiteRecord` | Junction with `rationale` and `prerequisiteType`: a design decision as data |
| `NeedEvidenceLink` | Junction: LearningNeed to LearningEvidence with `confidence` (reliability, not direction) |
| `ModuleActivityLink`, `ModuleLessonLink` | Junctions placing an activity or a `Lesson` (an ordered set of activities, the peer of an assessment; ADR-0064) in a Module with `sequence` |
| `LessonActivityLink` | Junction placing an activity in a Lesson with its own `sequence` |
| `ActivityItemLink` | Junction: an item used formatively inside an activity, optional `sequence`, Hash key over `(activity, item)`; no points, no clearance, no coverage (ADR-0061) |

### Critical API constraints (not enforced by the TerminusDB schema)

Enforced by the invariants engine on every write; `invariants/index.ts` maps each number to its module. The store enforces types, required fields, `@min_cardinality`, enums and that a referenced document *exists*, not its class (check L), and no cross-document or conditional rule. Shape is Zod first, 400; the rules below answer 422 `invariant_violation` with every violation at once, except where a rule says otherwise. `docs/api.md` lists every code.

0. **Every reference field's target is an instance of the declared class or a subclass.** Generic; keeps a `User` out of `DesignNote.subject` and an `AssessmentItem` out of `Module.course` (ADR-0014, ADR-0017)
1. *Retired (ADR-0060).* `AssessmentItem.assesses` may be empty or absent; such an item counts toward no coverage and the alignment read lists it under `itemsWithoutObjective`; readers treat an absent Set as empty
2. `LearningActivity.targets` has at least one `LearningObjective` (schema `@min_cardinality`, ADR-0013; shape, 400; kept until a client shows the case, ADR-0060 decision 4)
3. `ModuleActivityLink.sequence` and `ModuleLessonLink.sequence` are unique across both types within a Module (one integer namespace)
4. `LessonActivityLink.sequence` is unique within a lesson
5. `ItemInstance.sequence` is unique within an Assessment
6. A `Lesson` contains no `Lesson` (falls out of constraint 0)
7. Coverage is never stored (ADR-0056); the coverage read computes it at the ref over the module's placements, two populations, the default cut 0/1/2 to 4/5 or more (ADR-0029 decisions 1 to 3). A `ModuleObjective` with a coverage field is an unknown key, 400
8. `fragmentId` is unique across all fragments of one `AssessmentItem` and never regenerated by the hub (ADR-0023, ADR-0033)
9. `ItemOption.text` is unique within one item where present; the number of correct options suits `itemType` (ADR-0022)
10. `ItemInstance.status` may not be `Approved` while its item is `Draft` or `InReview` (ADR-0018)
11. `DesignFinding.resolutionRationale` is required when `status` is `Dismissed` (ADR-0020)
12. A write whose `@id` exists under a different `@type` is 409 `type_conflict` (ADR-0024)
13. `asOf` on `LearningDataset`, `LearningMetric`, `DesignFinding` and `Attestation` is a bare commit id the store holds, at which the record's subjects exist; a metric carries its dataset's value. Filled from the head (or `If-Match`) on create, kept on replace, checked when supplied; an attestation's replace refills it and its subject may not be written in the same request (`subject_in_same_write`) (ADR-0057, ADR-0058, ADR-0028 decision 5)
14. `Attestation.claimRef` and `claimText` are both present or both absent (`claim_incomplete`; ADR-0028)
15. `Attestation.attestedBy` is the resolved identity, filled before the replace lookup since it is in the key; a body naming anyone else is `attester_not_caller` (ADR-0028, ADR-0032)
16. `fragmentId` on `Attestation`, `DesignNote` and `DesignFinding`: the record names exactly one `subject` (`fragment_needs_one_subject`) with a part of that id at `asOf` when checked, else as the write leaves it (`unknown_fragment`; ADR-0028 decision 6)
17. `ActivityItemLink.sequence` is unique within an activity (`duplicate_sequence`; ADR-0061)
18. `Attachment`: `revision` present when `store` is `Git` or `Lore` (`revision_required`); `contentHash` lower-case hexadecimal of the length `hashAlgorithm` implies for the IANA names the hub knows (`hash_malformed`); checked on an artifact or a fragment (ADR-0030)
19. A `Fragment` carries text or at least one attachment (`empty_fragment`; ADR-0030)
20. A `LearningDataset` has `producedBy` or an `externalRef` (`dataset_without_source`); a `LearningMetric` has `derivedFrom` or an `externalRef` (`metric_without_source`) (ADR-0063)
21. A `Grant` lives on `main`, judged by the branch a write is for, so the operator's `put` on `main` passes (400 `grants_live_on_main`, before anything is read; ADR-0068 decision 2)
22. A grant's holder suits its role: `Maintainer` and `Administrator` are persons, `Relay` an agent; `relayedUsers` only on a `Relay` grant, naming persons (`grant_holder_kind`, `relayed_users_not_relay`; ADR-0068 decision 2)

Also in the API: the list route refuses a filter on a `User` field of a class under `DesignRecord` (400 `person_filter_refused`, ADR-0021) and lists `Grant` by `user` (ADR-0068 decision 8); `Optional` and `Set` filters run in the hub (check Y). Decided, not built: a merge checked before it commits (ADR-0025 decision 5, note).

### Junction document pattern

Relationships are first-class artifacts, not edges, named after both sides and Hash-keyed over them, so a client never supplies the id and reaches one in a batch by `@capture` and `@ref`; children carry the parent reference (ADR-0003, ADR-0004, ADR-0024; `docs/schema-guide.md` §7 has the patterns).

---

## Development Principles

1. **The API is the boundary.** Plugins never touch a store. The API is host-neutral (ADR-0054): every route is a Hono route in `app/lib/api/` against Web-standard `Request` and `Response`, served by `app/server.ts`.
2. **Constraints belong in the API.** The store enforces types, required fields, enum values, minimum cardinality and reference existence; everything else is the invariants engine (ADR-0006's principle, ADR-0013 for the minimums). Derived values are not constraints to maintain: they are computed on read (ADR-0056).
3. **Design rationale is explicit.** Every non-obvious decision has a rationale in a code comment, an ADR or the schema documentation.
4. **Schema changes require an ADR**, written first; the schema and the generated files are committed together.
5. **Framework against plugin.** Ask of anything new: does it belong in the graph infrastructure or in a tool's experience? System-of-record concerns belong here; editing workflows, import and export formats and interface patterns belong in plugins.
6. **The two-client test.** A capability enters the hub only in the generic form a second reference client would also need (the table in `PROJECT_CONTEXT.md`; `docs/development-plan.md` §2). CoQui's round, craft grid, claim version and workflow states failed it and map onto branches, `claimRef`, `ItemStatus` and `User` at its boundary.
7. **Text fields on rationale-bearing documents are intentionally provisional** (ADR-0010). Do not propose replacing them with structure without evidence from real usage; the path is an optional enum beside the text, then a structured type, then a junction.
8. **Decisions wait for evidence, and a settled one is reopened when building it shows its cost** (ADR-0056 reversed a stored field the day its machinery was built). Options with pros, cons and a recommendation are presented; Amos decides; then build and record.

---

## ADRs to read first

The index with every status and a one-line summary of each is `schema/docs/adr/README.md`. Before working on the API or the schema, read these from it: ADR-0002 to ADR-0004 (references, junctions, back-references), ADR-0024 (identifiers and replace), ADR-0025 (the commit graph is the design history), ADR-0028 (attestation), ADR-0029 and ADR-0056 (coverage, nothing derived stored), ADR-0030 and ADR-0031 (external references, attachments, export), ADR-0032 (identity), ADR-0054 and ADR-0055 (the Hono app, one store adapter), ADR-0057 and ADR-0058 (`asOf`, item statistics as metrics), ADR-0059 (capability negotiation), ADR-0062 (operator repair outside the API), ADR-0065 to ADR-0068 (the workspace hub, its store, authentication, authorization; their dated notes hold the later decisions).

---

## Workflow

### Session startup
1. Read `SESSION.md` whole (it is under 32 KB) for the state and the next step
2. Check `git log` for recent commits
3. Read the files relevant to today's work
4. Read `HISTORY.md` only for a session or decision `SESSION.md` points at, or when no ADR or document says why something is as it is

### Tests
`npm test` in `app/` runs Vitest. The tests under `app/lib/api/` call the Hono app in-process against the TerminusDB container, which must be up with the seed loaded; they are the contract suite, which CI's `contract` job runs against a service container after seeding and the operator's `check`. Files run one at a time (the store has one commit graph); the global setup warms a cold store first. The Design Graph's modules are tested on a fixture and the seed; the pages in a browser by `app/e2e/graph.spec.ts` (`npm run test:e2e` after `build:hub` and `build`; CI's `viewer` job). **The rule:** a test is included unless it is very unlikely to show a real problem or very costly. The seed is a fixture the tests read (Module 1's sequences 1 and 2 are taken; two people are named; the designer holds the grants, the reviewer none). `authorization.test.ts` runs over a scratch database (its header says why), and every suite deletes its branches through the operator's `deleteScratchBranch`.

### Session end
Say "update session" and follow `.claude/prompts/update-session.md`: the history entry first, then the state, then the budgets.

### Branches, commits and pull requests
1. Work happens on a branch named for the unit of work (`phase-2/version-control`, `spike/adr-0054-hono`, `docs/...`), never on `main`; the one exception is the session-close commit, `docs(.claude): update session state for <date>`.
2. Before committing, show the proposed commit sequence (one logical change per commit, Conventional Commits per `.claude/prompts/commit-message-guide.md`) and wait for approval.
3. Commit, push and open a pull request only when asked; merge only when asked ("confirm and merge"), with a rebase merge (`--rebase --delete-branch`) so each commit stays visible on `main`, then confirm CI on `main`.
4. Platform assumptions get a lettered check in `scripts/platform_checks.js` before an ADR relies on them; the ADR cites the letter.
5. A pull request that changes how an instance runs (`docker/docker-compose.yml`, either Dockerfile, the `Caddyfile`, `docker/operator-entrypoint.sh`, or the steps in `docs/deployment.md`) gets a rehearsal on a fresh Lima VM before it merges; CI covers the code, not the deployment. A Droplet is for keeping an instance, before the first remote writing client, and whenever authentication changes. Never run the contract suite against a store with real data; the operator's `check` is the health check there (`docs/deployment.md` § "Testing a deployment").

### After schema changes
1. Write or update the ADR
2. Update `schema/schema.json`
3. `npm run generate:types`, then `npm run check:types`, from the repository root
4. `node scripts/generate-schema-appendix.js`
5. Commit `schema.json`, `packages/types/src/types.ts`, `schemas.ts` and `docs/SCHEMA_APPENDIX.md` together

### Adding an ADR
1. The next number past the candidate block 0035–0053; `NNNN-short-decision-title.md`
2. Nygard format (Status, Context, Decision, Consequences) with In brief, Alternatives and Verification as the recent ADRs have them
3. Reference the number in related schema `@documentation`; add the row to the index

### Documents and records
- **American spelling; acronyms expanded per section.**
- **A historical record is annotated, never rewritten.** An accepted ADR changes only by dated notes (`> **Later change (date):**`, `> **Note (date):**`); a consistency fix goes in before the Status changes. A handoff or review kept in `docs/` gets a status banner saying what landed, never an edit to its body.
- **A change to a route, the schema, a decision or what runs where updates the human-facing documents too** (the README, the reference, the guide, the explainer, deployment, the research path, demo coverage, the plans), as each describes the thing changed.
- **`docs/client-changes.md` is also the revision list.** Every change a client would act on gets a dated, tool-neutral entry with a CoQui note; a dated entry is a revision `REVISIONS` in `version.ts` must name (a test fails otherwise), and `CLIENT_REVISION` follows. A read added on a day that already has a revision rides it; a header the contract already promised is a fix, not a revision.
- **A review** of the documents runs as parallel readers over disjoint file groups against one written brief, whole files, every high finding spot-checked by the lead. An outside review is checked citation by citation first; its findings are cited by its own identifiers; a finding on an accepted ADR becomes a dated note; a disagreement goes into its banner with the reason.
- **The context files keep their budgets** (this file and `SESSION.md` 32 KB, `PROJECT_CONTEXT.md` 20 KB; `npm run check:context`, in CI): over budget means move, not shorten; a fact lives in one place and the rest point.

---

## What Not To Do

- **Don't** write directly to TerminusDB; everything goes through the API
- **Don't** add owned subdocuments for relationships: every relationship between documents is a reference (ADR-0002). The embedded exceptions are an item's parts, addressed by `fragmentId`, never by nested store ids, and `ExternalRef` and `Attachment`, which have no identity
- **Don't** put UI logic, import or export formats, or plugin-specific code in this repository
- **Don't** change `schema.json` without an ADR, or edit `packages/types/src/` by hand
- **Don't** write API routes as Next.js route handlers or add any file under `app/app/api/`: every route is a Hono route in `app/lib/api/` under `/api/v1`, served by `app/server.ts`; the Next.js app is the viewer and hosts no API
- **Don't** import from `next` under `app/lib/api/`, or import `app/lib/api/` from a page; a page reaches the hub over HTTP through `app/lib/viewer.ts`, like any plugin
- **Don't** add the `terminusdb` client to `app/`; the API reaches the store through its HTTP adapter (ADR-0055). The one exception would be a `lib/woql.js` building query JSON the adapter posts, and the first such use amends the ADR
- **Don't** write a per-type route or hand-write a request schema; type behavior is a validator in `invariants/`, request shape is the generated `schemas.ts`
- **Don't** let the store's `TerminusDB-Data-Version` header or its `branch:`/`commit:` prefixes into `/api/v1`; responses carry `ETag: "<commit-id>"`, writes accept `If-Match`, a stale match is 412; the adapter translates (ADR-0025 decision 7)
- **Don't** expose or call reset, squash or rebase; history is never rewritten, a mistake is undone by a new commit, a branch is deleted only when another holds its head (ADR-0025 decision 6). Repairs the rules prevent are operator work, still as commits (ADR-0062); never a bypass header, a raw query route, or `invariants: 'skip'` from a route (a test reads the API's modules for it)
- **Don't** take the commit author, `createdBy` or `attestedBy` from a request body; all three come from the resolved identity (constraint 15); `User` documents are created on `main` only (ADR-0032). The author may also be a registered agent named in `Armature-Agent`, acting for the caller (ADR-0067 decision 3, built), or when relays are built a relayed person under a `Relay` grant; never another person
- **Don't** add an import route or any write that bypasses the pipeline; reproducing an export is operator work through the adapter's operator-side methods (ADR-0031 decision 4, ADR-0062), the one exception a workspace hub's clone of its own remote (`workspace/clone.ts`)
- **Don't** put bytes in the graph; an image, a file or an asset tree is an `Attachment` reference with a content hash and, for a versioned store, a revision (ADR-0030)
- **Don't** store a derived value in the graph; coverage, alignment and any score are reads at a ref (ADR-0056); a judgment on record is a `DesignFinding` or an `Attestation` (ADR-0028); a measurement is a `LearningMetric` with a `subject` (ADR-0058)
- **Don't** use the store's `POST overwrite=true`, which merges values into a list rather than replacing (check X3a); the upsert is `PUT create=true` over a list
- **Don't** claim a reference's class is schema-enforced; the store checks existence only (check L), the engine checks class (constraint 0)
- **Don't** leave an API constraint undocumented; if the store cannot enforce it, the schema comment says the API will
