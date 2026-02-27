# ADR-0014: ArmatureDocument Abstract Base Class

## Status
Accepted

## Context
Thirteen primary artifact types in the schema independently declared `label: xsd:string` and `description: Optional<xsd:string>`. These fields are structurally identical across all types — every named artifact in the Armature graph has a human-readable label and an optional description. The duplication creates a maintenance problem and, more critically, blocked a typed reference mechanism for `DesignNote.subject`.

`DesignNote` (ADR-0012) used `xsd:anyURI` for its `subject` field as a stopgap because there was no common type to reference. The `xsd:anyURI` approach bypassed TerminusDB's type system entirely, requiring API-layer validation for referential integrity and leaving deletion behavior unspecified.

The authorship question (ADR-0010) also points at a shared base class: when `createdBy` and `updatedBy` are added, they should propagate to all primary artifact types in a single change, not require 13 individual edits.

## Decision
Define `ArmatureDocument` as an abstract base class carrying two fields:
- `label: xsd:string` — required human-readable name
- `description: Optional<xsd:string>` — optional elaboration

Thirteen types inherit from `ArmatureDocument`:
`LearningEvidence` (abstract), `LearningDataset`, `LearningNeed`, `LearningObjective`, `PrerequisiteRecord`, `AssessmentItem`, `Response`, `Assessment`, `LearningActivity`, `ActivityGroup`, `Module`, `DesignNote`, `Course`

`LearningMetric` and `DescriptiveEvidence` inherit `label`/`description` transitively through `LearningEvidence -> ArmatureDocument`.

**Junction and structural documents are excluded:** `NeedEvidenceLink`, `ItemInstance`, `ActivityGroupMember`, `ModuleObjective`, `ModuleActivityLink`, `ModuleActivityGroupLink` do not inherit from `ArmatureDocument`. They are addressed by their relationship fields, not a human-readable name.

**`DesignNote.subject` is retyped** from `Set<xsd:anyURI>` to `Set<ArmatureDocument>` with `@min_cardinality: 1`. TerminusDB now enforces referential integrity natively — subjects must exist, the type system validates at write time, and deletion behavior follows standard document reference semantics (ADR-0002). The API-layer validation workaround described in ADR-0012 is no longer needed for subject existence checks.

## Consequences
- `label` and `description` are defined once and inherited — no duplication, no divergence risk.
- `DesignNote.subject` has typed, schema-enforced referential integrity. Write validation is handled by TerminusDB; deletion of a referenced document follows ADR-0002 reference semantics.
- When authorship fields (`createdBy`, `updatedBy`) are added, they go on `ArmatureDocument` and propagate to all 13 types in a single schema change.
- The hierarchy is two levels for evidence types (`ArmatureDocument -> LearningEvidence -> LearningMetric/DescriptiveEvidence`) and one level for all others. `LearningEvidence` remains a meaningful mid-level abstract capturing evidence-specific fields (`collectedAt`, `source`).
- Junction documents remain outside the hierarchy. Adding a new primary artifact type requires only `@inherits: "ArmatureDocument"` — no change to `DesignNote` or any other type.
- The `xsd:anyURI` stopgap in `DesignNote.subject` is fully replaced. The open questions about write validation and deletion handling documented in ADR-0012 are resolved by this change.

## Related
ADR-0001 (LearningEvidence abstract base), ADR-0002 (references not ownership), ADR-0010 (authorship deferred), ADR-0012 (DesignNote)
