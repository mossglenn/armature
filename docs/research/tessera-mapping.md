# Mapping Tessera onto Armature

**Date:** 2026-10-18 · **Status:** Research note, not a decision. Nothing here changes the schema
or the API. The one change it led to is a new reference client in `docs/development-plan.md` §2
(the course builder), added the same day on the project owner's decision.

**Source:** [`redmodd/tessera`](https://github.com/redmodd/tessera) at commit `471d671`
(2026-10-19, `tessera-learn@0.11.1`), MIT. Read as text through the GitHub API: the root and
package `AGENTS.md` authoring guides, `docs/xapi.md`, `docs/scoring.md`, `docs/export.md`,
`docs/hooks.md`, and the modules `runtime/types.ts`, `runtime/interaction.ts`,
`runtime/interaction-format.ts`, `runtime/fingerprint.ts`, `runtime/quiz-engine.svelte.ts`,
`runtime/hooks.svelte.ts`, `runtime/xapi/publisher.ts`, `runtime/adapters/xapi-launch-base.ts`
and `runtime/adapters/scorm-base.ts`. No code from it was run; statements about runtime behavior
below are read from the source, not observed.

---

## 1. What it is, and why map it

Tessera is a TypeScript and Svelte framework for building and delivering eLearning courses. Pages
are `.svelte` files; a runtime owns the LMS (learning management system) data contract (tracking,
completion, scoring, navigation, saved state) and exports to SCORM 1.2, SCORM 2004 4th Edition,
cmi5, xAPI 1.0.3 or a static web build. It is designed for AI-assisted authoring: a packaged
`AGENTS.md` tells an assistant working in a course workspace how to write pages and components.
It is about five months old, pre-1.0, written by one maintainer, with an extensive conformance
test suite, and its changelog warns that some releases change how courses are written or reset
learners' saved progress.

It has no design concepts: no objectives (the only match for "objective" is an example page
title), no rationale, no history of design decisions. Its runtime and authoring conventions are
plugin territory (CLAUDE.md principle 5), and none of its code belongs in this repository.

It is worth mapping because it sits at the other end of Armature's pipeline from DQ QuestionBank
Core (`dq-questionbank-mapping.md`). DQ is an item bank beside the hub; Tessera is where a design
held in the hub would be **built and delivered**, and where Narrative 1's outcomes would come
from. Both directions are mapped: design to course (§2) and outcomes to design (§3).

## 2. Armature to Tessera: building a course from the design

A generator that reads the graph at one commit and writes a Tessera course is a plugin. The
shapes line up closely:

| Armature | Tessera | Fit |
|---|---|---|
| `Course` (`label`, `description`) | `course.config.js` (`title`, `description`, `id`) | Direct. The course `id` seeds the xAPI activity id, so it must be stable and unique (§3.1) |
| `Module`, in course order | A chapter folder with `_meta.js` (`title`, ordered `pages`) | Direct |
| Module content: `ModuleActivityLink` and `ModuleActivityGroupLink` by shared `sequence`, groups' members by their own (ADR-0005) | Pages in order within a chapter | **Needs a read the hub lacks**: the ordered module-content view ADR-0005 assigns to the API is unbuilt (plan §6) |
| `LearningActivity` | A content page | Lossy. An activity is a design record with a type and targets, not content; the page body is the builder's or the assistant's to write |
| `Assessment` (`retakes`, `passingScore`, `randomize`) | A quiz page: `pageConfig.quiz` (`graded`, `maxAttempts`, `feedbackMode`, `retryMode`), and the course's pass rule | Adapter. `retakes` → `maxAttempts`; `passingScore` maps to Tessera's success rule, which is course-wide rather than per assessment (`docs/scoring.md`) |
| `ItemInstance` (`sequence`, `pointValue`, `randomize`) | Question order on the page; per-question `weight` | Direct for order and weight. Per-placement randomization was not found in what was read |
| `AssessmentItem` with `itemType` | A question component | See the table below |
| `ItemOption` `text`, `isCorrect`, `feedback` | `options: string[]`, `correct` (a 0-based index), `optionFeedback: string[]` | Adapter. Options are plain strings; an option has no id of its own (§3.2) |
| `correctFeedback`, `incorrectFeedback` (`TextFragment`) | `correctFeedback`, `incorrectFeedback` (`string`) | Direct; the same names |
| `AssessmentItem` `@id` | Question `id`: letters, digits and inner underscores, unique within a page | Adapter. An Armature id (`AssessmentItem/<uuid>`) is not a legal Tessera id; the builder must derive one and keep the mapping (§3.1) |

Item types:

| Armature `ItemType` | Tessera component | `cmi.interaction` type |
|---|---|---|
| `MultipleChoice` | `MultipleChoice` | `choice` |
| `MultipleSelect` | Not found among the built-in components read (`MultipleChoice` takes one `correct` index) | `choice` |
| `TrueFalse` | `MultipleChoice` with two options, or a custom widget | `true-false` |
| `FillInTheBlank` | `FillInTheBlank` (`answers`, `caseSensitive`) | `fill-in` |
| `ShortAnswer` | A custom widget | `fill-in` or `long-fill-in` |
| `Essay` | A custom widget | `long-fill-in` |
| `Matching` | `Matching` | `matching` |
| `Ordering` | `Sorting` | `sequencing` |
| — | — | `numeric`, `likert`, `performance`, `other` |

Two gaps belong to Armature, not Tessera. `FillInTheBlank`'s accepted answers, and `Matching`'s
and `Ordering`'s pairs and orders, have no field in Armature's schema: per-type data shapes are
ADR-0034's, not yet written. Tessera's components are a concrete statement of what those shapes
must carry.

## 3. Tessera to Armature: outcomes back into the design

Tessera reports a learner's answer under xAPI and cmi5 as an `answered` statement (read from
`runtime/adapters/xapi-launch-base.ts`):

