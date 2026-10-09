# ADR-0002: All Relationships Use References, Not Ownership

> **In brief.** This decision answered how documents in Armature relate to one another: does one
> document own another, so that deleting the parent deletes the child, or does it only point to it?
> It decided that relationships between documents are always pointers (references), so one question
> or activity can be reused in many places. That still holds, with one later exception: the parts of
> a single assessment item (its stem, answer options and feedback) are stored inside the item,
> because they are never reused on their own (ADR-0022 and ADR-0033; ADR stands for Architecture
> Decision Record).

## Status
Accepted

**Amended by ADR-0022 and ADR-0033** (2026-10-07; noted 2026-10-08): no relationship *between
documents* is ownership, but an item's parts (`Fragment`, which is abstract, and its specializations
`TextFragment` and `ItemOption`) are subdocuments embedded in `AssessmentItem`. They are the one
embedded exception.

## Context
TerminusDB distinguishes between two relationship models: *owned* subdocuments (the child's lifecycle is controlled by the parent — deleting the parent deletes the child) and *referenced* documents (independent documents linked by ID — each has its own lifecycle).

Ownership is simpler to query but prevents reuse. A LearningActivity owned by one Module cannot appear in another. An AssessmentItem owned by one Assessment cannot be reused in a pre-test and post-test. The Armature diagram explicitly models reuse: activities in multiple modules, items in multiple assessments.

## Decision
All relationships in the schema use references — every document type is independently addressable and has its own lifecycle. No subdocument ownership is used anywhere in the schema.

> **Later change (2026-10-08):** "No subdocument ownership is used anywhere" is no longer literally
> true. `AssessmentItem` embeds its stem, options and feedbacks as `Fragment` subdocuments
> (ADR-0022, ADR-0033). Every relationship between two documents is still a reference.

## Consequences
- Reuse patterns from the diagram are structurally supported: activities can appear in multiple modules and groups, items can appear in multiple assessments, groups can appear in multiple modules.
- Every document can be independently queried, updated, or deprecated without affecting documents that reference it.
- Deleting a referenced document does not cascade automatically — the API must handle orphan detection and referential integrity.

  > **Later change (2026-10-08):** The API offers no document deletion. Lifecycle changes are status
  > changes (`Retired`, `Dismissed`, `Archived`), and deletion is an administrative operation
  > outside the API (ADR-0024 decision 5). On every write TerminusDB checks that a referenced
  > document exists, and the API checks its class (constraint 0,
  > `app/lib/api/invariants/references.ts`).
- Fetching a complete module view requires traversal queries rather than simple document retrieval. This is handled at the API layer.
