# ADR-0006: Minimum Cardinality Constraints Enforced by API, Not Schema

> **In brief.** Every assessment question and every learning activity must point to at least one
> learning objective. This decision, made when the database (TerminusDB) could not enforce "at least
> one" itself, gave that check to Armature's application programming interface (API). It was
> replaced by ADR-0013 (an ADR is an Architecture Decision Record), which moved the rule into the
> database schema once the database supported it. Its broader idea, that rules the database cannot
> express are checked by the API, lives on in the API's invariants engine.

## Status
Superseded by ADR-0013

**Superseded by ADR-0013** (applied 2026-02-26, commit `44d13b8`; noted 2026-10-08). The general
principle in this ADR's consequences, that rules TerminusDB cannot express are enforced by the API,
is no longer carried by a live ADR. It is implemented by the invariants engine
(`app/lib/api/invariants/index.ts`; constraints 0 to 12 in `.claude/CLAUDE.md`). Later ADRs that
cite ADR-0006 for that principle (ADR-0014, ADR-0016, ADR-0017, ADR-0018, ADR-0019,
ADR-0020, ADR-0022, ADR-0029) mean the principle, not this minimum-cardinality decision.

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

> **Later change (2026-10-08):** ADR-0013 was accepted and applied on 2026-02-26; both fields carry
> `@min_cardinality: 1` in `schema/schema.json`. The API's check is now the generated Zod request
> schema (`app/lib/schemas.ts`), which turns `@min_cardinality` into `.min(1)` and answers an empty
> set with 400 before the write reaches the store (constraints 1 and 2).
