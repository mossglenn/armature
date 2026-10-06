# Armature Development Plan

**Date:** 2026-10-05 · **Status:** Proposed plan for the next phase of development. Supersedes the
"What's Next" section of `.claude/SESSION.md` once adopted.

**What this rests on:** the position paper (`docs/positionpaper/`), the CoQui handoff
(`docs/armature-asks-from-Coqui.md`), ADRs 0001 to 0023, `schema/schema.json` at commit `f4d7110`,
and the Next.js routes in `app/`. The repository review that produced it found the gaps the CoQui
handoff describes to be accurate, plus a handful of defects and documentation drift listed in
Phase 0. Platform assumptions were checked against the TerminusDB v12.0.7 documentation and the
client source on 2026-10-05; §9 lists what was confirmed and what was corrected.

**The governing tension:** CoQui is the only client and was built partly to discover what clients
need. Its asks are the best evidence available. But a hub shaped to fit one client is a backend,
not infrastructure. This plan treats every CoQui ask as a hypothesis about what *tools in general*
need, tests it against the position paper's principles and a set of reference clients, and adopts
the generic capability rather than the specific request wherever the two differ.

---

## 1. Principles the plan is built on

Each principle is taken from the position paper and restated as a constraint on the hub. The
letter codes are used throughout the rest of the document.

**P1. Design data is artifacts, named relations, and process data.** The paper defines design data
as "a structured, queryable, versioned record" with three parts: artifacts, meaningfully named
relations that express decisions, and the history of how both changed. The schema already models
the first two well. The third is almost entirely unexposed. *Constraint:* every phase must leave
history more inspectable than it found it, not just the current state.

**P2. Armature is infrastructure, not a tool.** "Armature is not an app or a service, but a
framework." Tools adopt it because they solve a designer's workflow problem; the graph fills as a
byproduct. *Constraint:* the hub provides storage, identity, history, constraints and intelligence.
Workflow, UI, import and export formats stay in plugins. ADR-0010, ADR-0018 §5 and ADR-0020 §2
already say this; the plan enforces it at the API design level.

**P3. Version control modeled on Git.** Immutable history, branches for parallel work, merges
"inscribed with its author, the time, and the reason for the change." *Constraint:* the API must
expose commits, branches and history as first-class concepts. This is the paper's largest promise
and the repository's largest gap. One reconciliation is needed: the paper describes a
"new version of" *relation* between artifact versions, while TerminusDB keeps one document per id
and versions it inside the commit graph. The plan resolves this in ADR-0025 (Phase 2): design
process data lives in the commit graph, the commit message carries the reason, and the API renders
it as if it were the relation the paper describes. No "new version of" edge is added to the schema.
The store also supplies more of the paper's promise than the CoQui handoff assumed: TerminusDB v12
performs a three-way merge with field-level conflict detection and never resolves a conflict
silently (§9). What Armature adds is policy and shape, not the merge itself.

**P4. Design intelligence comes from structure, not AI.** Coverage gaps, redundant items, the needs
evidence behind an objective, Bloom's mismatches: "None of this requires AI. It requires
structured data." *Constraint:* the hub owns these computations and exposes them as read endpoints
any tool can call. Plugins do not each reimplement coverage.

**P5. AI is a collaborator subject to the same review.** AI contributions are "reviewable,
auditable, and reversible regardless of their source," and the paper's research questions ask
whether AI-proposed, human-accepted artifacts are as reliable as human-authored ones.
*Constraint:* provenance must be able to distinguish agent from person without a schema change
later. ADR-0015 already allows system-agent `User` documents. The plan keeps that door open and
does not add proposal or acceptance fields until a second signal appears.

**P6. Complement standards by reference.** CASE competencies, QTI representations, xAPI
statements: Armature "references these standards without duplicating them." *Constraint:*
artifacts need an optional, typed slot for external identifiers. Nothing in the schema has one.

**P7. Two adoption paths, one graph.** Tool-first for designers; data-first for learning
scientists who need "only the relevant slice of the graph" with "a constrained graph schema."
*Constraint:* the schema must be sliceable, the export must be open and comparable across
institutions, and nothing may require a full deployment to produce useful data.

**P8. From craft to engineering, without surveillance.** Research is conducted at the level of
process, not person (ADR-0021). *Constraint:* no route exposes a per-person aggregate, and the
boundary is enforced in the hub because it is the only place it can be.

**P9. Progressive formalization (ADR-0010).** Free text stays free text until usage shows what
structure is warranted. *Constraint:* when a client proposes structured vocabulary, the hub adopts
the minimal generic form and lets the client carry its own vocabulary in a reference string.

---

## 2. Reference clients: the test for every ask

To avoid shaping the hub for CoQui, the plan names six plausible tools the paper implies or the
project has discussed. They are not commitments to build anything. They are a checklist: an ask is
adopted into the hub when at least two reference clients would need the same capability.

