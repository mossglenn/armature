# Architecture Decision Records

This directory holds Armature's Architecture Decision Records (ADRs). An ADR is a short document
that records one design decision: the situation that called for it, what was decided, the options
that were turned down, and what follows from the choice.

## Why Armature keeps them

Armature exists to preserve the reasons behind instructional design decisions as artifacts that
can be inspected, queried and reused, instead of leaving them in people's heads or in old email.
ADRs apply the same idea to Armature itself: every non-obvious choice about the schema, the
application programming interface (API) or the database is written down with its rationale, so a
later reader can see not only what the system does but why. This is Armature practicing what it
preaches.

ADRs are never deleted and their original reasoning is never rewritten. When a later decision
changes an earlier one, the earlier ADR stays in place: its Status section gains a dated note
naming the ADR that changed it, and any statement in its body that is no longer true gets an
indented note directly beneath it:

```markdown
> **Later change (2026-10-08):** <what is true now, and which ADR or file made it so>.
```

Every ADR also opens with a short **In brief** block, written for readers who are not software
engineers, that says what question the decision answered, what was decided, and whether it still
holds.

## Status vocabulary

Each ADR's Status section uses one or more of these forms. A status that names another ADR is
always mirrored: if ADR-A says it amends ADR-B, ADR-B's status says "Amended by ADR-A".

| Status | Meaning |
|---|---|
| **Proposed** | Written and open for discussion. Not binding, and nothing has been built on it. |
| **Accepted** | A binding decision. New work must follow it. |
| **Accepted and implemented** | Binding, and the schema or code already reflects it. |
| **Amended by ADR-NNNN** | Still binding, but a later ADR changed a specific part of it. The status note says which part. |
| **Superseded in part by ADR-NNNN** | Some of its decisions were replaced by a later ADR; the rest remain binding. The status note says which. |
| **Superseded by ADR-NNNN** | Replaced entirely by a later ADR. Kept for the historical record only. |
| **Deprecated** | No longer applies and has no replacement. (No ADR currently has this status.) |

## Numbering

ADRs are numbered in the order they were written, with four digits (ADR-0001, ADR-0002, ...).
The sequence has deliberate gaps:

- **0028, 0030, 0031 and 0034 are reserved and not yet written.** The development plan
  (`docs/development-plan.md` §5) reserved the block 0024 to 0034 for decisions it scheduled;
  the others in that block have been written. The four unwritten ones are:
  - **ADR-0028: Attestation** (Phase 5): a person affirms or declines a claim about a design record.
  - **ADR-0030: External references and attachments** (Phase 6).
  - **ADR-0031: Export profiles and schema slices** (Phase 6).
  - **ADR-0034: Interaction types and renderers as versioned artifacts** (when the first non-text
    question type is needed).

  Where an existing ADR cites one of these, a note marks it as planned and not yet written.
- **0035 to 0053 are research candidates, not decisions.** They are proposals listed in
  `docs/research/adr-candidates.md`, numbered provisionally. ADRs cite them as "candidate
  ADR-00NN". None is binding until it is written here as an ADR.
- **0054 onward** were numbered past both blocks, so that new decisions did not collide with the
  reserved numbers or the candidates.

## Index

All 34 ADRs, grouped by when they were written. Statuses are as of 2026-10-08.

### 0001–0010: Foundational schema (February 2026)

