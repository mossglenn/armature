# ADR-0029: Coverage Algorithm

## Status

Accepted (2026-10-08). Closes the open question PROJECT_CONTEXT recorded under "Coverage
computation algorithm". Adopts ADR-0019's eligibility rule and promotes ADR-0019 to Accepted.
Amends ADR-0007: its recompute triggers widen (decision 6), its computed field is never accepted
from a client (decision 4), and the recompute's commit is specified (decision 5). The verdict
thresholds in decision 3 are provisional under the plan's principle P9; §Consequences says what
would revise them.

## Context

ADR-0007 made `ModuleObjective.coverageStatus` a computed field and listed the writes that must
recompute it. ADR-0019 decided which items are eligible to be counted: only `Approved` items for
`coverageStatus`, and every non-`Retired` item for a second field, `projectedCoverageStatus`, so
that a reviewer sees where coverage stands and a designer sees where it is heading. Neither ADR
said how counting produces a verdict, and both left five questions open that Phase 3's write
pipeline now makes answerable:

- **What population is counted.** "The module's AssessmentItems" can mean the items placed in
  the module's assessments, or every item in the bank whose `assesses` names the objective.
- **How a count becomes a verdict.** `CoverageStatus` has four values and no thresholds.
- **Whether a client may write the field.** The generated request schema requires
  `coverageStatus` because the store requires it, so a client has to invent a value the hub then
  stores. The seed did exactly that: it marks `identify-ai-limitations` `FullyAssessed` in
  `how-ai-works` while the only item assessing it, `hallucination-mc`, is `Draft`.
- **Where the recompute is committed.** Phase 3 left an `afterWrite` hook whose comment leaned
  toward a follow-on commit by the same author; that was a placeholder, not a decision.
- **How the seed gets its values** once coverage stops being hand-seeded.

Two store facts bear on the answer, both verified in Phase 3 (`scripts/platform_checks.js`):
`ModuleObjective` is Hash-keyed on `(module, references)`, so a declaration can be found and
replaced by those fields without its id (check X1c); and `PUT create=true` over a list is one
commit that fails together, with `@capture`/`@ref` resolving within the list (checks X1, X2b, X5).

`docs/research/adr-candidates.md` proposes that a coverage verdict should one day name the
alignment model it rests on and the confidence of the alignments counted (candidate ADR-0043).
Nothing in that proposal is adopted here; decision 1 counts the alignments the schema has today,
`AssessmentItem.assesses`, and the verdict shape leaves room to name a model later.

## Decision

### 1. Coverage is a property of a module's declaration, counted over placements

An item contributes to a module's coverage of an objective only when an `ItemInstance` places it
in an `Assessment` whose `module` is that module, and the item's `assesses` contains the
objective. A bank item nobody has placed covers nothing. The same item placed in two of the
module's assessments counts once: the count is of distinct `AssessmentItem`s, not of placements.

An item placed in a module's assessment that assesses an objective the module does not declare
is not coverage of anything; it is a signal the Phase 4 coverage read reports as undeclared
assessment, so a designer can declare the objective or move the item.

Rejected: counting every bank item whose `assesses` names the objective. Every module declaring
the same objective would then report the same coverage, and `ItemInstance` membership, which
ADR-0007 lists as a trigger, would be irrelevant to the result.

### 2. Two populations, one algorithm (adopts ADR-0019)

For `coverageStatus`, an item is eligible when its placement's `status` is `Approved` and the
item's own `status` is `Approved`. Constraint 10 (ADR-0018 decision 4) makes the second condition
redundant for data written through the API; it is stated so that data written outside the
pipeline, such as the seed, is judged by the same rule.

For `projectedCoverageStatus`, an item is eligible when neither its placement nor the item is
`Retired`.

### 3. The verdict, by the number of distinct eligible items

| Eligible items | Verdict |
|---|---|
| 0 | `Uncovered` |
| 1 | `PartiallyAssessed` |
| 2 to 4 | `FullyAssessed` |
| 5 or more | `OverAssessed` |

The upper bound is one hub constant, `OVER_ASSESSED_ABOVE = 4`, in the algorithm module. It is
not stored on the `Module`: a per-module threshold enters the schema only when two reference
clients need modules to differ, which none does yet (the two-client test). Both thresholds are
provisional. What would revise them is recorded in §Consequences.

### 4. The computed fields are the hub's; a client that sends one gets 400

`coverageStatus` and `projectedCoverageStatus` are listed in `@metadata.armature.computed` on
the `ModuleObjective` class. The generator reads that list: the fields stay on the TypeScript
interface, so reads return them, and are left out of the generated request schema, so a write
that carries one fails shape validation with 400 like any unknown field. The hub fills both
before the commit. `role`, `roleRationale` and `sequence` remain the client's, as ADR-0007 said.

Rejected: keeping the field in the request schema and overwriting it. The client would be
required to supply a value the hub discards, and the request shape would misdescribe the field.

### 5. The recompute lands in the same commit as the write that caused it

After the invariants pass and before the one `PUT`, the pipeline collects the modules the batch
affects (decision 6), recomputes every declaration of each, fills the two fields on the
declarations in the batch, and appends to the list each declaration on the branch whose values
change. The store then writes the caller's documents and the recomputed declarations as one
commit, under the caller's author and reason.

Consequences this buys:

