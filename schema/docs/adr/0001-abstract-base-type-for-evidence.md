# ADR-0001: Abstract Base Type for Learning Evidence

> **In brief.** Armature records two kinds of evidence about what learners need: numbers (such as
> test scores or pass rates) and observations (such as interview findings). This decision created
> one shared parent type, `LearningEvidence`, that is never used on its own, so both kinds share
> their common fields while each keeps its own. It still holds. The shared name and description
> fields were later moved one level higher, to the `ArmatureDocument` base type every named record
> uses (ADR-0014; ADRs are Architecture Decision Records like this one).

## Status
Accepted

**Amended by ADR-0014** (2026-02-26; noted 2026-10-08): `label` and `description` now come from
`ArmatureDocument`, which `LearningEvidence` inherits; `LearningEvidence` itself declares only
`collectedAt` and `source`.

## Context
The schema needs to model two distinct kinds of learning evidence: quantitative metrics (e.g., assessment scores, pass rates) and qualitative findings (e.g., interview observations, document reviews). Both share common metadata — label, description, collection date, and source — and both serve the same role in the needs analysis graph: they inform LearningNeeds and can be linked via NeedEvidenceLink.

A naive approach would define two fully independent document types with duplicated fields. A single flat type with an optional `method` and optional `value` would be permissive but lose type safety — a metric without a value, or a qualitative finding without a method, would be valid at the schema level.

## Decision
Define `LearningEvidence` as an abstract base class (`@abstract: []`) with the shared fields: `label`, `description`, `collectedAt`, `source`. Define `LearningMetric` and `DescriptiveEvidence` as concrete subtypes using `@inherits: "LearningEvidence"`, each adding only their type-specific fields.

> **Later change (2026-10-08):** `label` and `description` moved to `ArmatureDocument` (ADR-0014).
> The chain is now
> `DesignRecord -> ArmatureDocument -> LearningEvidence -> LearningMetric | DescriptiveEvidence`
> (ADR-0017). The two concrete subtypes are unchanged.

`LearningEvidence` cannot be instantiated directly. Tools always create and interact with the concrete subtypes.

## Consequences
- Shared fields are defined once and inherited — no duplication, no divergence risk.
- The `NeedEvidenceLink.evidence` field can type to the abstract `LearningEvidence`, accepting either subtype at runtime. This is idiomatic TerminusDB polymorphism.

  > **Later change (2026-10-08):** TerminusDB checks only that the referenced document exists, not
  > its class (platform check L, 2026-10-07). The API checks that the target is a `LearningEvidence`
  > on every write (constraint 0, `app/lib/api/invariants/references.ts`).
- Adding a third evidence subtype in the future (e.g., `ObservationalEvidence`) requires only a new class with `@inherits: "LearningEvidence"` — no changes to existing types or junction documents.
- TerminusDB enforces that concrete subtypes include all required inherited fields.
