# Mapping DQ QuestionBank Core onto Armature

**Date:** 2026-10-18 · **Status:** Research note, not a decision. Nothing here changes the schema
or the API; each gap names the decision it is evidence for.

**Source:** [`wzsisshadiao-crypto/dq-questionbank-core`](https://github.com/wzsisshadiao-crypto/dq-questionbank-core)
at commit `e1c5025` (2026-10-18, release v1.2.6), Apache-2.0. Read as text through the GitHub API:
`schema/question-set-1.1.schema.json`, `examples/sample_questions.json`, `OPEN_SOURCE_BOUNDARY.md`,
the design documents under `docs/` (question schema, question ids, quality findings, review
sessions, architecture proposal, roadmap) and the modules `quality_findings.py`,
`review_session.py`, `question_id.py` and `models.py`. No code from it was run.

---

## 1. What it is, and why map it

DQ QuestionBank Core is a Python, local-first toolkit for question banks: importing questions from
LaTeX, DOCX, PDF, Markdown and AI-assisted extraction; reviewing import candidates; editing with
live math preview; detecting LaTeX quality problems; assembling papers; publishing to Word. It is
the public core of a private commercial product (`OPEN_SOURCE_BOUNDARY.md`). It is about two
months old, released almost daily, and written mostly by one maintainer, with 140 test files and
CI.

Almost all of it is plugin territory under CLAUDE.md principle 5 (import and export formats,
authoring UX, publishing), and none of its code belongs in this repository. It is mapped here for
two other reasons:

1. **It is a real instance of the "rich item authoring tool" reference client** (PROJECT_CONTEXT,
   plan §2). Every two-client test today is argued against hypothetical clients; this one exists.
   Its architecture already expects storage outside the core ("StorageAdapter, implemented outside
   core"), so an Armature adapter would be an ordinary extension on its side.
2. **Where it does not fit, the misfit is evidence** for decisions Armature has left open (ADR-0033
   generic fragment kinds, ADR-0034 interaction types, ADR-0030 attachments, candidate 0035
   lossless writes, ADR-0028's open `regarding`).

## 2. The question model, field by field

DQ's normative form is JSON: a `QuestionSet` (`id`, `title`, `language`, ordered `questions`)
holding `Question`s whose content is an ordered list of typed blocks (`text`, `math` as LaTeX,
`image` by `asset_id`, `table`, `code`, `line_break`).

Fit: **Direct** maps as is; **Adapter** maps with a rule the adapter owns; **Lossy** maps with
information lost; **Gap** has no Armature home today.

| DQ | Armature | Fit | Note |
|---|---|---|---|
| `Question.id` (unique within its set) | `AssessmentItem` `@id` (global; client-supplied, ADR-0024) | Adapter | Compose `AssessmentItem/<set-id>--<question-id>` or mint a UUID and keep the mapping. DQ's id rules (never encode volatile fields, never reuse a retired id) match ADR-0023 and ADR-0024 |
| `QuestionSet` as a bank | Nothing: items exist independently in the bank | Adapter | A set becomes the branch name or commit message of an import, not a document |
| `QuestionSet` as an assembled paper | `Assessment` plus `ItemInstance` placements with `sequence` | **Gap** | `Assessment.module` is required, and DQ has no module or course. A paper cannot land without inventing one (§4.8) |
| — | `AssessmentItem.label` (required) | Adapter | DQ questions have no title; the adapter must derive one (the stem's first words) |
| `type` | `itemType` | Lossy | `single_choice` → `MultipleChoice`, `multiple_choice` → `MultipleSelect`, `true_false` → `TrueFalse`, `fill_blank` → `FillInTheBlank`, `short_answer` → `ShortAnswer`, `essay` → `Essay`. **`composite` has no equivalent** (§4.3). Armature's `Matching` and `Ordering` have no DQ type. How DQ represents true/false (two choices or a boolean answer) was not verified; Armature requires exactly two options (rule 9) |
| `stem` (content blocks) | `stem: TextFragment` (`fragmentId`, plain `text`) | **Lossy** | Text and math flatten to a string with `$…$` delimiters, which Armature stores but cannot interpret; images, tables and code have no home (§4.2) |
| `choices[]` (`id`, `content`) | `options[]: ItemOption` (`fragmentId`, `text`, `isCorrect`) | Adapter, Lossy | `choice.id` → `fragmentId`, but DQ's ids are positional letters (`"A"` to `"D"` in its own sample), which ADR-0023 forbids (§4.9). Content flattens as for the stem |
| `answer` (`kind: choice` or `choices`, `value`) | `ItemOption.isCorrect` | Direct | `value` names the correct choice ids |
| `answer` (any other `kind`: `text`, numeric, …) and `alternatives` | Nothing | **Gap** | A short-answer, fill-in or essay item in Armature has no field for its expected answer (§4.4) |
| `solution`, `analysis` | Nothing | **Gap** | Worked solutions are content, not feedback; `correctFeedback` and `incorrectFeedback` are something else (§4.4) |
| `hints[]` | Nothing | **Gap** | (§4.4) |
| `assets[]` (`id`, `kind`, `uri`, `media_type`, optional `sha256`, dimensions) | Planned attachment references (ADR-0030: mandatory content hash, optional revision and path) | Gap until ADR-0030 | DQ's shape is close to what ADR-0030 reserves; its digest is optional where Armature's will be required, so the adapter computes it |
| `difficulty` (0 to 1) | Not a field (ADR-0058) | **Decision needed** | An authored estimate, not a measured statistic (§4.5) |
| `taxonomy[]` (`system`, `code`, `label`) | `assesses` (when the system is a competency framework), or planned external references (ADR-0030, CASE) | Adapter or Gap | Not an objective as it stands; see §4.1 |
| `subject`, `tags[]`, `language` | Nothing | Gap | Classification and locale; no Armature field. Whether the hub wants them is a two-client question, not assumed here |
| `source` (`title`, `author`, `year`, `uri`, `license`, `attribution`, `locator`) | Nothing | **Gap** | Content provenance and licensing (§4.6) |
| `metadata` (namespaced extensions) and `schema_version` on every question | Strict request schemas refuse unknown keys; no version on a document | **Gap** | A round trip through Armature drops them (§4.7) |
| — | `assesses` (at least one `LearningObjective`, rule 1) | **Gap** | DQ questions name no objective (§4.1) |
| — | `status` (`ItemStatus`), `bloomsLevel`, `ItemOption.purpose` | Adapter | Defaults on import (`Draft`); DQ has no readiness state or option rationale |

## 3. The process contracts

| DQ contract | Armature | Note |
|---|---|---|
| An import candidate session: candidates `pending`, then `accepted` or `rejected`; extraction never implies persistence | A branch per import session; candidates written as `Draft` items on it; merged when the review ends | The hub already models this. The merge commit records who accepted (ADR-0025); DQ's digests and revision counters stay in DQ |
| A reviewer accepts a candidate | Optionally an `Attestation` with no claim (an endorsement) by that reviewer, ADR-0028 | Only when a per-item verdict is wanted beyond the merge |
| A `QualityFinding` (`rule_id`, `ruleset_version`, `target_field`, `severity`, `explanation`, input fingerprints) | A `DesignFinding` by an agent `User` (`agent:dq/quality-1`), `subject` the item, `fragmentId` from `target_field`, `finding` the explanation, `asOf` the commit | `target_field` such as `choices[0].content` resolves to a `fragmentId` only through the adapter. `severity` has no field (`confidence` is not severity) |
| A human judgment on a finding: `accepted` or `rejected` | `FindingStatus`: an accepted finding stays `Open` until the repair lands, then `Addressed`; a rejected one is `Dismissed` | `Dismissed` requires a `resolutionRationale` (rule 11); DQ judgments carry none, so the adapter must ask for one or supply a stated default |
| Repair proposals (preview only), the safe-repair gate, LaTeX normalization, Word publishing | Nothing, by design | Plugin workflow and formats (principle 5) |

## 4. What does not fit, as evidence

### 4.1 Every item must assess an objective

Rule 1 (ADR-0013) refuses an item with no `assesses`. CoQui asked for `assesses` to be optional
while an item is `Draft`, then withdrew the ask, because its items always arrive from Armature
already aligned (plan §2). DQ is the other case: a bank of questions that exist before anyone has
aligned them. An adapter can satisfy the rule only by inventing objectives, for instance one
`Draft` placeholder objective per set or per taxonomy code, by analogy with ADR-0011's
placeholder objectives for prerequisites. That writes a fiction into the graph.

This is the first evidence from a second client that the withdrawn ask was real. It does not
decide anything; it is the kind of evidence a settled decision should be reopened on, rather than
on preference. The question to put: is alignment a precondition of an item existing in the hub, or a
state the coverage read already reports (an unaligned item simply covers nothing)?

### 4.2 Rich content

Armature's fragments carry one plain `text` string. DQ's content is an ordered list of typed
blocks, with math as LaTeX and images by asset reference. ADR-0033 plans generic fragment kinds
with a validated JSON payload beside `ItemOption`; DQ's block list is a concrete specimen of what
that payload must hold, and of the decision ADR-0033 has not yet made: whether a fragment holds
rich content, or whether rich content is a list of fragments.

### 4.3 Composite questions

A DQ `composite` question nests `subquestions` that share a stem (a passage, a scenario), each
with its own type and answer. Armature has no item nesting: one `AssessmentItem` is one question.
The options are an item whose fragments include sub-items, a parent item referenced by children
(the back-reference pattern, ADR-0004), or a grouping record. Evidence for ADR-0033 and ADR-0034;
QTI's assessment sections and testlets are the standard precedent.

### 4.4 Answers, solutions and hints beyond options

For option types, correctness lives on the options. For every other type Armature has no field for
the expected answer, its accepted alternatives, a worked solution or hints. DQ treats these as
content blocks like the stem. Whether they are fragments (addressable, so a reviewer can attest
"the solution is correct") is a question for ADR-0033, and a strong argument that they should be.

### 4.5 An authored difficulty is not a measured one

ADR-0058 made item statistics `LearningMetric`s derived from an administration. DQ's `difficulty`
is an author's estimate, made before any learner sat the item. It is a judgment, not an
observation, so under ADR-0056 it is not a stored field either. Candidates: a `LearningMetric`
with no `derivedFrom` and a `source` saying "author estimate"; a `DesignNote`; or an attestation
whose claim is the estimate. Undecided; the outcomes importer and an authoring tool would both
have to agree on the reading.

### 4.6 Provenance and license of content

DQ records, per question, where the content came from and under what license. Armature records
who wrote a record and why (commits, `createdBy`), not the rights in its content. The research
exporter needs exactly this: an export profile (ADR-0031) cannot decide what is redistributable
without it, and ADR-0021's pseudonymization does not cover third-party content. Evidence for
ADR-0031, and possibly for ADR-0030's references.

### 4.7 Extensions and versions on the wire

DQ lets a tool keep namespaced extension data on any object, and stamps a `schema_version` on
every serialized question; readers refuse a version they do not know. Armature's strict request
schemas refuse unknown keys, so a DQ question loses its extensions on the way in, and nothing on
an Armature document says which schema it was written under. This is candidate 0035 (lossless
writes across schema versions) and the unbuilt `GET /api/v1/schema` (ADR-0027), both open in plan
§6, met by a real client.

### 4.8 A paper without a module

A DQ paper is a set of questions in order. In Armature an `Assessment` belongs to a `Module`
(required), so a paper assembled outside any course cannot be stored as one. This may be right
(Armature is course design infrastructure, and a free-floating paper is a plugin artifact), but it
should be a stated scope choice rather than a side effect of a required field.

### 4.9 Positional choice ids

DQ's own sample names its choices `"A"` to `"D"`. ADR-0023 decision 3 and CoQui's lessons both say
a part's identifier must never come from its position. Whether DQ keeps a choice's id when choices
are reordered was not verified. If it does, the letters are permanent and safe to use as
`fragmentId`s; if not, the adapter must mint stable `fragmentId`s and keep a mapping. A question to
put to DQ before any adapter is built.

## 5. What DQ does that Armature can learn from

- **Findings bound to the fields they read.** A `QualityFinding` stores SHA-256 fingerprints over
  *every field its rule read*, not only the field it targets, and goes stale when any of them
  changes while ignoring unrelated edits. This is ADR-0028's open `regarding` question answered
  from outside: an attestation that an item aligns with an objective should go stale when either
  changes. Armature's form would declare the dependencies on the record and compare each at
  `asOf` and at the ref, storing no hash, since every state stays readable (ADR-0025).
- **A stale judgment fails closed.** Judging a stale DQ finding raises an error rather than
  recording a decision about a state that no longer exists. Armature records a finding's status
  change without checking that its subject is unchanged since `asOf`. Whether a dismissal of a
  stale finding should be refused, or merely reported, is a question worth asking of ADR-0020 and
  ADR-0057.
- **The rule's identity travels with the finding** (`rule_id`, `ruleset_version`), so a finding
  from an older ruleset can be told apart. In Armature that identity is the agent `User`
  (`agent:dq/quality-1`), which already distinguishes rulesets without a schema change.
- **Extraction is not acceptance.** DQ's import sessions keep candidates, decisions and the export
  separate, and nothing is persisted until a human decides. Armature's branches give the same
  separation; DQ's contract is a good test of whether branch-per-import is comfortable in practice.

## 6. Reading the gaps through the two-client test

A gap enters the hub only in the generic form a second reference client also needs (CLAUDE.md
principle 6). Which other reference client would need each one:

| Gap | Other client that needs it | Where it would go |
|---|---|---|
| Rich content and composite items (§4.2, §4.3) | AI design assistant (item generation), complex learning object designer | ADR-0033, ADR-0034 |
| Answers, solutions, hints as addressable parts (§4.4) | CoQui (a reviewer attests "the key is correct"), AI design assistant | ADR-0033 |
| Unaligned items (§4.1) | Outcomes importer (items arriving from an LMS), AI design assistant (drafts) | Reconsider rule 1, or state it as scope |
| Content provenance and license (§4.6) | Research exporter | ADR-0031, possibly ADR-0030 |
| Extensions and versions on the wire (§4.7) | Every client that round-trips | Candidate 0035, ADR-0027 decision 4 |
| Assets with digests | Rich item authoring tool, complex learning object designer | ADR-0030 |
| Authored difficulty (§4.5) | Outcomes importer, if estimates and measurements are compared | Undecided |
| Subject, tags, language | None identified yet | Stays in the adapter |
| Papers without modules (§4.8) | None identified yet | Stays in the plugin, or a scope statement |

## 7. Recommendation

- **Do not import DQ code.** It is a different layer and a different language, and principle 5
  keeps its formats and UX out of the hub.
- **Treat DQ as evidence**, and cite this note when ADR-0033, ADR-0034, ADR-0030, ADR-0031,
  candidate 0035 and ADR-0028's `regarding` are written or reopened.
- **Put rule 1 (§4.1) on the list of settled decisions to reassess**, with this note and the
  withdrawn CoQui ask as the evidence.
- **An adapter is DQ's to build**, if anyone builds one; whether to propose it to DQ's maintainer
  is an outward-facing choice for the project owner. Two facts should be settled first: DQ's
  choice-id stability (§4.9) and how true/false is represented (§2).
