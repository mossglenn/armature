# Mapping QuiQui onto Armature

**Date:** 2026-10-18 · **Status:** Research note, not a decision. It adds evidence to the course
builder reference client (`docs/development-plan.md` §2) and raises one open question, entered in
plan §6 the same day: whether items used formatively inside learning activities belong in the
graph (§4).

**Source:** [`th-nuernberg/quiqui`](https://github.com/th-nuernberg/quiqui) at commit `2e44541`
and its question-format repository
[`th-nuernberg/quiqui-questions`](https://github.com/th-nuernberg/quiqui-questions) at `ccac664`
(both 2026-10-16), AGPL-3.0. Read as text through the GitHub API: `README.md`, `QUICKSTART.md`,
`FAQ.md`, `server.js`, and the format reference and example files of the question repository. No
code from it was run.

---

## 1. What it is, and why map it

QuiQui ("quick quiz") is a live audience response tool for lectures: the lecturer loads a YAML file
of questions, from a local file or a public GitHub repository; participants join by QR code with no
account; the host opens one question at a time, watches the votes arrive, and reveals the answer.
It is Node.js with socket.io and vanilla JavaScript, from Technische Hochschule Nürnberg, about four
months old, with one main maintainer and an end-to-end security test suite.

Three properties place it relative to Armature:

- **Delivery, not design.** It runs a room. CLAUDE.md principle 5 keeps that out of the hub.
- **It keeps nothing.** "Session state lives in memory and vanishes when the quiz ends." There are
  no accounts, no stored responses and no results export (none found in `server.js` or the FAQ).
  It can never feed Narrative 1, by design.
- **AGPL-3.0.** Armature is MIT. Copying QuiQui code into Armature would bring the AGPL's
  network-service obligations with it. A separate plugin that only reads or writes QuiQui's YAML
  format interoperates without being a derivative work.

It is mapped because it is a second, independent instance of the course builder reference client
(after Tessera, `tessera-mapping.md`), and because the way lecturers use it exposes a gap in how
Armature models formative assessment.

## 2. The question format

A session file is a YAML map with a `config` (a `session_url` that names the room, and a `title`)
and a `questions` list. Each question has `question` (Markdown, LaTeX and code allowed), `type`,
`answers`, an optional `correct` and an optional `explanation` shown on reveal; `shuffle` reorders
answers for display. There are four types:

| QuiQui `type` | `correct` | Armature `itemType` |
|---|---|---|
| `single` | one letter (`B`) | `MultipleChoice`; also `TrueFalse`, which QuiQui writes as a two-answer `single` |
| `multiple` | a list of letters | `MultipleSelect` |
| `matching` | per line, the value assigned | `Matching` |
| `ranking` | the letters in rank order, or none for an unscored opinion poll | `Ordering` |

A question with no `correct` is unscored: a poll, a rating, a yes/no. Armature has no unscored item:
`isCorrect` is required on every option, and rule 9 asks a choice item for a correct option.

## 3. Armature to QuiQui: building a session from the design

A generator would read the items placed in a module at one commit and write a session file. It
fits the course builder row added to the plan for Tessera:

| Armature | QuiQui | Fit |
|---|---|---|
| Items, in the order a placement or activity gives | `questions`, in file order | Direct |
| `stem.text` | `question` | Lossy in the other direction only: QuiQui renders Markdown and LaTeX, Armature stores plain text (`dq-questionbank-mapping.md` §4.2) |
| `options[]` in order at the commit, `isCorrect` | `answers[]`, `correct` as letters | Adapter. The letters are computed from the order at that commit |
| `correctFeedback`, or a worked solution | `explanation` | **Gap.** An explanation shown on reveal is a worked solution, which Armature has no field for (`dq-questionbank-mapping.md` §4.4) |
| `ItemOption.feedback` | Nothing | QuiQui has no per-answer feedback |
| The source commit | A comment in the file, or the `title` | Adapter. Nothing comes back, so the commit only helps a person reading the file later |

The reverse direction has nothing to carry. If a room's answer distribution were ever wanted on
record, it would be an aggregate `LearningMetric` whose `subject` is the item: counts per answer,
no person in them, which ADR-0021 permits. QuiQui would have to choose to export it.

## 4. The finding: items used formatively, inside activities

A live poll in a lecture is a learning activity that uses items. It checks understanding and
prompts discussion; it is not graded and gates nothing. Armature cannot record it:

- Items reach a module only as `ItemInstance` placements in an `Assessment`, and an `Assessment`
  requires a `module` and carries summative fields (`passingScore`, `retakes`).
- A `LearningActivity` (`activityType` `Practice` or `Discussion`) names the objectives it
  `targets` and cannot reference an item.

So a designer can record "lecture 3 has a practice activity targeting LO-2" or "the module's quiz
places item X", but not "lecture 3 polls the room with item X". The two-client test is already met:

| Client | How it uses items formatively |
|---|---|
| QuiQui (real) | A live poll: items inside a lecture activity, unscored or scored, never recorded |
| Tessera (real, the course builder) | Standalone questions on ordinary content pages (`useQuestion` outside a quiz), graded or not |
| Activity and strategy designer (reference client) | "A practice activity with these items" is the plan's own example of strategy |

Coverage (ADR-0029) counts placements in assessments only, and that was deliberate: coverage says
whether a module *assesses* what it declares. The open question is therefore not whether coverage
should count formative use, but whether formative use should be **in the graph at all**, and if so
how: a reference from `LearningActivity` to the items it uses; a junction (an activity-item link
with its own `sequence`, like `ModuleActivityLink`); or an `Assessment` flagged as formative. Each
touches ADR-0005 (module content), ADR-0029 (what coverage counts, and whether a second, formative
figure is wanted) and ADR-0019 (eligibility). Entered in plan §6, undecided.

## 5. Other observations

- **Positional identity fails in the wild.** Questions have no identifiers and answers are keyed by
  letter. In `self-contained-example.yaml` at `ccac664`, the first question lists `Marseille`,
  `Paris`, `Nice` with `correct: C`, which marks Nice as the capital of France; the README's
  version of the same question lists four answers beginning with `Lyon`, where `C` is Paris. An
  answer was evidently removed without the key being updated. DQ (`"A"`–`"D"`), Tessera
  (`correct={1}`) and QuiQui all identify options by position; this is a live case of the hazard
  ADR-0023 decision 3 guards against, in a fourth tool.
- **Questions in Git, but without identity.** QuiQui puts questions where they can be versioned,
  diffed and reused across courses, which is the property Armature builds on (ADR-0025). Without
  identifiers, though, Git's history follows lines, not questions: a reordered or edited file
  cannot say which question changed. Identity is what turns a file's history into an artifact's
  history.
- **Privacy by absence.** No accounts, nothing stored, no leaderboards. ADR-0021 reaches the same
  place by policy (no per-person aggregate) while still storing records; QuiQui reaches it by
  storing nothing. An Armature-fed builder would preserve that: it writes files and reads nothing
  back.
- **Drafting with an AI assistant into a plain format** ("paste our prompt into ChatGPT or Claude")
  is the AI design assistant reference client's pattern, with the format as the contract.

## 6. Recommendation

- **Do not import QuiQui code** (delivery layer, and AGPL-3.0 against Armature's MIT).
- **Count it as evidence for the course builder** row, beside Tessera.
- **Decide the formative-items question (§4) deliberately**, before the ordered module-content
  view is built, since that view is where an activity's items would appear.
- **The example-file error (§5) is QuiQui's to fix** (`correct: B`); reporting it is the project
  owner's outward-facing choice.
