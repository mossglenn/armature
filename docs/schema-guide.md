# Armature Schema Guide

This guide explains the Armature schema conceptually: the mental model, the patterns that recur across it, and how to write and read the graph correctly. It sits between two other documents:

- [How Armature Works](how-armature-works.md) explains *why* the schema is shaped this way, for a general academic audience (see its Section 12).
- The [Schema appendix](SCHEMA_APPENDIX.md) lists every type and field. It is generated from `schema/schema.json`, whose inline documentation is authoritative.

Decisions are cited by their Architecture Decision Record (ADR) number; all are in `schema/docs/adr/`. Phase 7 of the development plan will revisit this guide from the perspective of a tool author building a second plugin.

## 1. The mental model

Armature records instructional design as a **graph of documents**. Each document is one design record: a learning need, an objective, an assessment item, a module. Documents point at each other through **reference fields**, and the references are the **design relations**: "this item assesses that objective," "this need generated that objective."

Three ideas organize the schema:

1. **The learning objective is the central node.** Needs generate objectives; prerequisite records connect objectives; items assess them; activities target them; modules declare them. Almost every query passes through an objective.
2. **A relationship that carries data is a document.** If a relationship needs its own fields (a rationale, a role, a position, a confidence), it is a *junction document*. Otherwise it is a plain reference field (ADR-0003).
3. **History is not in the schema.** No document has version or timestamp fields. Every change is a commit in the database, with an author and a reason, and any document can be read as it was at any commit (ADR-0025).

## 2. The lifecycle the schema follows

```
LearningEvidence ──NeedEvidenceLink(confidence)──▶ LearningNeed
                                                        ▲
                                          generatedBy   │
LearningObjective ──────────────────────────────────────┘
   ▲   ▲   ▲   ▲
   │   │   │   └── PrerequisiteRecord (objective, prerequisite, type, rationale)
   │   │   └────── ModuleObjective (module, references, role, roleRationale, sequence) ── Module ── Course
   │   └────────── LearningActivity.targets
   └────────────── AssessmentItem.assesses
                        ▲
                        └── ItemInstance (assessment, implements, sequence, status) ── Assessment ── Module
                                                                                          ▲
                                                           LearningDataset.producedBy ────┘
                                                                ▲
                                          LearningMetric.derivedFrom
```

The arrows point from the document holding the reference to the document it names.

## 3. Four categories of class

Every class declares a category in its schema metadata (`@metadata.armature.category`, ADR-0027). Tools can read the category to decide how to treat a type, and the generators fail on a class without one.

| Category | Classes | What it means for a tool |
|---|---|---|
| `artifact` | `Course`, `Module`, `LearningObjective`, `AssessmentItem`, `Assessment`, `LearningActivity`, `ActivityGroup`, `LearningNeed`, `LearningEvidence` (abstract), `LearningMetric`, `DescriptiveEvidence`, `LearningDataset`, `DesignNote`, `DesignFinding` | A primary design record with a `label`, an optional `description` and a `createdBy`. Writable. A client may choose its identifier |
| `relationship` | `NeedEvidenceLink`, `PrerequisiteRecord`, `ModuleObjective`, `ModuleActivityLink`, `ModuleActivityGroupLink`, `ActivityGroupMember`, `ItemInstance` | A junction document. Writable. Its identifier is derived from its key fields; a client never supplies one |
| `fragment` | `Fragment` (abstract), `TextFragment`, `ItemOption` | An embedded part of an item. Not a document; written as part of its item |
| `infrastructure` | `User`, `DesignRecord` (abstract), `ArmatureDocument` (abstract) | Identity and abstract roots. `User` has its own routes; the roots cannot be created |

## 4. Patterns you will meet everywhere

### 4.1 References, not ownership (ADR-0002)

Documents are independent and reusable. An activity can appear in several modules; an item can appear in several assessments. Deleting or changing one document never silently changes another. The one exception is an item's parts (Section 4.6), which are embedded because they have no meaning outside their item.

### 4.2 Back-references on children (ADR-0004)

In a one-to-many relationship the reference lives on the child: `Assessment.module`, `Module.course`, `ItemInstance.assessment`, `ModuleObjective.module`, `LearningObjective.generatedBy`. Parents hold no lists of children. To find a module's assessments, list `Assessment` documents whose `module` is the module:

```
GET /api/v1/documents/Assessment?module=Module/how-ai-works
```

### 4.3 Sets for plain links, junctions for links with data (ADR-0003)

