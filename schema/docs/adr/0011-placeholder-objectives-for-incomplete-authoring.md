# ADR-0011: Placeholder Objectives for Incomplete Authoring States

## Status
Accepted

## Context
`PrerequisiteRecord` reifies the prerequisite relationship between two LearningObjectives. The record carries required fields — `rationale`, `prerequisiteType`, `objective`, and `prerequisite` — because a prerequisite relationship without a type or rationale is underspecified (ADR-0009).

During authoring, designers sometimes know that an objective has a prerequisite before they have identified or written that prerequisite objective. The previous schema made `prerequisite` Optional to accommodate this state, but this produced structurally incomplete records: relationships with only one end. One-ended relationships cannot participate in graph traversal (sequencing analysis, dependency detection, gap identification) and complicate `@key` generation on the record.

An alternative approach — adding a `recordState` field (Draft/Complete) — would create two sources of truth about the same fact, since the prerequisite objective's own `ObjectiveState` already expresses whether it is finished.

## Decision
`PrerequisiteRecord.prerequisite` is required. A PrerequisiteRecord must connect two real LearningObjective documents.

When a designer knows a prerequisite exists but the specific objective hasn't been written yet, the workflow is:
1. Create a new `LearningObjective` in `Draft` state (e.g., label: "TBD: prerequisite for Objective X").
2. Create the `PrerequisiteRecord` linking to that draft objective.
3. Update or replace the draft objective as authoring progresses.

This is the "create prerequisite objective" button workflow: the button creates the objective first (in Draft state), then creates the record. The record is structurally complete from the moment it's created; the prerequisite objective is semantically incomplete until its Draft state is resolved.

If the prerequisite relationship is suspected but no specific objective can even be stubbed out yet, capture that intent as a `DesignNote` with `category: PrerequisiteIntent` rather than creating an incomplete `PrerequisiteRecord`. See ADR-0012.

## Consequences
- The prerequisite graph is always fully traversable — every `PrerequisiteRecord` is a complete edge.
- `@key` on `PrerequisiteRecord` uses `["objective", "prerequisite"]` cleanly, with no ambiguity from null values.
- The `Draft` value on `ObjectiveState` is the single source of truth about an objective's completeness — no redundant state field needed on the record.
- Tooling must provide affordances to surface and resolve Draft placeholder objectives (e.g., a "prerequisites needing attention" view that filters for PrerequisiteRecords where the prerequisite's state is Draft).
- Incomplete intent that cannot yet be attached to a Draft objective is captured via `DesignNote`, keeping the prerequisite graph free of dangling semantics.

## Related
ADR-0003 (reified relationships), ADR-0004 (back-reference pattern), ADR-0009 (semantic enrichments), ADR-0012 (DesignNote)
