# ADR-0004: Back-References on Children, Not Arrays on Parents

## Status
Accepted

## Context
For one-to-many relationships with a clear ownership direction, there are two ways to model the association: store a list of child IDs on the parent, or store the parent ID on each child.

Storing lists on the parent (e.g., `Assessment.itemInstances: List<ItemInstance>`) keeps navigation intuitive but creates unbounded arrays that grow without limit. An assessment with 100 items has an array of 100 references. Updating an item's membership requires fetching and rewriting the parent document.

Storing the parent reference on the child (e.g., `ItemInstance.assessment: Assessment`) keeps parent documents lean regardless of how many children exist. Adding a child is a write to the child document only.

## Decision
For all one-to-many relationships with a clear parent/child direction, the foreign key lives on the child document:

- `Response.item → AssessmentItem`
- `ItemInstance.assessment → Assessment`
- `Assessment.module → Module`
- `Module.course → Course`
- `ModuleObjective.module → Module`
- `LearningObjective.generatedBy → LearningNeed` (one need generates zero or more objectives; each objective optionally references its originating need)

Parent documents contain no arrays of child references.

## Consequences
- Parent documents remain lean regardless of how many children they have.
- Adding or removing a child is a write to the child document only — the parent is not touched.
- Fetching all children of a parent (e.g., "all ItemInstances in an Assessment") requires a query filtering on the child's back-reference. This is handled efficiently by TerminusDB and abstracted by the API layer.
- The pattern is consistent with TerminusDB's document model conventions.
