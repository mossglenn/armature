# Knowledge components and alignment models: plan

*Status: draft 2026-11-11, for review; nothing here is decided. It proposes the order of the tests, studies and decisions that would take the schema from "objectives are the only skills it knows" to a designer's knowledge-component model as design data (option (b) below), with competing alignment models (option (c), candidate ADR-0043) layered on later. Each stage has a gate: a result that stops the sequence or changes its direction. The questions in §10 are open, each with the recommendation the plan is written to. The schema sketches in §4 are illustrations to test, not proposals to adopt; the ADRs of §6 decide the shapes.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), AFM (Additive Factors Model), BKT (Bayesian Knowledge Tracing), BRD (a CTAT behavior graph file), CTAT (Cognitive Tutor Authoring Tools), ITS (intelligent tutoring system), KC (knowledge component), LFA (Learning Factors Analysis), PFA (Performance Factors Analysis).

---

## 1. Purpose

A knowledge component is a unit of what a learner must know or be able to do to perform a step: finer than an objective, and the unit an adaptive system tracks. Armature has no place for one. ADR-0010 deferred knowledge components "until the use case is concrete", and the DataShop bridge plan (`docs/datashop-bridge-plan.md` §16) declines a KC class, exporting objectives as KCs instead.

That is enough to *test* an alignment. It is not enough to *design* a tutor or adaptive content, for three reasons:

