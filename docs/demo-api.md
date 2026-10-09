# Armature Demo API

> **Status: Retired (2026-10-08).** This document defined the demo-era API: per-type routes shaped around demo tools. The eight simple GET list routes, `GET /coverage/:moduleId`, `POST /courses` and `POST /modules` existed unversioned as legacy routes (ADR-0026) until Phase 3 of `docs/development-plan.md` retired them. Their work is done by the generic document API under `/api/v1/`: `GET /documents/:type?field=value` lists any type with filters, `PUT /documents/:type/:id` and the batch `POST /documents` write any type through the invariants engine, and a module's coverage is the one read `GET /api/v1/intelligence/coverage/:moduleId` (Phase 4, 2026-10-08; ADR-0029, ADR-0056), which computes it on read. `ModuleObjective` no longer has a coverage field, so no list read returns coverage. The current API is documented in `docs/api.md`. The rest of what is specified below was never built and will not be built in this form. Two shapes are stale and flagged in place: the item shape (superseded by ADR-0022 and ADR-0023) and the coverage response. The demo-tool framing and the "narrow domain layer" idea remain useful context for what the generic API must make possible.

## Purpose

The demo API serves two goals:

1. **Make the graph tangible.** Raw JSON from TerminusDB is not meaningful to an audience of instructional designers and learning engineers. The demo tools provide a familiar design workflow context that makes the graph's value visible.

2. **Demonstrate design rationale capture in practice.** Each tool is chosen to show a specific aspect of Armature's value proposition — not just that data is stored, but that design decisions, relationships, and rationale are preserved as queryable graph structure.

## Architecture

The API sits between the demo frontend tools and TerminusDB. It is a **narrow domain layer** — not a thin pass-through, not a general CRUD API. Each endpoint corresponds to a specific demo tool and performs whatever TerminusDB operations that tool requires atomically.

```
Demo Tools (Next.js frontend)
        ↓
Demo API (Next.js API routes)
        ↓
TerminusDB (local, via Docker Compose)
```

TerminusDB internals (document IDs, graph types, junction document structure) are not exposed to the frontend. The API shapes responses around the tools' needs.

## Demo Tools

The API supports four demo tools plus two supporting views:

| Tool | What It Demonstrates |
|---|---|
| **Course & Module Builder** | Structural container hierarchy |
| **Need + Evidence Intake** | Design grounded in evidence; NeedEvidenceLink as first-class data |
| **Objective Writer** | Needs → objectives traceability; Bloom's tagging |
| **Prerequisite Mapper** | Rationale capture; design decisions preserved in graph structure |
| **Item Builder** | Objective alignment; item bank reuse across assessments |
| **Coverage View** | Graph intelligence; what you get back from capturing design rationale |

The Coverage View is the demo payoff — it reads `ModuleObjective.coverageStatus` to show whether a module's declared objectives are adequately assessed, demonstrating that the graph can answer design questions that no current tool can.

> **Stale (2026-10-08).** `coverageStatus` was removed by ADR-0056. The Coverage View built in Phase 4 (`app/app/coverage/[moduleId]/page.tsx`) calls `GET /api/v1/intelligence/coverage/:moduleId`, which computes coverage on read. Every `coverageStatus` value in the examples below is historical.

## Endpoints

### Courses

#### `GET /courses`
Returns all courses. Used to populate the module builder's course selector.

**Response:**
```json
[
  {
    "id": "Course/intro-ai-for-ids",
    "label": "Introduction to AI for Instructional Designers",
    "description": "..."
  }
]
```

#### `POST /courses`
Creates a new course.

**Request:**
```json
{
  "label": "Introduction to AI for Instructional Designers",
  "description": "..."
}
```

**Response:** Created course document.

---

### Modules

#### `GET /modules`
Returns all modules with their declared objectives inline. Used by the Coverage View and objective writer.