- Every commit on every branch shows coverage consistent with its items. There is no window in
  which a reader sees stale coverage, and no second write that can fail or be lost.
- One commit, one `ETag`. A client's next `If-Match` is current on arrival.
- The provenance is honest under ADR-0025: the diff of a designer's commit shows that approving
  an item moved an objective from `PartiallyAssessed` to `FullyAssessed`, attributed to the person
  and the reason that caused it.

Rejected: a follow-on commit by the same author. It leaves a window of stale coverage, can fail
on a 412 when another writer lands between the two commits with nothing to retry it, and puts a
machine-written reason under a human author, or requires a system `User` that every branch must
then carry.

The recompute reads the branch as it will look after the write, the same view the validators
use, and runs after the invariants so that it computes over a batch already known to be valid.
The recomputed declarations carry only the two computed fields changed; nothing else on them is
touched.

### 6. The triggers (amends ADR-0007 and ADR-0019 decision 4)

A write of any of these recomputes every declaration of every module it touches:

- `ModuleObjective`: its module.
- `ItemInstance`: the module of its assessment, and of the assessment it is leaving when a
  replace moves it.
- `AssessmentItem`: the module of every assessment that places it, for any change, since
  `assesses` and `status` both bear on the result.
- `Assessment`: the module it joins and the module it leaves when a replace moves it.

Recomputing a whole module rather than one declaration is deliberate: it is correct when an item
drops an objective from `assesses`, and the cost is a handful of reads at any plausible module
size.

A merge is also a write. Two branches that recompute the same declaration to different values
conflict on merge, as any derived value stored in the graph does. The merge route will recompute
the affected modules after `apply`, and a conflict confined to the computed fields will be
resolved by that recompute rather than reported. That work is part of this phase and is
recorded as open until it lands; until then such a conflict is reported like any other.

### 7. The seed computes coverage with the hub's algorithm

`scripts/seed_data.js` no longer carries coverage values. It imports the algorithm module, which
is dependency-free for this reason, and computes both fields over its own in-memory documents
before inserting them. Node 24 imports the TypeScript module directly. Any script that writes
`ModuleObjective`s outside the pipeline must do the same or the fields do not mean what the
schema says they mean.

## Verification

The recompute relies on facilities Phase 3 verified against TerminusDB v12.0.7 and needs no new
platform check: a list `PUT create=true` is one commit and fails together (checks X1, X5),
`@capture`/`@ref` resolve within the list (X2b), and a Hash-keyed document is replaced by its key
fields (X1c). The algorithm and the pipeline step are covered by `app/lib/api/write.test.ts`
under "constraint 7": a declaration written without the fields is stored with computed values, a
declaration carrying one is a 400, and a sequence of item and placement writes walks a
declaration through `Uncovered`, `PartiallyAssessed`, `FullyAssessed` and `OverAssessed` with the
projected figure running ahead, each change in the commit of the write that caused it.

## Consequences

**Positive**

- PROJECT_CONTEXT's open question is closed; the headline intelligence output is defined,
  defensible and tested.
- Coverage can never be wrong by construction: the hub is the only writer of the fields and
  writes them in the commit that changes their inputs.
- The two figures tell the review backlog as coverage, as ADR-0019 intended. On the seed,
  `identify-ai-limitations` in `how-ai-works` reads `Uncovered` with `PartiallyAssessed` projected,
  and `evaluate-appropriate-use` in `risks-and-ethics` the same, each because of one unreviewed
  item.

**Negative**

- Every write of the four trigger types costs reads proportional to the affected modules'
  declarations, assessments and placements. Acceptable at demo scale; the place to revisit is a
  WOQL query that fetches a module's placements in one round trip.
- A commit's diff touches declarations the caller did not name. That is the honest record of the
  event, but clients that reason about "what did I change" must expect it.
- Until the merge recompute lands, two branches that move the same declaration conflict on merge
  and the conflict is reported as a 409.
- The thresholds are a guess. `FullyAssessed` at two items follows the usual practice of
  wanting more than one observation per objective; `OverAssessed` above four has no evidence
  behind it. Item statistics from the outcomes importer (Phase 6) are the first evidence that
  could set them; a module-level threshold is the first structural change, and only if two
  clients need modules to differ.
- Adding `projectedCoverageStatus` as a required field is a breaking schema change at demo
  scale: `load_schema.js --clear-instances` then `seed_data.js`.

**Neutral**

- `CoverageStatus` is unchanged; its documentation gains the thresholds.
- The seed's document count is unchanged; its coverage values change to the computed ones.

## Related

- ADR-0006 — constraints and computed consistency are the API's responsibility
- ADR-0007 — `ModuleObjective` as programmatic junction; amended by decisions 4 to 6
- ADR-0018 — item readiness; constraint 10 is why decision 2's second condition is redundant for API writes
- ADR-0019 — eligibility by readiness; adopted and promoted by this ADR
- ADR-0024 — Hash keys on junctions, which let the recompute replace a declaration by its fields
- ADR-0025 — the commit is the unit of design process data; decision 5 keeps the recompute inside it
- ADR-0027 — schema self-description; `@metadata.armature.computed` extends it
- ADR-0032 — the resolved identity authors the commit the recompute rides in
- Candidate ADR-0043 (`docs/research/adr-candidates.md`) — alignment models; not adopted
