# ADR-0017: DesignRecord Abstract Root, and Category as Metadata

## Status
Proposed

## Context

`ArmatureDocument` (ADR-0014) currently performs three unrelated jobs:

1. **Naming** — supplies `label` and `description`
2. **Provenance** — supplies `createdBy` (ADR-0015)
3. **Addressability** — it is the target type of `DesignNote.subject`, so inheriting it is the *only* way a document can be annotated

The third job was never stated as a purpose. It became one when ADR-0014 retyped `DesignNote.subject` from `Set<xsd:anyURI>` to `Set<ArmatureDocument>` in order to gain schema-enforced referential integrity. That was the right change, but it welded annotatability to naming.

### The asymmetry this produces

ADR-0014 excluded junction and structural documents from `ArmatureDocument` on the grounds that they are "addressed by their relationship fields, not a human-readable name." That reasoning is about **naming**, and it is sound — `ModuleObjective` has no name a designer would author.

But because naming and annotatability are the same inheritance decision, the exclusion silently removed something unrelated: six of the seven relationship types cannot carry a `DesignNote`.

| Type | Inherits `ArmatureDocument` | Annotatable |
|---|---|---|
| PrerequisiteRecord | Yes | Yes |
| NeedEvidenceLink | No | **No** |
| ItemInstance | No | **No** |
| ModuleObjective | No | **No** |
| ActivityGroupMember | No | **No** |
| ModuleActivityLink | No | **No** |
| ModuleActivityGroupLink | No | **No** |

`PrerequisiteRecord` is the sole exception, and only because it happens to have an authored name. Whether a relationship can carry design rationale is currently decided by whether it has a label — which is an accident, not a decision.

This matters for concrete cases. *"Why is this activity third in the module?"* is a sequencing decision (ADR-0005 is entirely about sequencing) with nowhere to be recorded. *"Why does this evidence carry only Preliminary confidence?"* has nowhere to go. A proposed `DesignFinding` type, which raises evidence-grounded concerns about artifacts, would be unable to point at most relationships.

### The taxonomy already exists, in the wrong place

`scripts/generate-types.js` carries a hand-maintained `JUNCTION_IDS` array, and CLAUDE.md instructs contributors that adding a type means remembering to "add `@id` to `JUNCTION_IDS` if it is a junction."

Armature therefore already distinguishes artifacts from relationships — as a constant in a build script rather than as a fact the schema declares about itself. Any second tool built on Armature would have to reconstruct that list by hand.

### Does formalising this taxonomy undermine the graph model?

A reasonable objection: if Armature reifies relationships into documents, and this ADR makes that split explicit in the schema, has the graph database been reduced to an awkward document store with hand-built join tables?

It has not, and the reasoning is worth recording here because this is the ADR where the artifact/relationship distinction becomes visible.

**Reification is requirement-driven, not store-driven.** Armature's premise is that relationships carry design rationale. A property graph such as Neo4j can put properties on an edge — but it cannot make an edge the *subject* of anything else, because relationships between relationships do not exist in that model. The moment the requirement is "a design note can annotate the alignment between an item and an objective," Neo4j must reify that alignment into a node exactly as TerminusDB does. Any backend converges here. The choice is forced by what Armature is for, not by which store it sits on.

**The split does not mean every connection becomes a node.** Plain reference fields remain the default and carry most traversal traffic — `Response.item`, `Assessment.module`, `Module.course`, `LearningObjective.generatedBy`, `LearningDataset.producedBy`, `createdBy`. The `relationship` category names the seven types that earned reification under ADR-0003 by carrying data. It is a label for what exists, not a mandate to convert more. **The failure mode to guard against is symmetry pressure** — naming a category invites reifying things for tidiness. ADR-0003's rule still governs: reify when the relationship carries data.

**What the graph is actually buying.** Three capabilities, none of which this ADR erodes:

- **Heterogeneous references.** `DesignNote.subject` pointing at any `DesignRecord` is trivial here and genuinely painful relationally — polymorphic association means either a type column plus an id column with no referential integrity, or a table per subject type. This ADR *exercises* the graph model rather than straining it.
- **Multi-hop traversal without predeclared joins.** "Find the learning need that generated the objective this item assesses."
- **Recursive reachability.** "Is objective A a transitive prerequisite of objective B?"

The inversion worth noting: if Armature did *not* reify — plain artifacts joined by foreign keys — a relational database would serve it well. It is the attributed relationships and heterogeneous anchoring that make the graph earn its place.

**One caveat for the record.** PROJECT_CONTEXT justifies TerminusDB on the closed-world assumption, deterministic queries, and the document model; ADR-0010 additionally leans on commit-level history. Those are arguments for *TerminusDB specifically*, not for *graphness*. The three capabilities above are the graph argument. Keeping them distinct matters when the choice has to be defended.

### What this ADR does not claim

`ModuleObjective.roleRationale` might appear to be a workaround for the missing annotation channel. It is not, and should not be cited as one. ADR-0009 justifies it as *"making ModuleObjective consistent with PrerequisiteRecord, which has always required rationale for design decisions"* — an inline field, deliberately chosen, following an existing pattern where rationale intrinsic to a relationship's meaning is a field rather than an attached note.