| ADR | Title | Status | In plain language |
|---|---|---|---|
| [0001](0001-abstract-base-type-for-evidence.md) | Abstract Base Type for Learning Evidence | Accepted; amended by ADR-0014 | Measured results and written findings share one parent type, `LearningEvidence`, so anything that cites evidence can accept either kind. |
| [0002](0002-references-not-ownership.md) | All Relationships Use References, Not Ownership | Accepted; amended by ADR-0022 and ADR-0033 | Records point at each other instead of nesting inside one another, so each can be reused and has its own history; a question's embedded parts are the one exception. |
| [0003](0003-set-vs-junction-document.md) | Set References vs. Junction Documents for Multi-Valued Relationships | Accepted (one example out of date since ADR-0056) | A plain list of links is used when a connection carries no information of its own; a separate "junction" record is used when the connection carries data such as an order, a role or a reason. |
| [0004](0004-back-references-on-children.md) | Back-References on Children, Not Arrays on Parents | Accepted; amended by ADR-0022 | In a parent-child relationship the child names its parent (an assessment names its module), rather than the parent keeping a list of children. |
| [0005](0005-module-content-sequencing.md) | Module Content Sequencing via Shared Integer Space | Accepted | Standalone activities and activity groups in a module share one numbered order, and activities inside a group have their own separate order. |
| [0006](0006-minimum-cardinality-enforced-by-api.md) | Minimum Cardinality Constraints Enforced by API, Not Schema | Superseded by ADR-0013 | Rules such as "a question must assess at least one objective" were to be checked by the API, until the database proved able to check them itself. |
| [0007](0007-module-objective-as-programmatic-junction.md) | ModuleObjective as Programmatic Junction with Computed Fields | Superseded in part by ADR-0056; amended by ADR-0019 and ADR-0029 | A module's declaration that it teaches an objective is its own record, carrying the objective's role and the reason for it; the stored coverage field it also carried was removed. |
| [0008](0008-top-level-enums.md) | Enums Defined as Top-Level Types | Accepted (its list of values is out of date; see the note in it) | Every controlled list of values, such as review status or Bloom's level, is defined once in the schema and shared wherever it is used. |
| [0009](0009-semantic-enrichments.md) | Semantic Enrichments Beyond the Base Diagram | Accepted; decision 1 is an open question | Seven fields added to the original design to carry more meaning, such as the reason for an objective's role in a module and the confidence in each piece of needs-analysis evidence. |
| [0010](0010-intentionally-deferred.md) | Intentionally Deferred Schema Features | Accepted; amended by ADR-0025 | Lists features deliberately left out until real use shows they are needed; several, including versioning and authorship, have since been settled by later ADRs. |

### 0011–0015: Schema review (February 2026)

| ADR | Title | Status | In plain language |
|---|---|---|---|
| [0011](0011-placeholder-objectives-for-incomplete-authoring.md) | Placeholder Objectives for Incomplete Authoring States | Accepted | When a designer knows a prerequisite exists but has not written that objective yet, they create a draft placeholder objective rather than an incomplete prerequisite record. |
| [0012](0012-design-note-for-free-form-rationale.md) | DesignNote for Free-Form Rationale Capture | Accepted; amended by ADR-0014 and ADR-0017 | Adds `DesignNote`, a free-text explanation of why a design decision was made, which can be attached to any design record. |
| [0013](0013-schema-level-minimum-cardinality.md) | Schema-Level Minimum Cardinality (Conditional) | Accepted (supersedes ADR-0006) | Because the database supports "at least one" rules on lists, the schema declares them itself instead of leaving them to the API. |
| [0014](0014-armature-document-abstract-base-class.md) | ArmatureDocument Abstract Base Class | Accepted; amended by ADR-0017 and ADR-0022 | Every named design artifact inherits a common parent, `ArmatureDocument`, which supplies its label, description and author. |
| [0015](0015-user-type-and-authorship-model.md) | User Type and Authorship Model | Accepted; amended by ADR-0032 | Adds the `User` record for the people and tools that take part in design, and a `createdBy` field on artifacts; signing in is left to an outside system. |

### 0016–0023: CoQui fit analysis (August–September 2026)

These came from testing the schema against CoQui, the assessment-authoring tool that is
Armature's first client.