| Relationship | Stored as |
|---|---|
| Item assesses objectives | `AssessmentItem.assesses`: a set (at least one) |
| Activity targets objectives | `LearningActivity.targets`: a set (at least one) |
| Need informed by evidence | `NeedEvidenceLink` with `confidence` |
| Objective requires objective | `PrerequisiteRecord` with `prerequisiteType` and `rationale` |
| Module declares objective | `ModuleObjective` with `role`, `roleRationale`, `sequence` |
| Activity or group placed in module | `ModuleActivityLink` / `ModuleActivityGroupLink` with `sequence` |
| Activity placed in group | `ActivityGroupMember` with `sequence` |
| Item placed in assessment | `ItemInstance` with `sequence`, `pointValue`, `randomize`, `status` |

Do not create a junction for tidiness. A relationship earns one by carrying data (ADR-0017).

### 4.4 Required, optional and controlled values

- A field is required unless the schema marks it `Optional`. Sets may be empty unless they declare `@min_cardinality`.
- Controlled vocabularies are top-level enums (ADR-0008). There are twelve: `BloomsLevel`, `ObjectiveState`, `ItemType`, `ItemStatus`, `EvidenceMethod`, `ObjectiveRole`, `ActivityType`, `PrerequisiteType`, `ConfidenceLevel`, `NeedPriority`, `DesignNoteCategory`, `FindingStatus`.
- Free-text rationale fields (`rationale`, `roleRationale`, `purpose`, `finding`, `resolutionRationale`) are free text on purpose. Do not propose replacing them with structure without evidence from real usage (ADR-0010, progressive formalization).

### 4.5 Identity and keys (ADR-0016, ADR-0024)

- **Artifacts** declare a random key. A client may supply the identifier on first write, as `Type/<anything>`; a UUID (universally unique identifier) is recommended, and readable slugs are allowed. Writing again under the same identifier replaces the document. The hub never parses or regenerates an identifier.
- **Junctions** declare a hash key over their defining references, for example `ModuleObjective` over `(module, references)` and `ItemInstance` over `(assessment, implements)`. The database computes the identifier from those fields, so a pair can exist only once. Writing the same pair again replaces the document, which keeps its other fields (sequence, role) editable.
- **No key ever includes an editable field.** Otherwise editing the field would create a different document.

### 4.6 Items are trees of fragments (ADR-0022, ADR-0023, ADR-0033)

An `AssessmentItem` embeds its parts:

```json
{
  "@id": "AssessmentItem/5b0c…",
  "@type": "AssessmentItem",
  "label": "Identify a hallucination",
  "itemType": "MultipleChoice",
  "status": "Draft",
  "bloomsLevel": "Understand",
  "assesses": ["LearningObjective/identify-ai-limitations"],
  "stem": { "@type": "TextFragment", "fragmentId": "f-stem", "text": "Which output is a hallucination?" },
  "options": [
    { "@type": "ItemOption", "fragmentId": "f-a", "text": "A cited source that does not exist", "isCorrect": true },
    { "@type": "ItemOption", "fragmentId": "f-b", "text": "A summary that omits a detail", "isCorrect": false,
      "purpose": "Targets the misconception that any error is a hallucination" }
  ],
  "incorrectFeedback": { "@type": "TextFragment", "fragmentId": "f-wrong", "text": "Look for invented facts." }
}
```

Rules for fragments:

