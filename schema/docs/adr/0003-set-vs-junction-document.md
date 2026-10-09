# ADR-0003: Set References vs. Junction Documents for Multi-Valued Relationships

> **In brief.** Armature links records in two ways: a simple list of pointers kept on a record, or a
> separate small "link" record (a junction document) that describes the relationship itself. This
> decision said to use the simple list when the link carries no extra information (for example,
> which learning objectives a question assesses) and a junction document when it does (an order, a
> rationale, a confidence rating). It still holds. One example below is out of date: the
> module-to-objective link no longer stores a coverage status, because coverage is now calculated
> whenever it is asked for (ADR-0056; ADR stands for Architecture Decision Record).

## Status
Accepted

**Note (2026-10-08):** the decision stands. One example in the Decision is out of date since
ADR-0056; see the note there.

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

> **Later change (2026-10-08):** `ModuleObjective` no longer carries `coverageStatus`, and no
> junction carries a computed status. Coverage is computed on read by
> `GET /api/v1/intelligence/coverage/:moduleId` and never stored (ADR-0056). `ModuleObjective`
> carries `role`, `roleRationale` and `sequence`.

## Consequences
- Objective mappings are simple and queryable without traversal overhead.
- Activity sequencing within modules and groups is explicitly represented in the graph.
- Junction documents for semantically rich relationships align with Armature's core principle: relationships are first-class artifacts that carry design rationale.
- The pattern is consistent and learnable: if a relationship needs data, it gets a junction document.
