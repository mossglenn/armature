# ADR-0006: Minimum Cardinality Constraints Enforced by API, Not Schema

## Status
Superseded by ADR-0013

## Context
Two relationships in the diagram have mandatory minimum cardinality:
- `AssessmentItem` must assess at least one `LearningObjective`
- `LearningActivity` must target at least one `LearningObjective`

An assessment item with no objective mapping has no place in the artifact graph — it cannot contribute to coverage analysis. A learning activity that targets no objectives is similarly unanchored.

TerminusDB's `Set` type does not support minimum cardinality constraints at the schema level. A `Set` can be empty and the schema will not reject the document.

## Decision
Both constraints are documented in the schema via `@documentation` comments and enforced by the Armature API before any write. The schema uses `Set` for both fields; the API validates that at least one element is present before committing.

`AssessmentItem.assesses` — API rejects any create or update that would leave this set empty.
`LearningActivity.targets` — API rejects any create or update that would leave this set empty.

## Consequences
- The schema remains valid TerminusDB JSON — no non-standard extensions needed.
- Enforcement is centralized in the API layer, which is the appropriate location for business rules that TerminusDB cannot express.
- Direct database writes that bypass the API can violate this constraint. This is acceptable for a system where the API is the intended access path.
- The constraint is documented in the schema itself so contributors understand it is intentional, not an oversight.

## Note
TerminusDB now supports `@min_cardinality` on `Set` types in recent versions. Migrating these constraints to schema-level enforcement is the intended next step — see ADR-0013 (proposed). The migration is conditional on verifying support in the installed TerminusDB version before applying the schema change. API enforcement remains in place regardless and will continue to provide descriptive error messages.
