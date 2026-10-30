# The Storyline bridge: plan

*Status: draft 2026-10-27, for review; the questions in §14 are open, each with a recommendation the plan is written to. A plan for a client of the hub, built outside this repository. When the bridge exists, this document becomes its description and its own repository carries the code.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CLI (command-line interface), cmi5 (an xAPI profile for launching courses from an LMS), IRI (Internationalized Resource Identifier), JSON (JavaScript Object Notation), LMS (learning management system), LRS (learning record store), OIDC (OpenID Connect), SCORM (Sharable Content Object Reference Model), XLIFF (XML Localization Interchange File Format), xAPI (Experience API).

---

## 1. Purpose

Most instructional designers build in Articulate Storyline 360, a closed authoring tool whose source file Armature cannot read. The bridge makes a Storyline course a full participant in the graph anyway, by recording three things at the boundary:

- **Which build this is.** Each published package is identified by its content hash and tied to the design commit it was published against.
- **Which parts are which.** Each interaction in the build is mapped to the `AssessmentItem` it delivers.
- **What learners did.** Results come back as metrics about those items, at that commit, so Narrative 1 runs for a Storyline course.

It is the answer to the adoption objection every audience raises ("our designers use Storyline"), and in `docs/demo-coverage.md` it closes three of the six capabilities no built or planned demo shows: **impact**, **external references** and **attachments**. It also shows outcome records at `asOf`, trace and item statistics.

Constraints from the rest of the project, which hold throughout:

- **The bridge is a client.** It reaches the hub through `@armature/client` and needs no change to the API or the schema.
- **The `.story` file is never opened.** Its format is undocumented and changes between versions (`docs/research/learning-data-standards-precedents.md`). The bridge reads only what Storyline publishes and exports, and records the `.story` file by hash.
- **Published output is not modified by default.** Articulate explicitly does not support adding files to published output (§2). The bridge records the build in the graph instead of writing into the package (§14 question 4).
- **Learner data stays out of the graph.** Only aggregates cross: proportions correct, counts, a cohort's label (ADR-0058).
- **Storyline is a target, never a system of record** (the precedents survey). The design lives in Armature; a build is evidence of what was delivered.

---

## 2. What Storyline gives a tool

Researched 2026-10-27. **[A]** marks what Articulate documents; **[C]** what community reports or published packages show, which the bridge must verify against packages of its own (M0).

