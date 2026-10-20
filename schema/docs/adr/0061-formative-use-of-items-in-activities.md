# ADR-0061: Formative Use of Items Inside Activities

> **In brief.** This decision answers: how does Armature record that a question is asked inside a
> learning activity, such as a live poll during a lecture or a practice question on a content
> page, rather than in a graded test? Until now a question could reach a module only through an
> assessment, which carries points and clearance, so such uses had no place in the graph. A new
> small link record, `ActivityItemLink`, names the activity, the question and, when it matters,
> the order. Formative uses carry no score and count toward nothing: coverage still counts graded
> placements only. The trace shows where a question is used in passing, and impact analysis
> reaches it. (ADR stands for Architecture Decision Record.)

## Status

Accepted and implemented (2026-10-20). Adds `ActivityItemLink` and constraint 17. Resolves the
`docs/development-plan.md` §6 question "Items used formatively, inside activities". Annotates
ADR-0003 (a third kind of multi-valued relationship), ADR-0005 (the ordered module-content view
nests an activity's items) and ADR-0029 (the population coverage counts is unchanged).

## Context

An item reaches a module only as a placement (`ItemInstance`) in an `Assessment`, which belongs to a
module and carries summative fields: points, randomization and placement clearance (ADR-0018). A
`LearningActivity` names the objectives it targets but cannot reference an item. So "lecture 3 polls
the room with item X" and "this practice page asks these three questions" cannot be recorded.

Two tools mapped in October 2026 do exactly this: QuiQui runs live polls inside a session
(`docs/research/quiqui-mapping.md` §4) and Tessera places standalone questions on content pages
(`docs/research/tessera-mapping.md`). The activity and strategy designer reference client would
plan the same thing. The ask passes the two-client test.

Coverage (ADR-0029 decision 1) deliberately counts items placed in a module's assessments and
nothing else; a question asked in passing is practice, not evidence that an objective is assessed.
Whatever shape formative use takes must leave that count alone.

The question was raised with three candidate shapes, assessed on 2026-10-20:

- **A set of items on `LearningActivity`.** The smallest change, and impact analysis would reach it
  at once. But a set is unordered, and polls happen in an order; and the use carries nothing
  else, no "graded or not", no purpose. ADR-0003's test says a relationship that carries data is a
  junction, and this one carries order from the first client. Starting with a set would mean a
  migration the day order is wanted.
- **A junction between activity and item with its own `sequence`.** The pattern every other
  placement uses (`ItemInstance`, `ModuleActivityLink`, `ActivityGroupMember`). It carries order
  now and, under ADR-0010, a purpose or a grading note later without a breaking change. A Hash key
  over (activity, item) mirrors `ItemInstance`'s one placement per item per container. Reads can
  tell formative use from summative placement, so coverage stays honest and a "practiced" figure
  remains possible. The cost is a new type, a sequence rule, and a second kind of container for
  an item.
- **A formative `Assessment`.** Reuses `ItemInstance` for order and points, but an `Assessment`
  belongs to a module, not an activity, so saying "this poll is inside lecture 3" needs a new
  reference anyway; its placements would count toward coverage unless an eligibility rule excluded
  them, which changes ADR-0029's two populations; and assessments are not in the module sequence
  ADR-0005 defines, so the poll would not appear in order. It conflates a graded instrument with a
  question asked in passing.

## Decision

### 1. `ActivityItemLink`, a relationship record

```json
"ActivityItemLink": {
  "@key": { "@type": "Hash", "@fields": ["activity", "item"] },
  "activity": "LearningActivity",
  "item": "AssessmentItem",
  "sequence": "Optional<xsd:integer>"
}
```

Category `relationship`, inheriting `DesignRecord` like the other placement junctions, so notes,
findings and attestations can be about a use. It carries no points, no clearance and no verdict:
those belong to `ItemInstance` and to the assessment it sits in. Fields a later client needs (a
purpose, a grading note) are added as optional fields beside `sequence` (ADR-0010), never by
reusing `ItemInstance`.

### 2. One use per item per activity

The key is a Hash over (activity, item): the store derives the identifier, a client never supplies
one (ADR-0024), and writing the same pair again replaces the use, which keeps `sequence` freely
editable. An activity that asks the same item twice is two activities or one use; the key is
revisited if a client shows otherwise, as `ItemInstance`'s is (plan §6).

### 3. Constraint 17: `sequence` is unique within an activity

`ActivityItemLink.sequence` is independent of every module-level and group-level sequence
(ADR-0005) and must be unique within one activity, checked by the invariants engine as
`duplicate_sequence` (`invariants/moduleContent.ts`, beside constraints 3 and 4). Absent
`sequence` means the activity does not order its items; gaps are permitted.

### 4. Formative use counts toward nothing

Coverage (ADR-0029 decision 1) and the alignment read are unchanged: an objective practiced in an
activity and assessed nowhere is still `Uncovered`, and an item used only formatively is still in
no objective's count. A "practiced" figure beside `delivered` and `projected` is a later decision
on ADR-0019, taken when a client asks for it, never a change to what "assessed" means.

### 5. The reads reach it

The trace follows an item downstream to the activities that use it, through the link, beside its
placements; an activity reached is shown with the modules it is placed in, as context, like an
assessment with its module. Impact analysis reaches a use through the schema's reference fields, as
it reaches every junction, naming the activity it sits in. The ordered module-content view ADR-0005
assigns to the API (unbuilt; plan §6) nests an activity's items by `sequence` under the activity
when it is built.

## Consequences

**Positive**

- A poll, a practice set or a question on a content page is recorded where it happens, in order,
  without pretending to be a test.
- A change to an item shows every lecture and page that asks it, not only the tests it is placed
  in.
- Coverage keeps its meaning; the schema can later say what practice contributes without
  reinterpreting what assessment means.
- An additive schema change: existing data is untouched and the schema loads without clearing.

**Negative**

- An item now has two kinds of container. "Where is this item used" is two lookups (`ItemInstance`
  and `ActivityItemLink`), and a client that shows usage must know both.
- Another junction type, another sequence rule, another case in the trace's tables.

**Neutral**

- The seed has no activities, so formative use is shown only in tests until the seed gains some.
- No client writes `ActivityItemLink` yet; QuiQui's and Tessera's mappings name it as the target
  for their formative uses when adapters are written.

## Open

- **A `purpose` on the use** (practice, check for understanding, discussion prompt), as an
  optional enum when a client records it as text first (ADR-0010).
- **A "practiced" coverage figure** (decision 4), on evidence from the activity designer.
- **The same item twice in one activity** (decision 2), on evidence from an import.

## Related

- ADR-0002, ADR-0003 — references, and when a relationship is a junction; ADR-0003 annotated
- ADR-0004 — the link names its activity and item; neither holds a list of uses
- ADR-0005 — module content sequencing; the composed view nests an activity's items; annotated
- ADR-0010 — progressive formalization, how the use gains fields
- ADR-0018, ADR-0029 — placement clearance and coverage, both untouched; ADR-0029 annotated
- ADR-0024 — Hash-keyed records take no client id
- ADR-0060 — an item may be unaligned; a formative use of one is still recorded
- `docs/research/quiqui-mapping.md` §4, `docs/research/tessera-mapping.md` — the evidence
- `docs/development-plan.md` §6 — the question resolved
