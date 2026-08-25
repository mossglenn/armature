# ADR-0020: DesignFinding — Evidence-Grounded Concerns About Design Artifacts

## Status
Proposed — depends on ADR-0017

## Context

Armature can record why an artifact is the way it is (`DesignNote`, ADR-0012). It cannot record that an artifact may be **wrong**.

These are different speech acts. A `DesignNote` asserts a decision that was made — it is the author explaining themselves, and its content is settled at the moment of writing. A concern raised about an artifact is unsettled by definition: it awaits judgment, may be rejected, and its value lies partly in whether anyone acted on it. Collapsing the two loses the distinction between *"we decided this"* and *"someone thinks this is wrong."*

### The originating requirement

A tool operating at one layer routinely discovers evidence about another. An assessment authoring tool reviewing items will surface that an *objective* is ambiguous — three items drawing the same expert objection is evidence about the objective, not about the items.

The requirement, as stated: a plugin must be able to **flag that an upstream artifact needs review, carrying the evidence or a pointer to it, without being able to edit that artifact.**

A finding is a new document pointing *at* an artifact. It never modifies its subject. This is what makes cross-layer feedback safe: a plugin scoped to item authoring can raise a concern about an objective without holding write access to objectives.

### Armature already has this shape

```
LearningNeed  --NeedEvidenceLink(confidence)-->  LearningEvidence
  a documented gap in learner performance          grounded in evidence
```

And `EvidenceMethod` already contains `ExpertReview`, documented as contextualising "qualitative findings... during needs analysis." Expert review was anticipated as a way of gathering evidence — but pointed only upstream at needs analysis, never at the design artifacts themselves.

`DescriptiveEvidence` (`method`, `finding`, `collectedAt`, `source`) and `ConfidenceLevel` both exist and are directly reusable.

## Decision

### 1. Add `DesignFinding`, inheriting `ArmatureDocument`

| Field | Type | Notes |
|---|---|---|
| `finding` | `xsd:string` | Required. What the concern is |
| `subject` | `Set<DesignRecord>` | Required, `@min_cardinality: 1`. The artifact(s) of concern |
| `regarding` | `Optional<DesignRecord>` | A second artifact the subject is being related to |
| `evidence` | `Set<LearningEvidence>` | Optional. Typically `DescriptiveEvidence` with `method: ExpertReview` |
| `confidence` | `Optional<ConfidenceLevel>` | How sure the reporter is that this is real |
| `status` | `FindingStatus` | Required. Open, Addressed, or Dismissed |
| `resolutionRationale` | `Optional<xsd:string>` | Why it was addressed or dismissed |

`@key`: `Random`, declared explicitly per ADR-0016 decision 4. Every field here is mutable; none may participate in identity.

### 2. Add `FindingStatus` as a top-level enum (ADR-0008)

`Open` · `Addressed` · `Dismissed`

Deliberately minimal. *"This objective was flagged as ambiguous by expert review and never addressed"* is materially different from *"was flagged and revised"* — that is design history, not workflow exhaust, and it justifies carrying state at all.

Richer lifecycles ("deferred pending a policy decision", "awaiting second reviewer") are plugin concerns and map onto these three at the boundary, following ADR-0018 decision 5.

### 3. Evidence is a `Set`, not a junction

`NeedEvidenceLink` exists because confidence is assessed **per piece of evidence** during needs analysis — a designer weighs each source separately.

A finding's meaningful confidence is different: *how sure am I that this is a real problem?* That is a property of the finding, not of each evidence item. The finding-to-evidence link therefore carries no data, and ADR-0003's rule applies in the direction that avoids reification: use a `Set`.

The structural parallel with `LearningNeed` is real but is **not** grounds for a shared abstract base. The similarity lives in the junction pattern, which this type does not use; the two differ in subject (learner performance vs. design artifact), in consequence (generates objectives vs. prompts revision), and in their remaining fields. Two similarly-shaped types are a coincidence, not evidence of an abstraction. If a third case appears, revisit.

### 4. Evidence is optional; the graph carries the substance

Requiring evidence would force a `DescriptiveEvidence` document for every flag and turn a cheap signal into ceremony. A finding without evidence is weaker — and that weakness is **visible in the graph**, which is the more useful outcome than forcing everyone to manufacture evidence.

Where a plugin holds transactional detail (a review thread, a comment history), the evidence document must still be **self-contained**. `DescriptiveEvidence.finding` carries the substance; `DescriptiveEvidence.source` carries the pointer — *"CoQui review, assignment 47"* or a URL. No new field is needed for this.

This is deliberate: an exported graph must not contain findings whose evidence has evaporated. The graph carries the claim; the pointer is a convenience for those with access to the originating system.

### 5. API constraint: a dismissal requires a reason

`resolutionRationale` is required when `status` is `Dismissed`. A finding that someone raised and someone else waved away without explanation is worse than no record at all — it launders a judgment as a fact.

TerminusDB cannot express a conditional requirement, so the API enforces it (ADR-0006). `Addressed` does not require one; the revision itself is usually the explanation.

## Consequences

**Positive**

- Cross-layer feedback becomes possible without cross-layer write access. A plugin scoped to one artifact type can raise concerns about any other.
- The distinction between settled rationale and unsettled concern becomes representable.
- Unaddressed findings are queryable — *"which objectives were flagged and never revisited?"* is a design-quality signal no current tool can produce.
- Reuses `DescriptiveEvidence`, `ConfidenceLevel`, and `ExpertReview` rather than introducing parallel machinery.
- Dismissals carry reasoning, so the record of what was rejected is as inspectable as the record of what was accepted.

**Negative**

- A new type and a new enum, both requiring `npm run generate:types`.
- Depends on ADR-0017 for `Set<DesignRecord>`. Without it, `subject` is limited to `Set<ArmatureDocument>` and cannot point at most relationships — which excludes exactly the sequencing and alignment cases that motivate the type.
- `status` is state, and this ADR argued elsewhere that workflow state belongs in plugins. The exception is deliberate and narrow: only whether a concern was ever resolved, not how it travelled.
- Findings accumulate. Nothing here says when a resolved finding may be archived.

**Neutral**

- No existing type changes. Additive.

## The weakest decision

`regarding` is the least defensible field here and should be scrutinised first.

Its justification is specific: it is the mechanism that made reifying `AssessmentItem.assesses` unnecessary. A finding disputing an item's alignment to an objective needs to identify both ends — *"this item, regarding that objective"* — and `regarding` supplies the second anchor without promoting the pair to a document. Having used that argument to withdraw a proposed `ObjectiveAlignment` junction, this ADR is obliged to actually provide it.

But it is a general-purpose slot justified by one case, and general-purpose slots invite misuse. If it accumulates no second use, it should be removed rather than defended.

## Related

- ADR-0003 — set vs. junction; applied here in the direction that avoids reification
- ADR-0006 — API-enforced constraints
- ADR-0008 — top-level enums
- ADR-0009 — `ConfidenceLevel` and the enrichment of `NeedEvidenceLink`
- ADR-0012 — `DesignNote`; the type this is deliberately *not*
- ADR-0016 — key strategy; `Random` declared explicitly
- ADR-0017 — `DesignRecord`, which `subject` and `regarding` depend on
