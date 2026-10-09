# ADR-0008: Enums Defined as Top-Level Types

> **In brief.** Several fields accept only values from a fixed list, such as the six levels of
> Bloom's taxonomy or the stages an objective passes through. This decision defined each such list
> once, as a named type of its own (an enumeration, or enum), which every field that uses it refers
> to by name. It still holds. The inventory below is out of date: the schema now has twelve enums,
> including `FindingStatus` and no longer `CoverageStatus`.

## Status
Accepted

**Note (2026-10-08):** the decision stands; the inventory in the Decision is out of date (see the
note there).

## Context
Controlled vocabularies appear throughout the schema: Bloom's taxonomy levels, objective lifecycle states, question formats, evidence collection methods, and others. These can be represented as inline string fields with no validation, or as defined enum types.

Inline strings are flexible but unconstrained — "MultipleChoice", "multiple_choice", and "MC" would all be valid, making queries unreliable. Defined enums constrain values to a known set and make them queryable as graph nodes.

The question is whether enums should be defined inline on the field or as top-level named types.

## Decision
All controlled vocabularies are defined as top-level `Enum` types in the schema. Fields reference these types by name rather than defining values inline.

The schema currently defines thirteen enums: `BloomsLevel`, `ObjectiveState`, `ItemType`, `ItemStatus`, `EvidenceMethod`, `ObjectiveRole`, `CoverageStatus`, `ActivityType`, `PrerequisiteType`, `ConfidenceLevel`, `NeedPriority`, `DesignNoteCategory`.

> **Later change (2026-10-08):** The list above says thirteen but names twelve. The schema now has
> twelve: `BloomsLevel`, `ObjectiveState`, `ItemType`, `ItemStatus`, `EvidenceMethod`,
> `ObjectiveRole`, `ActivityType`, `PrerequisiteType`, `ConfidenceLevel`, `NeedPriority`,
> `DesignNoteCategory`, `FindingStatus`. `FindingStatus` was added by ADR-0020. `CoverageStatus`
> left the schema with ADR-0056; its four values survive only as the coverage read's vocabulary.
> `docs/SCHEMA_APPENDIX.md` is the generated, current list.

## Consequences
- Enum types are reusable. `BloomsLevel` is referenced by both `LearningObjective` and `AssessmentItem` — they share the same vocabulary, enabling Bloom's alignment queries across both types.
- Adding a new value to an enum requires changing only the enum definition, not every document type that uses it.
- Enum values are queryable as graph nodes in TerminusDB's RDF layer.
- Enum type names are self-documenting in field definitions — `"bloomsLevel": "BloomsLevel"` is immediately legible.
- Removing or renaming an enum value is a breaking change that requires a migration. Enum values should be chosen carefully and named for long-term stability.