| What | Where | Source |
|---|---|---|
| Publish formats: SCORM 1.2, SCORM 2004 (2nd to 4th edition), xAPI 1.0.2, cmi5, AICC | Publish dialog | [A] [publishing for LMS](https://www.articulatesupport.com/article/Storyline-360-Publishing-a-Course-for-LMS-LRS-Distribution), [xAPI](https://www.articulatesupport.com/article/Publishing-Articulate-Storyline-360-Courses-for-Tin-Can-API) |
| A course **Identifier** assigned by Storyline, editable, not to be changed on republish; an xAPI **Activity ID** IRI | `imsmanifest.xml`; `tincan.xml` | [A] same articles |
| A project id and course id | `meta.xml` (`<project id=… courseid=…>`), `html5/data/js/data.js` | [C] inspected output |
| Stable internal slide ids (11 characters) with a slide map, each slide file carrying its id, title and `lmsId` | `html5/data/js/data.js`, `html5/data/js/<slideId>.js` | [C] inspected output |
| Every xAPI activity with its interaction type, choices and correct-response patterns | `tincan.xml` | [A] [Tin Can implementation](https://www.articulatesupport.com/article/Implementing-Tin-Can-API-to-Support-Articulate-Content) (an older article) |
| SCORM 2004 interactions report id, type, timestamp, learner response, correct response, result, weighting (the point value, since December 2022), latency and description (the question text); SCORM 1.2 omits timestamp and description | At runtime, to the LMS | [A] [quiz data sent to an LMS](https://www.articulatesupport.com/article/quiz-data-sent-to-an-lms-in-articulate-storyline) |
| **Interaction ids are positional**: scene, question draw and slide numbers (`Scene3_Slide3_MultiResponse_0_0`), not settable in Storyline; reordering changes them, renaming does not | At runtime | [A] same article and [staff answer](https://community.articulate.com/discussions/discuss/rename-slides-in-report/800246); [C] the examples |
| xAPI statements: verbs attempted, experienced, answered, completed, passed, failed, left; the course as grouping context | At runtime, to the LRS | [A] Tin Can implementation |
| A "Send xAPI statement" trigger (since build 3.58), with a raw-JSON editor that allows context extensions, not officially supported | Triggers | [A] [custom statements](https://www.articulatesupport.com/article/Storyline-360-Custom-xAPI-Statements); [C] [extensions](https://blog.xapi.ly/posts/storyline-xapi-updates-2021/) |
| Variables are not reported except through custom xAPI statements; adding a JavaScript file to published output is a method Articulate does not support | — | [A] [variables](https://www.articulatesupport.com/article/Storyline-360-How-to-Send-the-Value-of-a-Variable-to-an-LMS), [JavaScript](https://www.articulatesupport.com/article/Articulate-Storyline-360-JavaScript-Best-Practices-and-Examples) |
| Translation export as XLIFF 1.2 or 2.0 or Word, with internal object ids on each unit | Export | [A] [translating](https://www.articulatesupport.com/article/Storyline-360-Translating-Courses); [C] [ids](https://community.articulate.com/discussions/discuss/machine-translation-via-xliff/798701) |
| Question import from Excel or text: 19 type codes, `*` for correct, `\|` for choice feedback and matching pairs, up to 10 choices, points −1000 to 1000, formatting stripped, first sheet only, lands in the quiz after the selected slide, never in a question bank, no id column | Import | [A] [importing questions](https://www.articulatesupport.com/article/Storyline-360-Importing-Questions-from-Excel-Spreadsheets-and-Text-Files); the template in this project |

Three facts shape everything below:

1. **Interaction ids are exact within a build and unstable across builds.** They are positions. This is the same situation the Tessera mapping found for option positions (`docs/research/tessera-mapping.md` §3.2), with the same answer: identify the build, and a position names exactly one thing in it.
2. **Stable identity exists one level down.** The internal slide ids in the published data files survive reordering, so the bridge can map a positional interaction id to a slide id at publish time and record the slide id as the item's identity in Storyline. This is a community observation and the first thing M0 verifies.
3. **Nothing from Armature can travel inside a supported build.** Variables are not reported, and edits to the output are unsupported. So the join from results to a build has to come from outside the package: the delivery platform's own version of the course (§7).

---

## 3. What is recorded where

```
Module ── ModuleActivityLink ── LearningActivity  "Bias in AI tools (Storyline)"
                                  externalRefs: Other  storyline:project/<projectId>
                                  attachments:  source  <hash of the .story file>
                                                rendered <hash of build 7's package>
                                                map      <hash of build 7's interaction map>
Assessment "Module 3 capstone" ── ItemInstance ── AssessmentItem "Identifying training data bias"
                                                    externalRefs: Other  storyline:<projectId>/slide/<slideId>
                                                                  xAPI   <interaction activity IRI>
```

- **The Storyline project** is recorded on the record it delivers: a `LearningActivity` for content and knowledge checks, an `Assessment` for a scored quiz, or both when the project contains both (§14 question 6). Its identity is an `ExternalRef` with `system: Other` and the project id; the course Identifier is kept as its label.
- **Each build** is three `Attachment`s on that record (ADR-0030), each with `contentHash`, `hashAlgorithm: sha-256` and a `role`:
  - `source`: the `.story` file the build was published from, by hash; the bytes stay wherever the designer keeps them (`store: Other`, or `Git` with a `revision` when the project is in a repository, rule 18).
  - `rendered`: the published package.
  - `map`: a small JSON file the bridge writes beside the package (§4), the per-build table from positional interaction id to slide id, item and option positions.

  Each publish replaces the three in one commit whose message names the build. The record's history is then the list of builds, each with its commit (ADR-0025's amendment for externally versioned artifacts: a projection of the asset's history, not a replay).
- **Each item** carries the identity that survives rebuilds: an `ExternalRef` with the stable slide id, and, for xAPI and cmi5 builds, the interaction's activity IRI with `system: xAPI`.
- **The build's design commit** is the commit that recorded the build. A result from that build is read against it (§7).

Nothing here needs a new field, type or rule. The enum's `Other` value with a `storyline:` prefix names a system the enum does not list (ADR-0030); adding `Storyline` to the enum waits until a second tool needs it.

**The delivery stamp.** This is the first concrete instance of the convention the demo coverage notes propose as an ADR: what identifies a delivered build, how it maps to records, and where results find it. Here the stamp lives in the graph (attachments plus the map) because Storyline's output cannot carry it. The ADR should be written when a second bridge (DataShop, the experiment bridge, or the course builder) needs the same shape, from these two instances (§14 question 12).

---

## 4. Publishing a build: `armature-storyline publish`

The designer publishes in Storyline as usual, then runs the bridge on the zip:

```
armature-storyline publish course.zip --record Assessment/module-3-capstone \
  --story "Bias module.story" --branch main
```

1. **Read the package.** Detect the format from its manifest (`imsmanifest.xml`, `tincan.xml`, cmi5's course structure). Read the project id, course id and Identifier; the slide map and each question slide (id, title, `lmsId`, question type, text, choices, correct answers, points) from the data files; and, for xAPI and cmi5, the activity list in `tincan.xml`.
2. **Build the interaction map.** For each question slide: the positional interaction id the build will report, the stable slide id, the question type, and each choice's position and text. The map is the build's own description of itself and depends on nothing in Armature.
3. **Match interactions to items** (§5). Already-mapped slides match by their `ExternalRef`. New ones match by the export that produced them, or are proposed for the designer to confirm.
4. **Check the build against the design** at the head being written: a question with no item, an item placed in the assessment with no question, a question whose correct answer, choice count or points differ from the item's. Each becomes a `DesignFinding` on the record or the item, `Open`, with the difference in its text.
5. **Write one commit**, `If-Match` on the head read in step 3: the three attachments on the delivering record, new `ExternalRef`s on matched items, the findings. The message names the project, the build and the counts ("Storyline build 7 of Bias module: n questions mapped, m findings").
6. **Write the map file** beside the package, named by the package hash, for the designer to keep with it.

Nothing is written inside the zip. The designer uploads the same package they would have uploaded anyway.

---

## 5. Matching interactions to items

Three cases, in the order the bridge tries them:

1. **Known slides.** A slide id already recorded on an item matches that item. A rebuild after reordering slides matches completely, because slide ids do not change with position.
2. **Questions that came from Armature.** When the questions were imported from a file the bridge exported (§6), the export recorded the commit, the items and their order. At the first publish the bridge matches question text exactly against the items at that commit, which is reliable because the text came from Armature. Text edited in Storyline afterwards falls to case 3.
3. **Everything else.** Hand-authored questions, or exported ones edited since, are matched by the closest stem among the items placed in the record's assessment, shown to the designer with the similarity, and written only when confirmed. A question no item matches can become a new `Draft` item on a branch (the inventory), or stay unmatched with a finding.

Confirmation is interactive in a terminal, or non-interactive with a mapping file the designer edits and passes back (`--map-file`), so the step can run in a script.

**Option positions.** Storyline can shuffle choices at runtime, but the map records each choice's authored position and text, and the item at the build's commit has a fixed option order. So a reported response names exactly one option fragment within the build, as in the Tessera mapping §3.2. Choice ids in xAPI builds (`choice_<id>`) are recorded in the map as well.

---

## 6. Questions out: `armature-storyline export-questions`

```
armature-storyline export-questions --assessment Assessment/module-3-capstone --ref <commit> --out questions.xls
```

Writes the assessment's items, in placement order, into the Excel template this project holds, and a sidecar file recording the commit, the items and their order for §5's case 2.

| Armature `ItemType` | Storyline code | Exported |
|---|---|---|
| `MultipleChoice` | `MC` | Yes |
| `MultipleSelect` | `MR` | Yes |
| `TrueFalse` | `TF` | Yes |
| `ShortAnswer` | `SA` | Yes, ungraded, no choices |
| `Essay` | `ESS` | Yes, ungraded, no choices |
| `FillInTheBlank` | `FIB` | No: accepted answers have no field until ADR-0034 |
| `Matching` | `MD` or `MDN` | No: pairs have no field until ADR-0034 |
| `Ordering` | `SD` or `SDN` | No: the order has no field until ADR-0034 |

Columns: the code; `Points` from `ItemInstance.pointValue`; `Question Text` from the stem; up to ten choices, each `*` when `isCorrect`, then ` | ` and the option's `feedback` when it has one. What import loses is listed in the export's own report: `fragmentId`, `assesses`, `purpose`, the general correct and incorrect feedback, attachments (images), and anything beyond ten choices. The next publish maps everything back except the losses.

This is one way. Storyline is never read back as a source of item content; a question edited in Storyline shows up as a difference finding at the next publish (§4 step 4), and the designer decides which side is right.

---

## 7. Results back: `armature-storyline results`

The join from a learner's result to a build cannot come from inside the package (§2, fact 3), so it comes from the platform that delivered it, which knows which version of the course each attempt used.

**Sources, in order of support:**

1. **SCORM Cloud** (Rustici). A course is uploaded as versions, and a registration's progress can include its interactions and objectives ([postback guide](https://cloud.scorm.com/docs/v2/guides/postback/)). The bridge records the SCORM Cloud course and version as `ExternalRef`s on the build's record when the designer uploads, so each registration names its build. The endpoint names and interaction fields are to be confirmed against the API's own reference in M3.
2. **Moodle's SCORM interactions report**, downloadable as a spreadsheet ([Moodle docs](https://docs.moodle.org/404/en/mod/scorm/report)). The designer tells the bridge which build the course activity held.
3. **An LRS** for xAPI and cmi5 builds, queried by activity with `related_activities` ([xAPI communication](https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Communication.md)); SQL LRS for the demo ([SQL LRS](https://github.com/yetanalytics/lrsql)). The build is identified by a launch parameter the LMS adds, or by the period the build was live.

Canvas passes only a score from a SCORM package to its gradebook ([community report](https://community.articulate.com/discussions/discuss/canvas-no-longer-supports-scorm-output-what-is-a-storyline-output-that-will-work/926809/replies/1206441)), so question-level results from Canvas need an LRS.

**What is written**, in one commit:

- A `LearningDataset`: `producedBy` the assessment, `asOf` the build's design commit, `cohort` and `administrationDate` from the designer, and an `ExternalRef` naming the source (the SCORM Cloud course version, the Moodle activity, the LRS query), which satisfies rule 20.
- One `LearningMetric` per item per measure, `subject` the item, `derivedFrom` the dataset: proportion correct (`unit: proportion correct`), attempts (`unit: responses`), and mean latency where reported. The hub copies the dataset's `asOf` (ADR-0057 decision 5).
- Nothing per learner. Responses are read, counted and discarded; the bridge keeps no copy.

**Per-option counts** (how often each distractor was chosen) are computed from the responses and the map, but have nowhere to go yet: a `LearningMetric` names a `subject` record and no fragment. Writing them needs a `fragmentId` on metrics, a hub change that waits for the two-client rule (the DataShop bridge and Quiver's item analysis are the likely second client). Until then the bridge prints them and writes nothing.

---

## 8. Is a build out of date? `armature-storyline status`

```
armature-storyline status --record Assessment/module-3-capstone
```

Reads the build's design commit from the record's history (the commit that recorded the latest `rendered` attachment), then the changes on the branch since it (`changes?since=`), and the impact of each changed record. When something the build delivers has changed since (an objective it assesses, an item it contains, a placement's points), it reports the build as predating those changes, and with `--record-findings` writes one finding per change on the delivering record. This is the impact demo: an objective's verb changes in Armature, and the Storyline course that teaches it is flagged without anyone opening Storyline.

---

## 9. Identity and where it runs

- **The designer runs it, as themselves.** Unlike the MCP server, the bridge is not an agent acting on its own: a person publishes a build and records it. It writes with `Armature-User` set to the designer's `externalId`, so commits and findings are theirs.
- **Storyline 360 runs only on Windows**, so the bridge must too. It is a Node CLI with no native dependencies, packaged for Windows and macOS; the Excel template is written with a pure JavaScript library.
- **Reaching the hub.** *Since 2026-10-30:* under the hub's `header` resolver the hub listens on loopback (`deployment.md`), so the bridge writes beside the hub; for the demo that is a laptop running the hub's containers beside Storyline. The intended answer for a designer's Windows machine is a workspace hub there (ADR-0065, accepted 2026-10-30, not yet built), over the file-backed store (ADR-0066, Proposed: TerminusDB does not run on Windows outside WSL or a container, and a designer should not be asked to install a container runtime); the bridge is a loopback client writing as the workspace's owner, and the workspace hub pushes. Against a shared remote directly, the bridge signs in natively under the `oidc` resolver (ADR-0067 decision 2, accepted 2026-10-30, not yet built), which this bridge is a second trigger for.
- **SCORM Cloud and LRS credentials** come from the environment, never from the graph.

---

## 10. Testing

Storyline cannot run in CI (Windows, licensed), so the tests run on packages, not on Storyline.

- **Fixture builds.** One small `.story` project (two scenes, a knowledge check, a scored quiz of six questions across MC, MR, TF and a freeform question), published to SCORM 1.2, SCORM 2004 4th edition, xAPI and cmi5, then republished after reordering two slides and editing one question. The packages and their `.story` source are committed as fixtures; together they are a few megabytes.
- **Reader tests**: each fixture's inventory, interaction map and slide ids, and the reordered build mapping to the same slide ids.
- **Contract tests against a seeded hub**, as Armature's own CI runs them: publish, rebuild, a difference finding, `status` after a change on the seed.
- **Results tests** on recorded responses: a SCORM Cloud registration payload, a Moodle report file, and a set of xAPI statements, each turned into the expected dataset and metrics.
- **The Excel round trip** is checked by hand once per Storyline release: export from the seed, import into the fixture project, publish, and confirm the first-publish match is complete.

---

## 11. The demo

Six minutes, Storyline and the viewer side by side.

1. **Questions out.** Export Module 3's capstone items to the template; import them into a Storyline project (recorded ahead, since import takes time).
2. **Publish and record.** Publish to SCORM 2004 and run `publish`: every question mapped, the build's hash and commit on the assessment. In the viewer, the assessment's attachments and each item's Storyline identity.
3. **A difference.** Edit one question's correct answer in Storyline, republish, run `publish`: a finding on that item says the build disagrees with the design.
4. **Results.** Pull a cohort's registrations from SCORM Cloud with `results`. Open the metric's Focus page and run the Walkthrough: Narrative 1, for a course built in a closed tool.
5. **Out of date.** Change the assessed objective's Bloom's level in Armature and run `status`: the Storyline build is flagged as predating the change.

Beat 4 is the one that answers the adoption objection.

---

## 12. What is deliberately not built

- **Reading or writing the `.story` file.** Undocumented; recorded by hash only.
- **Modifying published output.** No injected JavaScript, no edited `scormdriver.js` to rename interaction ids, no files added to the zip. The stamp lives in the graph.
- **Importing item content from Storyline.** The design is Armature's; a difference is a finding for a person to resolve.
- **Learner-level data in the graph** or kept by the bridge (ADR-0058).
- **Per-option metrics** until metrics can name a fragment (§7).
- **A custom xAPI statement carrying the commit.** Possible through the trigger's JSON editor, but unsupported by Articulate and a manual step per project; revisit if an LRS deployment cannot identify builds any other way.
- **Question banks and random draws** in the first version. A draw changes which questions a learner sees and adds the draw number to the interaction id; the map can carry it, but the fixture project starts without one.

---

## 13. Implementation plan

Milestones in the bridge's repository, `mossglenn/armature-storyline`, each a pull request with its tests. Armature's repository changes only in documentation.

**M0 · Verify the package.** Publish the fixture project in all four formats and confirm the community-reported facts the plan rests on: the slide map and slide ids in `data.js`, the per-slide question data, that a reorder keeps slide ids, and where interaction ids can be predicted from the data files. Acceptance: a written note of what holds, with the fixtures committed. If slide ids are not readable, §5 falls back to text matching with confirmation at every rebuild, and the plan is revised before M1.

**M1 · Read and map.** The package reader for SCORM 2004 and 1.2, the interaction map, the map file. Acceptance: the fixtures' maps are correct, and the reordered build maps to the same slides.

**M2 · Publish to the graph.** `publish` with §5's matching, the difference findings, the attachments and `ExternalRef`s in one commit. Acceptance: beats 2 and 3 of the demo against a seeded hub.

**M3 · Results from SCORM Cloud.** `results` with SCORM Cloud first, then Moodle's report. Acceptance: beat 4; the dataset's `asOf` is the build's commit and the Walkthrough runs from its metric.

**M4 · Questions out and status.** `export-questions` and `status`. Acceptance: beats 1 and 5.

**M5 · xAPI and cmi5.** The `tincan.xml` reader, xAPI activity IRIs as identities, results from an LRS. Acceptance: the xAPI fixture's statements become the same dataset as its SCORM twin.

Sequencing: M0 is a short spike and decides whether M1 is straightforward; M1 and M2 are one or two sessions each; M3 one; M4 one; M5 one or two.

---

## 14. Questions to settle

Each with the options and the recommendation the plan above is written to.

1. **Where the bridge lives.**
   - (a) Its own repository, `mossglenn/armature-storyline`, installing `@armature/client` by git reference.
   - (b) A package in Armature's workspace.

   *Recommendation: (a).* It is a client, like CoQui, Quiver and the MCP server.

2. **Form.**
   - (a) A CLI.
   - (b) A small local web page.
   - (c) A desktop app.

   *Recommendation: (a) first.* Publishing is a step in a designer's routine, and a command runs on Windows, in a script and in CI. A page for reviewing matches can follow if confirmation in a terminal proves awkward for designers.

3. **First publish format.**
   - (a) SCORM 2004 4th edition through SCORM Cloud.
   - (b) xAPI to an LRS.
   - (c) cmi5.

   *Recommendation: (a).* It is what most LMS deliveries use, reports question text, and SCORM Cloud gives versioned courses, which is the build join §7 needs. xAPI and cmi5 are M5.

4. **Where the build stamp lives.**
   - (a) In the graph: attachments and the map, nothing in the package.
   - (b) A file added to the package naming the commit and the map.
   - (c) A custom xAPI statement at launch, carrying the commit as a context extension.

   *Recommendation: (a).* It modifies nothing Articulate supports, and the delivery platform's version of the course identifies the build. (b) is harmless in practice but is the kind of change Articulate says it does not support, and nothing at runtime would read it. (c) needs a manual, unsupported step per project and works only for xAPI.

5. **Identity of a question across builds.**
   - (a) The internal slide id from the published data files.
   - (b) Question text.
   - (c) The positional interaction id.

   *Recommendation: (a), verified in M0, with (b) as the fallback.* (c) changes whenever slides move.

6. **What a Storyline project is in the graph.**
   - (a) A `LearningActivity` for content and knowledge checks, an `Assessment` for a scored quiz, both when the project has both.
   - (b) Always an `Activity`.
   - (c) A new class.

   *Recommendation: (a).* It uses the schema as it stands: knowledge checks are formative uses of items (ADR-0061), and a scored quiz is an assessment with placements. (c) fails the two-client rule.

7. **Where the `.story` bytes live.**
   - (a) Wherever the designer keeps them, recorded by hash (`store: Other`).
   - (b) A Git repository with Large File Storage, recorded with its revision.
   - (c) A hub-managed store.

   *Recommendation: (a) for the demo, (b) as the documented practice for teams.* (c) waits for the hub-managed attachment endpoints, deferred until a client has a file to attach; this bridge could be that client, but it does not need it.

8. **Unmatched questions.**
   - (a) A finding only.
   - (b) A `Draft` item proposed on a branch, from the question's text and choices.

   *Recommendation: (b), behind a flag.* It turns a hand-built course into a starting inventory, which is how a team with existing Storyline courses would begin. The default is (a).

9. **Results source after SCORM Cloud.**
   - (a) Moodle's interactions report.
   - (b) An LRS.
   - (c) A Canvas route.

   *Recommendation: (a) in M3, (b) in M5.* Canvas has no question-level SCORM data, so it needs an LRS, which (b) covers.

10. **Per-option results.**
    - (a) Compute and print them now, write nothing.
    - (b) Propose `fragmentId` on `LearningMetric` now.

    *Recommendation: (a).* The hub change waits for a second client (§7).

11. **Whose identity writes.**
    - (a) The designer who runs it.
    - (b) An agent `User` for the bridge.

    *Recommendation: (a).* A person publishes and attests to the mapping. The bridge is their tool, not an agent with judgment of its own.

12. **The delivery-stamp ADR.**
    - (a) Write it now from this plan.
    - (b) Write it when a second bridge needs the same shape, from both.

    *Recommendation: (b).* It follows the two-client rule. This plan's §3 is the first instance, and the decisions recorded there are the draft.
