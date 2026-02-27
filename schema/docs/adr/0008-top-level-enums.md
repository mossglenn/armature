# ADR-0008: Enums Defined as Top-Level Types

## Status
Accepted

## Context
Controlled vocabularies appear throughout the schema: Bloom's taxonomy levels, objective lifecycle states, question formats, evidence collection methods, and others. These can be represented as inline string fields with no validation, or as defined enum types.

Inline strings are flexible but unconstrained — "MultipleChoice", "multiple_choice", and "MC" would all be valid, making queries unreliable. Defined enums constrain values to a known set and make them queryable as graph nodes.

The question is whether enums should be defined inline on the field or as top-level named types.

## Decision
All controlled vocabularies are defined as top-level `Enum` types in the schema. Fields reference these types by name rather than defining values inline.

The schema currently defines thirteen enums: `BloomsLevel`, `ObjectiveState`, `ItemType`, `ItemStatus`, `EvidenceMethod`, `ObjectiveRole`, `CoverageStatus`, `ActivityType`, `PrerequisiteType`, `ConfidenceLevel`, `NeedPriority`, `DesignNoteCategory`.

## Consequences
- Enum types are reusable. `BloomsLevel` is referenced by both `LearningObjective` and `AssessmentItem` — they share the same vocabulary, enabling Bloom's alignment queries across both types.
- Adding a new value to an enum requires changing only the enum definition, not every document type that uses it.
- Enum values are queryable as graph nodes in TerminusDB's RDF layer.
- Enum type names are self-documenting in field definitions — `"bloomsLevel": "BloomsLevel"` is immediately legible.
- Removing or renaming an enum value is a breaking change that requires a migration. Enum values should be chosen carefully and named for long-term stability.
