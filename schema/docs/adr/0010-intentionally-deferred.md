# ADR-0010: Intentionally Deferred Schema Features

## Status
Accepted

## Context
Several features were identified as potentially valuable but excluded from the initial schema to keep the design focused and the implementation scope manageable for the demo phase.

A broader principle governs deferral decisions throughout Armature: **the schema should not pre-design structure that real usage hasn't yet revealed.** Text fields on rationale-bearing documents (e.g., `LearningNeed.rationale`, `PrerequisiteRecord.rationale`) are intentionally provisional — they preserve semantic content in a queryable, portable form while the graph accumulates enough real design process data to reveal what structure is actually warranted. When patterns emerge, those text fields can be progressively formalized into enums, structured types, or junction documents. The infrastructure is designed to support that migration path: optional fields can be added alongside existing ones without breaking existing records, and junction documents can be introduced to carry new structure without touching the connected artifact types. This is a deliberate epistemological position: collect first, structure when you understand.

## Decision
The following are intentionally absent from the current schema:

### Versioning and change history
No `version`, `createdAt`, or `updatedAt` fields on any document type. TerminusDB provides built-in branch and commit history at the database level — every write is recorded with a timestamp and can be traversed. This may be sufficient for Armature's needs without per-document version fields. Revisit when branching and diffing use cases become concrete.

### Authorship and provenance
~~No `createdBy` or `updatedBy` fields. These would require a `User` or `Agent` type and an authentication model. Deferred until the multi-user collaboration use case is defined. When added, the cleanest approach is a shared abstract base class (`ArmatureDocument`) that all primary artifact types inherit, rather than adding fields individually.~~
**Implemented. See ADR-0015 (Accepted). `User` type added as standalone document. `createdBy: Optional<User>` added to `ArmatureDocument`, propagating to all 13 inheriting types. `updatedBy` deliberately omitted — change history tracked at TerminusDB commit level.**

### ArmatureDocument abstract base class
~~Defining `ArmatureDocument` as a shared abstract base for `label`/`description` fields (and eventually `createdBy`/`updatedBy`) is architecturally correct but deferred to keep the current change set focused. Nine artifact types currently duplicate the same `label: xsd:string` and `description: Optional<xsd:string>` pattern. When authorship fields become concrete, introduce `ArmatureDocument` and migrate all nine types to inherit from it in a single commit.~~
**Implemented. See ADR-0014 (Accepted). All 13 primary artifact types now inherit from ArmatureDocument. `DesignNote.subject` retyped from `xsd:anyURI` to `Set<ArmatureDocument>`.**

### Schema-level minimum cardinality
~~`@min_cardinality: 1` on `AssessmentItem.assesses` and `LearningActivity.targets` is the intended next step for ADR-0006. Implementation is gated on verifying TerminusDB support in the installed version — see ADR-0013 (proposed) and ADR-0006 Note.~~
**Implemented. See ADR-0013 (Accepted). ADR-0006 superseded.**

### DesignDecision structured type
`DesignNote` (added) provides free-form rationale capture. A structured `DesignDecision` type — with fields for alternatives considered, tradeoffs, and affected artifacts — is the intended second layer when real usage patterns in `DesignNote.category` indicate what structure is needed. A forward pointer slot (`relatesToDecision`) is reserved on `DesignNote` for when this type is implemented. See ADR-0012.

### NeedObjectiveDerivation reification
The `LearningObjective.generatedBy` back-reference is sufficient for the demo phase. If the need-to-objective translation process itself becomes a first-class workflow — capturing derivation rationale, type (DirectTranslation, PartialResponse, Compromise), or multiple derivation paths — a `NeedObjectiveDerivation` junction document would replace the simple back-reference. Defer until the needs-analysis workflow is a concrete feature target.

### Knowledge components
The diagram notes knowledge components as future work for `ActivityGroup` reusability beyond the flat single-level constraint. Not modeled until the use case is concrete.

### xAPI, LTI, and QTI integration points
Interoperability with external standards is an API-layer concern — the schema does not need to model it. xAPI statements reference Armature documents by URI; LTI launch parameters are passed at delivery time; QTI export is a serialization of `AssessmentItem` and `Response` data. None require schema changes.

### Response structure for complex item types

`ItemType` declares eight formats: MultipleChoice, MultipleSelect, TrueFalse, ShortAnswer, Essay, Matching, Ordering, FillInTheBlank. Its documentation states that the item type "determines the valid Response structure."

`Response` offers no structural variation — content, `isCorrect`, `incorrectFeedback`, and a back-reference to its item. That is sufficient for MultipleChoice, MultipleSelect, and TrueFalse; approximately sufficient for ShortAnswer (responses as accepted answers); and insufficient for the remainder:

- **Matching** requires pairs
- **Ordering** requires a correct sequence — a boolean `isCorrect` cannot express "third"
- **FillInTheBlank** requires indicating which blank an answer belongs to
- **Essay** has no response set at all, and no home for a rubric

This is deliberate rather than an oversight. The first tool built on Armature targets multiple choice, and formats beyond it are not needed to validate the graph infrastructure. Modelling response structures for formats no tool yet authors would be designing structure that real usage has not shaped — the general principle stated at the top of this ADR.

When it becomes concrete, the likely approaches in increasing order of change: restrict `ItemType` to the formats the schema supports and reintroduce values as they are implemented; introduce `Response` subtypes per format family, following the `LearningEvidence` pattern (ADR-0001); or add a structured answer field.

One constraint carries forward from ADR-0016: `Ordering` would require a sequence field on `Response`, which is mutable, and no key may include a mutable field. ADR-0016's replacement of `Response`'s Hash key with `Random` already accommodates this.

## Consequences
- The schema is simpler and more focused for the demo phase.
- Each deferred feature has a clear rationale for deferral and a note on the likely implementation approach when the time comes.
- TerminusDB's database-level history reduces the urgency of per-document versioning — this should be evaluated before adding version fields.