The case for this ADR rests on the asymmetry above, not on `roleRationale`.

## Decision

### 1. Introduce `DesignRecord` as an abstract root

```
DesignRecord (abstract)
  |
  +-- ArmatureDocument (abstract) -- label, description, createdBy
  |     +-- Course, Module, LearningObjective, AssessmentItem,
  |     |   Response, Assessment, LearningActivity, ActivityGroup,
  |     |   LearningNeed, LearningEvidence, LearningDataset, DesignNote
  |     +-- PrerequisiteRecord
  |
  +-- NeedEvidenceLink, ItemInstance, ModuleObjective,
      ActivityGroupMember, ModuleActivityLink, ModuleActivityGroupLink

User -- outside DesignRecord entirely
```

`DesignRecord` carries **no fields**. Its purpose is to be referenceable.

`DesignNote.subject` retypes from `Set<ArmatureDocument>` to `Set<DesignRecord>`, retaining `@min_cardinality: 1`.

The thirteen types that inherit `ArmatureDocument` are **unchanged**. Because `ArmatureDocument` now inherits `DesignRecord`, every existing `DesignNote` subject remains valid.

`User` remains outside, preserving ADR-0015's explicit position that it "should not be a valid subject of a `DesignNote`." This is what keeps `DesignRecord` meaningful rather than a synonym for "any document."

### 2. Category is metadata, not a class

Armature has two mechanisms available, and they answer different questions:

- **Inheritance** is for what must be *referenced as a type*
- **`@metadata`** is for what must be *known about a type*

`DesignRecord` earns a class because `DesignNote.subject` must reference it. `Relationship` and `Infrastructure` do not — nothing needs to hold a reference typed "any relationship." They become `@metadata`:

```json
"@metadata": { "armature": { "category": "relationship" } }
```

Categories: `artifact`, `relationship`, `infrastructure`.

`scripts/generate-types.js` derives `JUNCTION_IDS` from this metadata instead of hardcoding it, and any future tool can read the same declaration.

**The governing rule:** *a category becomes a class when something must reference it; otherwise it is metadata.*

This also avoids a structural problem. `PrerequisiteRecord` is simultaneously a relationship and a named artifact. As classes, that would require multiple inheritance. As metadata, it inherits `ArmatureDocument` and is simply tagged `relationship`.

## Consequences

**Positive**

- Annotatability is decoupled from naming. Whether a relationship can carry design rationale becomes a deliberate decision rather than a side effect of whether it has a label.
- All seven relationship types become valid `DesignNote` subjects, closing an asymmetry with no stated justification.
- A future `DesignFinding` can point at relationships as well as artifacts, with no further change.
- The artifact/relationship taxonomy moves from a build-script constant into the schema, where every tool can read it. This directly serves the toolkit goal: a second plugin no longer has to reconstruct the list by hand.
- Adding a new type requires tagging it, not editing a script — and a missing tag is visible in the schema rather than silent.

**Negative**

- Adds one level to the inheritance chain. `DesignRecord -> ArmatureDocument -> LearningEvidence -> DescriptiveEvidence` is four levels; ADR-0014 recorded the hierarchy as two levels for evidence types.
- Every class gains a `@metadata` block, and the taxonomy must be kept accurate — the same maintenance burden as `JUNCTION_IDS`, relocated but not eliminated. Relocated to where it is visible, which is the point.
- `generate-types.js` needs updating to read metadata rather than a constant.
- An abstract class with no fields may read as ceremony to a reviewer. The justification is narrow and specific: `DesignNote.subject` needs a referenceable supertype, and `xsd:anyURI` was already tried and rejected in ADR-0014.

**Neutral**

- No existing document changes shape. This is additive.

## Deferred

**Does `createdBy` move to `DesignRecord`?** Provenance on relationships is arguably meaningful — *"who declared this objective belongs to this module?"* is a design decision with an author, even when the record is API-created (ADR-0007). But ADR-0015 placed `createdBy` on `ArmatureDocument` deliberately, and moving it expands the scope of this change without a demonstrated need. Left where it is; revisit if relationship provenance is actually queried.

**Is `roleRationale` redundant once `ModuleObjective` is annotatable?** Possibly, but see the note in Context — it follows an existing inline-rationale pattern. Any change is a separate decision requiring migration of seeded values, and it should not ride along with this one.

## Verification

Before applying, confirm on the installed TerminusDB version:

1. Inheritance chains of four levels resolve correctly, including polymorphic references to a grandparent abstract class (`DesignNote.subject: Set<DesignRecord>` matching a `DescriptiveEvidence` instance).
2. `@metadata` is preserved through schema load and is readable by the document API, so the generator can consume it.
3. An abstract class with no properties is valid as an inheritance root.

Same gating discipline ADR-0013 applied to `@min_cardinality`: verify platform behaviour before encoding a decision that depends on it.

## Related

- ADR-0012 — `DesignNote` and the original `xsd:anyURI` subject
- ADR-0014 — `ArmatureDocument`, the junction exclusion, and the retyping of `DesignNote.subject`
- ADR-0015 — `User` deliberately outside the artifact hierarchy
- ADR-0016 — key strategy; the other place a single mechanism was doing two jobs
