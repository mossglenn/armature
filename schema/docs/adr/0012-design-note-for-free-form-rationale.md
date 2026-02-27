# ADR-0012: DesignNote for Free-Form Rationale Capture

## Status
Accepted

## Context
Several document types in the schema carry dedicated rationale fields: `PrerequisiteRecord.rationale`, `LearningNeed.rationale`, `ModuleObjective.roleRationale`. These fields are appropriate for decisions made within a well-defined slot — the reason a specific prerequisite was identified, the reason a need was prioritized, the reason an objective was assigned a role.

But design decisions frequently don't fit neatly into a predefined field. A designer might need to record:
- Why a particular Bloom's level was chosen for an objective
- The reasoning behind an assessment strategy for a module
- Why a specific sequencing order was chosen
- A suspected prerequisite relationship where the specific prerequisite objective is not yet known (the `PrerequisiteIntent` case from ADR-0011)
- A trade-off considered and rejected during course design

These decisions are currently lost — they stay in meeting notes, Slack threads, or the designer's head. Armature's core value proposition is that design rationale is captured in the graph, not just the artifacts.

Two design questions arise:
1. Should free-form notes be attached to specific artifact types or be universal?
2. Should there be one rationale layer (free-form notes only) or two (notes + structured decisions)?

A type-specific approach (e.g., `ObjectiveNote`, `ModuleNote`) would require a new type per artifact, duplicating schema complexity. A universal type using `xsd:anyURI` subject references is more flexible and avoids combinatorial explosion.

For the two-layer question: `DesignNote` handles narrative rationale well. A more structured `DesignDecision` type — capturing alternatives considered, tradeoffs, and affected artifacts — would support richer design process analysis but requires concrete usage patterns to define well. Adding it prematurely risks the wrong abstraction.

## Decision
Add `DesignNote` as a universal free-form rationale type. Key design choices:

- `subject: Set<xsd:anyURI>` — references any document(s) in the graph by URI, enabling a single note to span multiple artifact types (e.g., a rationale connecting an objective, an assessment item, and a module decision)
- `rationale: xsd:string` — markdown-capable text field for the free-form explanation
- `category: Optional<DesignNoteCategory>` — optional categorization using a controlled vocabulary (BloomsLevelChoice, AssessmentStrategyChoice, SequencingDecision, PrioritizationDecision, ScopeDecision, AlignmentDecision, PrerequisiteIntent, Other)
- API constraint: `subject` must contain at least one element — an orphaned note is not useful

A `DesignDecision` structured type is explicitly deferred (see ADR-0010). A forward pointer field `relatesToDecision` is reserved on `DesignNote` as a comment in the schema documentation, not as a live field, to signal the intended migration path when that type is defined.

## Consequences
- Designers can capture rationale that falls outside predefined fields, closing the most common gap in design process documentation.
- `DesignNoteCategory` makes rationale queryable by decision type — "show all notes about Bloom's level choices" is a valid graph query.
- `PrerequisiteIntent` in the category enum provides a semantically clean home for suspected-but-unresolved prerequisite relationships, without polluting the prerequisite graph with incomplete edges (ADR-0011).
- The `xsd:anyURI` subject approach is flexible but bypasses TerminusDB's type system — subjects are not validated as real documents by the schema. API layer must validate that subject URIs resolve to existing documents.
- Deferring `DesignDecision` means usage patterns in `DesignNote.category` will inform what structure that type should have when the time comes — avoiding premature structuring.

## Related
ADR-0003 (reified relationships as first-class artifacts), ADR-0009 (semantic enrichments), ADR-0010 (intentionally deferred), ADR-0011 (placeholder objectives)
