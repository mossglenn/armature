# What CoQui asks of Armature, and what it learned

> **Status since this handoff (2026-10-08).** This is a dated record of what CoQui, the first plugin, asked of Armature on 2026-10-05, as it read the repository at commit `3f00f40`. It is kept as written. Since then:
>
> - **All six asks in §3 have landed** in generic form: asks 1, 2 and 6 in Phase 2 (read any document at any commit, branches, history and changes since a commit; ADR-0025), asks 3, 4 and 5 in Phase 3 (client-supplied identifiers with replace semantics for every artifact, the generic write path for notes and findings, users; ADR-0024, ADR-0032). The merge with a per-field conflict report also exists (Phase 2); merge *policy* (O-P, O-Q) is still open (plan §6). The `Attestation` type is planned as ADR-0028 in Phase 5.
> - **The schema work in §3 is done:** ADR-0017, 0018, 0020, 0022, 0023 and 0024 are implemented (Phase 1).
> - **Superseded statements:** TerminusDB *does* have a three-way merge with field-level conflict reports (§4's "no three-way merge with markers" is wrong for v12; plan §9). The API is no longer "eight unpaginated GET-all routes": those were retired, and `/api/v1` has filtered, paged list reads (`docs/api.md`). The hub no longer takes a `User` id on trust: the `Armature-User` header now carries an `externalId` that the hub resolves to a `User` (ADR-0032), and every write through the API sets `createdBy`. The API's location is settled (ADR-0026, ADR-0054) and so is the coverage algorithm (ADR-0029, computed on read by ADR-0056).
> - **One recorded divergence:** this handoff gives each option's own feedback a `{ fragmentId, text }` shape (§2), but the schema has `ItemOption.feedback` as plain text, so per-option feedback is not separately addressable. The difference has not been decided either way.
>
> Every path written `coqui/…` refers to the CoQui repository, not this one.

**Date:** 2026-10-05 (Session 22) · **Status: a handoff, for whoever continues Armature's
development.** Everything here is collected from the CoQui repository's documents and session log
([github.com/mossglenn/coqui](https://github.com/mossglenn/coqui)); nothing is new. **Every path written
`coqui/…` is a file in that repository, not this one.** Where a line rests on a decision, the
decision's id is given so it can be read in full (`coqui/docs/armature-outbox-plan.md` for O-*,
`coqui/docs/author-workspace-plan.md` for W-*, `coqui/docs/craft-review-plan.md` for C-*,
`coqui/design/features/content-review/DECISIONS.md` for D-*).
**Armature as read:** this repository at commit `3f00f40` (2026-09-18), which has not moved since:
its `schema/schema.json`, the Next.js routes, `PROJECT_CONTEXT.md`, `docs/demo-api.md`, and ADRs 0003,
0004, 0006, 0010 to 0013, 0015 to 0023. Nothing in CoQui talks to Armature yet: no line of code
reaches it, and the integration is a plan (`coqui/docs/armature-outbox-plan.md`) whose first code PR is
next.

## 1. The model CoQui builds against

What Armature should expect from CoQui, stated once so the asks below make sense.

- **Topology.** `CoQui → Armature API → TerminusDB`. CoQui never touches the graph store, and never
  will: a TerminusDB of CoQui's own was evaluated and ruled out
  (`coqui/docs/armature-boundary-reconsidered.md` §1). CoQui keeps its own Postgres store and is not a
  thin client over the API (`coqui/docs/armature-boundary.md`).
- **The membership test.** Would a researcher studying design process, or a designer inheriting this
  course in three years, need it? Review discourse fails; review outcomes pass. CoQui holds three
  tiers: experiment and operational data (never crosses, under any redraw), discourse (the event log,
  never crosses, per ADR-0021), and structure and outcomes (crosses). The reconsideration's
  recommendation, accepted by the product owner, was to promote the **outcome per claim** into
  Armature's vocabulary as an `Attestation`, not the events (§2, recommendation 2).
- **Four kinds of outcome cross, per item** (O-A): the item at its latest version with the
  revision's reason; its readiness (O-K); findings (O-I); attestation state (O-J). Nothing else.
- **A round is the unit of a review** (W-R): a facilitator, a set of items, the reviewers assigned
  to them, opened and ended. The round has no document in the hub (ADR-0018 §5, workflow stays in
  the plugin). **Its trace in Armature is a branch** (O-P): one branch per round, created from
  `main` at a commit when the round opens; every push of the round goes to that branch; one commit
  per revision; one merge per round at the end, if at all. The first demo never merges and leaves the
  branch as it is. Nobody but CoQui writes to the branch, so no conflict can arise before a merge.
- **Items are imported, never written from nothing** (W-M withdrawn, O-H dissolved). A round opens
  by choosing items from an Armature; each is read at the branch's base commit and becomes version 1
  in CoQui with that `source_commit`. CoQui never holds an item Armature has not seen. So an item
  always arrives already naming what it assesses; the `assesses` question is moot.
- **Replace semantics, deterministic ids, nothing deleted** (O-C). CoQui mints every document's
  `@id` and writes with replace semantics; a retried push is the same push. The item's `@id` is its
  `itemId`; a finding is `DesignFinding/coqui-<noteId>`; a revision's note is
  `DesignNote/coqui-<itemId>-v<n>`; an attestation is
  `Attestation/coqui-<itemId>-<fragmentId or item>-<lineage>-<reviewer>`, replaced as the latest
  live attestation changes. A withdrawn finding becomes `Dismissed`; a superseded attestation is
  replaced; a removed option is a new item version. The product owner confirmed TerminusDB's model:
  one document per identifier, replaced in place, versioning internal to the engine; there is no
  "new version of" document in the graph.
- **CoQui's version row is the pin; the commit is a coordinate.** An attestation points at an item
  version plus a `fragmentId` and deliberately does not copy the text (D-35 copies the claim wording
  instead, since wording is not part of the item). A branch operation can give commits new ids, so
  the commit is recorded beside the version, never in place of it.
- **The outbox is state-based** (O-B): a dirty marker per item and outcome kind, written in the same
  transaction as the event. The worker derives the outcome fresh and upserts it. Coalescing is free;
  backfill is one statement. Armature receives projections, never a replay of messages.
- **No login in the first demo** (O-F). Armature has no auth; ADR-0015 makes `createdBy` optional
  for exactly this case. The public demo runs over a **recorded hub**, JSON captured from a real
  Armature (O-E), with writes, branches and new users in memory. The study deployment never pushes,
  structurally: a server with `COQUI_STUDY_URL` set refuses `ARMATURE_URL` at startup.
- **Every reviewer has an id in Armature** (O-R, settled Session 22), for project tracking and
  research: a round's reviewers are chosen from the hub's `User` documents, and a new reviewer is
  added to Armature as a `User` from CoQui and then chosen. The study's participants are the one
  exception: pseudonymous codes, never a `User`, since the study never touches Armature.

## 2. The shapes CoQui will send

All provisional, checked in as `coqui/lib/server/armature/types.ts` once PR 3 exists, to be replaced by
generated types when the schema has them (O-E, O-N).

**The item** (O-H, against ADR-0022's accepted but unimplemented shape; `coqui/lib/item.ts` is the source):

```
AssessmentItem {
  @id: itemId (UUID, CoQui-minted, ADR-0024 owed),
  label: name or the stem's first line,
  stem: { fragmentId, text },
  itemType: MultipleChoice,
  bloomsLevel?: cognitiveLevel, when it is one of the six verbs,
  options: List<ItemOption { fragmentId, text, isCorrect, feedback?: { fragmentId, text }, purpose? }>,
  correctFeedback: { fragmentId, text },
  incorrectFeedback: { fragmentId, text },
  assesses: at least one LearningObjective (carried from the import, never set by CoQui yet)
}
```

Every addressable piece of text carries a `fragmentId`: the stem, each option, each option's own
feedback, and the two general feedbacks (the Session 4 decision ADR-0023 left to CoQui). The two
declarations, `purpose` on an option and `cognitiveLevel` on the item (C-F), are design rationale and
travel with the item as the reconsideration foresaw.

**A revision** (W-E, O-A): one commit on the round's branch whose message is the revision's reason,
the item replaced under its `@id`, and one `DesignNote/coqui-<itemId>-v<n>` whose rationale is that
reason, referencing the findings it answers. The reason is required and is the facilitator's own
words; reviewers' note text never crosses, adopted rewrites included.

**A finding** (O-I, ADR-0020): one `DesignFinding` per item-level blocking objection and per mismatch
finding (`key-wrong`, `both-defensible`), subject the item, `finding` the note's text, `status`
derived: `Open` while live and unanswered, `Addressed` once a revision answers it (set by the
revision's `DesignNote` in the same commit), `Dismissed` once withdrawn, with `resolutionRationale`.
One self-contained `DescriptiveEvidence { method: ExpertReview, finding, source: "CoQui <itemId>
note <noteId>", collectedAt }`. No `confidence`, no `regarding`. A claim-level decline is not a
finding; it crosses as attestation state.

**An attestation** (O-J, the type CoQui proposes, ask 4 below):

```
Attestation {
  subject: the item, fragmentId?: the part, or absent for the item as a whole,
  grid, claim: the lineage, claimVersion, claimText,
  verdict: Affirmed | Cannot, reason?: a decline's live reason,
  asOf: the item version attested, sourceCommit?: that version's commit,
  reviewer: the reviewer's Armature User id
}
```

The latest live attestation per claim per reviewer, derived from the log exactly as CoQui's own
ledger is. A stale attestation is still sent `asOf` its version; the hub derives staleness from the
commits since. Until the type exists, attestation rows are held in CoQui's outbox, visibly, and
nothing is faked into a `DesignNote`.

**Readiness** (O-K, ADR-0018): `AssessmentItem.status` mapped at the boundary. `Draft` while no round
holds the item; `InReview` while its round is live; back to `Draft` when a round ends unapproved;
`Approved` only once approval is built (not in this plan); `Retired` never. CoQui's own states
(`blocked`, `sent-back`, `stale`, `reviewed`) do not cross.

**Never crosses** (O-A): the review events themselves, blind answers, confidence, mismatch
resolutions as such, the H1 condition, assignments, replies and threads, drafts, participants,
sessions, consent, ground truth, and any participant code beyond the reviewer's `User` id. CoQui's
tests enforce this by field name on every document leaving the mapping (O-O).

## 3. The asks, in the order the first demo needs them

From O-N, reordered in Session 19 to the round-shaped demo's needs and amended in Session 22.

1. **Read items by id**, each returned with the commit it was read at (`GET /items/:id`; today the
   API has only unfiltered `GET /items`).
2. **Create a branch from `main`** at a commit, and name it.
3. **Write an item to a branch by its identifier, replacing it**, in ADR-0022's embedded shape with
   ADR-0024's client-supplied `@id`.
4. **Create or replace a `DesignNote` and a `DesignFinding` on a branch**, under a client-supplied
   `@id`, with `status` and `resolutionRationale` on the finding (ADR-0020).
5. **Read users, and create one** (O-R): `GET /users`, and a route that creates a `User` for a new
   reviewer, returning its id.
6. **Read an item's history**, exposing commit ids, and a changed-since-commit listing (for the
   pull, once a second writer exists).

**The schema and ADR work those routes rest on:**

- Implement **ADR-0022** in `schema.json`: embedded options, `fragmentId` on the stem and on both
  general feedbacks, `purpose?` on an option, the two general feedbacks as fields. The pre-ADR-0022
  schema cannot hold CoQui's item: `Response` is keyed on its label, so editing an option changes
  its identity, the defect ADR-0016 and ADR-0022 fixed on paper. CoQui will not map to that shape;
  its recorded hub carries the target shape until the schema does (O-E, O-H, settled Session 22).
- Write **ADR-0024**: a client-supplied `@id` on first write, reversing ADR-0016 decision 5 for
  items, extended to the outcome documents CoQui mints. Armature should reject, not silently
  overwrite, a create whose id already belongs to a different lineage
  (`coqui/docs/Assigning-IDs-to-items-and-parts.md` §1).
- Land **ADR-0018** (`AssessmentItem.status`), **ADR-0017** (`DesignRecord`) and **ADR-0020**
  (`DesignFinding`) in the schema and the API.
- A new ADR for **`Attestation`** (§2 above), with ADR-0023 §5's compound target, `asOf` plus
  `sourceCommit`, and a `Random` key since every field is mutable. The Hash-key alternative over
  (subject, fragment, lineage, reviewer) gives the same idempotency inside the schema and is
  acceptable.
- **Auth** (ADR-0015), so `createdBy` and `reviewer` mean something; until then the hub takes a
  `User` id on trust.
- **`assesses` optional while `status` is `Draft`**: no longer needed by the first demo (items are
  imported with their objective), kept as the alternative if authoring from nothing ever returns.

**Deferred asks the demo makes visible but does not exercise:** a merge with a per-document conflict
report (O-Q); a merge filtered by document type, if O-P is answered "findings reach `main` without
approval"; the `Attestation` type's landing; auth.

## 4. What CoQui learned that Armature should know

Found by building against Armature's rules and reading its repository, in no particular order.

- **Attestations cannot be embedded in the part.** Rejected in Session 4 because it breaks "no owned
  subdocuments, parents hold no arrays", a part has many attestations, dropping them on edit destroys
  evidence the version comparison needs, and it leaks other reviewers' judgments into every item
  fetch. The attestation is a document of its own with a compound target, which is what ADR-0023 §5
  and the proposed `Attestation` type say.
- **Positional labels cannot be identity.** `Response.label` ("A", "B", "C") doing double duty as
  content and identity is the specific failure `fragmentId` exists to fix: a `fragmentId` must survive
  reordering untouched, is never derived from position, is retired and never reused when a part is
  deleted, and is unique only within its item. Always `fragmentId` in code, schema and payloads, never
  `id`, and always sent as the pair `{ itemId, fragmentId }`.
- **Item versions must be immutable and retrievable, forever.** An attestation identifies the text
  it was about by item version plus `fragmentId`, without copying it. If Armature ever cannot keep
  every version readable (TerminusDB's `local/commit/<id>` reads do), attestations would have to
  store the text or a hash, and that cannot be backfilled onto an append-only log.
- **A diff by `fragmentId` and field, not by position.** TerminusDB's diff on a `List` is positional;
  `changedIn` (W-G) needs a diff in which reordering is not a change. It is a small function over two
  JSON snapshots and lives in CoQui (`coqui/lib/item-history.ts`); the same function would serve a
  fragment-by-fragment conflict view (O-Q).
- **Plugin workflow stays in the plugin.** ADR-0010, ADR-0018 §5 and ADR-0020 §2 all say plugins map
  richer lifecycles onto the hub's minimal vocabulary at the boundary. CoQui's review model changed
  weekly through Sessions 10 to 14; in the hub each change would have been an ADR. Keep the hub's
  vocabulary minimal and let plugins project onto it.
- **Exhaust without its derivation is not readable data.** A graph of `noted`, `replaced`,
  `withdrawn` events would need CoQui's code to read. The inheritor is better served by the
  derived outcome. This is also why the outbox is state-based: the hub should hold a projection,
  not a replay.
- **ADR-0021 is load-bearing.** Attributed review exhaust in the graph makes "how often is this
  reviewer's blind answer wrong?" one query away, and reviewers who know they are tallied write
  fewer and softer notes. One attestation is provenance, no more aggregable per person than
  `createdBy`; the API should expose no per-person aggregate.
- **"Dismissed" stretches to cover a reviewer's own withdrawal.** CoQui maps a withdrawn finding to
  `Dismissed` with the withdrawal's reason as `resolutionRationale`. Recorded as evidence for a
  fourth `DesignFinding` status if a second tool needs one (ADR-0018 §5's test).
- **The API has no filtered read, so lookup-then-insert is a race.** Deterministic client-minted
  ids with replace semantics are the answer, and they make a retried push the same push.
- **The API is eight unpaginated `GET`-all routes and two `POST`s.** Enough for a demo; worth
  watching once any client has to page or filter. `PROJECT_CONTEXT.md` says "separate API service,
  not Next.js routes" while the implementation is Next.js routes; unresolved on Armature's side.
- **The API spec claims store internals are not exposed while its own examples pass TerminusDB ids
  in both directions.** A typed client generated from `schema.json` would make the boundary real
  (`coqui/docs/toolkit-candidates.md`).
- **The position paper promises branch-and-merge collaboration that the schema and API do not yet
  deliver.** CoQui's round-per-branch model is built on that promise; the asks above are what it
  needs to be true. TerminusDB has branches, rebase, and a diff-and-patch pair that refuses a patch
  whose "before" no longer matches; it has no three-way merge with markers. A change request is a
  product-layer feature Armature would build (O-Q).
- **What TerminusDB does not give that CoQui's store relies on:** no per-class immutability, no
  unique constraint beyond `@key`, no triggers, no sequences. In TerminusDB each becomes a convention
  in application code with optimistic concurrency. This is why CoQui's own data stays on Postgres
  and only outcomes cross.
- **Free-text rationale is intentional.** CoQui's revision reason, a finding's text and a decline's
  reason are strings on purpose (Armature's progressive-formalization rule). The structure that is
  warranted will show in usage: which is why CoQui prompts for declarations (purpose, level) with a
  truthful null rather than an open box. A prompt with a null yields a dataset; an open text box
  yields a corpus with no denominator (`coqui/docs/toolkit-candidates.md`, "Signals whose unit of capture
  differs").
- **Declarations are rationale and belong in Armature's relationships eventually** (C-F, the craft
  plan's "After this plan"): a distractor's declared purpose and the item's declared cognitive level
  are what the craft grid's claims rest on, and the craft attestations cross like the content ones.
- **Toolkit material already identified for a second plugin** (`coqui/docs/toolkit-candidates.md`):
  generated TypeScript types from `schema.json`; the schema declaring its own artifact and
  relationship categories in `@metadata` instead of a hand-maintained constant (the single
  highest-leverage change named so far); a typed API client; junction read/write helpers;
  `handleTerminusError`'s error mapping behind the boundary rather than in each plugin.
- **A merge is Armature's act, triggered by the facilitator.** CoQui's part on a conflict is to
  treat it as "the item changed under you": pull `main`'s version as a new version in arrival order,
  stale exactly the claims resting on what changed, let the facilitator revise and push again.

## 5. Open questions

**Armature's own, as CoQui recorded them** (`coqui/docs/armature-orientation.md`):

- API location: a separate service, or the Next.js routes that exist.
- The coverage algorithm: what makes `FullyAssessed` against `PartiallyAssessed`.
- The identifier convention: two coexist; ADR-0016 decision 5 proposed settling it, and ADR-0024
  would reverse it for client-authored documents.
- Auth: designed (ADR-0015), unimplemented; blocks attribution on both sides.
- The API surface: unfiltered, unpaginated.

**CoQui's, that need Armature to answer or to build:**

- **O-P.** Whether an unapproved round's findings and attestations should reach `main` without a
  merge, since the inheritor wants them. Left open on 2026-10-05, deferred with the merge. The lean
  is: when the merge exists, approval gates the item's change and findings always merge, which needs
  a merge filtered by document type.
- **O-Q.** The merge and its conflict report, per document; where a fragment-by-fragment conflict
  view lives (CoQui is a candidate).
- **Findings about objectives.** Three items drawing the same objection should become a finding on
  the objective; waits on D-25's cross-item objection in CoQui and an objective on the item.
- **A fourth `DesignFinding` status** for a reviewer's own withdrawal, if a second tool needs it.
- **A hosted Armature for the public demo**, if the recorded hub is not to remain its source.
- **Pulling a change made on `main` during a round**, and the two-versions-in-arrival-order rule,
  deferred with the merge: the round's branch is written by CoQui alone, so nothing can change
  under a reviewer before a merge exists.
- **Who the facilitator is on a live deployment** is settled on CoQui's side (an operator named by
  `COQUI_FACILITATOR`, O-F); once Armature has auth it replaces that, behind `getCurrentUser()`.

## 6. CoQui's plans and branches that touch Armature

**Documents in the CoQui repository, in reading order for someone new to this side:**

1. `coqui/docs/armature-orientation.md`: what Armature is, the API rules that constrain CoQui, the ADRs
   CoQui's fit analysis produced (0016 to 0021), Armature's open questions.
2. `coqui/docs/armature-boundary.md`: the data-ownership contract and the membership test.
3. `coqui/docs/armature-boundary-reconsidered.md` (Session 15): the evaluation that ruled out the API as
   CoQui's store and a TerminusDB of CoQui's own, the three tiers, the `Attestation` recommendation.
4. `coqui/docs/Assigning-IDs-to-items-and-parts.md`: `itemId` and `fragmentId`, the checklist, ADR-0024
   owed.
5. `coqui/docs/armature-outbox-plan.md` (Sessions 17, 19, 22): O-A to O-R, the outcome model, the six PRs,
   the asks.
6. `coqui/docs/author-workspace-plan.md` (Sessions 17 to 21, complete): the round, the `revised` event, the
   facilitator, real item versions, `changedIn`.
7. `coqui/docs/persistence.md`, "Deferred until integration"; `coqui/docs/toolkit-candidates.md`.

**The outbox plan's PRs and their state** (2026-10-05; branches and `pnpm` scripts are CoQui's):

| PR | Branch | State | What it gives Armature's side |
|---|---|---|---|
| 1 | `docs/armature-outbox-plan` | Merged (#107); settled Session 22, O-P open | This list |
| 2 | `feat/outcomes` | Next; **M16** | `deriveOutcomes`, the Outcomes view: what would cross, in words |
| 3 | `feat/armature-hub` | Not started | The hub interface, `types.ts` as the target schema, the mapping, the fake and recorded hubs, `pnpm armature:capture` |
| 4 | `feat/review-round` | Not started; migration `0006`; **M17** | The outbox, `openRound`, the round-opening screen, the study guard |
| 5 | `feat/armature-http` | Not started; **M18** | `httpHub` over the routes as they land, each refusing in words until then; `pnpm armature:check` against the Armature repo's Docker Compose, printing what the hub accepted and refused |
| 6 | `feat/armature-merge` | Deferred (Session 19); **M19** kept as the shape | The merge, the pull on conflict |

`pnpm armature:check` (PR 5) is the mechanism by which the gap between this plan and the hub becomes
a printed list rather than a guess; it is the natural way to verify each ask as it lands.

**Branches on GitHub** (`mossglenn/coqui`): `main` (everything merged, #1 to #117 less the closed
ones); `study` (the study deployment's Production branch, moved only by fast-forward from `main` on
the researcher's say; it never pushes to Armature); `feat/persistence` (closed PRs #18 and #40,
kept as reference). No branch touches Armature yet. This repository was read from a read-only clone in a scratchpad; CoQui holds no copy of it.

**What will be filed in the Armature repository**, as issues or ADRs: the six asks of §3 in order,
the ADR work beneath them, and O-P and O-Q once the merge is designed. Nothing has been filed yet.

## 7. Constraints CoQui relies on Armature keeping

Short, because each is argued above.

- Every item version stays readable by commit, forever.
- A client-supplied `@id` is accepted on first write and treated as an update on every later one;
  a create under an id that belongs to a different lineage is rejected, never overwritten.
- `fragmentId` uniqueness is validated within an item and nothing else is done with it: no
  assignment, no cross-item deduplication.
- A document is replaced in place under its id; nothing CoQui writes is ever deleted by the hub.
- A branch created for a round is written by nobody else until it is merged, left or discarded.
- An item's history exposes commit ids CoQui can store as coordinates.
- No per-person aggregate over attestations is exposed by the API (ADR-0021).
- The study's participants never appear in Armature in any form.