| Reference client | What it does | What it needs from the hub |
|---|---|---|
| **CoQui** (real) | SME review of assessment items in rounds | Read by id at a commit; branch per round; replace-by-id writes; findings; attestations on item parts; users; history |
| **Objective and curriculum mapper** | Author objectives, prerequisites, module declarations; link to CASE competencies | Transitive prerequisite queries; objective history and impact analysis; external competency references; ModuleObjective writes with coverage recompute |
| **Needs-analysis intake** | Record evidence, needs, priorities; the LEED-tracker decision log as a graph | Evidence and need writes; NeedEvidenceLink confidence; DesignNote and a future DesignDecision; provenance trace from objective back to evidence |
| **Activity and strategy designer** | Plan activities and groups per module; see strategy coverage | Sequenced module content (ADR-0005); "which objectives have no Practice activity" queries; ActivityGroup flatness enforced |
| **Outcomes importer** | Pull results from an LMS, DataShop or Torus; close the loop (Narrative 1) | LearningDataset and LearningMetric writes; item statistic write-back; xAPI and QTI references; bulk atomic writes |
| **Research exporter** | Produce comparable, anonymized design-data corpora across courses | Schema slices; JSON-LD export at a commit; export profiles with pseudonymization (ADR-0021); schema self-description |
| **AI design assistant** | Propose items, objectives or alignments inside another tool | Agent `User` provenance; design-intelligence reads for context; the same write path and constraints as humans |

**Applying the test to CoQui's asks.** The table below is the heart of the plan's answer to
"how do we not over-fit."

| CoQui ask | Second client that needs it | Generic form adopted | Not adopted |
|---|---|---|---|
| `GET /items/:id` with commit | Every client | Read any document by id at any ref, returning the ref | An item-only route |
| Branch from `main` at a commit | Curriculum mapper (proposals), AI assistant (sandbox) | Branch create, list, read; writes accept a branch | Round semantics, who may write a branch |
| Replace item by client-supplied id | Outcomes importer (idempotent loads), needs intake | Client-supplied `@id` on any artifact, replace semantics, 409 on type mismatch (ADR-0024) | CoQui's id formats |
| Embedded options with `fragmentId` | AI assistant (item generation), any item tool | ADR-0022 and ADR-0023 as written; `fragmentId` as a *pattern* for any artifact with embedded parts | Nothing withheld |
| `DesignFinding` and `DesignNote` on a branch | Curriculum mapper (objective flagged by three items) | ADR-0020 as written | A fourth status; CoQui's withdrawal vocabulary |
| `Attestation` with grid, claim lineage, claim version | Curriculum mapper (SME affirms alignment), AI assistant (human accepts proposal) | Verdict by a `User` about a claim regarding a target plus optional fragment, as of a commit (ADR-0028) | `grid`, `claimVersion` as named fields; they travel in `claimRef` |
| Users: read and create | Every client | `GET /users`, `POST /users`, identity resolution hook (ADR-0032) | Reviewer roles |
| Item history and changed-since | Outcomes importer (what changed since last pull), research exporter | Per-document history and branch diff for any type | Nothing withheld |
| `assesses` optional while Draft | None yet; CoQui withdrew it | Not adopted | Keep `@min_cardinality: 1` |
| Merge with per-document conflict report | Curriculum mapper eventually | Deferred until a second writer exists (Phase 2 records the design) | Nothing yet |

Three CoQui concepts never enter the hub: the **round**, the **craft grid**, and CoQui's
**review workflow states**. Each is workflow vocabulary (P2). They map onto branches, claim
references and `ItemStatus` at CoQui's boundary, exactly as ADR-0018 §5 prescribes.

---

## 3. Target shape of the hub

The current API is nine routes written one at a time. The target is five layers, each with a
single responsibility, so that adding a type or a client does not mean adding routes.

```
Plugins (CoQui, future tools)
        │  typed client package, generated from schema.json
        ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. Design-intelligence reads   coverage · alignment · trace ·  │
│                                impact · redundancy (later)     │
├───────────────────────────────────────────────────────────────┤
│ 3. Invariants engine           per-type validators ·           │
│                                recompute hooks · run on every  │
│                                write regardless of route       │
├───────────────────────────────────────────────────────────────┤
│ 2. Core document API           read at ref · list with filter  │
│                                and paging · put by id ·        │
│                                history · diff · branches       │
├───────────────────────────────────────────────────────────────┤
│ 1. Identity and provenance     User resolution · agent users · │
│                                commit author and reason        │
└───────────────────────────────────────────────────────────────┘
        │  per-request client bound to one branch or commit
        ▼
TerminusDB
```

**Decisions this shape implies, each recorded as an ADR in Phase 0 or the phase that builds it:**

- **Generic before specific.** Layer 2 is type-agnostic: `/api/v1/documents/:type/:id` style
  routes, not one handler per type. Type-specific behaviour lives in layer 3 as validators and
  recompute hooks keyed by `@type`. The existing per-type routes become thin aliases or are
  retired. This is what lets a generic `PUT` still enforce ADR-0006 constraints.
- **Every request names its ref.** The module-level client singleton in `app/lib/terminusdb.ts`
  holds branch state in the instance. A per-request factory (the client's `copy()` then
  `checkout()` or `ref()`) replaces it. Reads return the commit they were served from. Writes
  return the commit they created and accept the client's last-seen data version for optimistic
  concurrency, which the client already supports.
