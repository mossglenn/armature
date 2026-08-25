# ADR-0019: Coverage Semantics Account for Item Readiness

## Status
Proposed — depends on ADR-0018

## Context

ADR-0007 makes `ModuleObjective.coverageStatus` a computed field, recomputed after "any change that affects the coverage calculation: modifications to `AssessmentItem.assesses`, `ItemInstance` additions/removals, or `ModuleObjective` role changes."

`CoverageStatus` is documented as reflecting "whether the module's AssessmentItems adequately cover a declared objective" — `Uncovered`, `PartiallyAssessed`, `FullyAssessed`, `OverAssessed`.

**Readiness is absent from that calculation.** An objective assessed only by unreviewed draft items reports as covered.

This fails in the worst available direction. Coverage is Armature's headline intelligence output and the payoff of the demo narrative; as specified it produces confidently wrong output rather than an error, and it does so in every workflow that has a review step — which is every real workflow. A course could report full coverage on the strength of questions no subject expert has ever seen.

### Scope

PROJECT_CONTEXT records an open question: "What exactly makes a `CoverageStatus` value FullyAssessed vs. PartiallyAssessed? Needs definition before the API can implement it."

That remains open and is **not** settled here. Two separable questions:

- *What counts as adequate coverage?* — open, out of scope
- *Do unapproved items count toward it?* — this ADR

## Decision

### 1. `coverageStatus` counts only items whose readiness is `Approved`

`Draft`, `InReview`, and `Retired` items do not contribute. Retired is included in the exclusion deliberately: an objective assessed only by retired items is uncovered, not covered.

The field keeps its name and its meaning narrows. Any existing consumer therefore receives a stricter answer than before — coverage may drop, never rise. Understating is the safe direction for a field whose failure mode is false confidence.

### 2. Add `projectedCoverageStatus: CoverageStatus`, computed over all non-retired items

Both of Armature's stated demo narratives need an answer, and they need different ones:

- **Narrative 1** (outcomes to design) asks whether delivered assessment adequately covered an objective. That is `coverageStatus`.
- **Narrative 2** (graph-informed authoring) has CoQui "surface which objectives are under-assessed" *while a designer is working*. Approved-only would report a module mid-authoring as almost entirely uncovered, hiding real progress at exactly the moment the designer needs to see it. That is `projectedCoverageStatus`.

Two fields, one enum. A designer sees where the work is heading; a reviewer sees where it actually stands; the gap between them is itself informative — it is the review backlog, expressed as coverage.

### 3. Rejected: a new `CoverageStatus` value such as `ProvisionallyAssessed`

This keeps one field but collapses two independent dimensions — *how much coverage* and *how ready* — into a single enum. The cross-product is eight states, and every future refinement to either dimension multiplies against the other. Two fields keep the dimensions separable.

### 4. ADR-0007's recompute triggers are amended

Add: **any change to `AssessmentItem.status`.**

Approving an item now affects coverage for every objective it assesses, in every module declaring those objectives. This is a meaningful increase in recompute frequency — approval becomes a graph-wide event rather than a local one.

Acceptable at demo scale. SESSION.md already records that `ModuleObjective` filtering happens in application code rather than WOQL as known tech debt; this ADR increases the cost of that shortcut and should be cited when it is revisited.

## Consequences

**Positive**

- Coverage stops overstating itself. The demo's headline output becomes defensible under scrutiny — a reviewer asking "covered by what, reviewed by whom?" gets an answer.
- Both demo narratives are served by the same computed field family.
- The delta between the two figures is a genuinely useful signal: objectives whose coverage depends on unreviewed work.
- Retired items stop silently propping up coverage.

**Negative**

- Depends on ADR-0018; meaningless without it.
- Recompute frequency rises materially, and the trigger set is now wide enough that missing one produces silently stale data. The ADR-0007 warning that "any write that affects coverage must trigger a recompute" becomes harder to honour.
- `docs/demo-api.md`'s `GET /coverage/:moduleId` response and its `summary` block need the second figure.
- Seeded data will show different coverage than it does today. The demo's intentionally-`Uncovered` objective may need revisiting so the two figures tell a legible story rather than an accidental one.

**Neutral**

- No new enum. `CoverageStatus` is reused for both fields.

## Open

The coverage algorithm itself — what makes an objective `PartiallyAssessed` rather than `FullyAssessed` — remains undefined, as recorded in PROJECT_CONTEXT. This ADR defines only which items are eligible to be counted, not how counting produces a verdict. Both fields use the same algorithm over different populations, so defining it once serves both.

## Related

- ADR-0007 — `ModuleObjective` as programmatic junction; amended by decision 4
- ADR-0018 — item readiness, which this depends on
- ADR-0006 — the API's responsibility for constraints and computed consistency