**Response:**
```json
[
  {
    "id": "Module/how-ai-works",
    "label": "How AI Systems Work",
    "sequence": 1,
    "course": { "id": "Course/intro-ai-for-ids", "label": "..." },
    "objectives": [
      {
        "id": "ModuleObjective/...",
        "role": "Primary",
        "coverageStatus": "FullyAssessed",
        "sequence": 1,
        "objective": {
          "id": "LearningObjective/distinguish-ai-approaches",
          "label": "Distinguish AI Approaches",
          "bloomsLevel": "Understand"
        }
      }
    ]
  }
]
```

#### `POST /modules`
Creates a new module inside a course.

**Request:**
```json
{
  "label": "How AI Systems Work",
  "description": "...",
  "sequence": 1,
  "courseId": "Course/intro-ai-for-ids"
}
```

**Response:** Created module document.

---

### Learning Needs

#### `GET /needs`
Returns all learning needs. Used to populate the objective writer's "generated by" selector.

**Response:**
```json
[
  {
    "id": "LearningNeed/conceptual-gap",
    "label": "Conceptual Gap: How AI Systems Work",
    "rationale": "...",
    "priority": null
  }
]
```

#### `POST /needs`
Creates a LearningNeed. Optionally creates a DescriptiveEvidence document and NeedEvidenceLink in the same operation.

**Request:**
```json
{
  "label": "Conceptual Gap: How AI Systems Work",
  "rationale": "Survey data shows...",
  "priority": "High",
  "evidence": {
    "label": "ID Conference Survey",
    "method": "Survey",
    "finding": "82% of IDs could not distinguish...",
    "collectedAt": "2024-03-15",
    "source": "Regional ID Conference, Spring 2024",
    "confidence": "High"
  }
}
```

`evidence` is optional — a need can be created without evidence and linked later.

**Response:** Created need document, with evidence and link if provided.

---

### Learning Objectives

#### `GET /objectives`
Returns all learning objectives. Used to populate selectors in the item builder and prerequisite mapper.

**Response:**
```json
[
  {
    "id": "LearningObjective/distinguish-ai-approaches",
    "label": "Distinguish AI Approaches",
    "description": "...",
    "bloomsLevel": "Understand",
    "state": "Active",
    "generatedBy": {
      "id": "LearningNeed/conceptual-gap",
      "label": "Conceptual Gap: How AI Systems Work"
    }
  }
]
```

#### `POST /objectives`
Creates a learning objective. Optionally links to a LearningNeed and creates a ModuleObjective in the same operation.

**Request:**
```json
{
  "label": "Distinguish AI Approaches",
  "description": "Differentiate between rule-based systems and machine learning models.",
  "bloomsLevel": "Understand",
  "state": "Active",
  "needId": "LearningNeed/conceptual-gap",
  "moduleId": "Module/how-ai-works",
  "moduleRole": "Primary",
  "moduleSequence": 1
}
```

`needId`, `moduleId`, `moduleRole`, and `moduleSequence` are optional.

**Response:** Created objective document, with ModuleObjective if moduleId provided.

---

### Assessment Items

> **Stale shape.** The `responses` array below reflects the pre-ADR-0022 schema, in which options were separate `Response` documents. ADR-0022 (Accepted) embeds options in the item as `ItemOption` subdocuments, and ADR-0023 gives the stem, each option and both general feedbacks a client-assigned `fragmentId`. The schema change landed in Phase 1 of `docs/development-plan.md` (2026-10-07), and `GET /items` was retired in Phase 3. Treat the shapes in this section as historical.

#### `GET /items`
Returns all assessment items with their objective alignments. Used by the Coverage View and item builder review state.