- **The commit is the unit of process data (P3).** Every write carries an author and a reason.
  The reason is the commit message. A `DesignNote` is optional elaboration, not the primary
  record of why something changed. One platform fact shapes the write layer: the JavaScript
  client sets the commit author from its own connection credentials and offers no override, so
  every commit it makes is authored "admin". The HTTP document API takes `author` and `message`
  as query parameters. The hub therefore issues document writes over HTTP directly, with the
  resolved Armature `User` as author, and keeps the client for everything else. SESSION.md's
  "JS client retained over raw HTTP" decision is narrowed to reads and version-control calls.
- **Next.js stays the host for now.** PROJECT_CONTEXT's "separate API service" is reaffirmed as
  the long-term goal and the Next.js routes are declared the API for this phase, under a
  versioned prefix so moving hosts later is a deployment change, not a client change.
- **The schema describes itself.** `@metadata.armature.category` on every class; a `GET /schema`
  route; generated types and a typed client derived from the same file. Tools discover types
  from the hub, not from a hand-maintained list.

---

## 4. Phases

Each phase lists its goal, the principles it serves, the work, the ADRs, an exit criterion, and
what CoQui's outbox plan receives from it. Session estimates assume sessions like those in
`SESSION.md`.

### Phase 0: Ground truth (1 session)

**Goal.** Make the repository say true things about itself before building on it.
**Serves:** P2 (a credible infrastructure project), and every later phase.

Work:
- [ ] Fix `app/app/api/coverage/[moduleId]/route.ts`: status `5000`, three debug logs, error
      handling not routed through `handleTerminusError`, one round trip per objective.
- [ ] Reconcile documents: README setup section (Python loader "coming soon"); SESSION.md counts
      ("15 ADRs", "24 document types") and its `Response` mentions; CLAUDE.md stack line
      ("Express or Fastify"); `docs/demo-api.md` coverage response shape and item shape.
- [ ] Add CI: a GitHub Actions workflow running `npm run lint` and `npm run check:types` in
      `app/`. CLAUDE.md currently claims the drift check runs in CI; make it true.
- [ ] Pin the store and update the client. `docker/docker-compose.yml` uses the `latest` tag;
      pin `terminusdb/terminusdb-server:v12.0.7`, which is the build the local container already
      runs. Replace `@terminusdb/terminusdb-client@12.0.0` in `app/` and `scripts/` with the
      renamed `terminusdb@12.0.5` package, which is the same client under its current name and
      ships TypeScript types. Confirm the server-side `TERMINUSDB_ADMIN_PASS` and the credentials
      in `app/.env.local` agree: on 2026-10-05 the running container rejected the values in that
      file, so the app cannot currently connect.
- [ ] Write **ADR-0026: API host and route versioning**. Next.js routes are the API for this
      phase under `/api/v1`; separate service remains the destination; what would trigger the
      move.
- [ ] Add a "Reference clients" section to `.claude/PROJECT_CONTEXT.md` with the table from §2,
      and the two-client test as a rule in CLAUDE.md's Development Principles.
- [x] Vendor the TerminusDB documentation reproducibly. Done 2026-10-06:
      `scripts/sync-terminusdb-docs.js` pulls the Markdoc sources from the public
      `dfrnt-labs/terminusdb-docs-static` repository, converts them, commits fifty curated pages
      under `docs/vendor/terminusdb/` with `INDEX.md` and `VERSION.json`, and the
      `.claude/skills/terminusdb` skill tells future sessions which page answers what and when to
      trust the client source or the running store over the docs. Remove the superseded hand copy
      `docs/terminusdb-schema-doc.md` as part of the document reconciliation above.

Exit: CI green on `main`; no document in the repo contradicts another about the stack or the
schema's contents.

### Phase 1: Schema catch-up (2 to 3 sessions)

**Goal.** Land every accepted or proposed ADR that the schema does not yet reflect, so that the
schema file is again the single source of truth it claims to be.
**Serves:** P1 (relations and parts modeled correctly), P9 (the item shape follows real usage).

Work:
- [ ] **ADR-0022 and ADR-0023 in `schema.json`.** Remove `Response`. Add `ItemOption` as a
      `@subdocument` with `fragmentId`, `text`, `isCorrect`, optional `feedback`, optional
      `purpose`. Add `stem` as a subdocument with `fragmentId` and `text`; `correctFeedback` and
      `incorrectFeedback` as optional item-level fields with their own `fragmentId`. Use CoQui's
      shape because it is the only observed one, but document each field's purpose in schema
      terms, not CoQui's. Subdocuments must declare `@key` of type `Random` or `ValueHash`; use
      `Random`, since `ValueHash` would change an option's identity when its text changes, the
      defect ADR-0016 diagnosed. Subdocument IRIs nest under the parent and cannot be referenced
      from other documents, which is why `fragmentId` exists (ADR-0023). The v12.0.6 `@shared`
      annotation was considered and rejected: options are never shared across items (ADR-0022).
      Verify on the running store whether subdocuments return inline by default or need the
      `unfold` read parameter (the ADR-0013 gating discipline).
