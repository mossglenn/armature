# ADR-0005: Module Content Sequencing via Shared Integer Space

## Status
Accepted

## Context
A module's content is heterogeneous — it can contain standalone LearningActivities and ActivityGroups, interleaved in a pedagogically meaningful order. These are stored in two separate junction document types: `ModuleActivityLink` and `ModuleActivityGroupLink`.

Within an ActivityGroup, activities also have a pedagogical order, represented by `ActivityGroupMember.sequence`.

The question is how to represent the full two-level hierarchy: position of items/groups within the module, and position of activities within a group.

One option is a composite key — encoding both levels into a single value like "2.1" (group 2, activity 1). This is compact but introduces ambiguity: "2.10" and "2.1" are the same decimal, and the separator is fragile.

Another option is two independent integers: one for module-level position, one for group-level position. These are never combined.

## Decision
Module-level sequence is stored as a plain integer on both `ModuleActivityLink.sequence` and `ModuleActivityGroupLink.sequence`. These two fields share the same integer namespace — they are sorted together to produce the module's ordered content list.

Group-level sequence is stored as a plain integer on `ActivityGroupMember.sequence`. It is entirely independent of module-level sequence — a sub-sequence within the group only.

The two integers are never combined, concatenated, or compared across levels.

```
Module
  ModuleActivityLink:      sequence=1  → standalone LearningActivity
  ModuleActivityGroupLink: sequence=2  → ActivityGroup
    ActivityGroupMember:   sequence=1  → first activity in group
    ActivityGroupMember:   sequence=2  → second activity in group
    ActivityGroupMember:   sequence=10 → tenth activity in group (unambiguous)
  ModuleActivityLink:      sequence=3  → standalone LearningActivity
```

## Consequences
- Sequencing is unambiguous at both levels — 10 means 10, not "after 9 but before 11 at some fractional position."
- Gaps are permitted (1, 2, 10 is valid) to allow insertion without full renumbering. The schema does not enforce uniqueness or contiguity — that is the API's responsibility.
- The API is responsible for merging `ModuleActivityLink` and `ModuleActivityGroupLink` records, sorting by `sequence`, and composing the hierarchical view.
- A standalone activity and a group at the same sequence value is a data error — the API must prevent it.