**Response:**
```json
[
  {
    "id": "AssessmentItem/distinguish-ai-mc",
    "label": "Rule-based vs. ML distinction",
    "stem": "Which of the following best describes...",
    "itemType": "MultipleChoice",
    "bloomsLevel": "Understand",
    "assesses": [
      {
        "id": "LearningObjective/distinguish-ai-approaches",
        "label": "Distinguish AI Approaches"
      }
    ],
    "responses": [
      {
        "label": "A",
        "isCorrect": false,
        "incorrectFeedback": "..."
      }
    ]
  }
]
```

#### `POST /items`
Creates an AssessmentItem with Responses atomically. Optionally places the item into an Assessment as an ItemInstance.

**Request:**
```json
{
  "label": "Rule-based vs. ML distinction",
  "stem": "Which of the following best describes...",
  "itemType": "MultipleChoice",
  "bloomsLevel": "Understand",
  "objectiveIds": ["LearningObjective/distinguish-ai-approaches"],
  "responses": [
    { "label": "A", "isCorrect": false, "incorrectFeedback": "This reverses the two..." },
    { "label": "B", "isCorrect": true },
    { "label": "C", "isCorrect": false, "incorrectFeedback": "..." },
    { "label": "D", "isCorrect": false, "incorrectFeedback": "..." }
  ],
  "placement": {
    "assessmentId": "Assessment/mod1-assessment",
    "sequence": 1,
    "pointValue": 1,
    "randomize": true
  }
}
```

`placement` is optional — items can exist in the bank without being placed in an assessment.

**Response:** Created item document, with responses and ItemInstance if placement provided.

---

### Assessments

#### `GET /assessments`
Returns all assessments with their placed items. Used for item placement and review.

**Response:**
```json
[
  {
    "id": "Assessment/mod1-assessment",
    "label": "Module 1 Knowledge Check",
    "description": "...",
    "randomize": false,
    "passingScore": 0.7,
    "retakes": 2,
    "module": { "id": "Module/how-ai-works", "label": "How AI Systems Work" },
    "items": [
      {
        "sequence": 1,
        "pointValue": 1,
        "status": "Approved",
        "item": {
          "id": "AssessmentItem/distinguish-ai-mc",
          "label": "Rule-based vs. ML distinction"
        }
      }
    ]
  }
]
```

#### `POST /assessments`
Creates an assessment inside a module.

**Request:**
```json
{
  "label": "Module 1 Knowledge Check",
  "description": "...",
  "moduleId": "Module/how-ai-works",
  "randomize": false,
  "passingScore": 0.7,
  "retakes": 2
}
```

**Response:** Created assessment document.

---

### Prerequisites

#### `POST /prerequisites`
Creates a PrerequisiteRecord between two objectives. Rationale is required — a prerequisite relationship without a documented reason is outside Armature's design philosophy.

**Request:**
```json
{
  "label": "Model training requires understanding AI approaches",
  "objectiveId": "LearningObjective/describe-model-training",
  "prerequisiteId": "LearningObjective/distinguish-ai-approaches",
  "prerequisiteType": "Hard",
  "rationale": "Understanding the distinction between rule-based and ML systems is necessary context for explaining how training works."
}
```

**Response:** Created PrerequisiteRecord document.

---

### Design Notes

#### `GET /notes`
Returns all design notes with their subjects. Used to review captured design rationale.

**Response:**
```json
[
  {
    "id": "DesignNote/item6-authoring-rationale",
    "label": "Rationale for human-authored harassment scenarios",
    "rationale": "Unable to find literature on prompting AI...",
    "category": "AssessmentStrategyChoice",
    "subjects": [
      {
        "id": "AssessmentItem/appropriate-use-mc",
        "label": "Evaluating appropriate AI use in sensitive content",
        "type": "AssessmentItem"
      }
    ]
  }
]
```

#### `POST /notes`
Attaches a DesignNote to one or more artifacts.

**Request:**
```json
{
  "label": "Rationale for human-authored harassment scenarios",
  "rationale": "Unable to find literature on prompting AI to generate descriptions of inappropriate behavior.",
  "category": "AssessmentStrategyChoice",
  "subjectIds": ["AssessmentItem/appropriate-use-mc"]
}
```