- **The authoring tool assigns `fragmentId`** once, when the part is created. Never derive it from position or display order, never regenerate it, never reuse a retired one. Armature checks only that it is unique within the item (rule 8).
- **Address a part as the pair `{ item @id, fragmentId }`.** The database's own nested identifiers for parts are regenerated every time the item is replaced; never store them.
- **The options list is in presentation order.** Identity is `fragmentId`, not position.
- **Option text must be present and unique within the item, and the number of correct options must suit the item type** (rule 9): multiple choice and true/false have exactly one correct option (true/false exactly two options); multiple select has one or more.
- `ItemOption.feedback` is plain text, not a fragment, so per-option feedback cannot yet be addressed as a part. (CoQui's handoff proposed a `{ fragmentId, text }` shape for it; that divergence is recorded and unresolved.)

### 4.7 Two statuses for items (ADR-0018)

`AssessmentItem.status` is the item's own review (is the question correct and aligned?). `ItemInstance.status` is clearance in one assessment. Both use `ItemStatus` (`Draft`, `InReview`, `Approved`, `Retired`). A placement cannot be `Approved` while its item is `Draft` or `InReview` (rule 10). Map a richer workflow onto these four at your tool's boundary.

### 4.8 Rationale has three homes

1. The **commit message**, required on every write: the primary record of why a change was made.
2. **Inline rationale fields** where the reason is intrinsic to a relationship (`PrerequisiteRecord.rationale`, `ModuleObjective.roleRationale`, `ItemOption.purpose`).
3. **`DesignNote`** for a decision that fits no slot, and **`DesignFinding`** for a concern that something is wrong (ADR-0012, ADR-0020). Both take a `subject` set of any `DesignRecord`: any artifact or junction, never a `User`.

A finding has a status (`Open`, `Addressed`, `Dismissed`); a `Dismissed` finding must carry a `resolutionRationale` (rule 11).

### 4.9 Provenance is set by the hub

`createdBy` on every artifact is set by the API from the identity the request resolved to, on create, and preserved on replace (ADR-0032). A value in a request body is ignored. The commit author is the same user. Do not try to set either.

### 4.10 Nothing derived is stored (ADR-0056)

The schema holds what people decided and what was observed. Coverage, alignment and any future score are computed by the intelligence reads at a ref. If a judgment needs to be on record under someone's name, it is a `DesignFinding` (or, from Phase 5, an attestation). Before proposing any stored score, ask: *could this value appear in a commit under a person's name and be true as a record of what they did?*

`AssessmentItem.difficultyIndex` and `discriminationIndex` predate this rule; whether they remain as imported observations is an open question for the Phase 6 outcomes importer.

## 5. What TerminusDB checks and what the API checks

| The database checks | The API checks (the invariants engine) |
|---|---|
| Field types, required fields, enum values | That every reference names a document of the declared class (rule 0) |
| Minimum set sizes (`@min_cardinality`) | Unique positions in modules, groups and assessments (rules 3 to 5) |
| That a referenced document exists | Fragment and option rules (rules 8, 9) |
| Unique identifiers | Item and placement status consistency (rule 10) |
| | A reason for every dismissal (rule 11) |
| | No identifier reused across types (rule 12) |

The database does **not** check that a reference points at the right *class* of document (platform check L). Never describe a typed reference as "schema-enforced"; the API enforces it. The full rule list, with response codes, is in the [API reference](api.md#the-write-pipeline).

## 6. Worked examples

### 6.1 A module declares an objective, with a note on the declaration

Because `ModuleObjective`'s identifier is derived from its key fields, a request that creates one and annotates it in the same commit uses `@capture` and `@ref`:

```
POST /api/v1/documents?branch=my-branch
Armature-User: demo-designer@example.edu

{
  "message": "Declare limitations as a supporting objective of the how-AI-works module",
  "documents": [
    { "@type": "ModuleObjective", "@capture": "decl",
      "module": "Module/how-ai-works", "references": "LearningObjective/identify-ai-limitations",
      "role": "Supporting", "roleRationale": "Introduced here, assessed fully in module 3" },
    { "@type": "DesignNote", "label": "Why supporting",
      "rationale": "SMEs wanted limitations previewed before the ethics module",
      "subject": [ { "@ref": "decl" } ], "category": "SequencingDecision" }
  ]
}
```

### 6.2 A prerequisite you cannot write yet (ADR-0011)

If the prerequisite objective exists only as an idea, create it as a draft objective first, then the record:

```json
{ "@type": "LearningObjective", "@id": "LearningObjective/tbd-prereq-x",
  "label": "TBD: prerequisite for distinguishing AI approaches", "state": "Draft" }
```

```json
{ "@type": "PrerequisiteRecord", "label": "Basic statistics before AI approaches",
  "objective": "LearningObjective/distinguish-ai-approaches",
  "prerequisite": "LearningObjective/tbd-prereq-x",
  "prerequisiteType": "Soft", "rationale": "Learners struggled with probability language in the pilot" }
```

If even a draft objective is premature, record a `DesignNote` with `category: "PrerequisiteIntent"` about the objective instead.

### 6.3 Tracing a result back to the design

```
GET /api/v1/intelligence/trace/LearningMetric/<id>
```

returns the dataset, assessment, items, objectives, needs and evidence the metric connects to, the modules that declare those objectives, and every note and finding about them. See [How Armature Works](how-armature-works.md#174-trace-follow-the-chain-from-evidence-to-outcomes).

## 7. Adding or changing a type

1. Write or update an ADR first (`schema/docs/adr/`).
2. Edit `schema/schema.json`. A new class needs `@metadata.armature.category` and an explicit `@key` (`Random` for artifacts; `Hash` over the defining references for junctions). Document every field in `@documentation`, and say "API CONSTRAINT:" for any rule the database cannot express.
3. If the change relies on a database behavior not yet recorded in `docs/development-plan.md` §9, add a check to `scripts/platform_checks.js` and run it.
4. If the type has rules the database cannot express, add a validator in `app/lib/api/invariants/` and register it, with a failing and a passing test.
5. Run `npm run generate:types` in `app/` and `node scripts/generate-schema-appendix.js` at the root.
6. Commit the schema, `app/lib/types.ts`, `app/lib/schemas.ts` and `docs/SCHEMA_APPENDIX.md` together.
7. For a change that is not backward-compatible at demonstration scale: `node scripts/load_schema.js --clear-instances`, then `node scripts/seed_data.js`. A deployment holding real data uses TerminusDB's schema migration endpoint instead (ADR-0022).
