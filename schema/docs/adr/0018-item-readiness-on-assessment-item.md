# ADR-0018: Item Readiness Belongs on AssessmentItem, Not Only on ItemInstance

## Status
Proposed

## Context

`ItemStatus` (Draft, InReview, Approved, Retired) is declared only on `ItemInstance`, and the schema is explicit that it is scoped to a placement:

> "Review lifecycle state of an ItemInstance within a specific Assessment. Draft: not yet reviewed. InReview: under SME or editorial review. Approved: cleared for administration. Retired: removed from active use."

`ItemInstance` further records that "all fields are required — there is no reasonable default for sequence, point value, or review status when placing an item in a formal assessment."

So SME review **was** anticipated. It was modelled at the delivery-configuration layer.

### Why that placement fails

`AssessmentItem` is documented as "a single reusable question or task in the item bank... exists independently of any specific Assessment." Three consequences follow:

1. **An item that has never been placed carries no review state at all.** The item bank — the thing an authoring tool operates on — has no concept of readiness. An item can be written, reviewed by a subject expert, corrected and approved, and none of that is representable until someone puts it in a test.

2. **An item reused in three assessments carries three independent states.** ADR-0002 makes reuse a first-class capability; this makes reuse fragment the review record. Nothing identifies which of the three answers "is this question correct?"

3. **Two different questions are collapsed into one field.** *"Is this item factually correct and properly aligned?"* is a property of the item and travels with it everywhere. *"Is this item cleared for use in this particular assessment?"* is a property of the placement — and is legitimately separate, since an item can be sound but inappropriate here, or embargoed because it is in use on a pre-test.

The defect is not that the field is in the wrong place. It is that **two distinct states exist and the schema has only one of them.**

## Decision

### 1. Add `status: ItemStatus` to `AssessmentItem`, required

The bank item's own review lifecycle. Required, so that every item carries a deliberate state and absence is never ambiguous. `Draft` is the state on creation.

### 2. `ItemInstance.status` is retained, with narrowed documentation

It continues to mean placement clearance — cleared for administration *in this assessment*. Its `@comment` is updated to say so, and to point at `AssessmentItem.status` for the item's own readiness.

### 3. Reuse the existing `ItemStatus` enum on both types

The four values are already correct for both. This follows the precedent set by `BloomsLevel`, whose documentation states it is "used on both LearningObjective and AssessmentItem — sharing this enum enables alignment queries between the two types."

The same benefit applies here. Sharing the enum makes a consistency check expressible as a graph query: *find ItemInstances marked Approved whose AssessmentItem is not Approved.*

### 4. API constraint: a placement may not be cleared ahead of its item

An `ItemInstance` may not be `Approved` while its `AssessmentItem.status` is `Draft` or `InReview`. A placement of an unreviewed question cannot be cleared for administration.

TerminusDB cannot express a cross-document conditional, so this is enforced by the API on write, following ADR-0006.

### 5. The hub carries the minimum vocabulary; plugins carry their own workflow

`ItemStatus`'s four values are meaningful to any tool. Finer workflow states — "revision needed", "parked pending a policy decision", "awaiting second reviewer" — are plugin concerns and are not added here. A tool with a richer lifecycle maps its states onto these four at the boundary.

This is deliberate: importing one application's workflow vocabulary into the schema is the failure mode ADR-0010's progressive-formalization stance exists to prevent. If several tools converge on the same additional state, that is evidence to revisit.

## Consequences

**Positive**

- The item bank gains a review state, which is a precondition for any authoring or review tool built on Armature.
- An item's review record survives reuse rather than fragmenting across placements.
- The item-level and placement-level questions become separately answerable.
- Enables ADR-0019 — coverage cannot account for readiness while no readiness exists.
- Item/placement inconsistency becomes a queryable condition rather than an invisible one.

**Negative**

- Schema change requiring `npm run generate:types` and a paired commit.
- Six seeded `AssessmentItem` documents need a status backfilled. Varying them (rather than setting all to `Approved`) will make the coverage demo more informative once ADR-0019 lands.
- `docs/demo-api.md` needs the field added to `GET /items` and `POST /items`.
- A new API-enforced invariant (decision 4) to implement and test.
- Two fields named `status` now exist on related types. Mitigated by documentation and by the fact that they are genuinely different states; the shared enum is what makes the relationship between them legible.

**Neutral**

- No existing `ItemInstance` data changes meaning.

## Related

- ADR-0002 — references not ownership; why item reuse exists and why fragmenting its review record matters
- ADR-0004 — back-references; why the item/instance split exists at all
- ADR-0006 — constraints enforced by the API
- ADR-0008 — top-level enums, shared across types
- ADR-0019 — coverage semantics, which depends on this