- [ ] **Decide reload versus migration for removing `Response`.** TerminusDB v12 has a schema
      migration endpoint with `DeleteClass`, `CreateClassProperty`, `ChangeKey` and a dry-run
      mode that rewrites instance data with the schema. At demo scale a reload of the seed is
      simpler, but the ADR should record that the migration path exists for any deployment that
      holds real data. Note that `Cardinality` is deprecated in v12 in favour of `Set` with
      `@min_cardinality`, which is what the schema already uses.
- [ ] **Generator support for subdocuments.** `scripts/generate-types.js` maps class references
      to `string`; subdocument references must inline the type. Same change in
      `generate-schema-appendix.js`.
- [ ] **ADR-0017 to Accepted and implemented.** Run its three verification checks first
      (four-level inheritance, `@metadata` survival, empty abstract root). Add `DesignRecord`;
      retype `DesignNote.subject`.
- [ ] **ADR-0027: Schema self-description.** `@metadata.armature.category` on every class
      (`artifact`, `relationship`, `infrastructure`); generator derives `JUNCTION_IDS` and
      `CLASS_ORDER` sections from it; the hand-maintained constants are deleted. This is the
      change CoQui's toolkit notes call the highest-leverage one.
- [ ] **ADR-0018 to Accepted and implemented.** `AssessmentItem.status: ItemStatus`, required;
      `ItemInstance.status` documentation narrowed.
- [ ] **ADR-0020 to Accepted and implemented.** `DesignFinding`, `FindingStatus`.
- [ ] **ADR-0024: Client-supplied identifiers.** Accept `@id` on first write for any artifact;
      later writes under the same id are replacements; a write whose id exists under a different
      `@type` is rejected with 409; the hub never deletes a plugin-written document on a
      plugin's behalf (status changes replace deletion). Retire the seed script's slug convention
      or redeclare it as a client choice. Closes ADR-0016 decision 5 and ADR-0023's open
      question. Record the ADR-0016 rule that keys never include mutable fields as still binding.
- [ ] **Seed data rewrite.** Items with real option text and fragment ids; varied `status` values
      so Phase 4's coverage story has something to show; one `DesignFinding`; one `DesignNote`
      on a junction document to prove ADR-0017 works.
- [ ] Regenerate `types.ts` and `SCHEMA_APPENDIX.md`; commit with the schema.

Exit: `schema.json`, the ADR index, the seed, and the generated files agree. ADRs 0017, 0018,
0020, 0022, 0023, 0024, 0027 are Accepted and implemented. ADR-0019 stays Proposed.

CoQui receives: the target item shape its PR 3 types file is written against, and the id rules
its outbox depends on.

### Phase 2: The version-control model (2 to 3 sessions)

**Goal.** Make the paper's "collaboration and version control" section true at the API.
**Serves:** P3 directly; P1 (process data becomes inspectable); P8 (author on every commit).

