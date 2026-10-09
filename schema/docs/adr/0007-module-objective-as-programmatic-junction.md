# ADR-0007: ModuleObjective as Programmatic Junction with Computed Fields

> **In brief.** A module declares which learning objectives it teaches; the record of that
> declaration (`ModuleObjective`) holds the objective's role in the module and the reason for it.
> This decision also made that record store a coverage status (how well the module's assessments
> test the objective) and said only the application programming interface (API) would create it.
> Both parts have since changed: coverage is no longer stored but calculated each time it is asked
> for (ADR-0056), and any client creates these records through the ordinary document routes. The
> role, rationale and order fields still stand. (ADR stands for Architecture Decision Record.)

## Status
Accepted for `ModuleObjective` as the reified, programmatic declaration carrying `role`,
`roleRationale` and `sequence`. **Superseded in part by ADR-0056 (2026-10-08):** `coverageStatus`
is no longer a field. Coverage is computed at read time by the intelligence routes from the
module's placements, at any commit, and never stored; the recompute triggers this ADR and ADR-0019
decision 4 listed have nothing to trigger. The "double duty" this ADR's consequences describe has
ended: the junction is a design record only.

**Amended by ADR-0019** (decision 4: item status changes added to the recompute triggers) **and by
ADR-0029** (decisions 4 to 6: how the stored field was to be kept true), both 2026-10-08. Those
amendments fell with the stored field under ADR-0056. ADR-0029 decisions 1 to 3 (the population
counted, the two eligibility rules and the default thresholds) are the coverage read's default
algorithm. **Not built as written (noted 2026-10-08):** no API code creates `ModuleObjective`
"programmatically". Clients write it like any other document through
`PUT /api/v1/documents/:type/:id` and `POST /api/v1/documents`, as the seed does. The title's
"Computed Fields" no longer describes the type.

## Context
The relationship between a Module and a LearningObjective it declares is not a simple association — it carries meaningful design data: the role the objective plays in the module (Primary, Supporting, Prerequisite), an optional rationale for that role, a sequence position, and a computed coverage status.

> **Later change (2026-10-08):** `ModuleObjective` carries no computed coverage status (ADR-0056).

Two design questions arise:
1. Should designers create and edit ModuleObjective documents directly in the UI?
2. Should coverage status be a field on the document or only derivable by query?

Making ModuleObjective UI-editable adds complexity for what is often a mechanical assignment. Coverage status is computed from the relationship between declared objectives and the AssessmentItems that actually assess them — it is a derived value, not authored.

## Decision
`ModuleObjective` is created programmatically by the API when a designer designates a LearningObjective as belonging to a Module. It is not directly created or edited through the UI.

> **Later change (2026-10-08):** Not what was built. `ModuleObjective` is written by clients through
> the generic document API (`PUT /api/v1/documents/:type/:id`, `POST /api/v1/documents`), like every
> other type, and the invariants engine checks it on the way in. Whether a designer edits it
> directly is a choice for each client's interface, not the hub's.

`coverageStatus` is a computed field updated by the API after any change that affects the coverage calculation:
- When an `AssessmentItem.assesses` set is modified
- When an `ItemInstance` is added to or removed from an `Assessment`
- When a `ModuleObjective` is created or its `role` is changed

The values of `CoverageStatus` (Uncovered, PartiallyAssessed, FullyAssessed, OverAssessed) represent the API's analysis of how well the module's assessments cover the declared objective.

> **Later change (2026-10-08):** Superseded by ADR-0056: there is no `coverageStatus` field and
> nothing to recompute. `GET /api/v1/intelligence/coverage/:moduleId` computes the verdict at any
> commit with ADR-0029 decisions 1 to 3: the distinct items placed in the module's assessments that
> assess the objective, counted twice (Approved placements of Approved items, and everything not
> Retired). The default cut is 0 `Uncovered`, 1 `PartiallyAssessed`, 2 to 4 `FullyAssessed`, 5 or
> more `OverAssessed` (`DEFAULT_THRESHOLDS` in `app/lib/api/intelligence/coverage.ts`, overridable
> by query parameters). The four values are the read's vocabulary; there is no `CoverageStatus` enum
> in the schema.

`role` and `roleRationale` are the designer-facing fields — they can be updated through the UI after the ModuleObjective is created.

## Consequences
- Designers work with a simple mental model: "assign an objective to a module, set its role."
- Coverage status is always fresh relative to the current graph state, not stale data from a previous analysis.
- The API bears responsibility for keeping `coverageStatus` consistent. Any write that affects coverage must trigger a recompute.
- `ModuleObjective` serves double duty: it is both a design record (role, rationale) and a computed intelligence output (coverageStatus). This is intentional — the junction document is the natural place for both.

> **Later change (2026-10-08):** The second, third and fourth consequences no longer apply. Coverage
> is fresh because it is computed at the requested commit, the API has no stored value to keep
> consistent, and `ModuleObjective` is a design record only (ADR-0056).
