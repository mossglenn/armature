# ADR-0003: Set References vs. Junction Documents for Multi-Valued Relationships

## Status
Accepted

## Context
The schema has two categories of multi-valued relationships:
1. **Objective mappings** — an AssessmentItem assesses multiple objectives; a LearningActivity targets multiple objectives. The connection is the entire relationship — no additional data is needed.
2. **Activity containment** — modules contain activities and groups; groups contain activities. These relationships require sequencing data to express pedagogical order.

TerminusDB supports two patterns: a `Set` field (an unordered collection of references on the document itself) and a junction document (a separate document that reifies the relationship and can carry its own fields).

A `Set` is simpler and more direct but is unordered by definition. A junction document adds a layer of indirection but can carry relationship-level data like `sequence`.

## Decision
Use `Set` for objective mapping relationships where ordering is irrelevant and the link carries no data:
- `AssessmentItem.assesses: Set<LearningObjective>`
- `LearningActivity.targets: Set<LearningObjective>`

Use junction documents for all activity containment relationships where pedagogical sequence matters:
- `ModuleActivityLink` — with `sequence`
- `ModuleActivityGroupLink` — with `sequence`
- `ActivityGroupMember` — with `sequence`

Use junction documents for all relationships where the relationship itself carries meaningful data (rationale, role, confidence, computed status):
- `NeedEvidenceLink` — carries `confidence`
- `PrerequisiteRecord` — carries `rationale` and `prerequisiteType`
- `ModuleObjective` — carries `role`, `roleRationale`, `coverageStatus`, `sequence`

## Consequences
- Objective mappings are simple and queryable without traversal overhead.
- Activity sequencing within modules and groups is explicitly represented in the graph.
- Junction documents for semantically rich relationships align with Armature's core principle: relationships are first-class artifacts that carry design rationale.
- The pattern is consistent and learnable: if a relationship needs data, it gets a junction document.