**Response:** Created DesignNote document.

---

### Coverage

#### `GET /coverage/:moduleId`
Returns coverage analysis for a module — which declared objectives are covered, partially covered, uncovered, or over-assessed. This is the primary demo of Armature's graph intelligence.

> **Superseded (2026-10-08).** `GET /api/v1/intelligence/coverage/:moduleId` delivers this read with a different shape from the target below: `module`; the `thresholds` in force (`fullyAssessedAt`, `overAssessedAbove`, from the query or the hub's defaults); a `summary` with `declared`, per-verdict counts under `coverage` and `projected`, and `undeclared`; `objectives`, one per declaration in sequence order, each with `role`, the `objective` summary, `coverage` and `projected` as `{ status, items }`, and `assessedBy` (each placed item with its `eligibility`, delivered, projected or none, and its placements); and `undeclared`, the objectives the module's assessments test without declaring. `GET /api/v1/intelligence/coverage?course=` returns the same per module. Everything is computed at the requested ref; nothing is stored (ADR-0056). The JSON below is kept as the historical target.

**Target response:**
```json
{
  "module": {
    "id": "Module/how-ai-works",
    "label": "How AI Systems Work"
  },
  "summary": {
    "total": 3,
    "fullyAssessed": 2,
    "partiallyAssessed": 0,
    "uncovered": 1,
    "overAssessed": 0
  },
  "objectives": [
    {
      "id": "ModuleObjective/...",
      "role": "Primary",
      "coverageStatus": "FullyAssessed",
      "objective": {
        "id": "LearningObjective/distinguish-ai-approaches",
        "label": "Distinguish AI Approaches",
        "bloomsLevel": "Understand"
      },
      "assessedBy": [
        {
          "id": "AssessmentItem/distinguish-ai-mc",
          "label": "Rule-based vs. ML distinction",
          "bloomsLevel": "Understand"
        }
      ]
    },
    {
      "id": "ModuleObjective/...",
      "role": "Primary",
      "coverageStatus": "Uncovered",
      "objective": {
        "id": "LearningObjective/describe-model-training",
        "label": "Describe Model Training",
        "bloomsLevel": "Understand"
      },
      "assessedBy": []
    }
  ]
}
```

---

## Documents Not Included in Demo API

The following schema types are intentionally out of scope for the demo:

| Type | Reason deferred |
|---|---|
| `LearningActivity`, `ActivityGroup` | No activity authoring tool in demo scope |
| `ModuleActivityLink`, `ModuleActivityGroupLink` | Depends on LearningActivity |
| `LearningDataset`, `LearningMetric` | Outcome feedback loop deferred — requires assessment administration |
| `LearningEvidence` (LearningMetric subtype) | Only DescriptiveEvidence covered via POST /needs |
| `User` | No auth system in demo scope |

## Enum Reference

Valid values for fields used in API requests:

**bloomsLevel:** `Remember` `Understand` `Apply` `Analyze` `Evaluate` `Create`

**state (objective):** `Draft` `Active` `Deprecated` `Archived`

**itemType:** `MultipleChoice` `MultipleSelect` `TrueFalse` `ShortAnswer` `Essay` `Matching` `Ordering` `FillInTheBlank`

**prerequisiteType:** `Hard` `Soft` `Corequisite`

**moduleRole:** `Primary` `Supporting` `Prerequisite`

**evidenceMethod:** `Interview` `Survey` `Observation` `FocusGroup` `DocumentReview` `ExpertReview` `Other`

**confidence:** `Preliminary` `Low` `Medium` `High`

**noteCategory:** `BloomsLevelChoice` `AssessmentStrategyChoice` `SequencingDecision` `PrioritizationDecision` `ScopeDecision` `AlignmentDecision` `PrerequisiteIntent` `Other`
