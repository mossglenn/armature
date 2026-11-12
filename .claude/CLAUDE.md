# Armature — Claude Code Context

The primary context for AI-assisted development on Armature: the rules and the map. Read this first, then `PROJECT_CONTEXT.md` (the problem, audiences, reference clients) and `SESSION.md` (the state) before any work session; read `HISTORY.md`, the log, only when `SESSION.md` points at it or no ADR or document answers a "why". Human readers start with `docs/how-armature-works.md`. Budget: 42 KB since 2026-11-01 (`docs/context-files-plan.md`).

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
- **The viewer** is the Next.js app's pages (modules, the Coverage View, the Design Graph, `/connect`'s link to the desktop program), a client of a hub over HTTP through `@armature/client` (`app/lib/viewer.ts`, `ARMATURE_HUB_URL`, default `http://localhost:3100`); no store credentials, reads only.
- **The packages**: `@armature/types` (generated: interfaces, the schema as data, Zod schemas) and `@armature/client` (every route as a typed function), in an npm workspace with `app`; `scripts/` stays outside so the TerminusDB client resolves only there.
- **Docker Compose** (`docker/`) runs the store alone by default; `--profile hub` adds the hub and the viewer, all on loopback; `--profile public` adds Caddy in front of the viewer, the only public container, refused while `TERMINUSDB_ADMIN_PASS` is unset or `admin`, and under `ARMATURE_IDENTITY=oidc` in front of the hub too at `ARMATURE_API_HOST` (`docker/caddy/oidc.caddy`; refused without the issuer, the audience and a bare host); `--profile rehearsal-oidc` a Keycloak for rehearsals (`docker/rehearsal/`); `--profile workspace` a workspace hub on port 3101 over its folder, no store; the `operator` profile runs `scripts/` in a Node container. Two networks: `armature-store` (the store, the hubs, the operator) and `armature` (the hubs, the viewer, Caddy); a client beside an instance joins `armature`, calls `http://hub:3100` and never reaches the store. Its hubs set `ARMATURE_TRUST_NETWORK=1` (ADR-0067 decision 8). Settings live in `docker/.env`. `docs/deployment.md` is the administrator's guide.
- **Identity** is resolved by `identity.ts` (ADR-0032). The default resolver, `header`, trusts `Armature-User: <externalId>`, so a hub under it stays on its server's loopback; `oidc` (ADR-0067 decision 1, built 2026-11-05; `oidc.ts`) verifies `Authorization: Bearer <token>` with `jose` against the issuer's keys (`ARMATURE_OIDC_ISSUER`, `ARMATURE_OIDC_AUDIENCE`), resolves a person by `(issuer, sub)`, registers a first encounter only when `ARMATURE_OIDC_ADMIT` admits the token (403 `not_registered` otherwise), resolves a service's token (a client `ARMATURE_OIDC_SERVICES` lists, no `name`; decision 4, note of 2026-11-12) to `agent:<client id>`, requires a token on every request but `GET /discover`, takes `Armature-User` beside a service's token as a relay (decision 5: an active `Relay` grant naming the person and covering the branch, documents only, the person the author and `Armature-Relayed-By` appended, 403 `reason: relay` otherwise), and keeps the registry (`GET /users`, `GET /documents/User`) for maintainers of `main` and administrators, `pseudonymous` the export's default and `profile=full` to anyone else with only the users its records name, `kind=agent` open (ADR-0068 decision 4, notes); a workspace hub runs under `header`. The viewer holds its own credential under `oidc` (`app/lib/viewerToken.ts`: `ARMATURE_HUB_TOKEN`, or the client credentials grant). Every hub answers only loopback host names and `ARMATURE_ALLOWED_HOSTS`, and refuses unlisted remote web origins (`ARMATURE_ALLOWED_ORIGINS`; ADR-0067 decision 7). `Armature-Agent` names a registered agent acting for that person: the agent is the author, the person's authority applies, and the hub appends `Armature-On-Behalf-Of` to the message and refuses that trailer from clients (ADR-0067 decisions 3 and 6; `trailers.ts`). **Authorization** (ADR-0068, built 2026-11-01; `authorization.ts`): a remote hub checks every write, merge, delete, grant and registration against the `Grant` documents in force on `main` (`grants.ts`), 403 `forbidden`; whoever creates a branch owns it, only a maintainer merges into `main`, an administrator grants; a branch with no owner stays writable while `GET /discover` says `ownerlessBranches: writable`; an agent as the credential itself reads and never writes on a remote hub (ADR-0067 decision 10); a workspace hub checks no grants and keeps each workspace to its owner. A write without `If-Match` that loses a race to a commit changing a document it replaces is 409 `document_moved`, never an overwrite (ADR-0025 decision 7, note). The seed registers `demo-designer@example.edu` as `Administrator` and `Maintainer` of every branch, and `demo-reviewer@example.edu` with nothing. `app/.env.local` holds the `TERMINUS_*` variables, `ARMATURE_IDENTITY` and `ARMATURE_EXPORT_KEY`; the scripts read the same from the shell.
- **The connection profile** (since 2026-11-06): `instance` in `GET /discover`, what a person confirms before connecting (`ARMATURE_INSTANCE_NAME`; `ARMATURE_PUBLIC_URL`, read only under `oidc`, derived by the compose file; `program.releases`); a workspace hub's is its remote's, kept at the clone (`docs/desktop-program-plan.md` §8).
- **Export**: `GET /api/v1/export?branch=|ref=&profile=full|pseudonymous|institutional&slice=<name>` is the graph at a ref as one JSON-LD document with its reloadable schema (ADR-0031). There is no import route; re-import is operator work (ADR-0062).
- **Accepted, built in part**: the workspace hub (ADR-0065; its role, `remote_only`, the whole cycle is built: create, clone, push, bring in, deliver and remove (`DELETE /workspace/:name`, revision 2026-11-07; `?discard=<n>` since 2026-11-12), with `push.json`, the split rule and the remote's merge checked before it commits; every write to a workspace hub carries its per-launch secret `Armature-Local-Token`, drawn and printed at start unless `ARMATURE_LOCAL_TOKEN` chose it, 403 without (`localToken.ts`; ADR-0065 decision 7, built 2026-11-03); the three actions are routes under `/workspace/:name/` only under `ARMATURE_WORKSPACE_ACTIONS=routes`, for the compose profile and the suites, 403 `program_action` otherwise, the desktop core reaching them through a second app it never serves; since 2026-11-02 a clone holds snapshots at the older `asOf` commits its records name within `ARMATURE_SNAPSHOTS`, the branch's log, and forwards a read at any other commit to the remote when online, 404 `remote_needed` offline, remote commit identifiers resolved by `workspace/store.ts`), its file-backed store (ADR-0066, accepted 2026-11-02; built in part the same evening: `filestore/` behind the interface, the ids by check AI's formula, the patch, the lock, the two-store contract test; since 2026-11-02 night the one local store by ADR-0066 decision 4, so a workspace hub reads no `TERMINUS_*` variable and `ARMATURE_STORE` is retired; the Windows rehearsal run on a real machine 2026-11-03: a file the system refuses to read is 503 `store_unreadable` and the open is retried, a rename a sync client refuses is retried for about 2.5 s then 503 `store_unwritable`, the lock sweeps a killed write's temporary file, the synced-folder warning is the core's, `lib/desktop/folder.ts`), authentication beyond decisions 1, 3, 4, 5, 6, 7, 8, 9 and 10 and decision 2's hub side (ADR-0067: a workspace hub reaches a remote under `oidc` with the owner's token from its host, `hub.remoteToken`, `ARMATURE_REMOTE_TOKEN` in `server.ts`, the remote's `/users/me` checked against the owner, 403 `remote_identity`) and decision 7's `api.<site>` with the health probes `GET /health/live` and `/ready` (`routes/health.ts`); the program's sign-in is in its core since 2026-11-07 (`app/desktop.ts`, `app/lib/desktop/`; ADR-0069, notes), with the shell and its pages the same evening (`desktop/`); the release workflow and the updater since 2026-11-08, the release built without secrets and signed under a GitHub environment and the feed a fixed channel release since 2026-11-09 (`desktop-release.yml`, `desktop-channel.yml`), the Droplet run done 2026-11-09, `desktop-v0.1.0` tagged 2026-11-09 night and published 2026-11-11, `desktop-v0.1.1` released and installed through the channel the same day, `desktop-v0.1.2` that night. Authorization (ADR-0068) is built except the migration window's close. `docs/workspace-hub-plan.md` §14 is the build order; the ADRs' dated notes hold every later decision. Nothing changes for a client of the hub as built.
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
docker/                    # docker-compose.yml, Caddyfile (+ caddy/<resolver>.caddy), hub.Dockerfile, viewer.Dockerfile, operator-entrypoint.sh, rehearsal/ (Keycloak's realm); docs/deployment.md explains them
.github/workflows/ci.yml   # Lint, typecheck, drift check, context budgets, the hub bundle; the contract suite in three shards, each its own store container; the client install check; the browser test; both images; the file store's suites on Windows; documents alone run the first only (its header says which)
package.json               # The npm workspace root: app and packages/*
packages/types/            # @armature/types, GENERATED src/ (types.ts, schemas.ts); do not edit
packages/client/           # @armature/client, every route as a typed function; takes a fetch; install-check/ is CI's consumer test
scripts/                   # Outside the workspace: generate-types.js, generate-schema-appendix.js, load_schema.js (--clear-instances, --recreate),
                           #   seed_data.js (six commits; its header says what each adds), platform_checks.js (lettered probes; its header lists them), check_context_size.js
app/server.ts              # The hub's entry (.env.local, PORT, HOST loopback by default); what build:hub bundles
app/operator.ts            # The operator tools' command line: check, delete, put (ADR-0062); bundled, shipped in the hub image
app/desktop.ts             # The desktop program's core (ADR-0069): a workspace hub's host driven by JSON lines on stdin and stdout; build:desktop; its own command-line driver
desktop/                   # The shell (Tauri 2; ADR-0069), outside the npm workspace with its own lockfile: src-tauri/ (Rust: core.rs the sidecar's life, relay.rs what a page may ask, keychain.rs, tray.rs), src/ (the seven pages, through lib/backend.ts, a fake core in a browser), e2e/ (Playwright against the fake core), desktop.yml in CI, desktop-release.yml on a `desktop-v*` tag; desktop/README.md
app/app/                   # The viewer: page.tsx (modules), coverage/[moduleId], graph/ (the Design Graph, Focus page, Walkthrough; docs/graph-view-plan.md), connect/ (the desktop program's link), layout.tsx
app/e2e/                   # The browser smoke tests (Playwright): graph.spec.ts, connect.spec.ts; CI's viewer job
app/lib/viewer.ts          # The viewer's client of the hub (ARMATURE_HUB_URL; viewerToken.ts its credential under oidc); hub.ts starts the API on a port; envLocal.ts reads .env.local; workspaceFolder.ts is the host side of a workspace hub's folder (records, store files, the lock)
app/lib/graph/             # The Design Graph's pure modules (no React, no DOM), each tested; stages.ts is the visual language as data
app/lib/desktop/           # The desktop core's modules: protocol.ts (JSON lines, a reply as the route's), settings.ts (the file is the core's), folder.ts (the synced-folder warning), signIn.ts (PKCE on loopback), credential.ts (hub.remoteToken), core.ts (the requests)
app/lib/operator/          # check.ts (the engine over a whole branch), repair.ts (every repair a marked commit through a transient branch)
app/lib/api/               # The Armature API, the Hono app (app.ts, basePath /api/v1; never imports from next)
  config.ts, role.ts       #   HubConfig per request (createApp, storeFor), the only env reader; remote_only
  boundary.ts, version.ts  #   Then: Host and Origin checks (ADR-0067 d7); then negotiate: REVISIONS mirrors docs/client-changes.md, every route under a CAPABILITY (ADR-0059)
  store.ts                 #   The store adapter: the ONLY module that talks to TerminusDB; routes reach it by storeFor; a dropped read resent once, a write never
  queue.ts                 #   KeyedQueue, behind Store.exclusive, the per-branch write queue (ADR-0025 d7)
  identity.ts, oidc.ts, write.ts  # The resolver → a User on main (ADR-0032), Armature-Agent → the agent as author; the bearer token verified (ADR-0067 d1); the one write pipeline: shape → attestedBy → 409 → createdBy and asOf → invariants → one commit, the hub's trailer appended
  authorization.ts, grants.ts, trailers.ts  # Who may (ADR-0068 decision 4's table, 403); the hub's own grant writes and reads; the hub-written trailers, refused from clients
  http.ts, classes.ts, fragments.ts, errors.ts, memo.ts  # Conventions (?branch=|?ref=, ETag/If-Match); the class maps; parts by fragmentId; ApiError; reads kept by commit
  invariants/              #   The engine; index.ts maps each constraint number to its module
  intelligence/            #   coverage.ts (ADR-0029, computed on read), graph.ts (per-request cached reads at one ref)
  export/                  #   exporter.ts (slices, profiles, schema normalization), slices.json (a study's slice is an entry here)
  routes/                  #   documents, branches, users, intelligence, export, discover, workspace; docs/api.md is their reference
  filestore/               #   The file-backed store (ADR-0066): store.ts (one folder per branch: head.json, commits/<id>.json; the state at a commit replayed and kept in memory), ids.ts (Hash ids by check AI's formula from the store's own schema; Random and nested ids), patch.ts (TerminusDB's JSON patch, emitted and applied), files.ts (StoreFiles, what it asks of a folder; memory for tests), contract.test.ts (both stores on the seed, every read alike)
  workspace/               #   A workspace hub's clone (the one route-side use of the operator methods), its records (workspace.json, push.json, snapshots.json, log.json), its remote client, commits.ts (the local commits against the table), push.ts (replay, the commit table, recovery from the remote's log), merged.ts (a merge written here, a bring-in that did not finish settled from `bringingIn`), split.ts (the split rule), bringIn.ts (the remote's merges of main, the second use of the operator methods), snapshots.ts (the remote's state at each older asOf as an at.<commit> branch, the kept log; the third use) and store.ts (the Store on a workspace hub: remote commit identifiers resolved through the records, the snapshots and the remote)
  *.test.ts                #   The contract suite over app.request(): write (every constraint failing and passing), intelligence (both narratives), client, store, boundary, ...
app/vitest.config.mts      # '@' alias; reads .env.local; files run one at a time
docs/                      # how-armature-works.md (the explainer), desktop-program.md (the program's guide), api.md (the reference), schema-guide.md (for tool authors), client-changes.md (the revision list),
                           #   SCHEMA_APPENDIX.md (GENERATED), development-plan.md (§2 clients, §6 questions, §9 platform facts), deployment.md, research-path.md,
                           #   the plans (workspace-hub, desktop-program, graph-view, mcp-server, storyline-bridge, datashop-bridge, ledger, knowledge-components, lint, context-files), visual-language.md, demo-coverage.md,
                           #   the kept records with banners (armature-asks-from-Coqui.md, armature-deep-review-2026-10-30.md, armature-code-review-2026-11-09.md, demo-api.md RETIRED),
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

Also in the API: the list route refuses a filter on a `User` field of a class under `DesignRecord` (400 `person_filter_refused`, ADR-0021) and lists `Grant` by `user` (ADR-0068 decision 8); `Optional` and `Set` filters run in the hub (check Y). A merge is checked before it commits, on a transient branch, 422 with the target unchanged, with a dry run (ADR-0025 decision 5, note; built 2026-11-01).

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

The index with every status and a one-line summary of each is `schema/docs/adr/README.md`. Before working on the API or the schema, read these from it: ADR-0002 to ADR-0004 (references, junctions, back-references), ADR-0024 (identifiers and replace), ADR-0025 (the commit graph is the design history), ADR-0028 (attestation), ADR-0029 and ADR-0056 (coverage, nothing derived stored), ADR-0030 and ADR-0031 (external references, attachments, export), ADR-0032 (identity), ADR-0054 and ADR-0055 (the Hono app, one store adapter), ADR-0057 and ADR-0058 (`asOf`, item statistics as metrics), ADR-0059 (capability negotiation), ADR-0062 (operator repair outside the API), ADR-0065 to ADR-0068 (the workspace hub, its store, authentication, authorization; their dated notes hold the later decisions), ADR-0069 (the desktop program: a Tauri shell over the hub on a Node sidecar).

---

## Workflow

### Session startup
1. Read `SESSION.md` whole (it is under 32 KB) for the state and the next step
2. Check `git log` for recent commits
3. Read the files relevant to today's work
4. Read `HISTORY.md` only for a session or decision `SESSION.md` points at, or when no ADR or document says why something is as it is

### Tests
`npm test` in `app/` runs Vitest. The tests under `app/lib/api/` call the Hono app in-process against the TerminusDB container, which must be up with the seed loaded; they are the contract suite, which CI's `contract` job runs in three shards (`--shard=<n>/3`), each against its own service container after seeding and the operator's `check`. Files run one at a time (the store has one commit graph); the global setup warms a cold store first. A test that reads a document makes it code for CI: list it in `ci.yml`'s `changes` step, as `docs/client-changes.md` is. The Design Graph's modules are tested on a fixture and the seed; the pages in a browser by `app/e2e/graph.spec.ts` (`npm run test:e2e` after `build:hub` and `build`; CI's `viewer` job). **The rule:** a test is included unless it is very unlikely to show a real problem or very costly. The seed is a fixture the tests read (Module 1's sequences 1 and 2 are taken; two people are named; the designer holds the grants, the reviewer none). `authorization.test.ts` runs over a scratch database (its header says why), and every suite deletes its branches through the operator's `deleteScratchBranch`. Each test branch still leaves a revoked `Owner` grant on `main` (ADR-0068 decision 2), so a local `main` drifts from the seed; `TERMINUS_DB=<name> npm test` keeps a run off it, the shell winning over `.env.local`, once `load_schema.js --recreate` and `seed_data.js` have run with the same variable.

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
- **The context files keep their budgets** (this file 42 KB, `SESSION.md` 32 KB, `PROJECT_CONTEXT.md` 20 KB; `npm run check:context`, in CI): over budget means move, not shorten; a fact lives in one place and the rest point.

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
- **Don't** commit to a branch outside `Store.exclusive`, the hub's per-branch write queue: the store does not hold `If-Match` for writes in flight together (check AO). It is not reentrant, a branch's queue comes before `main`'s, and resolving a caller happens before it, since that can write to `main`; a workspace hub's bring-in, deliver, remove and clone hold their branch's queue throughout, and `queue.test.ts` lists every module that commits (ADR-0025 decision 7, notes of 2026-11-06 and 2026-11-11)
- **Don't** expose or call reset, squash or rebase; history is never rewritten, a mistake is undone by a new commit, a branch is deleted only when another holds its head (ADR-0025 decision 6); the one deletion of commits no branch holds is a workspace hub's discard of local commits never pushed, their number stated and their files set aside first (ADR-0065 decision 6, 2026-11-12). Repairs the rules prevent are operator work, still as commits (ADR-0062); never a bypass header, a raw query route, or `invariants: 'skip'` from a route (a test reads the API's modules for it)
- **Don't** take the commit author, `createdBy` or `attestedBy` from a request body; all three come from the resolved identity (constraint 15); `User` documents are created on `main` only (ADR-0032). The author may also be a registered agent named in `Armature-Agent`, acting for the caller (ADR-0067 decision 3, built), or a person a service relays under a `Relay` grant (decision 5, built); never anyone else
- **Don't** add an import route or any write that bypasses the pipeline; reproducing an export is operator work through the adapter's operator-side methods (ADR-0031 decision 4, ADR-0062), the one exception a workspace hub's clone of its own remote (`workspace/clone.ts`)
- **Don't** put bytes in the graph; an image, a file or an asset tree is an `Attachment` reference with a content hash and, for a versioned store, a revision (ADR-0030)
- **Don't** store a derived value in the graph; coverage, alignment and any score are reads at a ref (ADR-0056); a judgment on record is a `DesignFinding` or an `Attestation` (ADR-0028); a measurement is a `LearningMetric` with a `subject` (ADR-0058)
- **Don't** use the store's `POST overwrite=true`, which merges values into a list rather than replacing (check X3a); the upsert is `PUT create=true` over a list
- **Don't** claim a reference's class is schema-enforced; the store checks existence only (check L), the engine checks class (constraint 0)
- **Don't** leave an API constraint undocumented; if the store cannot enforce it, the schema comment says the API will
