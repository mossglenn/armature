# ADR-0060: Items May Exist Unaligned

> **In brief.** This decision answers: must every assessment question name a learning objective
> before Armature will store it? Until now the schema required at least one, so a question could
> not exist in the hub before someone had aligned it. A question bank reviewed in October 2026
> holds questions that exist before anyone aligns them, and an importer could satisfy the rule
> only by inventing objectives. The rule is removed: a question may assess nothing, it then
> counts toward no objective's coverage, and the alignment read lists every such question so the
> gap is visible instead of unrepresentable. How Armature encourages alignment without requiring
> it at all times is opened as a question. (ADR stands for Architecture Decision Record.)

## Status

Accepted and implemented (2026-10-20). Amends ADR-0013: the minimum of one on
`AssessmentItem.assesses` is removed, and CLAUDE.md constraint 1 is retired.
`LearningActivity.targets` keeps its minimum (constraint 2; decision 4). Resolves the
`docs/development-plan.md` §6 question "Must every item assess an objective?" and opens
"Encouraging alignment without requiring it".

## Context

ADR-0006 and then ADR-0013 required `AssessmentItem.assesses` and `LearningActivity.targets` to hold
at least one `LearningObjective`, on the reasoning that "an item that assesses nothing has no place
in the artifact graph". The rule is shape: the generated request schema answered an empty set with
400 before the store saw it.

Two clients tested it.

- **CoQui** asked for `assesses` to be optional while an item is `Draft`, then withdrew the ask:
  its items always arrive from Armature already aligned (plan §2).
- **DQ QuestionBank Core** (`docs/research/dq-questionbank-mapping.md` §4.1) holds banks of
  questions that exist before anyone aligns them. An adapter could satisfy rule 1 only by minting a
  placeholder objective for every unaligned question, which writes a fiction into the graph and
  would count toward coverage.

Two reference clients would meet the same wall: the **outcomes importer** (items arriving from a
learning management system's bank, unaligned) and the **AI design assistant** (drafts proposed
before a person aligns them).

Nothing in the hub depends on the rule. Coverage (ADR-0029) counts, per objective, the distinct
items placed in a module's assessments whose `assesses` names that objective; an item that assesses
nothing is in no count, by construction. The alignment read scopes items by the objectives they
assess; an unaligned item is in no scope. Impact analysis and the trace read references and find
none. The rule did not keep anything false out of the reads; it kept a true state of the design
(this item is not yet aligned) out of the graph, where no read could report it and no finding could
be raised about it.

The position paper's bet is that design data is captured as a byproduct of work, and the history of
rationale tools says the barrier at entry is what kills capture (`docs/how-armature-works.md`,
Section 29). A hub that refuses to hold a question until it is aligned puts the barrier at the
door.

## Decision

### 1. `AssessmentItem.assesses` is a set of zero or more objectives

`@min_cardinality` is removed from the field. The generator renders a set without a minimum as
optional in the request schema, so a body may send `assesses: []` or omit the field; the store
returns no field for an empty set, and every reader treats an absent `assesses` as none
(`idsIn` in `intelligence/graph.ts` already does). Existing documents conform, so the schema
loads without clearing data.

### 2. Rule 1 is retired, and nothing replaces it at write time

No invariant checks alignment on a write. An unaligned item is a state of the design, not a
violation.

### 3. The alignment read reports items that assess nothing

`GET /api/v1/intelligence/alignment` gains `itemsWithoutObjective`: without `module`, every item in
the bank with no objective; with `module`, those placed in the module's assessments. The list is
separate from `scope.items`, which still counts items that assess an objective in scope. Coverage is
unchanged: an unaligned item contributes to no verdict.

### 4. `LearningActivity.targets` keeps its minimum, for now

The reasoning above applies to activities too, and the same change follows when a client shows an
activity that exists before it targets anything (the course builder importing an existing course,
or the activity designer drafting). No client has. This is a timing decision, not a judgment that
activities differ in kind; when it is made, it is a note on this ADR, not a new one.

### 5. Alignment is encouraged, not required at all times

The hub's stance is that every item should be aligned and that an unaligned one is visible, never
that an unaligned one is refused. How the hub encourages alignment is an open question (below and
plan §6), decided on evidence from the first imported bank.

## Alternatives considered

- **Keep rule 1; importers hold unaligned items outside the hub.** Rejected. The bank is then
  partly invisible: impact analysis cannot reach the item, a finding cannot be raised about it, and
  the first act of design on it (aligning it) happens where the graph cannot record it.
- **Optional while `Draft`, as CoQui first asked.** Rejected. It ties alignment to the item's
  review lifecycle: a question approved in its source bank would still need a fiction to enter, and
  a conditional minimum is a rule the store cannot express, so shape would depend on `status`. A
  readiness gate ("not `Approved` while unaligned") is a candidate answer to the encouragement
  question, where it belongs beside rule 10, not a cardinality.
- **A placeholder objective ("Unaligned").** Rejected. A fiction in the graph, counted by
  coverage, attested by nobody.

## Consequences

**Positive**

- An imported bank enters whole, and aligning it is recorded in the graph as the design work it is.
- Drafts, human or assistant-proposed, exist before they are aligned.
- The alignment read's `itemsWithoutObjective` is the bank's to-do list, at any ref.
- A weakening schema change: no migration, no clearing of data.

**Negative**

- An item can be `Approved`, and placed, while assessing nothing; nothing at write time says so.
  The encouragement question decides whether anything should.
- A client written against the old contract may assume `assesses` is present; it must now guard
  against its absence (`docs/client-changes.md`).

**Neutral**

- The seed is unchanged: every seed item is aligned, so `itemsWithoutObjective` is empty on `main`
  and the behavior is shown in tests.
- Rule 2 stands, so the explainer's rule table keeps one "at least one objective" row.

## Open

- **Encouraging alignment without requiring it at all times.** Candidates, none built: a readiness
  rule in the invariants engine (an item, or a placement of it, may not be `Approved` while the item
  assesses nothing; the same shape as rule 10); the coverage read naming the unaligned items placed
  in a module beside its verdicts; a `DesignFinding` a client raises from the alignment read; the AI
  design assistant proposing alignments for a person to attest (ADR-0028). Evidence to act on: the
  first imported bank, and what its users do with the unaligned list (ignore it, work through it, or
  want it to block approval). Tracked in plan §6.
- **Whether `LearningActivity.targets` follows** (decision 4).

## Related

- ADR-0006 and ADR-0013 — the rule this amends; ADR-0013 annotated
- ADR-0010 — progressive formalization: a rule added when evidence warrants, not before
- ADR-0018 — readiness, where an alignment gate would live if one is adopted
- ADR-0019, ADR-0029 — coverage counts, unchanged by this decision
- ADR-0056 — the graph holds decisions and observations; what is derived is read
- `docs/research/dq-questionbank-mapping.md` §4.1 — the evidence
- `docs/development-plan.md` §6 — the question resolved and the question opened
