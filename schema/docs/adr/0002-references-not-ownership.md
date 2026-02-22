# ADR-0002: All Relationships Use References, Not Ownership

## Status
Accepted

## Context
TerminusDB distinguishes between two relationship models: *owned* subdocuments (the child's lifecycle is controlled by the parent — deleting the parent deletes the child) and *referenced* documents (independent documents linked by ID — each has its own lifecycle).

Ownership is simpler to query but prevents reuse. A LearningActivity owned by one Module cannot appear in another. An AssessmentItem owned by one Assessment cannot be reused in a pre-test and post-test. The Armature diagram explicitly models reuse: activities in multiple modules, items in multiple assessments.

## Decision
All relationships in the schema use references — every document type is independently addressable and has its own lifecycle. No subdocument ownership is used anywhere in the schema.

## Consequences
- Reuse patterns from the diagram are structurally supported: activities can appear in multiple modules and groups, items can appear in multiple assessments, groups can appear in multiple modules.
- Every document can be independently queried, updated, or deprecated without affecting documents that reference it.
- Deleting a referenced document does not cascade automatically — the API must handle orphan detection and referential integrity.
- Fetching a complete module view requires traversal queries rather than simple document retrieval. This is handled at the API layer.
