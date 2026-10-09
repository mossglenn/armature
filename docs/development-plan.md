# Armature Development Plan

**Date:** 2026-10-05 · **Status:** Adopted; the project's roadmap. Phases 0 to 4 are done (7 and 8
October 2026, pull requests #1 to #10); next is the decision on ADR-0057 and Phase 5.
`.claude/SESSION.md` tracks day-to-day state against this plan. **Last reconciled with the code:**
2026-10-08.

**How to read this plan.** §1 states nine principles (P1 to P9) taken from the position paper;
later sections cite them by label. §2 names the reference clients and the two-client test that
keeps the hub from overfitting to its first client. §3 describes the target architecture. §4 is the
phases, each with its work, decision records and exit criterion; completed items are checked, and
items that were built and then reversed are struck through with the reason. §5 is the queue of
decision records, §6 the questions deliberately left open, §8 what the plan declines to do, and §9
the database behaviors the plan relies on, each verified. Abbreviations used throughout: ADR
(Architecture Decision Record, in `schema/docs/adr/`), API (application programming interface), SME
(subject-matter expert), LMS (learning management system), CI (continuous integration), CASE
(Competencies and Academic Standards Exchange), QTI (Question and Test Interoperability), xAPI
(Experience API), LTI (Learning Tools Interoperability), JSON-LD (JSON for Linked Data), WOQL
(TerminusDB's query language). For a narrative account of the same material, see
`docs/how-armature-works.md`.

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
the first two well. The third is almost entirely unexposed. Artifacts include complex learning
objects such as simulations, whose bytes and development history will live outside the graph;
the hub must be able to name an exact revision of such an object and the reason it changed.
*Constraint:* every phase must leave history more inspectable than it found it, not just the
current state, and nothing may assume an artifact is a single document or a single file.

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

To avoid shaping the hub for CoQui, the plan names eight plausible tools the paper implies or the
project has discussed, beside CoQui. They are not commitments to build anything. They are a checklist: an ask is
adopted into the hub when at least two reference clients would need the same capability.

| Reference client | What it does | What it needs from the hub |
|---|---|---|
| **CoQui** (real) | SME review of assessment items in rounds | Read by id at a commit; branch per round; replace-by-id writes; findings; attestations on item parts; users; history |
| **Objective and curriculum mapper** | Author objectives, prerequisites, module declarations; link to CASE competencies | Transitive prerequisite queries; objective history and impact analysis; external competency references; ModuleObjective writes; coverage reads |
| **Needs-analysis intake** | Record evidence, needs, priorities; the LEED-tracker decision log as a graph | Evidence and need writes; NeedEvidenceLink confidence; DesignNote and a future DesignDecision; provenance trace from objective back to evidence |
| **Activity and strategy designer** | Plan activities and groups per module; see strategy coverage | Sequenced module content (ADR-0005); "which objectives have no Practice activity" queries; ActivityGroup flatness enforced |
| **Outcomes importer** | Pull results from an LMS, DataShop or Torus; close the loop (Narrative 1) | LearningDataset and LearningMetric writes; item statistics (stored or computed: see §6); xAPI and QTI references; bulk atomic writes |
| **Research exporter** | Produce comparable, anonymized design-data corpora across courses | Schema slices; JSON-LD export at a commit; export profiles with pseudonymization (ADR-0021); schema self-description; attachments resolvable or deliberately excluded per profile |
| **AI design assistant** | Propose items, objectives or alignments inside another tool | Agent `User` provenance; design-intelligence reads for context; the same write path and constraints as humans |
| **Rich item authoring tool** | Author drag-and-drop, hotspot and media-bearing items on a shared item bank | Items as a tree of addressable fragments, typed or generic; attachment references on fragments; interaction types with versioned renderers; impact analysis when a renderer or an image changes; the same review surface CoQui uses |
| **Complex learning object designer** (distant) | Develop simulations and other multi-file learning objects, with their own asset store or the hub's | References to a revision of an asset tree, with hash and reason; impact analysis when an asset revision moves; attestations and findings against a revision; the asset store's history reachable, not replayed |

Three of these need **binary attachments** today or soon: the needs-analysis intake tool
(evidence documents), CoQui (item media, eventually), and the outcomes importer (raw dataset
exports). The last row needs **versioned asset references**, and is the reason the reference
shape is versioned-tree-capable from the start. See the note below the CoQui table.

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
| Merge with per-document conflict report | Curriculum mapper eventually | The store's three-way merge, wrapped with a computed base and a three-value conflict report (built in Phase 2); merge *policy* deferred until a second writer exists (§6) | Per-type filtered merge |

Three CoQui concepts never enter the hub: the **round**, the **craft grid**, and CoQui's
**review workflow states**. Each is workflow vocabulary (P2). They map onto branches, claim
references and `ItemStatus` at CoQui's boundary, exactly as ADR-0018 §5 prescribes.

**A need no single client raised: binary attachments and externally versioned assets.** Applying
the same test to the reference clients surfaces a capability CoQui has not asked for but three
clients would need: a place for files that are not graph documents. The needs-analysis intake
tool holds evidence documents (survey instruments, interview transcripts, PDFs). CoQui will
eventually hold item media (an image in a stem, an audio prompt). The outcomes importer holds raw
dataset exports. Three clients pass the test, so the capability belongs in the hub.

The near-term files are write-once. The paper's scope is not. Design process data is "the record
of how artifacts and relations changed over time," and the artifacts Armature expects to describe
include complex learning objects such as simulations: trees of large binaries, edited in place by
several people over many revisions, built by a future tool that may well carry its own asset
store. The reference shape must therefore address a **revision of a tree**, not only a single
immutable file, and it must do so for stores the hub does not operate. If it cannot, a simulation
authoring tool would need a schema and API redo on arrival.

The shape follows from the position paper and PROJECT_CONTEXT, which both say Armature is not a
content repository: the graph holds a **reference** carrying a content hash and, where the source
is versioned, the revision coordinate, so the graph can name an exact state of the asset and
detect a missing or altered one. The bytes and their fine-grained history live in a
content-addressed store behind the Armature API, or in a store the tool manages. The graph never
embeds blobs, and the backend is a deployment choice, not a schema fact. The reference shape is
decided in Phase 6 (ADR-0030); the hub-managed backend is an open question (§6).

What crosses from an asset store into the graph follows the lesson CoQui taught about review
exhaust: a **projection, not a replay**. The graph records the coordinates that matter to design
(the revision a module was built against, the revision a reviewer attested, the revision whose
change prompted a finding), each in a graph commit carrying the author and the reason. The full
revision log stays in the asset store, reachable through the reference. A tool that can do so
writes the graph commit id into its own revision message, so the two histories cross-reference
each other without either duplicating the other.

---

## 3. Target shape of the hub

When this plan was written, the API was eleven routes written one at a time (eight list reads, a
coverage read and two writes; Phase 3 retired them). The target is five layers, each with a
single responsibility, so that adding a type or a client does not mean adding routes. As of Phase
4, layers 1 to 4 exist; the typed client package is Phase 7.

```
Plugins (CoQui, future tools)
        │  typed client package, generated from schema.json
        ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. Design-intelligence reads   coverage · alignment · trace ·  │
│                                impact · redundancy (later)     │
├───────────────────────────────────────────────────────────────┤
│ 3. Invariants engine           per-type validators · run on    │
│                                every write regardless of route │
│                                (no recompute: ADR-0056)        │
├───────────────────────────────────────────────────────────────┤
│ 2. Core document API           read at ref · list with filter  │
│                                and paging · put by id ·        │
│                                history · diff · branches       │
├───────────────────────────────────────────────────────────────┤
│ 1. Identity and provenance     User resolution · agent users · │
│                                commit author and reason        │
└───────────────────────────────────────────────────────────────┘
        │  per-request HTTP store adapter bound to one branch or commit (ADR-0055)
        ▼
TerminusDB
```

**Decisions this shape implies, each recorded as an ADR in Phase 0 or the phase that builds it:**

- **Generic before specific.** Layer 2 is type-agnostic: `/api/v1/documents/:type/:id` style
  routes, not one handler per type. Type-specific behavior lives in layer 3 as validators keyed
  by `@type`. *(Done in Phase 3: the per-type routes were retired, not aliased; the recompute hooks
  first planned here were removed by ADR-0056, since nothing derived is stored.)* This is what lets
  a generic `PUT` still enforce the constraints the store cannot (ADR-0006, ADR-0013, and the
  invariants engine).
- **Every request names its ref.** The module-level client singleton in `app/lib/terminusdb.ts`
  held branch state in the instance (deleted in Phase 3). A per-request HTTP store adapter (ADR-0055), created from
  the resolved ref and identity and holding no other state, replaces it. Reads return the commit
  they were served from. Writes return the commit they created and accept the caller's last-seen
  data version for optimistic concurrency.
- **The commit is the unit of process data (P3).** Every write carries an author and a reason.
  The reason is the commit message. A `DesignNote` is optional elaboration, not the primary
  record of why something changed. One platform fact shapes the write layer: the JavaScript
  client sets the commit author from its own connection credentials and offers no override, so
  every commit it makes is authored "admin". The HTTP document API takes `author` and `message`
  as query parameters. That fact, with the others recorded in ADR-0055 (instance state that leaks
  across calls, flattened errors, a client that lags the server), is why the API layer reaches the
  store only through its HTTP adapter, with the resolved Armature `User` as author on every write.
  The JavaScript client stays in `scripts/`. This supersedes SESSION.md's earlier "JS client
  retained over raw HTTP" decision and the narrowing of it that this bullet previously recorded.
- **Next.js stays the host for now; the API is a Hono app.** PROJECT_CONTEXT's "separate API
  service" is reaffirmed as the long-term goal (ADR-0026). The API itself is a Hono application in
  `app/lib/api/` that imports nothing from Next.js; a single catch-all route mounts it under the
  versioned prefix (ADR-0054, accepted 2026-10-07 after a six-check spike). Moving hosts later is
  a deployment change plus a build configuration that resolves the `@/` alias, never a handler
  change. Every route Phases 2 to 6 add is a Hono route; the legacy Next.js handlers die in
  Phase 3.
- **The schema describes itself.** `@metadata.armature.category` on every class (done, ADR-0027);
  a `GET /schema` route (not yet built, and no phase currently owns it; see §6); generated types
  (done) and a typed client (Phase 7) derived from the same file. Tools discover types
  from the hub, not from a hand-maintained list.

### Rich artifacts: four layers with different homes

CoQui can review any item in the graph, however it got there, because three things hold for a
text item: its design structure is in the graph in a shape CoQui did not define; every part has a
stable address (item id plus `fragmentId`) CoQui did not mint; and everything that is not
structure is reachable. None of these depend on the parts being text. The complexity of richer
items comes from content, behavior and structure separating: an image separates content from
structure; drag-and-drop separates behavior from both; an animation library or a simulation
gives behavior its own development history. Each step adds a layer. None changes the three
requirements. The hub keeps them true by giving each layer a different home.

**Structure lives in the graph, always.** For drag-and-drop: instruction text, draggables, drop
zones, the correct mapping, the objectives assessed. For a simulation: the manifest of scenarios,
parameters and what each measures. Structure is what design intelligence reads and what every
tool needs to interoperate. Underneath the typed shapes sits a **generic part model**: an item is
a tree of fragments, each with a `fragmentId`, a `kind`, and inline text, an attachment reference,
or both. Multiple-choice options are a typed specialization carrying `isCorrect`; a new item type
begins as generic fragments with a validated JSON payload (TerminusDB's `sys:JSON` subdocument is
stored but not schema-checked) and is promoted to typed subdocuments once its shape settles. This
is ADR-0010's progressive formalization applied to item types. A review tool that has never seen
drag-and-drop still sees a tree of addressable parts with text and images, which is enough to
review against and attach findings to. (ADR-0033.)

**Content lives in a store, referenced from a fragment.** The `fragmentId` identifies the slot;
the attachment reference identifies what fills it. Replacing an image is an ordinary graph write:
the reference inside the item changes, the commit carries author and reason, a `DesignNote` can
elaborate. Because the reference is inside the item document, the item's commit changes when the
image does, so attestation staleness works for images with no new mechanism. The presign path on
the attachment endpoints is how a reviewer sees it. (ADR-0030.)

**Behavior is a property of the item type, not the item, and is a versioned artifact of its
own.** Drag-and-drop logic is shared by every drag-and-drop item; what varies per item is data.
So an item declares "an instance of interaction type X at version N" and carries only data. The
graph holds the registry entry, an `InteractionType` with its version, the data shape it expects,
and an attachment reference to its renderer at a revision; the renderer's code is a developed
asset in an asset store. This is the H5P model (content JSON plus a versioned library) and the
QTI Portable Custom Interaction model (a contract between item data and interaction code), and
it lets Armature reference those ecosystems rather than reinvent them. Three consequences: a
renderer change is an impact-analysis event across every item of that type; a review tool
renders an unfamiliar item by loading the registered renderer in a sandboxed frame, falling back
to the generic fragment tree; and the hub **never serves executable content from a graph
document**. Code reaches a tool only through a registered, hashed, versioned reference loaded
under a content security policy. The eight values of today's `ItemType` enum become the built-in
interaction types. (ADR-0034.)

**Rationale stays where it is**: commits with author and reason, design notes, findings,
attestations. Richer items force one addition: notes and findings need the compound target
(document plus `fragmentId`) that ADR-0023 §5 reserved for attestations, because "why did we
replace this image" points at a part, not an item. (Folded into ADR-0028.)

The simulation case then differs in scale, not in kind. It is an activity whose structure is a
manifest in the graph, whose content and behavior are an asset tree referenced at a revision,
and whose rationale is the commits that moved the reference plus the notes on them. The asset
store keeps the development history; the graph keeps the projection designers and researchers
need.

**The exhaust test, restated for rich artifacts.** A reviewer's comment on an image is exhaust
and stays in the tool. The decision to replace the image, and why, is data: a reference move in
a graph commit with a reason. A hundred renderer commits are exhaust kept in the asset store. The
decision to adopt renderer version 3 for a module's items, and why, is data. The graph records
state transitions a designer chose and could explain; everything else is reachable, not
replicated.

**What Phase 1 must not do**: make `ItemOption` the only way an item can have parts. The typed
option list lands as planned, but as a specialization of a fragment, so that the generic model
can sit beside it without a second migration.

---

## 4. Phases

Each phase lists its goal, the principles it serves, the work, the ADRs, an exit criterion, and
what CoQui's outbox plan receives from it. Session estimates assume sessions like those in
`SESSION.md`.

### Phase 0: Ground truth (1 session) — done 2026-10-07, PR #1

**Goal.** Make the repository say true things about itself before building on it.
**Serves:** P2 (a credible infrastructure project), and every later phase.

Work:
- [x] Fix `app/app/api/coverage/[moduleId]/route.ts`: status `5000`, three debug logs, error
      handling not routed through `handleTerminusError`, one round trip per objective.
- [x] Reconcile documents: README setup section (Python loader "coming soon"); SESSION.md counts
      ("15 ADRs", "24 document types") and its `Response` mentions; CLAUDE.md stack line
      ("Express or Fastify"); `docs/demo-api.md` coverage response shape and item shape.
- [x] Add CI: a GitHub Actions workflow running `npm run lint` and `npm run check:types` in
      `app/`. CLAUDE.md currently claims the drift check runs in CI; make it true.
- [x] Pin the store and update the client. `docker/docker-compose.yml` uses the `latest` tag;
      pin `terminusdb/terminusdb-server:v12.0.7`, which is the build the local container already
      runs. Replace `@terminusdb/terminusdb-client@12.0.0` in `app/` and `scripts/` with the
      renamed `terminusdb@12.0.5` package, which is the same client under its current name and
      ships TypeScript types. Confirm the server-side `TERMINUSDB_ADMIN_PASS` and the credentials
      in `app/.env.local` agree: on 2026-10-05 the running container rejected the values in that
      file, so the app cannot currently connect.
- [x] Write **ADR-0026: API host and route versioning**. Next.js routes are the API for this
      phase under `/api/v1`; separate service remains the destination; what would trigger the
      move.
- [x] Add a "Reference clients" section to `.claude/PROJECT_CONTEXT.md` with the table from §2,
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

### Phase 1: Schema catch-up (2 to 3 sessions) — done 2026-10-07

**Goal.** Land every accepted or proposed ADR that the schema does not yet reflect, so that the
schema file is again the single source of truth it claims to be.
**Serves:** P1 (relations and parts modeled correctly), P9 (the item shape follows real usage).

Work:
- [x] **ADR-0022 and ADR-0023 in `schema.json`.** Remove `Response`. Add `ItemOption` as a
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
      `unfold` read parameter (the ADR-0013 gating discipline). Model `ItemOption` as a
      specialization of an abstract `Fragment` subdocument (`fragmentId`, `kind`, optional
      `text`, optional attachment) so that §3's generic part model and the `sys:JSON` payload for
      new item types can sit beside typed options later without re-keying anything. Verify first
      that a `List` of subdocuments accepts subtypes polymorphically on the running store; if it
      does not, record the fallback (one list per kind) in ADR-0033 before landing the shape.
- [x] **Decide reload versus migration for removing `Response`.** TerminusDB v12 has a schema
      migration endpoint with `DeleteClass`, `CreateClassProperty`, `ChangeKey` and a dry-run
      mode that rewrites instance data with the schema. At demo scale a reload of the seed is
      simpler, but the ADR should record that the migration path exists for any deployment that
      holds real data. Note that `Cardinality` is deprecated in v12 in favor of `Set` with
      `@min_cardinality`, which is what the schema already uses.
- [x] **Generator support for subdocuments.** `scripts/generate-types.js` maps class references
      to `string`; subdocument references must inline the type. Same change in
      `generate-schema-appendix.js`.
- [x] **ADR-0017 to Accepted and implemented.** Run its three verification checks first
      (four-level inheritance, `@metadata` survival, empty abstract root). Add `DesignRecord`;
      retype `DesignNote.subject`.
- [x] **ADR-0027: Schema self-description.** `@metadata.armature.category` on every class
      (`artifact`, `relationship`, `infrastructure`); generator derives `JUNCTION_IDS` and
      `CLASS_ORDER` sections from it; the hand-maintained constants are deleted. This is the
      change CoQui's toolkit notes call the highest-leverage one.
- [x] **ADR-0018 to Accepted and implemented.** `AssessmentItem.status: ItemStatus`, required;
      `ItemInstance.status` documentation narrowed.
- [x] **ADR-0020 to Accepted and implemented.** `DesignFinding`, `FindingStatus`.
- [x] **ADR-0024: Client-supplied identifiers.** Accept `@id` on first write for any artifact;
      later writes under the same id are replacements; a write whose id exists under a different
      `@type` is rejected with 409; the hub never deletes a plugin-written document on a
      plugin's behalf (status changes replace deletion). Retire the seed script's slug convention
      or redeclare it as a client choice. Closes ADR-0016 decision 5 and ADR-0023's open
      question. Record the ADR-0016 rule that keys never include mutable fields as still binding.
- [x] **Seed data rewrite.** Items with real option text and fragment ids; varied `status` values
      so Phase 4's coverage story has something to show; one `DesignFinding`; one `DesignNote`
      on a junction document to prove ADR-0017 works.
- [x] Regenerate `types.ts` and `SCHEMA_APPENDIX.md`; commit with the schema.

Exit: `schema.json`, the ADR index, the seed, and the generated files agree. ADRs 0017, 0018,
0020, 0022, 0023, 0024, 0027 are Accepted and implemented. ADR-0019 stays Proposed.

CoQui receives: the target item shape its PR 3 types file is written against, and the id rules
its outbox depends on.

### Phase 2: The version-control model (2 to 3 sessions) — done 2026-10-08, PR #5

**Goal.** Make the paper's "collaboration and version control" section true at the API.
**Serves:** P3 directly; P1 (process data becomes inspectable); P8 (author on every commit).

Work:
- [x] **ADR-0025: Design process data lives in the commit graph.** Accepted 2026-10-08 on
      platform checks M to T. Decides: no `version`, `createdAt`, `updatedAt` or "new version of"
      fields (ADR-0010 amended); every write is a commit whose author is the resolved `User` id
      and whose reason is a required message, carried in a JSON envelope; branches are the unit
      of parallel work; reads are at a named ref (`branch` or `ref`); history, changes and diff
      are read routes over the store; the hub wraps `apply` as a three-way merge with a computed
      base and returns 409 with the witnesses plus the source value on conflict; shared history
      is never rewritten (no reset, squash or rebase exposed or called); `/api/v1` exposes the
      bare commit id as `ETag` and accepts `If-Match` (412 when stale). Corrections to the
      merge facts previously recorded here are in §9. Who may merge and per-type merge
      filtering stay open (§6). Interim identity: an `Armature-User` header carrying a `User`
      id, replaced by ADR-0032's resolver in Phase 3.
- [x] **Routes are Hono routes.** `app/lib/api/routes/documents.ts` and `routes/branches.ts`,
      mounted by `app.ts`. The concurrency token is handled by shared helpers in
      `app/lib/api/http.ts` (`ifMatchFrom`, `setEtag`) rather than middleware, because the commit
      a response carries is known only after the store call; the effect is the same.
- [x] **Decide the shape of the data-version token.** Decided in ADR-0025 decision 7: `/api/v1`
      exposes the bare commit id in `ETag` on every response that touched the store and accepts
      `If-Match` on writes; the adapter translates to and from the store's `branch:<id>` token and
      maps `api:DataVersionMismatch` to 412. The store's header never appears in the contract.
- [x] **ADR-0055: the API layer reaches the store over HTTP.** Accepted 2026-10-08 on a reading
      of the installed client source. One `fetch`-based adapter under `app/lib/api/` owns URL
      construction, credentials, `author` and `message`, the data-version header and typed error
      parsing; the JavaScript client stays in `scripts/` and may re-enter the API layer only to
      build WOQL JSON. The two behaviors it relies on that §9 did not yet record have their
      checks: the stale data-version error body (M5) and `diff=true` on history (N2).
- [x] **Per-request store adapter and the write path (ADR-0055).** `app/lib/api/store.ts`:
      `createStore(ref)` per request; `getDocument`, `putDocument` (author, message, If-Match),
      `log`, `head`, `getCommit`, `history`, `diff`, `listBranches`, `createBranch`,
      `deleteBranch`, `apply`. Typed `StoreError` carries the server's `@type`; `app.onError`
      matches on it. Identity in `app/lib/api/identity.ts`, interim in Phase 2 (`Armature-User`
      header naming a `User`), replaced by ADR-0032's resolver in Phase 3. A provisional
      `PUT /api/v1/documents/:type/:id` exists so the walkthrough can write; Phase 3 wraps it in
      the invariants engine.
- [x] **Branch routes.** `POST /api/v1/branches` (`{ name, from: { branch } | { commit } }`,
      201 with the head), `GET /api/v1/branches` (names with heads), `GET /api/v1/branches/:name`
      (head commit). `DELETE /api/v1/branches/:name` decided in Phase 3 (ADR-0025 decision 6,
      amended 2026-10-08): never `main`, and only when another branch holds the head, else 409
      `unmerged_branch`; tests still delete their unmerged scratch branches through the adapter.
- [x] **Merge route.** `POST /api/v1/branches/:name/merge` with `{ message, from }`: computes the
      merge base from the logs and the merge commits' metadata, calls `apply`, returns the merge
      commit or `upToDate: true`; on conflict 409 `merge_conflict` with `{ id, field, base,
      target, source }` per witness, the source value read from the source head. Per-type merge
      filtering and a conflict view are not built here.
- [x] **Read at ref.** `GET /api/v1/documents/:type/:id?branch=|ref=`; `ETag` is the commit. A
      caller-supplied commit id is checked against the commit graph first, because the store
      answers a read at a non-existent commit with a 500 (check U).
- [x] **History routes.** `GET /api/v1/documents/:type/:id/history?branch=&start=&count=&diff=`
      returning `{ commit, author, message, timestamp, diff }` per entry, newest first.
      `GET /api/v1/branches/:name/changes?since=<commit>` returning `{ id, op }` per changed
      document (`insert`, `delete`, `update`).
- [x] **Diff route.** `GET /api/v1/documents/:type/:id/diff?from=<commit>&to=<commit>` returning
      the store's structural diff. List fields diff positionally in the store, so fragment-aware
      diffing stays in the plugin, as CoQui concluded.

Exit: a scripted walkthrough creates a branch from a commit, writes to it as a named author,
reads the same document at two commits, lists its history with diffs, merges the branch, and
provokes one conflict, without touching the TerminusDB API directly. **Met on 2026-10-08:** the
walkthrough is the second `describe` block of `app/lib/api/app.test.ts`, run with `npm test`
against the container; it works on scratch branches and leaves `main` untouched.

CoQui receives: asks 1, 2 and 6, and the merge its PR 6 was deferred for.

### Phase 3: Generic writes and the invariants engine (2 to 3 sessions) — done 2026-10-08, PR #7

**Goal.** One write path for every type, with every ADR-0006 constraint enforced on it.
**Serves:** P2 (constraints are infrastructure), P5 (one write path for humans and agents alike).
(As first written this also served "P4: computed fields stay correct"; ADR-0056 removed the
computed fields.)

Work:
- [x] **`PUT /api/v1/documents/:type/:id` and `POST /api/v1/documents`** (2026-10-08), one
      pipeline in `app/lib/api/write.ts`. Both are the store's `PUT` with `create=true` over a
      list (checks X1, X2b, X5): Hash-keyed junctions need no `@id`, `@capture` and `@ref` work
      within the list, the response carries the written ids, and the list fails together. The
      store's `POST overwrite=true` turned out to merge triples rather than replace (X3a), so the
      hub never uses it. An existing document is found by `@id`, or for a Hash-keyed class by its
      key fields (X1c), so a replace is recognized either way; an id held by another type is a
      409 before the store sees it. `GET /api/v1/documents/:type?field=value&count=&skip=` lists
      with filters from the template query (W1).
- [x] **Invariants engine** in `app/lib/api/invariants/` (under the API directory, since it is
      host-neutral API code): `index.ts` holds the write context, the validator registry and the
      422 `invariant_violation` response carrying every violation; `references.ts` is constraint
      0 for every type, walking into subdocuments; one module per constrained type
      (`assessmentItem`, `itemInstance`, `moduleContent`, `designFinding`). Validators see the
      whole batch and read the branch being written. Shape is the generated Zod schemas'
      job (400 `invalid_document`); `@min_cardinality` becomes `.min(n)`, so constraints 1 and 2
      are shape. Flatness is constraint 0's doing. Every CLAUDE.md constraint has a failing and
      a passing test in `app/lib/api/write.test.ts`.
- [x] ~~**Recompute hooks.** `afterWrite` for `AssessmentItem`, `ItemInstance`, `ModuleObjective`
      in `invariants/recompute.ts` names the affected modules; Phase 4 gives it a body.~~
      **Removed in Phase 4 by ADR-0056:** coverage is computed on read; `recompute.ts` is gone.
- [x] **Users and ADR-0032: Identity resolution** (accepted 2026-10-08, PR #7).
      `app/lib/api/identity.ts`: a pluggable resolver chosen by `ARMATURE_IDENTITY` (`header`
      now, carrying the caller's `externalId`; `oidc` named for later) yields claims; the hub
      resolves them to a `User` on `main`, the registry of record, by template query (check W1),
      registering one there on first encounter when the claims carry a `displayName`. The commit
      author and `createdBy` come from the resolved `User`, never from the body: set on create,
      preserved on replace. A write on a branch that lacks the `User` carries `main`'s copy in
      the same commit (W3b); identical copies merge clean (W2). `GET /api/v1/users`,
      `GET /api/v1/users/me`, `POST /api/v1/users` (main only; 409 `user_exists`). Agent users
      are `User` documents with an `agent:` `externalId`, registered by a person. The generator
      emits `CLASS_ANCESTORS` so the hub knows which classes carry `createdBy`; the same map
      serves constraint 0. The merge route reports the `InsertConflict` witness (W2d).
- [x] Identity resolution and request validation are functions the write routes call rather
      than middleware, because both depend on the ref the route resolved; the TerminusDB error
      mapping lives in the app's `onError` (ADR-0054 decision 4), which now also maps the store's
      id-prefix refusal to 400. Zod request schemas are emitted by `scripts/generate-types.js`
      into `app/lib/schemas.ts` from `schema.json`, strict objects with `@min_cardinality` as
      `.min(n)`, enums from the same `VALID_*` arrays, and references as an id or `{ "@ref" }`;
      `check:types` covers both outputs. The generator also emits the schema as data,
      `CLASS_KEY` and `CLASS_FIELDS`, which the pipeline and the reference check read.
- [x] Retired the per-type routes, `app/lib/terminusdb.ts`, `app/lib/routeHelpers.ts` and
      `app/lib/validate.ts` (2026-10-08); the `terminusdb` client package left `app/`. Nothing
      aliases them: the list route covers the eight GET routes, the write path covers the two
      POST routes, and coverage became the Phase 4 intelligence read.

Exit (met 2026-10-08): every constraint in CLAUDE.md has a failing test and a passing test
against the running store (`app/lib/api/write.test.ts`). The old per-type routes are gone.
`DELETE /api/v1/branches/:name` is decided and built: a branch goes only when another branch
holds its head, because a deletion is the one mutation the store records nowhere (ADR-0025
decision 6, amended).

CoQui receives: asks 3, 4 and 5.

### Phase 4: Design intelligence (2 to 3 sessions) — done 2026-10-08, PRs #8 to #10

**Goal.** Deliver the paper's §4 as read endpoints, starting with the four the paper names for a
quiz tool.
**Serves:** P4 directly; it is also the demo payoff for both narratives in PROJECT_CONTEXT.

Work:
- [x] **ADR-0029: Coverage algorithm** (decisions 1 to 3 accepted 2026-10-08; 4 to 6 superseded
      by ADR-0056 the same day). Defines the verdict: `Uncovered` is zero eligible items,
      `PartiallyAssessed` is one, `FullyAssessed` is two to four, `OverAssessed` is five or more.
      These are the default thresholds (`DEFAULT_THRESHOLDS` in `app/lib/api/intelligence/coverage.ts`),
      which the coverage read takes as query parameters (`fullyAssessedAt`, `overAssessedAbove`);
      no module field until two clients need modules to differ. Counts distinct items placed in the
      module's assessments, not the bank. Adopts ADR-0019's eligibility rule as the read's two
      figures (delivered: Approved items in Approved placements; projected: nothing Retired) and
      promotes ADR-0019 to Accepted. The thresholds are provisional (P9); the ADR says what would
      revise them.
- [x] ~~`deriveCoverage(ctx)` in the write pipeline~~ **Reversed the same day by ADR-0056.** Built
      first as a pre-commit recompute with the fields declared computed in the schema metadata,
      then a merge-route recompute with a resolution path for conflicts on the computed fields
      alone (platform check Z). Weighing that machinery showed the stored field was the mistake:
      a verdict is a reading of the structure, not a design fact, and a derived value in a
      versioned graph conflicts on merge without any disagreement behind it. `coverageStatus`,
      `projectedCoverageStatus` and the `CoverageStatus` enum left the schema; coverage is
      computed by the read at any ref, with the counts returned and the thresholds as parameters.
      Coverage stops being seeded at all.
- [x] **`GET /api/v1/intelligence/coverage/:moduleId`** (2026-10-08), returning the summary block
      `demo-api.md` promised, both coverage figures with their counts and default verdicts, the
      thresholds in force, the items behind each, and the objectives the module assesses without
      declaring. A course-wide form, `GET /api/v1/intelligence/coverage?course=`, returns every
      module (every module in the database when `course` is omitted).
- [x] **`GET /api/v1/intelligence/alignment?module=`** (2026-10-08): items whose `bloomsLevel`
      is below an objective they assess, with the gap in levels; objectives no item reaches at or
      above their level; objectives no activity targets; and the objectives and items that have no
      level to judge. `LearningActivity` has no level, so "activity at their level" is read as
      "any activity targets it" until the schema says otherwise.
- [x] **`GET /api/v1/intelligence/trace/:type/:id`** (2026-10-08): the lifecycle walk, evidence
      to metric, both ways from any document on it, each hop naming the field and the junction it
      went through (with the link's confidence, the placement's status, the declaration's role); modules attached as context to every objective and assessment reached; the notes
      and findings about anything reached. A metric traces to the module that declared the
      objective its item assessed, which is Narrative 1.
- [x] **`GET /api/v1/intelligence/impact/:type/:id`** (2026-10-08): every document that
      references this one, found from CLASS_FIELDS (the inverse of constraint 0), each with the
      field and, for a junction, the artifact it sits in. Platform check Y records why Optional
      and Set references are listed and filtered rather than queried.
- [x] Redundancy detection ("a new item is redundant in the bank") is deferred: it needs text
      similarity and is not structural (P4). Recorded in the routes' header comment.
- [x] A first read-only Coverage View page in the app (2026-10-08): `/` lists a branch's modules,
      `/coverage/<module>` renders the coverage read with both figures, their counts and the cut
      in force, both calling the Hono app in-process so the page is a client of the API like any
      plugin. `?branch=` reads another branch; `?fullyAssessedAt=&overAssessedAbove=` change the cut.

Exit: both PROJECT_CONTEXT narratives can be walked through on seed data using only intelligence
routes. **Met 2026-10-08:** `app/lib/api/intelligence.test.ts` walks Narrative 2 through the
coverage and alignment reads and Narrative 1 from a metric to the declaring module through the
trace read. What Narrative 1 still lacks is the commit an administration was taken from, which is
ADR-0057's proposal.

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
      for any part-level reference, and applies it immediately: `DesignNote` and `DesignFinding`
      gain an optional `fragmentId` beside their existing `subject`, so "why did we replace this
      image" and "this drop zone is ambiguous" point at a part rather than a whole item.
- [ ] **Non-aggregation guard (ADR-0021).** The generic list route refuses `attestedBy` and
      `createdBy` as filter keys, and the ADR records why this one restriction lives in the
      generic layer.
- [ ] An `Attestation` validator in the invariants registry (the `DesignFinding` validator, rule
      11, has existed since Phase 3).
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
- [ ] **ADR-0030: External references and attachments.** Two optional subdocument sets on
      `ArmatureDocument`, both pointing outward so nothing is duplicated in the graph.
      `externalRefs: Set<ExternalRef>` with `system` (an enum seeded with `CASE`, `QTI`, `xAPI`,
      `LTI`, `Other`) and `identifier` (URI or string). `attachments: Set<Attachment>`, a
      reference to bytes or to a revision of a tree of bytes, in a store the hub may or may not
      operate, with:
      - `store`: the backend kind, an enum seeded with `S3`, `Lore`, `Git`, `Other`, extended
        as backends appear. Naming a kind the hub does not operate is allowed; it tells a reader
        how to interpret the locator.
      - `storeUri`: which instance of that store (an endpoint or bucket), so references survive a
        deployment with more than one.
      - `container`: the repository, bucket or dataset within the store.
      - `revision`: optional, the store's own immutable version identifier for the state
        referenced (a Lore revision hash, a Git commit, an S3 version id). Present whenever the
        source is versioned.
      - `path`: optional, the file or subtree within the container at that revision. Absent for
        a reference to the whole tree at a revision.
      - `contentHash` and `hashAlgorithm`: mandatory. For a single file, the file's hash. For a
        tree, the store's root hash for that revision (Lore and Git both expose one). This is
        what makes the reference an unforgeable coordinate (P3) regardless of backend.
      - `mediaType` and `byteSize`: optional, meaningful for single files.
      - `role`: optional free text for what the reference is to the artifact (source, rendered,
        evidence, export), left as text per P9 until usage shows the categories.
      - `label`: optional.
      Subdocuments take `@key: Random`. The ADR records why attachments are references and not
      blobs (the paper's "not a content repository"), why the hash is mandatory, why `revision`
      and `path` are in the shape from day one (a simulation authoring tool must be able to say
      "this module was built against revision X of this asset tree" without a schema change),
      and that the hub-managed backend is chosen in a separate ADR when a reference client needs
      one (§6). This is the minimum P9 permits that does not foreclose versioned assets.
- [ ] **ADR-0025 amendment: externally versioned artifacts.** Design process data for an
      artifact whose bytes live in an asset store is carried by the graph commits that move its
      `Attachment.revision`, each with author and reason, plus the asset store's own log reached
      through the reference. The graph is a projection of the asset history, not a replay of it
      (§2). The amendment also states the cross-reference convention: a tool that controls the
      asset store writes the graph commit id into the asset revision message when it can.
- [ ] **Attachment endpoints, in two modes.** For a **hub-managed** store:
      `POST /api/v1/attachments` streams bytes, computes the hash, and returns an `Attachment`
      for the caller to place on its artifact; `GET /api/v1/attachments/url` takes a reference
      and returns a short-lived URL the plugin's browser can fetch, or proxies when the store
      cannot presign. For a **tool-managed** store: the tool places the reference on the artifact
      through the ordinary write path, and the hub validates the shape, verifies the hash when
      it has read access to that store, and otherwise records the reference as unverified. The
      invariants engine enforces that `revision` is present when `store` is a versioned kind.
      The store adapter is one module behind one interface, so adding a backend does not touch
      routes or schema. The hub-managed endpoints are not built until a reference client has a
      concrete file to attach; the tool-managed path costs nothing beyond the validator and
      lands with ADR-0030.
- [ ] **ADR-0031: Export profiles and schema slices.** A `GET /api/v1/export?ref=&profile=`
      route producing JSON-LD (the store's native shape) for the whole graph or a declared
      slice. The documentation lists Turtle and RDF/XML content negotiation under enterprise
      pages; verify on the open-source build before promising any format beyond JSON and
      JSON-LD. Profiles: `full`, `pseudonymous` (stable tokens for `User`), `institutional`
      (institution only, per ADR-0021's cheapest option). Slices are declared as lists of
      classes in a small JSON file, so the needs-to-objectives-to-outcomes slice the paper
      describes is a configuration, not code.
- [ ] **Outcomes import path.** `LearningDataset`, `LearningMetric` and item statistics (stored
      or computed: decide first, §6) through the generic write route, with an invariant for `producedBy` when the
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
      parameters, data-version handling, and the store-error mapping (now `app.onError` in
      `app/lib/api/app.ts`; formerly `handleTerminusError`) behind the boundary. CoQui's `httpHub` becomes a consumer of it, not a reimplementation.
- [ ] **Contract test owned by Armature.** A test suite that starts TerminusDB as a CI service
      container, loads the schema, seeds, and exercises every v1 route and every invariant.
      CoQui's planned `armature:check` becomes a second opinion, not the only one.
- [ ] Containerize the hub: an entry file that serves the Hono app with `@hono/node-server`,
      behind a build or transpile step that resolves the `@/` path alias (Node cannot; the
      ADR-0054 spike needed `tsx` for the standalone check). A compose file that runs store and hub
      together; deploy one hosted instance for the public demo so CoQui's recorded hub is a
      fallback rather than the source. The Next.js app becomes the demo UI only, deployed
      separately or not at all. The contract test above runs through `app.request()` against the
      service container, so `npm test` joins CI here.
- [ ] `docs/schema-guide.md` revised from the reference-client perspective: what a tool author
      needs to know to write and read the graph. (A first conceptual version was written on
      2026-10-08, with `docs/api.md` and `docs/how-armature-works.md`.)

Exit: a developer with the repo, Docker and the client package can write a new plugin without
reading TerminusDB documentation.

---

## 5. ADR queue

The decision records this plan reserved or produced, in number order, with their status as of
2026-10-08. The full index of all decision records is `schema/docs/adr/README.md`. Numbers 0035 to
0053 are research candidates (`docs/research/adr-candidates.md`), not decisions.

| ADR | Title | Phase | Status | Notes |
|---|---|---|---|---|
| 0017 | DesignRecord abstract root | 1 | Accepted and implemented | Promoted after platform checks A to C |
| 0018 | Item readiness on AssessmentItem | 1 | Accepted and implemented | |
| 0019 | Coverage accounts for readiness | 4 | Accepted 2026-10-08 | Promoted with 0029; its two figures are outputs of the coverage read (amended by 0056) |
| 0020 | DesignFinding | 1 | Accepted and implemented | |
| 0022, 0023 | Embedded parts, fragmentId | 1 | Accepted and implemented | |
| 0024 | Client-supplied identifiers | 1 | Accepted and implemented | Resolves 0016 decision 5 and 0023's open question. Its lossless-write requirement (candidate 0035) is still open; see §6 |
| 0025 | Design process data lives in the commit graph | 2 | Accepted and implemented | Reconciles the paper's model with the store; to be amended in Phase 6 for externally versioned artifacts |
| 0026 | API host and route versioning | 0 | Accepted; decision 1 amended by 0054 | Resolved the PROJECT_CONTEXT contradiction; the legacy routes it named were retired in Phase 3 |
| 0027 | Schema self-description via `@metadata` | 1 | Accepted and implemented, except `GET /schema` | Replaced `JUNCTION_IDS`; `GET /api/v1/schema` not built (see §6) |
| 0028 | Attestation | 5 | Reserved, not written | Generic form of CoQui's proposal |
| 0029 | Coverage algorithm | 4 | Decisions 1 to 3 accepted 2026-10-08; 4 to 6 superseded by 0056 | Counted over placements; two figures; default thresholds as parameters |
| 0030 | External references and attachments | 6 | Reserved, not written | P6; attachment references with mandatory content hash, backend left open |
| 0031 | Export profiles and schema slices | 6 | Reserved, not written | P7, P8; implements ADR-0021's deferred section |
| 0032 | Identity resolution | 3 | Accepted and implemented | Implements ADR-0015's boundary; pluggable resolver; `main` is the `User` registry; carried copies on branches; author and `createdBy` from the resolved identity |
| 0033 | Items as a tree of fragments | 1 (shape), later (generic kinds) | Accepted; shape implemented | Abstract `Fragment` subdocument; `ItemOption` as a specialization; generic kinds with `sys:JSON` payload and per-kind validation land with the first non-text item type |
| 0034 | Interaction types and renderers as versioned artifacts | When the first non-text item type is needed | Reserved, not written | `InteractionType` registry with version, data shape and renderer reference; the eight `ItemType` values become built-ins; renderer contract (H5P and QTI PCI, Portable Custom Interactions, as precedents); the hub never serves executable content from a graph document, and renderers load sandboxed under a content security policy (CSP) |
| 0054 | The API is a Hono application | 0 | Accepted 2026-10-07 | Amends ADR-0026 decision 1; host-neutral app in `app/lib/api/`, one catch-all mount; numbered past the reserved and candidate blocks |
| 0055 | The API layer reaches TerminusDB over HTTP | 2 | Accepted 2026-10-08 | One `fetch` adapter under `app/lib/api/`; the JavaScript client stays in `scripts/`; supersedes the "keep the JS client" decision and the earlier §3 split |
| 0056 | Coverage is computed on read, never stored | 4 | Accepted 2026-10-08 | Supersedes ADR-0007's computed field and ADR-0029 decisions 4 to 6; the graph stores decisions and observations, the reads derive the rest |
| 0057 | Records that refer to a state of the graph name its commit (`asOf`) | Before or with Phase 5 (needed by Phase 6) | Proposed 2026-10-08 | `LearningDataset`, `LearningMetric`, `DesignFinding`, Attestation; the hub fills the branch head when absent and validates a supplied id (a new rule 13); closes Narrative 1's "adequate when" |

ADR-0021 (non-goal) and ADR-0010 (deferrals) are amended where phases touch them rather than
superseded. ADR-0026 is amended by ADR-0054.

---

## 6. Questions to decide deliberately, not by default

These are not in any phase. Each should become an ADR when evidence arrives, and the plan names
what evidence would be enough.

- **Lossless writes across schema versions.** ADR-0024's replace semantics mean a client built
  against an older schema can read a document, edit it, and write it back without fields it does
  not know, erasing them. ADR-0024 paired itself with a Phase 3 requirement that the hub carry such
  fields forward (research candidate ADR-0035, "High"); Phase 3 shipped without it, and the
  generated request schemas reject unknown fields rather than preserving them. Evidence that
  forces it: the first schema change that adds a field to a type a deployed plugin already writes.
- **Item statistics: stored or computed?** `AssessmentItem.difficultyIndex` and
  `discriminationIndex` (ADR-0009) are described as values written back after dataset analysis, but
  ADR-0056 names difficulty summaries among derived values to compute on read. Either they are
  observations imported from an external analysis (and stay), or they are computed from datasets
  at read time (and leave the schema). No code writes them today. Evidence: the outcomes importer
  in Phase 6.
- **`GET /api/v1/schema`.** ADR-0027 decision 4 scheduled a route returning the schema graph so a
  tool can discover types from the hub, for "Phase 2 or 3"; it was not built, and no phase owns it
  now. Phase 7's toolkit is the natural home. Evidence: a second plugin that needs to discover
  types at run time rather than from generated files.
- **How `ModuleObjective` declarations are written.** ADR-0007 decided the API would create a
  declaration "programmatically" when a designer assigned an objective to a module, and that it
  would not be created or edited directly through a UI. What was built treats it like any other
  relationship: clients write it through `PUT`/`POST /api/v1/documents`, and the seed writes seven.
  Either amend ADR-0007 so the generic path is the recorded decision (the two-client test favors
  it: a curriculum mapper and an AI design assistant would both write declarations), or add a
  rule restricting writes. Evidence: the objective and curriculum mapper reference client.
- **The ordered module-content view.** ADR-0005 assigns the API the job of merging
  `ModuleActivityLink` and `ModuleActivityGroupLink` by `sequence` into one ordered view of a
  module, with each group's members in their own order. The uniqueness rules are enforced
  (constraints 3 and 4), but the composed view has not been built; clients sort the links
  themselves. Evidence: the activity and strategy designer reference client, or a Coverage View
  that shows a module's activities.
- **Filtering the list route on optional and multi-valued references.** The store answers a
  template query on an `Optional` or `Set` reference field with a 500 (check Y), and
  `GET /api/v1/documents/:type?<field>=` passes such filters through, so `?createdBy=` or
  `?assesses=` fail with a 500. The intelligence reads work around it in `Graph.where`. Fixing the
  list route (list and filter in the hub, or refuse with 400) should happen with Phase 5's
  non-aggregation guard, which refuses `createdBy` as a filter anyway.
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
  modeling the LEED tracker's columns.
- **A fourth `DesignFinding` status.** CoQui stretches `Dismissed` to cover a reviewer's own
  withdrawal. Evidence: a second tool needing the distinction (ADR-0018 §5's test).
- **One placement per item per assessment.** `ItemInstance`'s Hash key over `(assessment,
  implements)` means an item appears at most once in an assessment, a client never mints a
  placement id, and writing the pair again is a replace, which keeps `sequence` freely editable
  (a key that included it would orphan the old placement, and the API has no delete). Two forms
  or orderings of the same items are two `Assessment`s of the module; coverage counts distinct
  items per module, so reuse across forms counts once (ADR-0029). Evidence to reopen it: a
  container inside `Assessment` (a section, an in-assessment form) that the same item may belong
  to twice, which would change the key anyway; or the outcomes importer meeting a source that
  references one item twice in one test, which QTI permits. Decided 2026-10-08 as a timing
  decision, not a scope decision.
- **Separate API service.** When Phase 7's container and client package exist, the move is
  mechanical. Evidence: a plugin that cannot or should not depend on a Next.js deployment, or
  the hosted demo needing independent scaling.
- **Which store the hub operates for attachments, and when.** The reference shape (ADR-0030) is
  backend-neutral and versioned-tree-capable on purpose, so this question is about operations
  and timing, not about what the graph can express. Two workloads are in view and they want
  different stores:
  - *Write-once media* (evidence PDFs, item images, dataset exports) from the first three
    reference clients. Immutability and integrity are what matter. An S3-compatible bucket
    (MinIO locally) keyed by content hash satisfies the reference and is the cheapest thing to
    run next to one TerminusDB container. Likely first.
  - *Developed assets* (simulations and other complex learning objects): trees of large binaries
    edited in place by several people over many revisions, where the development history is
    itself design process data. This is a version-control workload. A content-hash bucket cannot
    express a tree at a revision, who changed it, or why; a versioned asset store can. The tool
    building such objects may bring its own store, which the tool-managed reference path
    accepts. Whether the hub should *also* operate a versioned asset store, so that tools without
    one can still get their assets under version control through Armature, is the real decision
    here. Evidence: the first tool that develops multi-file assets on Armature, or a partner
    institution that already keeps course assets in a VCS.

  **Epic's Lore was evaluated on 2026-10-06** (v0.10, [github.com/EpicGames/lore](https://github.com/EpicGames/lore))
  and is the leading candidate for the developed-assets store. Its design matches that workload
  closely: BLAKE3 content addressing and full-hash revision ids give unforgeable coordinates
  (P3) and a Merkle root per revision, which is exactly what `Attachment.contentHash` needs for
  a tree; commits carry author and message, so an asset revision can be inscribed like a graph
  write; content-defined chunking and sparse working copies are built for large binaries edited
  in place; a stable per-file identity that survives moves mirrors the fragment-id idea; a
  repository is a hard access partition, which bears on the project-boundary question above;
  presigned URL minting is restricted to service accounts, which is the hub's position; and
  there is an npm SDK. Reasons not to operate it *yet*: three of the last four releases carried
  breaking API changes and the roadmap places 1.0 after 2026; the server needs QUIC and gRPC
  ports, TLS certificates, and OIDC whenever auth is enabled, with no published container image
  and S3 backends compiled into a custom binary; and the npm SDK is a native FFI addon on four
  platforms. None of these affect the reference shape, which is why the shape lands now and the
  operation waits. It is not a TerminusDB replacement under any reading: it has no data model,
  schema, referential integrity or query language, and merges files rather than fields. If
  adopted as a hub-managed store, branching and merging of *design relations* stay in the graph;
  the asset store's branches, if used, belong to the asset tool's workflow and are named in the
  reference like any other revision coordinate.

  **slash-builder/bitchain was evaluated on 2026-10-07** and is not a candidate: a one-person,
  local-first Rust CLI aligned to Lore's storage format with no server, no HTTP or S3 path, no
  revisions or history, a private-registry dependency, and no releases. One thing from it is
  worth keeping. Its `context`, a 16-byte logical identity assigned once at ingest and kept
  separate from the content hash so the slot stays stable while its bytes change, is the same
  split as Armature's `fragmentId` plus attachment reference, and Lore's per-file identity is a
  third instance. Three independent content-addressed designs reaching the same separation of
  stable identity from content is evidence that ADR-0023's `fragmentId` and ADR-0030's reference
  shape are the right pair, and that `fragmentId` must never be derived from content or
  position.

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
- No per-type write routes once the generic path exists. Type behavior is a validator, not a
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
- No binary content in the graph. Files and asset trees are referenced by content hash and
  revision coordinate and live in a content-addressed store behind the API or in a store the
  tool manages; the store is a backend, never a schema fact.
- No replay of an asset store's history into the graph. The graph records the revisions that
  matter to design, with author and reason; the asset store keeps the rest, reachable through
  the reference. Branching and merging of design relations happen only in the graph.
- No executable content served from a graph document. Behavior reaches a tool only as a
  registered, hashed, versioned reference, loaded sandboxed. Item documents carry data, never
  code.
- No item type whose parts cannot be enumerated generically. A tool that does not know an item
  type must still be able to list its fragments, read their text, fetch their media, and attach a
  finding or attestation to one.

---

## 9. Platform facts this plan relies on

Checked on 2026-10-05 against the TerminusDB documentation at terminusdb.org (topics: version
control, schema, documents, diff and patch, collaboration, access control, installation), the
server release notes for v12.0.0 to v12.0.7, and the installed client source. Items marked
*corrected* contradict something written earlier in this repository or in the CoQui handoff.
The same pages are now vendored under `docs/vendor/terminusdb/` (see `VERSION.json` for the
pinned docs commit and release), so future checks can diff rather than re-read.

**Versions**
- Server: v12.0.7, released 2026-08-10. Compose pins `terminusdb/terminusdb-server:v12.0.7`
  (done in Phase 0; it previously used `latest`).
- Client: the npm package was renamed from `@terminusdb/terminusdb-client` to `terminusdb` at
  12.0.3; current is 12.0.5 with bundled TypeScript types. `scripts/` uses `terminusdb` ^12.0.5
  (updated in Phase 0); `app/` has no client at all since Phase 3 (ADR-0055).
- Client internals (read 2026-10-08, `terminusdb@12.0.5`, for ADR-0055): every method is a URL
  built by `ConnectionConfig` and dispatched through axios; database, branch, ref and custom
  headers live on the instance; a write given a data version stores it in the instance headers
  and never clears it, and `copy()` does not carry those headers; errors are thrown as a plain
  `Error` with the server's JSON fields concatenated into the message; `DocHistoryParams` does
  not include the `diff` option the server added in v12.0.5.

**Version control** (Phase 2)
- Branch creation accepts an `origin` that is a branch head *or* a commit path
  (`org/db/local/commit/<id>`); the client uses the commit when `ref()` is set.
- Reads at a commit use the `local/commit/<id>` path and are read-only.
- *Corrected:* `apply` is a three-way merge with field-level conflict detection, and the merge
  is rejected rather than resolved. Earlier statements that TerminusDB lacks a three-way merge
  (CoQui handoff §4, and the first draft of this plan) were wrong for v12.
- *Corrected (2026-10-08, checks P and Q):* `apply` takes `before_commit` and `after_commit` as
  bare commit ids (commit paths are `api:NotValidRefError`) and does not compute the merge base;
  the caller supplies it. A conflict is HTTP 409 with `api:status: api:conflict` and witnesses of
  the form `{ "@id", "<field>": { "@op": "Conflict", "@expected": <base>, "@found": <target> } }`;
  the source branch's value is not in the witness. The vendored docs' `@before`/`@after_left`/
  `@after_right` shape is not what the store returns. `rebase` replays commits, gives them new
  identifiers, and leaves the old commit readable at its old id; `POST /api/rebase/<X>` with
  `rebase_from: <Y>` rebases X onto Y (the vendored page reads the other way).
- Branch creation from a commit path starts the branch at that commit with the same identifier
  (check O). Deleting a branch keeps its commits readable at `local/commit/<id>`; the DELETE
  needs a `{}` body when sent with a JSON content type, else 500 (check T).
- A commit's existence is checked by reading `ValidCommit/<id>` from `local/_commits` (200 or
  `api:DocumentNotFound`). A document read at a commit path that does not exist is a 500
  `api:InternalServerError`, so the hub validates commit ids before using them as refs (check U).
- The commit schema (`local/_commits`) declares `parent` as `Optional<Commit>` and `metadata` as
  `Optional<sys:JSON>`. A merge commit made by `apply` has one parent and does not record the
  source commit; the hub records it as `{ armature: { mergeSource } }` in the commit's metadata,
  which `apply` accepts in `commit_info` and `/api/log` returns. `/api/history` entries carry no
  metadata, and a `metadata` query parameter on a document write is ignored (check V, ADR-0025
  decision 5).
- Document history: `/api/history/<path>?id=<doc>&diff=true` returns the commits that touched one
  document, with author, message, identifier, timestamp, and since v12.0.5 the structural diff.
- Diff: `/api/diff` takes two data versions (branch names or commit ids) and an optional document
  id; list fields diff positionally (`CopyList`, `SwapList`).
- Patch: applying a patch whose `@before` no longer matches returns 409 with `api:PatchError` and
  `api:witnesses`. This is the behavior CoQui's handoff relied on.
- *Verified (2026-10-08, check Z):* a conflict on a field is cleared by restoring the base value
  on the target in a new commit: `apply` with the same `before_commit` and `after_commit` then
  succeeds, the source's value lands, and the target's other changes are kept. Verified for the
  merge recompute ADR-0029 decision 6 called for; nothing uses it since ADR-0056.
- Change requests are an unmaintained dashboard feature, not an API.
- Reset and squash exist; reset moves the head and keeps commits.

**Writes, identity and concurrency** (Phases 2 and 3)
- *Corrected:* the JavaScript client sets `author` from its connection user and provides no
  override on any write method. The HTTP document API accepts `author` and `message` query
  parameters on `POST`, `PUT` and `DELETE`. All store calls from the API layer go over HTTP
  through one adapter, with the resolved `User` as author on every write (ADR-0055).
- `POST` inserts and errors on an existing id unless `overwrite=true`; `PUT` replaces and errors
  on a missing id unless `create=true` (upsert). `@capture` and `@ref` allow intra-batch
  references.
- `TerminusDB-Data-Version` is returned on every operation and accepted on writes for optimistic
  concurrency. Independently, the server retries a transaction up to three times when the branch
  head moved during it (`TERMINUSDB_SERVER_MAX_TRANSACTION_RETRIES`), so concurrent writers do not
  fail unless they pass a data version.
- *Verified (2026-10-08, check M):* the token is `branch:<commit-id>` on a branch read and
  `commit:<commit-id>` on a read at a commit, and the id is the log head. A write with a stale
  token is HTTP 400 `api:DataVersionMismatch` (not 409); a bare commit id as the token is HTTP
  400 `api:BadDataVersion`. `/api/v1` maps the stale case to 412 (ADR-0025 decision 7).
- Access control is role-based at organization and database scope. No per-branch permissions
  exist, and only basic authentication is documented for self-hosted use. Branch write
  exclusivity is therefore a hub convention, as the CoQui handoff assumed.
- *Verified (2026-10-08, check W):* the document API's template query works over HTTP as a
  `POST` with `X-HTTP-Method-Override: GET` and a body `{ type, as_list, query }`, returning the
  matching documents and the data-version header, `[]` when nothing matches (W1, W1c). `apply`
  of a commit that inserted a document the target already holds with identical fields succeeds
  and makes no commit, since the patch is empty (W2, W2b); the same id inserted on both sides
  with different fields is a 409 with a witness `{ "@op": "InsertConflict",
  "@id_already_exists": "<iri>" }` rather than a per-field witness (W2d). A list body on `POST`,
  and on `PUT` with `create=true`, commits every document in one commit, including a reference
  from one to another (W3, W3b). ADR-0032 rests on these.
- *Verified (2026-10-08, check X):* a `PUT` list with `create=true` writes a Hash-keyed document
  that carries no `@id`, deriving the id from the key fields, and a second write with the same
  key fields replaces it in place (X1, X1c); `@capture` and `@ref` resolve within both a `POST`
  list and a `PUT` list (X2, X2b); both return the written ids as full IRIs in input order; a
  list with one bad document writes nothing (X5). **`POST overwrite=true` does not replace: it
  merged the old and new values of a field into a list (X3a), so the hub never uses it.** `GET`
  with `ids=[...]`, as a query parameter or in a method-override body, returns the documents
  that exist and silently drops the rest (X4, X4b). The generic write path rests on these.

**Schema** (Phase 1)
- *Corrected (2026-10-07):* the store does **not** check the class of a referenced document. A
  field typed `X` accepts any existing document; only a reference to a missing document is
  rejected (`references_untyped_object`). `scripts/platform_checks.js` check L reproduces it.
  Typed references are documentation and generator input; the API enforces the class as a generic
  invariant on every write (ADR-0014 and ADR-0017 amended, CLAUDE.md constraint 0). The earlier
  statement that typing `DesignNote.subject` gave "schema-enforced referential integrity" was true
  only of existence.
- `@subdocument` classes must use `@key` `Random` or `ValueHash`; their IRIs nest under the
  parent; they cannot be retrieved, updated or referenced independently. Verified: they return
  inline by default (no `unfold` needed); a `List` typed to an abstract subdocument accepts
  subclasses polymorphically; `sys:JSON` on a subdocument round-trips; a replace of the parent
  regenerates every subdocument id (checks D to J, `scripts/platform_checks.js`).
- A client-supplied `@id` is honored under an explicit `@key: Random`; `POST` under an existing
  id fails with `api:DocumentIdAlreadyExists`; `PUT` replaces; `@capture` and `@ref` resolve
  intra-batch references including to Hash-keyed junctions (check K; the seed uses it).
- `@shared` (v12.0.6) is a regular document with reference-counted cascade deletion. Not needed
  by this plan.
- `@metadata` accepts arbitrary JSON; the documentation recommends nesting it one level deep,
  which is the `@metadata.armature.*` shape ADR-0017 and ADR-0027 use. A `ReplaceClassMetadata`
  migration operation exists.
- `@inherits` forms a DAG; multiple inheritance is allowed when shared properties agree; key
  strategies are not inherited.
- `Cardinality` is deprecated in favor of `Set` with `@min_cardinality` and `@max_cardinality`.
  The schema already follows this.
- `@documentation` may be a list of language-tagged objects, as the schema already does.
- A schema migration endpoint (`/api/migration/<path>`, with `dry_run`) rewrites instance data
  alongside the schema: `DeleteClass`, `CreateClassProperty` with defaults, `CastClassProperty`,
  `ChangeKey`, `MoveClass`, `ExpandEnum` and others. Weakening changes (new optional fields, new
  classes) need no migration.
- `@unfoldable` and field-level `@unfold` expand linked documents on read with cycle detection.
  Considered for the trace route in Phase 4; not used. The trace and impact reads use a
  per-request cached reader (`app/lib/api/intelligence/graph.ts`) over ordinary document reads.

**Documents API** (Phases 2 to 4)
- `GET` supports `type`, `id`, `ids`, `skip`, `count`, `as_list`, `unfold`, `minimized`, and a
  template `query` sent via `X-HTTP-Method-Override: GET`. The client exposes `skip`, `count` and
  `query`.
- *Verified (2026-10-08, check Y):* a template filters on a required reference field (Y1). A
  template on an `Optional` reference field is a 500 `api:InternalServerError`
  (`unknown_type_casting_error` in the server log), and so is a template on a `Set` reference
  field, whether the value is one member or an array (Y2, Y3). The intelligence reads therefore
  look documents up by an Optional or Set reference by listing the type and filtering in the hub
  (`Graph.where`); a WOQL query over the adapter replaces that when a type outgrows a list.
- Turtle and RDF/XML content negotiation appear under enterprise-labeled pages; treat JSON and
  JSON-LD as the guaranteed export formats until verified.