Work:
- [ ] **ADR-0025: Design process data lives in the commit graph.** States the reconciliation in
      §1 P3. Decides: no `version`, `createdAt` or "new version of" fields (confirms ADR-0010);
      every write names an author and a reason; the reason is the commit message; branches are
      the unit of parallel work; reads are always at a named ref; what "immutable" means when
      the store replaces in place (every prior state is readable at its commit, forever). Records
      the merge model: TerminusDB's `apply` endpoint is a three-way merge with field-level
      conflict detection that returns a conflict report (document, field, `@before`,
      `@after_left`, `@after_right`) and never resolves silently; `rebase` replays commits
      instead. The hub wraps `apply` as its merge, surfaces the store's conflict report in the
      plugin's terms, and owns the policy questions the store does not answer: who may merge,
      and whether some document types merge without approval (CoQui's O-P). Change requests
      exist only as an unmaintained dashboard feature, so a review workflow above the merge is
      hub or plugin product work.
- [ ] **Per-request client and an HTTP write path.** Replace the singleton with
      `getClient({ branch?, ref? })`. Every handler receives it. Document writes go over the HTTP
      document API with `author` and `message` set from the resolved identity (see §3). The
      `TerminusDB-Data-Version` header is returned on reads and forwarded on writes when the
      caller supplies it; without it the server retries a write up to three times if the branch
      head moved, so two blind writers both succeed and the last one wins.
- [ ] **Branch routes.** `POST /api/v1/branches` (name, from a branch head or a commit; the
      store's `origin` accepts a commit path and the client builds one when `ref()` is set),
      `GET /api/v1/branches`, `GET /api/v1/branches/:name` (head commit), `DELETE` reserved.
- [ ] **Merge route.** `POST /api/v1/branches/:name/merge` wrapping `apply` with author and
      reason; on conflict, return 409 with the store's witnesses mapped to document ids and
      fields. Per-type merge filtering and a conflict view are not built here; the route makes
      the paper's merge promise true and gives the deferred questions something concrete to be
      about.
- [ ] **Read at ref.** All document reads accept `?branch=` or `?ref=`; the response carries the
      commit it was read at. Reads at a commit use the store's `local/commit/<id>` path, which is
      read-only by construction.
- [ ] **History routes.** `GET /api/v1/documents/:type/:id/history` wrapping the store's history
      endpoint, including its `diff=true` option (added in v12.0.5) so each commit carries the
      structural change it made. `GET /api/v1/branches/:name/changes?since=<commit>` wrapping a
      branch diff between two data versions with no document filter, which yields the changed
      document ids.
- [ ] **Diff route.** `GET /api/v1/documents/:type/:id/diff?from=<commit>&to=<commit>` returning
      the store's diff. List fields diff positionally in the store, so fragment-aware diffing
      stays in the plugin, as CoQui concluded.

Exit: a scripted walkthrough creates a branch from a commit, writes to it as a named author,
reads the same document at two commits, lists its history with diffs, merges the branch, and
provokes one conflict, without touching the TerminusDB API directly.

CoQui receives: asks 1, 2 and 6, and the merge its PR 6 was deferred for.

### Phase 3: Generic writes and the invariants engine (2 to 3 sessions)

**Goal.** One write path for every type, with every ADR-0006 constraint enforced on it.
**Serves:** P2 (constraints are infrastructure), P4 (computed fields stay correct), P5 (one write
path for humans and agents alike).

Work:
- [ ] **`PUT /api/v1/documents/:type/:id`** with replace semantics per ADR-0024, on a branch,
      with author and reason required. The store's `PUT` with `create=true` is an upsert and its
      `POST` rejects an existing id unless told to overwrite, so both halves of ADR-0024 map to
      native behaviour; the hub adds only the type check that turns "id exists under another
      type" into a 409. **`POST /api/v1/documents`** accepting a list for atomic multi-document
      writes (the `POST /needs` case becomes a client composition, not a special route); the
      store's `@capture` and `@ref` let one batch reference ids it mints in the same request.
- [ ] **Invariants registry** in `app/lib/invariants/`: one module per type exporting
      `validate(doc, ctx)` and `afterWrite(doc, ctx)`. The seven constraints in CLAUDE.md move
      here, plus: `fragmentId` uniqueness within an item (ADR-0023); dismissal requires rationale
      (ADR-0020); a placement may not be Approved ahead of its item (ADR-0018); ActivityGroup
      flatness; sequence uniqueness across the shared module namespace (ADR-0005). Validators
      read the branch they are writing to, never `main` by default.
- [ ] **Recompute hooks.** `afterWrite` for `AssessmentItem`, `ItemInstance`, `ModuleObjective`
      calls the coverage recompute from Phase 4 (stubbed until then).
- [ ] **Users.** `GET /api/v1/users`, `POST /api/v1/users`, and **ADR-0032: Identity
      resolution**, implementing ADR-0015's boundary with a pluggable resolver: a trusted header
      for local and demo use, OIDC later. `createdBy` and the commit author are set by the hub
      from the resolved identity, never from the body. Agent users are ordinary `User` documents
      with a documented naming convention.
- [ ] Retire or alias the per-type routes. Keep `createGetHandler` only if it survives as the
      alias layer.

Exit: every constraint in CLAUDE.md has a failing test and a passing test against the running
store. The old per-type POST routes are gone or delegate.

CoQui receives: asks 3, 4 and 5.

### Phase 4: Design intelligence (2 to 3 sessions)

**Goal.** Deliver the paper's §4 as read endpoints, starting with the four the paper names for a
quiz tool.
**Serves:** P4 directly; it is also the demo payoff for both narratives in PROJECT_CONTEXT.

Work:
- [ ] **ADR-0029: Coverage algorithm.** Defines the verdict: `Uncovered` is zero eligible items,
      `PartiallyAssessed` is one, `FullyAssessed` is two or more, `OverAssessed` is above a
      threshold stored on the module or defaulted. Adopts ADR-0019's eligibility rule (Approved
      only for `coverageStatus`; non-Retired for `projectedCoverageStatus`) and promotes ADR-0019
      to Accepted. Records that the thresholds are provisional (P9) and where usage will
      inform them.
- [ ] **`recomputeCoverage(moduleId | objectiveId, ctx)`** wired into Phase 3's hooks. Coverage
      stops being hand-seeded.
- [ ] **`GET /api/v1/intelligence/coverage/:moduleId`** replacing the current route, returning
      the summary block `demo-api.md` promised, both coverage figures, and the items behind each.
- [ ] **`GET /api/v1/intelligence/alignment`**: items whose `bloomsLevel` is below an objective
      they assess; objectives with no item or activity at their level.
- [ ] **`GET /api/v1/intelligence/trace/:type/:id`**: the provenance chain. From an item to its
      objectives, their needs, and the evidence with confidence; from a dataset or metric back
      to items (Narrative 1).
- [ ] **`GET /api/v1/intelligence/impact/:type/:id`**: what should be reviewed if this document
      changes. Items, activities, module declarations and prerequisites that reference it.
      This is the paper's "if an objective changes, you can immediately see what needs to be
      reviewed."
- [ ] Redundancy detection ("a new item is redundant in the bank") is recorded as a future
      endpoint; it needs text similarity and is not structural. Deferred with a note.
- [ ] A first read-only Coverage View page in the app, as SESSION.md intended, consuming the
      intelligence route.

Exit: both PROJECT_CONTEXT narratives can be walked through on seed data using only intelligence
routes.

CoQui receives: the coverage and alignment reads its Narrative 2 integration needs; nothing it
asked for, which is the point. This phase exists for every client.

### Phase 5: Review vocabulary: findings and attestations (1 to 2 sessions)

**Goal.** Give the hub a minimal, tool-neutral way to record that someone judged an artifact, so
"how those alignments were established and whether they have since changed" is answerable.
**Serves:** P1 (a judgment is a relation with properties), P5 (human and agent judgments look
alike), P8 (non-aggregation enforced).

Work:
- [ ] **ADR-0028: Attestation.** A `User` affirms or declines a claim about a target. Fields:
      `subject: DesignRecord`; `fragmentId?`; `claimText`; `claimRef?` (an opaque, plugin-scoped
      identifier for the claim's lineage; CoQui puts its grid and claim version here);
      `verdict: AttestationVerdict` (`Affirmed`, `Declined`); `reason?`; `asOf` (the commit of
      the subject attested); `attestedBy: User`. Key: Hash over `subject`, `fragmentId`,
      `claimRef`, `attestedBy`, so "the latest live attestation per claim per reviewer" is a
      store guarantee, not an API lookup. Staleness is derived from commits since `asOf`, not
      stored. The ADR states the compound-target pattern from ADR-0023 §5 as the general rule
      for any future part-level type.
- [ ] **Non-aggregation guard (ADR-0021).** The generic list route refuses `attestedBy` and
      `createdBy` as filter keys, and the ADR records why this one restriction lives in the
      generic layer.
- [ ] `DesignFinding` and `Attestation` validators in the invariants registry.
- [ ] Seed one attestation so the trace route can show "affirmed by an expert at <institution>
      as of commit X, two revisions ago."

Exit: an attestation written on a branch at commit A is reported stale after a write at commit B
touches the same fragment, without the plugin computing anything.

CoQui receives: ask 4's attestation half, and the type its outbox is holding rows for.

### Phase 6: Ecosystem and the research path (2 sessions)

**Goal.** Make the paper's §5 and §6 structurally possible: external standards by reference,
and data-first adoption by learning scientists.
**Serves:** P6, P7, P8.

Work:
- [ ] **ADR-0030: External references.** An optional `externalRefs: Set<ExternalRef>`
      subdocument on `ArmatureDocument` with `system` (an enum seeded with `CASE`, `QTI`,
      `xAPI`, `LTI`, `Other`) and `identifier` (URI or string). Nothing is duplicated; the graph
      points outward. This is deliberately the minimum P9 permits.
- [ ] **ADR-0031: Export profiles and schema slices.** A `GET /api/v1/export?ref=&profile=`
      route producing JSON-LD (the store's native shape) for the whole graph or a declared
      slice. The documentation lists Turtle and RDF/XML content negotiation under enterprise
      pages; verify on the open-source build before promising any format beyond JSON and
      JSON-LD. Profiles: `full`, `pseudonymous` (stable tokens for `User`), `institutional`
      (institution only, per ADR-0021's cheapest option). Slices are declared as lists of
      classes in a small JSON file, so the needs-to-objectives-to-outcomes slice the paper
      describes is a configuration, not code.
- [ ] **Outcomes import path.** `LearningDataset`, `LearningMetric` and item statistic
      write-back through the generic write route, with an invariant for `producedBy` when the
      assessment is Armature's. Seed one dataset so Narrative 1 is live end to end.
- [ ] A short `docs/research-path.md` describing how a scientist would stand up a constrained
      Armature for one study: which slice, which profile, what the collection instrument writes.

Exit: an export at a commit, re-imported into an empty database, reproduces the graph; the
pseudonymous profile contains no `displayName` or `email`.

### Phase 7: Toolkit and deployment (2 sessions)

**Goal.** Make the boundary real for a second client and put a hub where stakeholders can reach
it.
**Serves:** P2 (tools-first needs a toolkit), the demo environment in PROJECT_CONTEXT.

Work:
- [ ] Move generated types into a workspace package (`packages/types`), published or consumable
      by git reference; the generator writes there and `check:types` still guards drift.
- [ ] A thin typed client (`packages/client`): fetch wrappers over the v1 routes, branch and ref
      parameters, data-version handling, and `handleTerminusError`'s mapping behind the
      boundary. CoQui's `httpHub` becomes a consumer of it, not a reimplementation.
- [ ] **Contract test owned by Armature.** A test suite that starts TerminusDB as a CI service
      container, loads the schema, seeds, and exercises every v1 route and every invariant.
      CoQui's planned `armature:check` becomes a second opinion, not the only one.
- [ ] Containerize the app; a compose file that runs store and hub together; deploy one hosted
      instance for the public demo so CoQui's recorded hub is a fallback rather than the source.
- [ ] `docs/schema-guide.md` written at last, from the reference-client perspective: what a tool
      author needs to know to write and read the graph.

Exit: a developer with the repo, Docker and the client package can write a new plugin without
reading TerminusDB documentation.

---

## 5. ADR queue

| ADR | Title | Phase | Notes |
|---|---|---|---|
| 0017 | DesignRecord abstract root | 1 | Promote to Accepted after verification |
| 0018 | Item readiness on AssessmentItem | 1 | Promote to Accepted |
| 0019 | Coverage accounts for readiness | 4 | Promote with 0029 |
| 0020 | DesignFinding | 1 | Promote to Accepted |
| 0022, 0023 | Embedded parts, fragmentId | 1 | Already Accepted; implement |
| 0024 | Client-supplied identifiers | 1 | Resolves 0016 decision 5 and 0023's open question |
| 0025 | Design process data lives in the commit graph | 2 | Reconciles the paper's model with the store |
| 0026 | API host and route versioning | 0 | Resolves the PROJECT_CONTEXT contradiction |
| 0027 | Schema self-description via `@metadata` | 1 | Replaces `JUNCTION_IDS` |
| 0028 | Attestation | 5 | Generic form of CoQui's proposal |
| 0029 | Coverage algorithm | 4 | Closes PROJECT_CONTEXT's open question |
| 0030 | External references | 6 | P6 |
| 0031 | Export profiles and schema slices | 6 | P7, P8; implements ADR-0021's deferred section |
| 0032 | Identity resolution | 3 | Implements ADR-0015's boundary |

ADR-0021 (non-goal) and ADR-0010 (deferrals) are amended where phases touch them rather than
superseded.

---

## 6. Questions to decide deliberately, not by default

These are not in any phase. Each should become an ADR when evidence arrives, and the plan names
what evidence would be enough.

- **Merge policy.** The store's three-way merge lands in Phase 2; what remains open is policy:
  who may merge a branch, whether findings and attestations merge without approval (CoQui's
  O-P), which needs a per-type filtered merge the store does not offer, and where a
  fragment-by-fragment conflict view lives. Evidence: a second writer on any branch, or the
  first real conflict report from CoQui's PR 6.
- **Project boundaries.** One TerminusDB database per course, per program, or per institution?
  Cross-database queries do not exist, and the research path wants comparability across
  courses. Evidence: a second course in any deployment, or the first research slice.
- **AI provenance beyond `createdBy`.** Whether an AI-proposed, human-accepted artifact needs
  `proposedBy` and `acceptedBy`, or whether an `Attestation` with an agent `attestedBy` already
  covers it. Evidence: the AI design assistant reference client becoming real, or a research
  question that needs the distinction.
- **Fragment ids beyond items.** Activities with steps, objectives with components, rubrics with
  criteria. ADR-0023's pattern generalizes; the plan does not apply it anywhere else until a
  tool needs it.
- **DesignDecision as a structured type.** ADR-0010's intended second layer over `DesignNote`.
  Evidence: `DesignNote.category` usage showing recurring structure, or a needs-analysis tool
  modelling the LEED tracker's columns.
- **A fourth `DesignFinding` status.** CoQui stretches `Dismissed` to cover a reviewer's own
  withdrawal. Evidence: a second tool needing the distinction (ADR-0018 §5's test).
- **Separate API service.** When Phase 7's container and client package exist, the move is
  mechanical. Evidence: a plugin that cannot or should not depend on a Next.js deployment, or
  the hosted demo needing independent scaling.

---

## 7. Sequencing against CoQui's outbox plan

| CoQui PR | Needs from Armature | Available after |
|---|---|---|
| 2 `feat/outcomes` | Nothing; in words only | Now |
| 3 `feat/armature-hub` | The target item shape, id rules, `DesignFinding`, `AssessmentItem.status` as schema facts | Phase 1 |
| 4 `feat/review-round` | Nothing from the hub; CoQui's own outbox | Now |
| 5 `feat/armature-http` | Read at ref, branches, `PUT` by id, users, history | Phases 2 and 3; attestations after Phase 5 |
| 6 `feat/armature-merge` | Merge with a conflict report | Phase 2 for the merge and the store's conflict report; per-type filtering stays open (§6) |

CoQui's `armature:check` can begin printing accepted and refused asks as soon as Phase 2 lands;
Armature's own contract test in Phase 7 is the durable version of the same check. The CoQui
handoff's statement that TerminusDB "has no three-way merge with markers" is out of date for
v12 and should be corrected on CoQui's side when PR 6 is picked up.

---

## 8. What the plan declines to do

Recorded so the decisions are inherited rather than rediscovered.

- No CoQui vocabulary in the schema: no round, grid, claim version, workflow state, or reviewer
  role. They map onto branches, `claimRef`, `ItemStatus` and `User` at CoQui's boundary.
- No per-type write routes once the generic path exists. Type behaviour is a validator, not a
  handler.
- No "new version of" relation, `version` field, or timestamp fields. The commit graph is the
  record (ADR-0010, ADR-0025).
- No per-person aggregate, filter or endpoint, anywhere (ADR-0021).
- No merge *policy* beyond the store's own conflict detection until a second writer exists. The
  merge route itself is cheap and lands in Phase 2.
- No reimplementation of what the store provides: history, diff, patch, time-travel, merge and
  optimistic concurrency are wrapped, not rebuilt.
- No structured replacement for any free-text rationale field without usage evidence (ADR-0010).
- No import or export *format* work beyond JSON-LD. QTI, CASE and xAPI are referenced, not
  implemented; translating to them is plugin work.

---

## 9. Platform facts this plan relies on

Checked on 2026-10-05 against the TerminusDB documentation at terminusdb.org (topics: version
control, schema, documents, diff and patch, collaboration, access control, installation), the
server release notes for v12.0.0 to v12.0.7, and the installed client source. Items marked
*corrected* contradict something written earlier in this repository or in the CoQui handoff.
The same pages are now vendored under `docs/vendor/terminusdb/` (see `VERSION.json` for the
pinned docs commit and release), so future checks can diff rather than re-read.

**Versions**
- Server: v12.0.7, released 2026-08-10. The local container runs the `v12` tag built that day,
  so it is current. Compose should pin `v12.0.7` rather than `latest`.
- Client: the npm package was renamed from `@terminusdb/terminusdb-client` to `terminusdb` at
  12.0.3; current is 12.0.5 with bundled TypeScript types. The repo has 12.0.0 of the old name in
  both `app/` and `scripts/`. Same API surface; the rename is the only migration.

**Version control** (Phase 2)
- Branch creation accepts an `origin` that is a branch head *or* a commit path
  (`org/db/local/commit/<id>`); the client uses the commit when `ref()` is set.
- Reads at a commit use the `local/commit/<id>` path and are read-only.
- *Corrected:* `apply` is a three-way merge with field-level conflict detection. A conflict is
  reported per document and field with `@before`, `@after_left` and `@after_right`, and the merge
  is rejected rather than resolved. `rebase` replays commits and requires a shared ancestor.
  Earlier statements that TerminusDB lacks a three-way merge (CoQui handoff §4, and the first
  draft of this plan) were wrong for v12.
- Document history: `/api/history/<path>?id=<doc>&diff=true` returns the commits that touched one
  document, with author, message, identifier, timestamp, and since v12.0.5 the structural diff.
- Diff: `/api/diff` takes two data versions (branch names or commit ids) and an optional document
  id; list fields diff positionally (`CopyList`, `SwapList`).
- Patch: applying a patch whose `@before` no longer matches returns 409 with `api:PatchError` and
  `api:witnesses`. This is the behaviour CoQui's handoff relied on.
- Change requests are an unmaintained dashboard feature, not an API.
- Reset and squash exist; reset moves the head and keeps commits.

**Writes, identity and concurrency** (Phases 2 and 3)
- *Corrected:* the JavaScript client sets `author` from its connection user and provides no
  override on any write method. The HTTP document API accepts `author` and `message` query
  parameters on `POST`, `PUT` and `DELETE`. Writes that must carry an Armature `User` as author go
  over HTTP.
- `POST` inserts and errors on an existing id unless `overwrite=true`; `PUT` replaces and errors
  on a missing id unless `create=true` (upsert). `@capture` and `@ref` allow intra-batch
  references.
- `TerminusDB-Data-Version` is returned on every operation and accepted on writes for optimistic
  concurrency. Independently, the server retries a transaction up to three times when the branch
  head moved during it (`TERMINUSDB_SERVER_MAX_TRANSACTION_RETRIES`), so concurrent writers do not
  fail unless they pass a data version.
- Access control is role-based at organization and database scope. No per-branch permissions
  exist, and only basic authentication is documented for self-hosted use. Branch write
  exclusivity is therefore a hub convention, as the CoQui handoff assumed.

**Schema** (Phase 1)
- `@subdocument` classes must use `@key` `Random` or `ValueHash`; their IRIs nest under the
  parent; they cannot be retrieved, updated or referenced independently.
- `@shared` (v12.0.6) is a regular document with reference-counted cascade deletion. Not needed
  by this plan.
- `@metadata` accepts arbitrary JSON; the documentation recommends nesting it one level deep,
  which is the `@metadata.armature.*` shape ADR-0017 and ADR-0027 use. A `ReplaceClassMetadata`
  migration operation exists.
- `@inherits` forms a DAG; multiple inheritance is allowed when shared properties agree; key
  strategies are not inherited.
- `Cardinality` is deprecated in favour of `Set` with `@min_cardinality` and `@max_cardinality`.
  The schema already follows this.
- `@documentation` may be a list of language-tagged objects, as the schema already does.
- A schema migration endpoint (`/api/migration/<path>`, with `dry_run`) rewrites instance data
  alongside the schema: `DeleteClass`, `CreateClassProperty` with defaults, `CastClassProperty`,
  `ChangeKey`, `MoveClass`, `ExpandEnum` and others. Weakening changes (new optional fields, new
  classes) need no migration.
- `@unfoldable` and field-level `@unfold` expand linked documents on read with cycle detection.
  Worth evaluating for the trace route in Phase 4 before writing custom joins.

**Documents API** (Phases 2 to 4)
- `GET` supports `type`, `id`, `ids`, `skip`, `count`, `as_list`, `unfold`, `minimized`, and a
  template `query` sent via `X-HTTP-Method-Override: GET`. The client exposes `skip`, `count` and
  `query`.
- Turtle and RDF/XML content negotiation appear under enterprise-labelled pages; treat JSON and
  JSON-LD as the guaranteed export formats until verified.