| ADR | Title | Status | In plain language |
|---|---|---|---|
| [0016](0016-key-strategy-for-documents-and-junctions.md) | Key Strategy for Documents and Junctions | Superseded in part by ADR-0022; decision 5 resolved by ADR-0024 | Sets how record identifiers are formed: relationship records are identified by what they connect, other records by an opaque identifier, and no identifier includes an editable field. |
| [0017](0017-design-record-abstract-root.md) | DesignRecord Abstract Root, and Category as Metadata | Accepted and implemented; amended by ADR-0027 | Adds an empty parent type, `DesignRecord`, so notes and findings can be attached to relationships as well as artifacts, and records each type's category as a label in the schema. |
| [0018](0018-item-readiness-on-assessment-item.md) | Item Readiness Belongs on AssessmentItem, Not Only on ItemInstance | Accepted and implemented | Every test question has its own review status, separate from its clearance in each test, and a placement cannot be approved before its question is. |
| [0019](0019-coverage-accounts-for-item-readiness.md) | Coverage Semantics Account for Item Readiness | Accepted; amended by ADR-0056 | Coverage is reported twice, counting only approved questions and counting everything not retired, so the gap between the two shows the review backlog. |
| [0020](0020-design-finding-for-evidence-grounded-concerns.md) | DesignFinding — Evidence-Grounded Concerns About Design Artifacts | Accepted and implemented | Adds `DesignFinding`, a concern that a design record may be wrong, with optional evidence, a status, and a required reason for dismissing it. |
| [0021](0021-non-goal-practitioner-performance-data.md) | Armature Does Not Model Practitioner Performance | Accepted (a policy; its list-filter guard is planned for Phase 5) | Armature permanently declines to measure the performance of individual designers or reviewers, and offers no feature that summarizes one person's work. |
| [0022](0022-item-parts-embedded-not-response-document.md) | AssessmentItem Stem and Options Are Embedded Structure, Not a Separate Response Document | Accepted and implemented; amends ADR-0002, supersedes ADR-0016 in part | A question's stem and answer options are stored inside the question's own record, and the separate `Response` record type was removed. |
| [0023](0023-client-assigned-fragment-id.md) | Client-Assigned fragmentId for Addressing Item Parts | Accepted and implemented | The authoring tool gives each part of a question a permanent `fragmentId`, so a comment or review can point at one specific option. |

### 0024–0033: Development-plan block (October 2026)

