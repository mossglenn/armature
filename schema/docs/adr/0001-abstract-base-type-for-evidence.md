# ADR-0001: Abstract Base Type for Learning Evidence

## Status
Accepted

## Context
The schema needs to model two distinct kinds of learning evidence: quantitative metrics (e.g., assessment scores, pass rates) and qualitative findings (e.g., interview observations, document reviews). Both share common metadata — label, description, collection date, and source — and both serve the same role in the needs analysis graph: they inform LearningNeeds and can be linked via NeedEvidenceLink.

A naive approach would define two fully independent document types with duplicated fields. A single flat type with an optional `method` and optional `value` would be permissive but lose type safety — a metric without a value, or a qualitative finding without a method, would be valid at the schema level.

## Decision
Define `LearningEvidence` as an abstract base class (`@abstract: []`) with the shared fields: `label`, `description`, `collectedAt`, `source`. Define `LearningMetric` and `DescriptiveEvidence` as concrete subtypes using `@inherits: "LearningEvidence"`, each adding only their type-specific fields.

`LearningEvidence` cannot be instantiated directly. Tools always create and interact with the concrete subtypes.

## Consequences
- Shared fields are defined once and inherited — no duplication, no divergence risk.
- The `NeedEvidenceLink.evidence` field can type to the abstract `LearningEvidence`, accepting either subtype at runtime. This is idiomatic TerminusDB polymorphism.
- Adding a third evidence subtype in the future (e.g., `ObservationalEvidence`) requires only a new class with `@inherits: "LearningEvidence"` — no changes to existing types or junction documents.
- TerminusDB enforces that concrete subtypes include all required inherited fields.