- **Grain.** Objectives are written for people; KCs are cognitive units, often several per objective. Writing KCs as objectives would fill coverage with rows that are never declared by a module and give Bloom's levels to things that have none.
- **Lifecycle.** An objective changes by a design decision. A KC model changes by evidence: a learning curve, an LFA split.
- **The policy runs on KCs.** A mastery-learning system picks the next problem per KC (OATutor's default picks the problem with the lowest average mastery across its KCs; §3). A design whose KC model lives only in the delivery tool cannot be inspected, traced or reviewed.

The distinction this plan rests on: **a KC model the designer writes before delivery is design data**, a hypothesis like an alignment; **a KC model discovered from learner data stays in DataShop** until a person adopts it, by a commit, prompted by a finding. That keeps the DataShop plan's line ("a researcher's KCs stay DataShop's") and its principle (data proposes, people decide) while giving the designer's own model a home.

The direction, as chosen 2026-11-11:

- **(b) now:** `KnowledgeComponent` as a design record, linked to the objectives it supports, with items (and later steps) naming the KCs they exercise.
- **(c) later, on top of (b):** competing alignment models (candidate ADR-0043), so that more than one step-to-KC mapping can be held and compared. KCs keep one identity across models; models differ in the mappings.

Boundaries that hold throughout:

- **Armature records the design of an adaptive system and never runs it** (`docs/research/learning-data-standards-precedents.md`, "Never orchestrate delivery"; `docs/how-armature-works.md`: not an adaptive learning engine). Mastery thresholds, BKT priors and selection heuristics are the delivery tool's configuration; their intent and rationale are design data.
- **No learner data in the graph** (ADR-0058). Fitted parameters arrive as metrics about a KC, never as rows.
- **Every schema change has an ADR first, passes the two-client test, and is additive** (CLAUDE.md, Development Principles 4 and 6; ADR-0010).

---

## 2. What the schema has today

Checked against `schema/schema.json` at `d9cb71d` (2026-11-11).

| Adaptive-design concept | Armature today | Gap |
|---|---|---|
| Curriculum, unit | `Module`, `Lesson` | None |
| Problem set with adaptive selection | `LearningActivity` (`activityType: Practice`) plus `ActivityItemLink` with no `sequence`; ADR-0061 decision 3: "Absent `sequence` means the activity does not order its items" | Selection policy, as a `DesignNote` for now |
| Problem | `AssessmentItem` | Only single-step `ItemType` values |
| Step | A fragment, addressed by `{item, fragmentId}` (ADR-0023, ADR-0033) | No step fragment kind; ADR-0033 decision 4 reserves `parts: List<Fragment>` |
| Anticipated wrong answer, bug message | `ItemOption.isCorrect`, `feedback`, `purpose` | Item level only, not per step |
| Knowledge component | `LearningObjective`, by convention in the DataShop plan | No class (ADR-0010) |
| KC model | The alignment at a commit (DataShop plan §3); candidate ADR-0043 | Not adopted |
| Behavior graph, solution paths | `Attachment` by hash (ADR-0030) | None; stays opaque |
| Fitted parameters, learning curves | `LearningMetric` (`subject: DesignRecord`; ADR-0058) | Nothing finer than an objective to attach a per-KC metric to |
| The same problem as practice and on a post-test | `ActivityItemLink` and `ItemInstance` on one item | None |

The three levels of a tutor already have homes: **the problem set is an activity, the problem is an item, the step is a fragment**. What is missing is the skill model and, at the finest grain, the step.

```
Module
 └─ Lesson / ModuleActivityLink
     └─ LearningActivity (Practice)             ← problem set, mastery unit
         └─ ActivityItemLink (no sequence)      ← an unordered pool
             └─ AssessmentItem                  ← problem
                 ├─ exercises → KnowledgeComponent ── supports → LearningObjective   (stage 4)
                 └─ parts: StepFragment[]       ← steps                                (stage 7)
                     └─ exercises → KnowledgeComponent
```

---

## 3. What the precedents show

**[A]** marks what the source documents; **[C]** what papers or code show; **[?]** what nobody has checked. Stage 1 verifies [C] and [?].

| Source | Where KCs attach | KC-to-objective | Other structure | Evidence |
|---|---|---|---|---|
| CTAT example-tracing tutors | Behavior-graph links (steps); "any number of skill labels" per link; a skill has a name, a category and a label | [?] | Hints only on correct links, in levels; the BRD records each skill's `opportunities`, the number of links it is attached to | [A] CTAT wiki, [Annotating a Behavior Graph](https://github-wiki-see.page/m/CMUCTAT/CTAT/wiki/Annotating-a-Behavior-Graph), [Skill Attributes and Behavior](https://github.com/CMUCTAT/CTAT/wiki/Skill-Attributes-and-Behavior) |
| OATutor | Steps, through one skill model per content source (`src/content-sources/*/skillModel.json`) | [?] | Problems, steps, hints and scaffolds as JSON in git, CC BY 4.0; adaptive selection by lowest average mastery across a problem's KCs | [A] [CAHLR/OATutor](https://github.com/CAHLR/OATutor), [OATutor-Content](https://github.com/CAHLR/OATutor-Content) |
| OLI Torus | Objectives attached per activity part; its DataShop export carries an activity's objectives with each attempt | Objectives are the KCs | Activities with parts | [C] `docs/research/learning-data-standards-precedents.md` (per part); DataShop plan §2 (the export) |
| DataShop | Step to one or more KCs per named model; two baselines | None; a KC model is flat | Opportunity counts per KC; curve categories | [A] DataShop plan §2 |
| Learning Commons Knowledge Graph | "Learning components" beside standards and progressions | [?] How they relate to standards | Provenance on every relationship | [C] `docs/research/schema-precedents-and-plugin-candidates.md` ("effectively the deferred knowledge components") |

Two things stand out. **Every tutor source attaches KCs to steps, not problems**, so item-grain KCs (stage 4) are a first step, not the whole answer. And **CTAT already counts opportunities per skill when the author saves a problem**. Design-time opportunity coverage (stage 6) is a check tutor authors already rely on, not an invention.

---

## 4. Target shape, to be tested

Illustrations the stages test. Names and cardinalities are §10's questions.

```json
"KnowledgeComponent": {
  "@inherits": "ArmatureDocument",
  "@key": { "@type": "Random" },
  "@metadata": { "armature": { "category": "artifact" } },
  "supports": { "@type": "Set", "@class": "LearningObjective" }
}

"AssessmentItem": {
  "exercises": { "@type": "Set", "@class": "KnowledgeComponent" }
}

"StepFragment": {
  "@inherits": "Fragment", "@subdocument": [], "@key": { "@type": "Random" },
  "kind":      "xsd:string",
  "sequence":  { "@type": "Optional", "@class": "xsd:integer" },
  "responses": { "@type": "List", "@class": "ItemOption" },
  "hints":     { "@type": "List", "@class": "TextFragment" },
  "exercises": { "@type": "Set",  "@class": "KnowledgeComponent" }
}
```

The rules they would carry:

1. **`assesses` stays the coverage predicate.** Coverage, the alignment read and Narrative 1 do not change meaning. The objectives an item's KCs support are *implied* objectives, computed on read (ADR-0056), and a mismatch is reported, never enforced: "the KCs of this item's steps support LO-4, which it does not assess."
2. **KCs attach wherever DataShop's step is.** That is the item for a single-step item and the step for a multistep one, never both on one item (a constraint), so the export to DataShop is unambiguous (DataShop plan §6).
3. **`supports` is a back-reference on the child** (ADR-0004), many-to-many, and may be empty, as an item may be unaligned (ADR-0060).
4. **A KC is a `DesignRecord`**, so notes, findings, attestations and metrics about a KC need no schema of their own. "Step s3 exercises KC x" can be attested with a `claimRef` (ADR-0028), which records whether the tag came from a subject-matter expert or from data.
5. **The direct field is the preferred model.** When alignment models arrive (stage 9), `exercises` and `assesses` remain the current view that coverage reads, and alternative models sit beside them. This is the split the research recommends for `assesses` (`docs/research/learning-data-standards-precedents.md`, "Keep `assesses` as a hot predicate, add provenance beside it"), so stage 9 adds records and migrates none.

---

## 5. How the sequence is built

- **Every stage asks one question and names the result that would stop the sequence.** A stop leaves the schema as it was; the study that found it is the record.
- **Studies come before checks, checks before ADRs, ADRs before schema** (CLAUDE.md, Workflow: "Platform assumptions get a lettered check … before an ADR relies on them").
- **Item grain before step grain.** KCs on items stand alone and serve single-step items, the DataShop bridge's M1 and M2, and CoQui's banks. Steps need ADR-0033's generic path or ADR-0034, which is a larger change; a stall there should not hold KCs back.
- **Branches before alignment-model records.** Armature's commit graph already holds competing models: a branch is the same items with different mappings. A model record is added only when two models must be read together at one ref (stage 9).
- **Tests follow CLAUDE.md's rule:** included unless very unlikely to show a real problem or very costly; every constraint has a failing and a passing test; the contract suite runs over `app.request()` against the store and over the file-backed store (`filestore/contract.test.ts`).

---

## 6. The sequence

### Stage 0 · The reference client and its questions

**Question.** Is there a reference client that needs KCs, stated in the terms the two-client test uses?

**Work.**
- Add a reference client to `.claude/PROJECT_CONTEXT.md` and `docs/development-plan.md` §2: **Tutor and adaptive content designer**. What it does: designs problems, steps and practice pools for an ITS or adaptive platform. What it needs from the hub: a KC model linked to objectives; KC tags on items and steps; opportunity counts per KC over a pool; KC-level traces; KC-level metrics back from DataShop.
- Add its questions to `docs/research/graph-questions.md`, each with the shape that answers it:
  - Which KCs supporting this module's objectives have fewer than *n* opportunities in its practice pools? (closure plus count)
  - Which items assess an objective that none of their KCs supports, and the reverse? (a check over two paths)
  - Which objectives have no KC? Which KCs support no objective? (something missing)
  - Which KCs did this commit's changes touch, and which pools does that affect? (across time)
  - Which items and steps does this DataShop finding's KC reach? (fixed path)

**Tests.** None in code. Amos reviews the client row and the questions.

**Gate.** The second client. The DataShop bridge consumes a KC model (outcomes importer), and the rich item authoring tool needs steps. If Amos does not see a tutor or adaptive designer among Armature's audiences for the next year, the sequence stops here and the DataShop bridge keeps objectives as KCs.

### Stage 1 · The mapping study

**Question.** Where do real tutor sources attach KCs, how stable are KC identities, and does any source relate KCs to objectives?

**Work.** `docs/research/tutor-content-mapping.md`, in the form of `quiqui-mapping.md` and `tessera-mapping.md` (source at a commit, read as text, no code run), over:

- **OATutor-Content:** one textbook's problems, steps, hints, scaffolds and `skillModel.json`.
- **CTAT:** a published example-tracing BRD with skill labels and its `productionRule` inventory.
- **OLI Torus:** a multi-part activity with objectives per part, from the source the DataShop plan cites.
- **DataShop:** a public dataset's KC models, as the consumer.

For each, record: where KC labels attach (problem, step, link); how many KCs per step, and how often more than one; how KCs are named and whether names change between versions; whether anything relates a KC to an objective or standard; whether steps are ordered, unordered or alternative paths; where hints and bug messages live.

**The no-schema exercise.** On a scratch branch of a local store, model one OATutor problem set with today's classes: KCs as `LearningObjective`s by the DataShop convention, a `Practice` activity with an unordered pool, the problem JSON attached by hash, the policy in a `DesignNote`. List every place it breaks or misleads (coverage rows, Bloom's levels, the Design Graph's objective column, the alignment read). The list is the evidence for stage 3's ADR.

**Tests.** The exercise's break list, with the reads that show each break.

**Gate.** If, in at least two sources, KCs map one to one onto something objective-shaped and the exercise breaks nothing a designer would notice, objectives are enough: stop, record the finding, and amend nothing. If KCs attach only to steps in every source, move stage 7 ahead of stage 4.

### Stage 2 · Platform checks

**Question.** Does the store do what the target shape relies on? New lettered checks in `scripts/platform_checks.js`, from AP on, against the pinned TerminusDB v12.0.7:

| Check | What it probes | Relied on by |
|---|---|---|
| AP | A `Set` of document references on an abstract-typed subdocument inside a `List`, typed to a document class: loads, round-trips, and survives a replace that regenerates nested ids (check J4's case) | `StepFragment.exercises` |
| AQ | Deleting a document referenced only from inside a nested subdocument: refused, as check AC found for a top-level reference | KC deletion |
| AR | The store's diff reports a change to a reference set inside a nested fragment at field level (as J3 does for text) | History and staleness of step tags |
| AS | A template query by a reference inside a subdocument; if the store cannot, `Graph.where` lists it (check Y's pattern) | "Which steps exercise KC x" |
| AT | Export and re-import (check AE's path) with references from nested subdocuments to documents | Export profiles, a workspace hub's clone |

The file-backed store gets the same cases in its contract test, since a workspace hub must hold the same data (ADR-0066). AP to AT are needed only for stage 7; stage 4 needs nothing the store has not shown (a `Set` of references on a document is what `assesses` already is, and check Y queries it).

**Gate.** If AP or AQ fails, step-level KCs become a junction document (`StepComponentLink` over `(item, fragmentId, kc)`, Hash-keyed) rather than a field on a fragment. Stage 7's ADR records which, and why.

### Stage 3 · ADR: knowledge components

**Question.** What exactly is added, and what is refused?

**Work.** ADR-0070 (the next number past ADR-0069), Proposed, Nygard format with In brief, Alternatives and Verification:

- `KnowledgeComponent`: an artifact, `ArmatureDocument`, `@key: Random`, client-supplied identifier allowed (ADR-0024); `supports: Set<LearningObjective>`, optional.
- `AssessmentItem.exercises: Set<KnowledgeComponent>`, optional.
- Rule 1 of §4 as a read: the implied objectives and the mismatch, on the alignment read or beside it.
- What it refuses: Bloom's levels on a KC; KC prerequisites (§9); any learner-model parameter as a field.
- Alternatives with reasons: (a) objectives as KCs, (c) KCs only as labels inside an alignment model, (d) KCs only in DataShop.
- Amendments: ADR-0010's "Knowledge components" section (a dated note); the DataShop plan's §3 and §16, which change when the ADR is accepted.
- The client revision it needs in `docs/client-changes.md`, with a CoQui note (CoQui reads items and must tolerate `exercises`).

**Tests.** None in code. The ADR names the tests stage 4 writes.

**Gate.** Amos accepts, revises or declines. An accepted ADR changes only by dated notes after that, so consistency fixes go in while it is Proposed.

### Stage 4 · Build: KCs at item grain

**Work.** CLAUDE.md, Workflow, "After schema changes": the schema, `npm run generate:types`, `npm run check:types`, the appendix, committed together. Then:

- **Invariants.** Constraint 0 already checks that `exercises` and `supports` point at the declared class; no new constraint is needed at item grain. If §10 question 2 makes `supports` required, it is `@min_cardinality` (ADR-0013), a 400 on shape.
- **Seed.** A seventh commit in `scripts/seed_data.js` giving Module 3's items KCs, including one item whose KCs imply an objective it does not assess and one KC that supports no objective, so the reads have something to find. The operator's `check` stays clean over it (CI).
- **Reads.** The trace accepts `KnowledgeComponent` (today a 400 `untraceable_type`) and follows item to KC to objective; impact analysis reaches KCs through the schema's reference fields with no change; history and diff work as for any document.
- **Export.** `KnowledgeComponent` in the `full` slice (it inherits `DesignRecord`) and added to `outcomes-loop` in `slices.json`; the pseudonymous profile keeps it, since it names no person.
- **The viewer.** An entry in `app/lib/graph/stages.ts` (stage, hue, glyph) beside objectives; the Design Graph's tests on the seed.
- **Capability.** A revision in `version.ts` `REVISIONS` and `docs/client-changes.md`; a client at an older revision still reads items.

**Tests.**

| Test | Fails when |
|---|---|
| Write and read a KC, with and without `supports` | The class or its key is wrong |
| An item with `exercises` naming an objective, then a `User` | Constraint 0 does not cover the new fields |
| Implied objectives on the seed | The mismatch item or the orphan KC is not reported |
| Trace from a KC and to a KC | The trace's type list or walk misses it |
| Impact of a KC change | A referencing item is not reached |
| Export round trip with KCs | AE's path drops or mangles the new references |
| The file-backed store's contract test with the seventh commit | The two stores disagree on any read |
| A client at the previous revision reads an item with `exercises` | Capability negotiation does not hold |
| The Design Graph on the seed | An unplaced class breaks the layout |

**Acceptance.** The contract suite and the viewer's tests green in CI; `docs/how-armature-works.md`, `docs/schema-guide.md`, `docs/api.md` and `docs/demo-coverage.md` updated as each describes the change.

### Stage 5 · The DataShop bridge at KC grain

**Question.** Does the designer's KC model give DataShop something objectives do not?

**Work.** Revise `docs/datashop-bridge-plan.md` (§3 vocabulary, §5 step 4, §7, §16): `push-model` writes two columns per commit, `KC (Armature <commit>)` from KCs and `KC (Armature <commit> objectives)` from objectives (§10 question 7), and `pull` writes AFM parameters and curve categories as metrics about KCs, with the objective-level view rolled up on read rather than stored (ADR-0056).

**Tests.** On the bridge's synthetic dataset (its §12): both models import, DataShop fits both beside its baselines, and `pull` writes metrics whose `subject` is a KC. Recorded responses replayed in the bridge's CI.

**Gate.** The demo question: on the synthetic dataset, the KC-grain model fits differently from the objective-grain one in a way a designer would act on. If the two are indistinguishable even on data generated to separate them, KCs are not earning their place in the demo, and the plan's later stages wait for a real dataset.

### Stage 6 · Design-time reads at KC grain

**Question.** Which KC reads does the hub serve, and which do clients derive?

**Work.** Opportunity coverage: for each KC, the steps and items that exercise it across a module's practice pools (`ActivityItemLink`) and across its assessments (`ItemInstance`), counted separately. This is the "practiced" figure ADR-0061 decision 4 left open, at KC grain, and CTAT's per-skill `opportunities` count (§3) is its precedent. Decide by the two-client test whether it is a hub read or a client derivation; the tutor designer and the DataShop bridge's "Too little data" finding are the two askers.

**Tests.** The read against stage 0's questions on the seed; a pool with a KC below the threshold; a KC exercised only in an assessment; a formative use and a placement of the same item counted once in each population.

**Gate.** If the read is built in the hub, it gets its own ADR (it annotates ADR-0061 and ADR-0029; coverage's meaning is untouched). If clients derive it, the module-content and alignment reads must expose what they need, which is the test.

### Stage 7 · ADR and build: steps as fragments

**Question.** Is the step a typed fragment, and does it carry KCs?

**Work.** An ADR, either ADR-0034 (reserved for interaction types and renderers "when the first non-text question type is needed") or a new number (§10 question 4): `StepFragment`, `AssessmentItem.parts`, a `MultiStep` value of `ItemType` with each step's interaction in `kind`, `responses` reusing `ItemOption`, hints as a `List<TextFragment>`, `exercises` on the step or a junction (stage 2's gate). New constraints, numbered from 23:

- **KCs at one grain.** An item with `parts` carries `exercises` on its steps, not on itself (`kc_grain_conflict`).
- **Constraint 8 over the nested tree.** `fragmentId` unique across every fragment of an item, hints and responses inside steps included.
- **Step `sequence` unique within an item where present** (`duplicate_sequence`, as constraints 4, 5 and 17); absent means unordered, since CTAT's steps can be unordered or alternative paths.

**Tests.** Each new constraint failing and passing; a finding and an attestation on a step and on a hint inside it by `fragmentId` (constraint 16); a client that knows no step type enumerates the fragments and reads their text (ADR-0033 decision 5); CoQui's read of an item with `parts`; the file-backed store's contract test; the DataShop bridge's step map onto `{item, fragmentId}` with a KC column from steps.

**Gate.** Stage 1 must have shown step-level KCs in at least two sources. If the mapping study shows steps whose structure varies too much to type, the step lands as ADR-0033's `GenericFragment` with a `kind` and a JSON payload first, and is promoted when it settles.

### Stage 8 · KC metrics and findings from data

**Work.** The DataShop bridge's `pull` and `compare-models` at KC grain, through stage 5's revisions: AFM slope, intercept and curve category as metrics about KCs; findings on KCs ("no learning across 9 opportunities"); `compare-models` reports a discovered model's split or merge of the designer's KCs as a finding on each KC concerned. The designer answers on a branch: split the KC, re-tag the steps, push the new commit's model.

**Tests.** The bridge's contract tests against a seeded hub; a finding on a KC traced to its steps, items and objectives (Narrative 1 at KC grain).

**Gate.** None; this is the loop the earlier stages exist for. It shows whether the branch-per-model approach of stage 9 is enough.

### Stage 9 · Alignment models, option (c)

**Question.** When must two models be held at one ref, and what is the smallest record that holds them?

**Trigger.** One of: a researcher's alternative KC model must stay on `main` beside the designer's (a study comparing them over terms); an adaptive platform runs an experiment between two models of the same content; Narrative 1's "at-risk objective" must say which of several models it rests on (candidate ADR-0043). Until a trigger arrives, a model is the mappings at a commit, and alternatives are branches.

**Work.** An ADR adopting candidate ADR-0043 at a new number. Shapes to weigh:

- **(i) Branches and commits only.** No schema. Two models are two refs; comparing them is a diff. Fails when two models must be read together at one ref.
- **(ii) An `AlignmentModel` record with mapping junctions.** A named model, its provenance (designed, discovered by LFA, imported from DataShop with the dataset in `externalRefs`) and Hash-keyed junctions over `(model, item, fragmentId, kc)`. The direct `exercises` and `assesses` fields stay the preferred model (§4 rule 5).
- **(iii) Models as attestation sets.** Each mapping an attestation of a claim. Reuses ADR-0028 but bends it: an attestation is one person's verdict, not a model's membership.

Recommendation, to test: (i) until a trigger, then (ii). KCs keep one identity across models (that is what (b) under (c) means), so a model adds mappings and never forks the KCs.

**Tests.** The trigger case as a contract test: two models on one ref, a coverage or alignment read naming its model, the preferred model unchanged; adopting a discovered model as a merge that rewrites the direct fields, with the model record kept as provenance.

---

## 7. Tests at a glance

| Stage | Where the tests live | What they protect |
|---|---|---|
| 1 | `docs/research/tutor-content-mapping.md`; a scratch branch | That the shape answers real content |
| 2 | `scripts/platform_checks.js` AP to AT; `filestore/contract.test.ts` | The store behaviors the ADRs cite |
| 4 | `app/lib/api/*.test.ts` (write, intelligence, export, client), `app/lib/graph/` | KC writes, reads, export, negotiation, the viewer |
| 5, 8 | The DataShop bridge's repository: recorded responses, contract tests against a seeded hub | KC models out, KC metrics and findings back |
| 6 | `app/lib/api/intelligence.test.ts`, or the client's tests | Opportunity coverage |
| 7 | `invariants/` tests for constraints 23 onward; `fragments.ts` tests | Steps, nested fragment identity, grain |
| 9 | `app/lib/api/*.test.ts` | Coexisting models without changing coverage |

---

## 8. Documents each stage changes

- **When this plan is accepted:** the README's table of plans, and SESSION.md's What's Next.
- **Stage 0:** `.claude/PROJECT_CONTEXT.md` (reference clients), `docs/development-plan.md` §2, `docs/research/graph-questions.md`.
- **Stage 1:** `docs/research/tutor-content-mapping.md` (new); `docs/development-plan.md` §6 if it raises a question.
- **Stage 3:** the ADR, its index row, a dated note on ADR-0010.
- **Stage 4:** `schema/schema.json`, the generated types, `docs/SCHEMA_APPENDIX.md`, `docs/client-changes.md`, `docs/api.md`, `docs/schema-guide.md`, `docs/how-armature-works.md`, `docs/demo-coverage.md`, `scripts/seed_data.js`, `app/lib/api/export/slices.json`, `app/lib/graph/stages.ts`, `docs/visual-language.md`.
- **Stage 5:** `docs/datashop-bridge-plan.md` (§3, §5, §7, §16).
- **Stages 6, 7, 9:** their ADRs and the same human-facing documents as stage 4.

---

## 9. What is deliberately not built

- **Learner-model parameters as fields.** BKT's four parameters, PFA's coefficients or a mastery threshold on a KC would tie the schema to one learner model while BKT, AFM, PFA and deep knowledge tracing all have users. The policy's rationale is a `DesignNote` (a `DesignNoteCategory` value such as `AdaptivePolicy`, when one is asked for); its parameters are the delivery tool's file, attached by hash.
- **Behavior graphs as structure.** Solution paths, production rules and the engine's matching stay in the attached BRD or content file (ADR-0030). Armature records the steps, their tags and the review of them.
- **KC discovery.** LFA, KCluster and their kin run in DataShop or LearnSphere; Armature records the result a person adopts.
- **Bloom's levels on KCs**, or anything that treats a KC as a small objective.
- **For now, by trigger:** KC prerequisites (generalizing `PrerequisiteRecord`, when an engine consumes a KC prerequisite graph); `Misconception` as a document (when `ItemOption.purpose` text repeats across items, which passes the reuse test ADR-0022 used to keep options embedded); item templates (candidate ADR-0052, "the first parameterized item bank"); a `measure` enum beside `LearningMetric.unit` (SESSION.md item 11), which KC metrics add evidence for.

---

## 10. Questions to settle

Each with the options and the recommendation the plan is written to.

1. **The field name for item-to-KC and step-to-KC.**
   - (a) `exercises`, a verb beside `assesses` and `targets`.
   - (b) `kcs` or `components`, a noun.
   - (c) `requires`.

   *Recommendation: (a).* It reads as a relation like its neighbors. Its risk is reading as the noun ("exercises"), which the field's documentation addresses. (c) collides with prerequisite language.

2. **Whether `supports` is required.**
   - (a) Optional, as `assesses` is (ADR-0060).
   - (b) At least one objective (`@min_cardinality`).

   *Recommendation: (a).* KC models are often drafted bottom-up from steps, before their objectives are settled; an orphan KC is reported by the read (§4 rule 1), not refused.

3. **A lifecycle on KCs.**
   - (a) Reuse `ObjectiveState` (`Draft`, `Active`, `Deprecated`, `Archived`).
   - (b) None until a client shows the need.

   *Recommendation: (b).* A KC split by evidence is a new KC and a re-tag on a branch; whether the old one needs `Deprecated` is stage 8's evidence.

4. **The steps ADR's number.**
   - (a) ADR-0034, broadened to cover multistep items.
   - (b) A new number, leaving ADR-0034 to renderers.

   *Recommendation: (b).* ADR-0034 is about interaction types and versioned renderers, a course-builder concern; steps are an authoring and evidence concern. They meet at `ItemType`, which the steps ADR extends and ADR-0034 later versions.

5. **Item grain first, or wait for steps.**
   - (a) Item grain at stage 4, steps at stage 7.
   - (b) Both in one ADR.

   *Recommendation: (a), unless stage 1 finds KCs only on steps.* Item grain is complete for single-step items and unblocks the DataShop bridge; one ADR would hold KCs hostage to the larger fragment change.

6. **Opportunity coverage in the hub or in clients.**
   - (a) A hub read.
   - (b) Derived by clients from the module-content and alignment reads.

   *Recommendation: decide at stage 6 by the two-client test.* Leaning (a), since the DataShop bridge's finding and the tutor designer's check ask the same question.

7. **What `push-model` sends.**
   - (a) Two models per commit, KC grain and objective grain.
   - (b) KC grain only once KCs exist.

   *Recommendation: (a).* The comparison is the experiment: whether the designer's decomposition predicts learners' errors better than their objectives do. Both names fit DataShop's 50-character limit.

8. **The reference client's name.**
   - (a) Tutor and adaptive content designer.
   - (b) Adaptive learning designer.

   *Recommendation: (a).* It names both the intelligent tutoring and the adaptive-platform cases the ask comes from.

9. **The default for competing models.**
   - (a) Branches until a trigger (stage 9's (i)).
   - (b) `AlignmentModel` records from the start.

   *Recommendation: (a).* It needs no schema, and the trigger cases say when (ii) is worth its records.

---

## 11. Sequencing

Stage 0 is a short review; stage 1 one or two sessions; stage 2 one; stages 3 and 4 one or two each; stage 5 rides the DataShop bridge's M1 and M2; stage 6 one; stage 7 two or three; stage 8 rides the bridge's M3; stage 9 when its trigger arrives. Stages 0 to 2 change no schema and can run while other work continues; stage 4 is the first change a client sees.