Numbers reserved by `docs/development-plan.md` §5. The block's other numbers, 0028, 0030, 0031
and 0034, are not yet written; see [Numbering](#numbering).

| ADR | Title | Status | In plain language |
|---|---|---|---|
| [0024](0024-client-supplied-identifiers.md) | Client-Supplied Identifiers and Replace Semantics | Accepted and implemented; one consequence (lossless writes across schema versions) open | A client may choose a record's identifier on first write; later writes under it replace the record, a clash of record types is refused, and tools retire records instead of deleting them. |
| [0025](0025-design-process-data-lives-in-the-commit-graph.md) | Design process data lives in the commit graph | Accepted and implemented | The database's commit history is Armature's design history: every change has an author and a reason, every read names a branch or past commit, and shared history is never rewritten. |
| [0026](0026-api-host-and-route-versioning.md) | API host and route versioning | Accepted; amended by ADR-0054 (decision 1) | The API is served from the Next.js web application for now, every route lives under `/api/v1/`, and a separate server remains the long-term goal. |
| [0027](0027-schema-self-description.md) | Schema Self-Description via `@metadata` | Accepted and implemented, except decision 4 (`GET /api/v1/schema` not built) | Every schema class carries a category label (infrastructure, fragment, artifact or relationship) that tools and code generators read from the schema itself. |
| [0029](0029-coverage-algorithm.md) | Coverage Algorithm | Accepted for decisions 1 to 3; superseded in part by ADR-0056 (decisions 4 to 6; decision 7 moot) | For each objective a module declares, coverage counts the distinct questions placed in the module's assessments: 0 is Uncovered, 1 Partially Assessed, 2 to 4 Fully Assessed, 5 or more Over-Assessed. |
| [0032](0032-identity-resolution.md) | Identity resolution | Accepted and implemented | A pluggable resolver turns each request's identity into a `User` kept on the `main` branch, and that identity, never the request body, is recorded as the author of the change. |
| [0033](0033-items-as-a-tree-of-fragments.md) | Items Are a Tree of Fragments | Accepted; the typed shape is implemented, generic fragment kinds are not yet built | A question's parts are "fragments" with permanent identifiers, so richer question types can be added later without reworking existing data. |

### 0054–0057: Later decisions (October 2026)

| ADR | Title | Status | In plain language |
|---|---|---|---|
| [0054](0054-api-as-a-hono-app.md) | The Armature API is a Hono application | Accepted and implemented; amended by ADR-0032 (decision 4) | The API is a Hono application in `app/lib/api/`, independent of Next.js, which serves it through a single file so it can move to its own server without a rewrite. |
| [0055](0055-store-access-over-http.md) | The API layer reaches TerminusDB over HTTP, not through the JavaScript client | Accepted and implemented | The API talks to the TerminusDB database through one small HyperText Transfer Protocol (HTTP) module instead of the JavaScript client library, so it can record each change's real author. |
| [0056](0056-coverage-is-computed-on-read-never-stored.md) | Coverage Is Computed on Read, Never Stored | Accepted and implemented | Coverage, and any future score, is calculated when someone asks for it, at any point in the design's history, and is never stored in the database. |
| [0057](0057-records-name-the-commit-they-refer-to.md) | Records That Refer to a State of the Graph Name Its Commit | Proposed | Proposes an `asOf` field naming the saved version of the design that a dataset, metric or finding refers to, so results can be compared with the design as it was. |

## How to add an ADR

1. **Write the ADR before the change.** Any change to `schema/schema.json` that alters an existing
   type or adds a new one needs an ADR first; so does any other decision a later reader would
   otherwise have to reverse-engineer from the code.
2. **Pick the number.** If you are writing one of the reserved decisions (0028, 0030, 0031, 0034),
   use its reserved number. Otherwise take the next number after the highest existing ADR
   (ADR-0058 at the time of writing). If the decision adopts a research candidate from
   `docs/research/adr-candidates.md`, name the candidate in the Status section, as ADR-0025 does
   for candidate 0036.
3. **Name the file** `NNNN-short-decision-title.md` in this directory.
4. **Follow the format below**: the Nygard sections (Status, Context, Decision, Consequences),
   plus Alternatives considered when real alternatives were weighed, and an In brief block for
   readers who are not engineers.
5. **Verify any database behavior you rely on.** If the decision depends on how TerminusDB
   behaves, cite the lettered check in `scripts/platform_checks.js` that demonstrates it. If no
   check exists, add one and run it first; the script creates a scratch database and deletes it
   afterwards. Record the results, with the TerminusDB version and the date, in a Verification
   section.
6. **Reference the ADR where it takes effect.** Cite its number in the `@documentation` comment of
   every schema class or field it shapes, and in code comments where the code carries it out.
7. **Keep links two-way.** If the new ADR amends or supersedes an earlier one, add a dated note to
   the earlier ADR's Status section and a "Later change" note under each statement it makes
   untrue. Do not rewrite or delete the earlier text. Then add the new ADR to the index above.
8. **After a schema change**, regenerate the types (`npm run generate:types` in `app/`) and the
   appendix (`node scripts/generate-schema-appendix.js`), and commit them with the schema.

## Format

```markdown
# ADR-XXXX: Title

> **In brief.** Two to four plain-language sentences for a reader who is not a software engineer:
> what question this decision answers, what was decided, and whether it still holds. Expand any
> acronym.

## Status

[Proposed | Accepted | Accepted and implemented | Amended by ADR-XXXX | Superseded in part by
ADR-XXXX | Superseded by ADR-XXXX | Deprecated], with the date, and any ADRs this one amends or
supersedes.

## Context

What situation or problem motivated this decision?

## Decision

What was decided?

## Alternatives considered (optional)

What other options were weighed, and why was each rejected?

## Verification (optional)

Which platform checks in `scripts/platform_checks.js` (or other tests) confirm the behavior this
decision relies on, against which TerminusDB version, on what date, and with what result?

## Consequences

What are the results — positive, negative, and neutral?
```
