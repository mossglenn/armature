# ADR-0007: ModuleObjective as Programmatic Junction with Computed Fields

## Status
Accepted

## Context
The relationship between a Module and a LearningObjective it declares is not a simple association — it carries meaningful design data: the role the objective plays in the module (Primary, Supporting, Prerequisite), an optional rationale for that role, a sequence position, and a computed coverage status.

Two design questions arise:
1. Should designers create and edit ModuleObjective documents directly in the UI?
2. Should coverage status be a field on the document or only derivable by query?

Making ModuleObjective UI-editable adds complexity for what is often a mechanical assignment. Coverage status is computed from the relationship between declared objectives and the AssessmentItems that actually assess them — it is a derived value, not authored.

## Decision
`ModuleObjective` is created programmatically by the API when a designer designates a LearningObjective as belonging to a Module. It is not directly created or edited through the UI.

`coverageStatus` is a computed field updated by the API after any change that affects the coverage calculation:
- When an `AssessmentItem.assesses` set is modified
- When an `ItemInstance` is added to or removed from an `Assessment`
- When a `ModuleObjective` is created or its `role` is changed

The values of `CoverageStatus` (Uncovered, PartiallyAssessed, FullyAssessed, OverAssessed) represent the API's analysis of how well the module's assessments cover the declared objective.

`role` and `roleRationale` are the designer-facing fields — they can be updated through the UI after the ModuleObjective is created.

## Consequences
- Designers work with a simple mental model: "assign an objective to a module, set its role."
- Coverage status is always fresh relative to the current graph state, not stale data from a previous analysis.
- The API bears responsibility for keeping `coverageStatus` consistent. Any write that affects coverage must trigger a recompute.
- `ModuleObjective` serves double duty: it is both a design record (role, rationale) and a computed intelligence output (coverageStatus). This is intentional — the junction document is the natural place for both.