```
verb:   http://adlnet.gov/expapi/verbs/answered
object: { id: "<course activityId>#<questionId>", objectType: "Activity",
          definition: { type: <cmi.interaction>, interactionType, correctResponsesPattern? } }
result: { response, success? }
```

Under SCORM it writes the same interaction as `cmi.interactions.n.*`. An outcomes importer would
turn a cohort's statements into a `LearningDataset` (`producedBy` the `Assessment`, `asOf` the
commit the course was built from, ADR-0057) and per-item `LearningMetric`s whose `subject` is the
item (ADR-0058). Three things stand between the statements and that result.

### 3.1 The question identifier is not course-unique

A question `id` is unique within a page (`AGENTS.md`, question rules), and the id the quiz engine
passes to the adapter is that bare id (`quiz-engine.svelte.ts` registers it; the adapter composes
`<activityId>#<questionId>`). As read, two pages that each hold a question `q1` would report the
same xAPI object id. An omitted `id` is derived from the prompt text, so rewording a question
changes its identity, which ADR-0023 and ADR-0024 forbid for Armature's own identifiers. The
SCORM adapter also sanitizes ids (`q-planet` becomes `q_planet` under SCORM 1.2).

**Consequence for an importer:** it can rely on question identity only if the builder writes an
explicit, course-unique id for every question and keeps the mapping from that id to the Armature
item. A builder controls this; a course written by hand does not.

### 3.2 Options are identified by text or position

A multiple-choice question's options are strings and its key is an index. A response is recorded
as an option's text, sanitized, or as its position when the export standard requires it
(`interaction-format.ts`). Neither is a `fragmentId`.

**What makes this recoverable is `asOf`.** If the builder records the Armature commit it built
from, the item read at that commit has a fixed option order, so a position names exactly one
`fragmentId`. Per-option statistics (how often each distractor was chosen) can then land on the
right fragment, which is the distractor analysis ADR-0058 leaves to be built. Positions are unsafe
as identity across commits, and exact within one.

### 3.3 The build must carry its source commit

For the importer to fill `asOf`, the delivered package must name the Armature commit it was
generated from. Candidates in Tessera: the course `version` field (`CourseConfig.version`), the
course `id` or activity id, or an xAPI context extension. Whether Tessera can attach an extension
to the statements it sends automatically (the lifecycle and `answered` statements, as opposed to
those an author sends through `useXAPI()`) was not verified. This is the most important question
to settle before an importer is built.

## 4. What Tessera does that Armature can learn from

- **The interaction vocabulary is a standard's.** Tessera's `Interaction` type is the SCORM 2004
  `cmi.interaction` set verbatim. If ADR-0034's built-in interaction types were keyed to the same
  vocabulary, outcomes would come back in the terms the design was written in, which is plan
  principle P6 (reference standards by identifier) applied to item types. Armature's eight
  `ItemType`s map onto it with three gaps (`numeric`, `likert`, `performance`).
- **A structure fingerprint decides when a course is a new version.** Tessera hashes the ordered
  page slugs (`runtime/fingerprint.ts`) and discards a learner's saved progress when the structure
  changes, and its guide tells authors to upload a restructured course as a new LMS version. That
  is a precise, cheap answer to "when is a delivered course a different thing": the question an
  outcomes importer must answer to decide which `asOf` a cohort's results belong to.
- **Conventions for an AI author, versioned with the runtime.** The authoring guide ships inside
  the package, so an assistant reads the rules of the version it is writing against. Armature's
  AI design assistant reference client would benefit from the same: conventions served with the
  API version, not kept in a separate document.

## 5. The course builder, a new reference client

No row of the plan's reference-clients table builds a deliverable course from the design: the
outcomes importer brings results in, but nothing takes the design out. On the project owner's
decision (2026-10-18) the table gains a **course builder**: it generates a deliverable course
(SCORM, cmi5 or xAPI) from the design at one commit, for instance by having an AI assistant write
a framework's pages. What it needs from the hub, and the second client for each:

| Need | Second client |
|---|---|
| The ordered module-content view (ADR-0005), unbuilt | Activity and strategy designer, already in the table. With the builder, the view **passes the two-client test** |
| The course tree read at one commit, with the commit returned | Every client; already built (`?ref=`, `ETag`) |
| Interaction types with data shapes a runtime can render, keyed to `cmi.interaction` (ADR-0034) | Rich item authoring tool |
| Its source commit, which becomes the delivered results' `asOf` (ADR-0057) | Outcomes importer |
| Assessment settings as data (attempts, passing score, weights) | Outcomes importer, which needs the pass rule a cohort was judged by |

## 6. Recommendation

- **Do not import Tessera code.** It is the delivery layer, and principle 5 keeps runtimes and
  formats out of the hub.
- **Build the ordered module-content view** when the next phase touches module content: it now
  has two reference clients.
- **Cite this note** when ADR-0034 (interaction types keyed to `cmi.interaction`, per-type data
  shapes) and the outcomes importer (Phase 6) are designed.
- **A builder and an importer are plugins**, and whether to approach Tessera's maintainer is the
  project owner's outward-facing choice. Two asks would matter if either is built: course-unique
  question ids reported to the LMS, and a place to stamp the source commit on every statement.
