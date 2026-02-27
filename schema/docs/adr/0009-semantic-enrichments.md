# ADR-0009: Semantic Enrichments Beyond the Base Diagram

## Status
Accepted

## Context
The Mermaid ER diagram defines the structural relationships between artifact types. After translation to TerminusDB, a review identified six places where meaningful design information would fall through the cracks without additional fields. Each enrichment increases the graph's ability to capture design rationale or support graph intelligence queries.

## Decision
Seven enrichments were added to the base schema:

### 1. AssessmentItem: difficultyIndex and discriminationIndex
Classic item analysis metrics computed from LearningDataset results after assessment administration. Both are `Optional<xsd:decimal>` — they are not authored by the designer, but written back to the item by the Armature API after analysis. Storing them on the item (rather than only derivable from the dataset) enables direct queries like "which items assessing Objective X have a difficulty index above 0.8?"

### 2. LearningActivity: activityType
The `ActivityType` enum (Reading, Video, Simulation, WorkedExample, Discussion, Practice, Reflection, Other) makes instructional strategy a queryable property. Without it, the graph cannot answer "what strategies have been applied to this objective?" Optional — designers are not forced to categorize during early authoring.

### 3. PrerequisiteRecord: prerequisiteType
The `PrerequisiteType` enum distinguishes three meaningfully different prerequisite relationships: `Hard` (must be met before), `Soft` (recommended but not required), `Corequisite` (should be learned alongside). This distinction has direct implications for curriculum sequencing tools. Required — a prerequisite relationship without a type is underspecified.

### 4. ModuleObjective: roleRationale
`ModuleObjective.role` captures what role an objective plays in a module. `roleRationale` optionally captures why — making `ModuleObjective` consistent with `PrerequisiteRecord`, which has always required rationale for design decisions. Optional to avoid friction during routine assignments.

### 5. NeedEvidenceLink: confidence
The `ConfidenceLevel` enum (High, Medium, Low, Preliminary) records the designer's assessment of each piece of evidence's reliability at the point of linking it to a need. This makes the needs analysis process inspectable — the graph records not just what evidence was used but how much weight it carried.

### 6. LearningNeed: priority
The `NeedPriority` enum (Critical, High, Medium, Low) captures triage decisions when needs analysis produces more needs than a course can address. Optional — not all projects require explicit prioritization — but when it matters, the decision is preserved in the graph.

### 7. LearningObjective: generatedBy
`LearningObjective.generatedBy: Optional<LearningNeed>` replaces the earlier `LearningNeed.generates: Optional<LearningObjective>` scalar. The inversion follows ADR-0004's back-reference pattern and corrects the cardinality: one LearningNeed can generate multiple LearningObjectives by having multiple objectives reference the same need. The previous scalar allowed only one objective per need, which was semantically incorrect. Optional — an objective may exist independently of a formal needs analysis (e.g., a regulatory requirement).

## Consequences
- The graph captures a richer picture of the design process with minimal added schema complexity.
- All seven additions are optional except `prerequisiteType`, preserving design flexibility during early authoring.
- `difficultyIndex` and `discriminationIndex` create an explicit feedback loop between post-delivery data and item design — this is a concrete demonstration of Armature's full-cycle infrastructure argument.
- Future graph intelligence queries (coverage gaps, strategy distribution, evidence quality) have the data they need in the graph.
- The `generatedBy` inversion enables "one need generates many objectives" queries without a junction document.
