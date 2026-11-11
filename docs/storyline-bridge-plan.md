# The Storyline bridge: plan

*Status: draft 2026-10-27, revised 2026-11-09, for review. Three decisions taken on 2026-11-09 (Amos, on the session's recommendations) reshape it: the bridge writes a stamp into the package as an inert sidecar file (§4; §16 question 4, which reverses the first draft's recommendation); one core serves three front ends, among them a tool the desktop program launches and a service beside a remote hub (§9; §16 question 2); and this revision replaces the first draft in place, which stays in the history (`git log -- docs/storyline-bridge-plan.md`). The other questions in §16 are open, each with a recommendation the plan is written to, and §16 questions 13 to 19 are new. A plan for a client of the hub, built outside this repository. When the bridge exists, this document becomes its description and its own repository carries the code.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CLI (command-line interface), cmi5 (an xAPI profile for launching courses from an LMS), IRI (Internationalized Resource Identifier), JSON (JavaScript Object Notation), LMS (learning management system), LRS (learning record store), OIDC (OpenID Connect), SCORM (Sharable Content Object Reference Model), XLIFF (XML Localization Interchange File Format), xAPI (Experience API).

---

## 0. What changed in this revision (2026-11-09)

- **The package carries a stamp.** The first draft kept everything in the graph because Articulate does not support changes to published output. Amos chose a middle course: one file, `armature.json`, added at the package's root, naming the build, the design commit and the map from interactions to items. It changes nothing a learner's browser runs, and it names the files it describes, so a stamp that no longer matches its package is detected rather than trusted (§4).
- **Two homes for one tool.** The bridge is a core library with three front ends: a CLI; a local page the desktop program launches, writing into a workspace on the designer's machine; and a service deployed beside a remote hub, where a person signs in, uploads an export and downloads it stamped. Both pages take a zip or a folder Storyline published (§9).
- **The hosting problem the first draft hedged is answered.** Since 2026-10-27: the workspace hub's cycle (2026-11-01), its file-backed store rehearsed on a Windows PC (2026-11-03), the `oidc` resolver and relays (2026-11-05), and the desktop program through its release, sign-in included (2026-11-06 to 09). A designer's Windows PC needs the program and the bridge, and no container.
- **One case added to M0** from Amos's own Storyline work: slides imported, copied or moved between scenes, which a routine fix does and which may give slides new ids (§2, §14).
- **No change to the hub, the API or the schema is required**, as before. What this plan asks of Armature's repository is the desktop program's list of launched tools and the documents that describe the bridge; one read on a workspace hub may become an ask if M2 shows it is needed (§13).

---

## 1. Purpose

Most instructional designers build in Articulate Storyline 360, a closed authoring tool whose source file Armature cannot read. The bridge makes a Storyline course a full participant in the graph anyway, by recording four things at the boundary:

- **Which build this is.** Each published package is identified by a hash of its files and tied to the design commit it was checked against.
- **Which parts are which.** Each interaction in the build is mapped to the `AssessmentItem` it delivers.
- **What the package knows about itself.** The stamp travels with the package to wherever it is uploaded, so anyone holding it later (an LMS administrator, a reviewer, the bridge itself) can ask which design it delivers and whether that design has moved.
- **What learners did.** Results come back as metrics about those items, at that commit, so Narrative 1 runs for a Storyline course.

It is the answer to the adoption objection every audience raises ("our designers use Storyline"), and in `docs/demo-coverage.md` it closes three of the capabilities no built or planned demo shows: **impact**, **external references** and **attachments**. It also shows outcome records at `asOf`, trace and item statistics.

Constraints from the rest of the project, which hold throughout:

- **The bridge is a client.** It reaches the hub through `@armature/client` and needs no change to the API or the schema. No part of it runs inside the hub, and no Storyline format code enters Armature's repository (CLAUDE.md, Development Principles 1 and 5).
- **The `.story` file is never opened.** Its format is undocumented and changes between versions (`docs/research/learning-data-standards-precedents.md`). The bridge reads only what Storyline publishes and exports, and records the `.story` file by hash.
- **The stamp is inert.** One file added beside the player; nothing the player, the manifest or the LMS reads is changed (§4, §15).
- **The input is not modified.** The bridge writes a new, stamped package; the export Storyline wrote stays as it was, unless the designer asks for a web folder to be stamped in place (§16 question 15).
- **Learner data stays out of the graph and out of the bridge.** Only aggregates cross: proportions correct, counts, a cohort's label (ADR-0058).
- **Storyline is a target, never a system of record** (the precedents survey). The design lives in Armature; a build is evidence of what was delivered.

---

## 2. What Storyline gives a tool

Researched 2026-10-27. **[A]** marks what Articulate documents; **[C]** what community reports or published packages show; **[?]** what nobody has checked yet. The bridge verifies [C] and [?] against packages of its own (M0).

| What | Where | Source |
|---|---|---|
| Publish formats: SCORM 1.2, SCORM 2004 (2nd to 4th edition), xAPI 1.0.2, cmi5, AICC; and a plain web folder with no LMS | Publish dialog | [A] [publishing for LMS](https://www.articulatesupport.com/article/Storyline-360-Publishing-a-Course-for-LMS-LRS-Distribution), [xAPI](https://www.articulatesupport.com/article/Publishing-Articulate-Storyline-360-Courses-for-Tin-Can-API) |
| A course **Identifier** assigned by Storyline, editable, not to be changed on republish; an xAPI **Activity ID** IRI | `imsmanifest.xml`; `tincan.xml` | [A] same articles |
| A project id and course id | `meta.xml` (`<project id=… courseid=…>`), `html5/data/js/data.js` | [C] inspected output |
| Stable internal slide ids (11 characters) with a slide map, each slide file carrying its id, title and `lmsId` | `html5/data/js/data.js`, `html5/data/js/<slideId>.js` | [C] inspected output |
| Whether a slide **imported, copied or moved between scenes** keeps its id | — | [?] M0 |
| Every xAPI activity with its interaction type, choices and correct-response patterns | `tincan.xml` | [A] [Tin Can implementation](https://www.articulatesupport.com/article/Implementing-Tin-Can-API-to-Support-Articulate-Content) (an older article) |
| SCORM 2004 interactions report id, type, timestamp, learner response, correct response, result, weighting (the point value, since December 2022), latency and description (the question text); SCORM 1.2 omits timestamp and description | At runtime, to the LMS | [A] [quiz data sent to an LMS](https://www.articulatesupport.com/article/quiz-data-sent-to-an-lms-in-articulate-storyline) |
| **Interaction ids are positional**: scene, question draw and slide numbers (`Scene3_Slide3_MultiResponse_0_0`), not settable in Storyline; reordering changes them, renaming does not | At runtime | [A] same article and [staff answer](https://community.articulate.com/discussions/discuss/rename-slides-in-report/800246); [C] the examples |
| xAPI statements: verbs attempted, experienced, answered, completed, passed, failed, left; the course as grouping context | At runtime, to the LRS | [A] Tin Can implementation |
| A "Send xAPI statement" trigger (since build 3.58), with a raw-JSON editor that allows context extensions, not officially supported | Triggers | [A] [custom statements](https://www.articulatesupport.com/article/Storyline-360-Custom-xAPI-Statements); [C] [extensions](https://blog.xapi.ly/posts/storyline-xapi-updates-2021/) |
| Variables are not reported except through custom xAPI statements; adding a JavaScript file to published output is a method Articulate does not support | — | [A] [variables](https://www.articulatesupport.com/article/Storyline-360-How-to-Send-the-Value-of-a-Variable-to-an-LMS), [JavaScript](https://www.articulatesupport.com/article/Articulate-Storyline-360-JavaScript-Best-Practices-and-Examples) |
| Whether an LMS accepts a package with a file its manifest does not list (SCORM Cloud, Moodle, Canvas) | Upload | [?] M0 |
| What a republish into the same folder does to a file Storyline did not write | Publish | [?] M0 |
| Translation export as XLIFF 1.2 or 2.0 or Word, with internal object ids on each unit | Export | [A] [translating](https://www.articulatesupport.com/article/Storyline-360-Translating-Courses); [C] [ids](https://community.articulate.com/discussions/discuss/machine-translation-via-xliff/798701) |
| Question import from Excel or text: 19 type codes, `*` for correct, `\|` for choice feedback and matching pairs, up to 10 choices, points −1000 to 1000, formatting stripped, first sheet only, lands in the quiz after the selected slide, never in a question bank, no id column | Import | [A] [importing questions](https://www.articulatesupport.com/article/Storyline-360-Importing-Questions-from-Excel-Spreadsheets-and-Text-Files); the template in this project |

Three facts shape everything below:

1. **Interaction ids are exact within a build and unstable across builds.** They are positions. This is the same situation the Tessera mapping found for option positions (`docs/research/tessera-mapping.md` §3.2), with the same answer: identify the build, and a position names exactly one thing in it.
2. **Stable identity exists one level down.** The internal slide ids in the published data files survive reordering, so the bridge can map a positional interaction id to a slide id at publish time and record the slide id as the item's identity in Storyline. This is a community observation; M0 verifies it, and also checks the case reordering does not cover, a slide brought in from another scene or project.
3. **A file can travel inside the package; nothing at runtime reads it.** Variables are not reported and the player is not to be changed, so the stamp (§4) tells whoever holds the package what it is, but a learner's result still reaches a build through the delivery platform, which knows which version of the course each attempt used (§7).

---

## 3. What is recorded where

```
Module ── ModuleActivityLink ── LearningActivity  "Bias in AI tools (Storyline)"
                                  externalRefs: Other  storyline:project/<projectId>
                                  attachments:  source   <hash of the .story file>
                                                rendered <tree hash of build 7 as Storyline wrote it>
                                                stamp    <hash of build 7's armature.json>
Assessment "Module 3 capstone" ── ItemInstance ── AssessmentItem "Identifying training data bias"
                                                    externalRefs: Other  storyline:<projectId>/slide/<slideId>
                                                                  xAPI   <interaction activity IRI>

course.zip  (what Storyline published, unchanged)
course.armature.zip  =  course.zip's files  +  armature.json at the package root
```

- **The Storyline project** is recorded on the record it delivers: a `LearningActivity` for content and knowledge checks, an `Assessment` for a scored quiz, or both when the project contains both (§16 question 6). Its identity is an `ExternalRef` with `system: Other` and the project id; the course Identifier is kept as its label.
- **Each build** is up to three `Attachment`s on that record (ADR-0030), each with `contentHash`, `hashAlgorithm: sha-256` and a `role` (free text, ADR-0010):
  - `source`: the `.story` file the build was published from, by hash; the bytes stay wherever the designer keeps them (`store: Other`, or `Git` with a `revision` when the project is in a repository, rule 18). Optional on the service, which never receives the `.story` file unless the page hashes it in the browser (§16 question 7).
  - `rendered`: the files Storyline published, as a tree (§4, "The tree hash"). The same value for the zip and for the folder it came from, and unchanged by the stamp, since the stamp is left out of the tree.
  - `stamp`: the `armature.json` the bridge wrote. With `rendered` it fixes the stamped package exactly, so the stamped zip's own bytes need no hash.

  Each publish replaces them in one commit whose message names the build. The record's history is then the list of builds, each with its commit (ADR-0025's amendment for externally versioned artifacts: a projection of the asset's history, not a replay). The first draft's separate map file is folded into the stamp.
- **Each item** carries the identity that survives rebuilds: an `ExternalRef` with the stable slide id, and, for xAPI and cmi5 builds, the interaction's activity IRI with `system: xAPI`.
- **The build's design commit** is the head the bridge read and checked the build against (§5, step 3), the state of the design the build was published to deliver. The stamp names it, and a result from that build is read against it (§7). The commit that records the build follows it directly (it is written with `If-Match` on the design commit) and adds only the build's own record and findings, so the history alone leads from a build to its design commit.

Nothing here needs a new field, type or rule. The enum's `Other` value with a `storyline:` prefix names a system the enum does not list (ADR-0030); adding `Storyline` to the enum waits until a second tool needs it.

**The delivery stamp.** This is the first concrete instance of the convention the demo coverage notes propose as an ADR: what identifies a delivered build, how it maps to records, and where results find it. The first draft kept the stamp in the graph alone; this revision keeps it in both places, the graph as the record and the package as a copy that travels. The stamp's format (§4) is the draft of that ADR's shape. The ADR is still written when a second bridge (DataShop, the experiment bridge, or the course builder) needs the same shape, from both instances (§16 question 12).

---

## 4. The stamp: `armature.json`

One JSON file at the package's root, beside `imsmanifest.xml`, `tincan.xml`, `cmi5.xml` or `story.html`, whichever the format has.

```json
{
  "stamp": "armature-storyline/1",
  "hub": { "instance": "Armature at Example University", "api": "https://api.example.edu" },
  "workspace": null,
  "branch": "main",
  "designCommit": "k3j9x2…",
  "record": { "type": "Assessment", "id": "Assessment/module-3-capstone" },
  "build": {
    "format": "scorm2004-4",
    "rendered": { "tree": "armature-tree/1", "hashAlgorithm": "sha-256", "contentHash": "9f2c…" },
    "storyline": { "projectId": "…", "courseId": "…", "identifier": "…" }
  },
  "interactions": [
    {
      "interactionId": "Scene3_Slide3_MultiResponse_0_0",
      "slideId": "6Xq2vB9dLkA",
      "item": "AssessmentItem/identifying-training-data-bias",
      "options": [ { "position": 1, "choiceId": null, "fragmentId": "opt-a" } ]
    }
  ],
  "unmatched": [ { "interactionId": "Scene3_Slide5_TrueFalse_0_0", "slideId": "…" } ],
  "tool": { "name": "armature-storyline", "version": "0.1.0" }
}
```

**What it may hold.** The stamp is served to every learner who opens the course: any file in the package can be fetched from its address. So it holds identifiers, hashes and a commit, and nothing more: no person's name or identifier, no rationale or finding text, no correct answers, no credential. The hub's instance name and address come from the instance's own public profile in `GET /discover` (`instance`, which a client reads before signing in) and are left out when the instance publishes none (§16 question 16). The stamp is not a secret and is not signed: it is a pointer, and the graph is the authority it points to.

**The tree hash** (`armature-tree/1`). Every regular file under the package root except `armature.json` itself, and except operating-system debris (`__MACOSX/`, `.DS_Store`, `Thumbs.db`, `desktop.ini`), sorted by path in UTF-8 byte order with `/` as the separator; one line per file, the lower-case hexadecimal SHA-256 of its bytes, two spaces and the path; the SHA-256 of those lines. The package root is the directory holding the format's manifest, so a zip with or without a top-level folder, and the folder it was zipped from, hash alike. ADR-0030 already allows a tree's root hash as an attachment's `contentHash`.

**Self-checking.** Because the stamp names the tree it describes, any reader can recompute the tree hash and compare. A stamp left behind in a folder Storyline republished into, or copied onto another package, does not match, and the bridge reports it as stale instead of trusting it.

**What is not changed.** The manifest (`imsmanifest.xml`, `tincan.xml`, `cmi5.xml`), the player, `scormdriver.js` and every file Storyline wrote stay byte for byte. Whether the manifest should list the new file is §16 question 14, recommended not, pending M0's upload checks.

**Where the stamped package goes.** A new zip, never a change to the input: beside the input as `<name>.armature.zip` from the CLI, and as a download from either page. A folder input becomes a stamped zip, since a zip is what an LMS takes; a web-folder publication, hosted as files with no LMS, can have `armature.json` written into the folder on request (§16 question 15).

**Identifying a package.** The reverse of stamping, and the stamp's payoff: given any zip or folder, read `armature.json`, recompute the tree hash, then ask the hub for the record, the build and the changes since `designCommit` (§8). The answer is one of: not stamped; stamped, current; stamped, the design has moved since (with what moved); stale stamp; or stamped by a hub this bridge cannot reach.

---

## 5. Recording a build: `publish`

The designer publishes in Storyline as usual, then gives the bridge the zip or the folder: on the command line, or by dropping it on the page (§9).

```
armature-storyline publish course.zip --record Assessment/module-3-capstone \
  --story "Bias module.story" --branch main
```

1. **Read the package.** Find the package root and detect the format from its manifest (`imsmanifest.xml`, `tincan.xml`, cmi5's course structure, or `story.html` alone for a web folder). Read the project id, course id and Identifier; the slide map and each question slide (id, title, `lmsId`, question type, text, choices, correct answers, points) from the data files; and, for xAPI and cmi5, the activity list in `tincan.xml`. Compute the tree hash. An `armature.json` already in the input is read, checked against the tree, and reported, never kept: the bridge stamps afresh.
2. **Build the interaction map.** For each question slide: the positional interaction id the build will report, the stable slide id, the question type, and each choice's position and text. The map is the build's own description of itself and depends on nothing in Armature.
3. **Match interactions to items** (§6) at the branch's head, read once; that head is the design commit. Already-mapped slides match by their `ExternalRef`. New ones match by the export that produced them, or are proposed for the designer to confirm.
4. **Check the build against the design** at the design commit: a question with no item, an item placed in the assessment with no question, a question whose correct answer, choice count or points differ from the item's. Each becomes a `DesignFinding` on the record or the item, `Open`, with the difference in its text.
5. **Write the stamp** (§4) from the map, the matches and the design commit, and hash it.
6. **Write one commit**, `If-Match` on the design commit: the attachments on the delivering record, new `ExternalRef`s on matched items, the findings. The message names the project, the build and the counts ("Storyline build 7 of Bias module: n questions mapped, m findings"). A 412 means the design moved while the designer was confirming; the bridge says what moved and starts again from step 3.
7. **Write the stamped package** (§4).

Steps 1 to 5 write nothing and can run as a dry run (`--dry-run`, and the page's first screen), which is also how a designer checks a build before deciding to record it.

---

## 6. Matching interactions to items

Three cases, in the order the bridge tries them:

1. **Known slides.** A slide id already recorded on an item matches that item. A rebuild after reordering slides matches completely, because slide ids do not change with position. A slide whose id changed when it was brought in from another scene (if M0 finds that it does) falls to case 3, and the item's old slide id is replaced once the designer confirms.
2. **Questions that came from Armature.** When the questions were imported from a file the bridge exported (§10), the export recorded the commit, the items and their order. At the first publish the bridge matches question text exactly against the items at that commit, which is reliable because the text came from Armature. Text edited in Storyline afterwards falls to case 3.
3. **Everything else.** Hand-authored questions, or exported ones edited since, are matched by the closest stem among the items placed in the record's assessment, shown to the designer with the similarity, and written only when confirmed. A question no item matches can become a new `Draft` item on a branch (the inventory), or stay unmatched with a finding.

Confirmation is a screen on the page, interactive in a terminal, or non-interactive with a mapping file the designer edits and passes back (`--map-file`), so the step can run in a script.

**Option positions.** Storyline can shuffle choices at runtime, but the map records each choice's authored position and text, and the item at the design commit has a fixed option order. So a reported response names exactly one option fragment within the build, as in the Tessera mapping §3.2. Choice ids in xAPI builds (`choice_<id>`) are recorded in the map as well.

---

## 7. Results back: `results`

The runtime reports positional interaction ids and nothing from the stamp (§2, fact 3), so a result reaches its build through the platform that delivered it, which knows which version of the course each attempt used. The stamp shortens the step from that version to the build: where the platform returns the package it holds, the bridge identifies it from its stamp instead of asking the designer which build it was.

**Sources, in order of support:**

1. **SCORM Cloud** (Rustici). A course is uploaded as versions, and a registration's progress can include its interactions and objectives ([postback guide](https://cloud.scorm.com/docs/v2/guides/postback/)). The bridge records the SCORM Cloud course and version as `ExternalRef`s on the build's record when the designer uploads, so each registration names its build. The endpoint names and interaction fields, and whether a version's package can be fetched back, are to be confirmed against the API's own reference in M4.
2. **Moodle's SCORM interactions report**, downloadable as a spreadsheet ([Moodle docs](https://docs.moodle.org/404/en/mod/scorm/report)). The designer gives the bridge the report and either names the build or drops the package the activity holds, when the teacher can download it from the activity (to confirm in M4), and the stamp names the build.
3. **An LRS** for xAPI and cmi5 builds, queried by activity with `related_activities` ([xAPI communication](https://github.com/adlnet/xAPI-Spec/blob/master/xAPI-Communication.md)); SQL LRS for the demo ([SQL LRS](https://github.com/yetanalytics/lrsql)). The build is identified by a launch parameter the LMS adds, or by the period the build was live.

Canvas passes only a score from a SCORM package to its gradebook ([community report](https://community.articulate.com/discussions/discuss/canvas-no-longer-supports-scorm-output-what-is-a-storyline-output-that-will-work/926809/replies/1206441)), so question-level results from Canvas need an LRS.

**What is written**, in one commit:

- A `LearningDataset`: `producedBy` the assessment, `asOf` the build's design commit, `cohort` and `administrationDate` from the designer, and an `ExternalRef` naming the source (the SCORM Cloud course version, the Moodle activity, the LRS query), which satisfies rule 20.
- One `LearningMetric` per item per measure, `subject` the item, `derivedFrom` the dataset: proportion correct (`unit: proportion correct`), attempts (`unit: responses`), and mean latency where reported. The hub copies the dataset's `asOf` (ADR-0057 decision 5).
- Nothing per learner. Responses are read, counted and discarded; neither front end keeps a copy, and the service never writes them to disk.

**Per-option counts** (how often each distractor was chosen) are computed from the responses and the map, but have nowhere to go yet: a `LearningMetric` names a `subject` record and no fragment. Writing them needs a `fragmentId` on metrics, a hub change that waits for the two-client rule (the DataShop bridge and Quiver's item analysis are the likely second client). Until then the bridge shows them and writes nothing.

---

## 8. Is a build out of date? `status` and `identify`

```
armature-storyline status --record Assessment/module-3-capstone
armature-storyline identify course.armature.zip
```

`status` starts from a record: it reads the latest build's design commit from the record's history, as the commit just before the one that recorded the latest `rendered` attachment, since that write was made with `If-Match` on the design commit (§5, step 6). The graph holds the stamp's hash, not its content. `identify` starts from a package: it reads the design commit from the stamp, after checking the stamp against the tree (§4). Both then read the changes on the branch since that commit (`changes?since=`) and the impact of each changed record. When something the build delivers has changed since (an objective it assesses, an item it contains, a placement's points), they report the build as predating those changes, and with `--record-findings` write one finding per change on the delivering record. This is the impact demo: an objective's verb changes in Armature, and the Storyline course that teaches it is flagged without anyone opening Storyline, from the record or from the package itself.

---

## 9. One core, three front ends

```
                 ┌───────────────────────── @armature-storyline/core ─────────────────────────┐
                 │ package reader · interaction map · tree hash · matching · checks ·        │
                 │ stamp writer · identify · results readers · question export ·             │
                 │ graph writes through @armature/client                                      │
                 └───────────────┬────────────────────────┬────────────────────────┬──────────┘
                                 │                        │                        │
   CLI (scripts, CI, developers) │      local page        │       service          │
                                 ▼                        ▼                        ▼
   any hub it is pointed at       a workspace hub on the designer's    a remote hub, from beside it
                                  machine, launched by the desktop     on the instance's network,
                                  program                               reached at storyline.<site>
```

The core is TypeScript on Node 20 or later, with no native dependencies and no interface: it takes streams and paths and returns plain data, so each front end is thin. The two pages are one web interface (React and Tailwind, as Quiver, CoQui and the desktop program use, so components travel) served by the bridge's own small server in two modes. The page's screens: drop a zip or folder; the build's inventory and the dry run's matches and differences; confirm or correct matches; record and stamp; download. And a second door, "What is this package?", which runs `identify`.

### 9.1 On the designer's machine: a tool the desktop program launches

Storyline runs on Windows, so this is the front end a designer uses most.

- **Launch.** The desktop program starts the bridge from its list of tools with `ARMATURE_HUB_URL`, `ARMATURE_USER` and `ARMATURE_LOCAL_TOKEN` in its environment, as the program's plan already describes for a launched tool (`docs/desktop-program-plan.md` §7). The bridge listens on `127.0.0.1` on a port of its choosing and writes one JSON line to standard output, `{"ready":{"url":"http://127.0.0.1:<port>/#k=<session key>"}}`; the program shows an Open button for it and stops the bridge when it quits. The bridge is the first tool to ask to be launched rather than paired, which is the trigger the program's plan set for building its tool list (§13 there; its §15 question 11). What the program needs is in §13 below.
- **Where writes land.** In a workspace on the workspace hub, which the page lists from `GET /workspace` for the designer to choose. Every write carries `Armature-Local-Token`. The build reaches the remote when the designer pushes in the program, which alone can push, bring in and deliver (ADR-0065 decision 7, note of 2026-10-30). The bridge never holds the remote's credential.
- **Which commit the stamp names.** On a workspace hub the design commit may be a local commit. Push rewrites every `asOf` in the graph to the remote commit it became (`docs/workspace-hub-plan.md` §5), but it cannot reach a file already in a package, so the stamp keeps the local id and says so (`"workspace": "<name>"`). The remote commit carries the local id in its `Armature-Workspace-Commit` trailer, so `identify` and `results` resolve it there. The page recommends pushing before uploading the package to an LMS, and does not require it (§16 question 13).
- **Its own boundary.** A page on loopback can be reached by any other page in the designer's browser, so the bridge's server does what the hub's does (ADR-0067 decision 7): it answers only loopback host names, refuses a request whose `Origin` is not its own, and requires the session key from the launch line (kept in the page's session storage and sent as a header). The key is drawn at each start.
- **Files.** The page uploads the package to the bridge on loopback; nothing leaves the machine except the graph writes to the workspace hub. The stamped zip comes back as a download. The CLI, given paths, writes it beside the input.
- **Packaging.** A single-file executable per platform, Windows first (§16 question 17), so a designer installs nothing else.

### 9.2 Beside a remote hub: a service

For a team whose designers upload builds to a shared instance, and for anyone without the program.

- **Deployment.** A container in the bridge's own repository, joining the instance's `armature` network and calling the hub as `http://hub:3100`, published by the instance's Caddy at `storyline.<site>` through a site file in `docker/sites/` and a compose override: the arrangement `docs/deployment.md` describes in "A client on the same server" and rehearsed for Keycloak's `login.<site>` on 2026-11-09. Armature's files never name it. The hub's name goes in `ARMATURE_ALLOWED_HOSTS` only if the service calls it by another name than `hub`.
- **Who writes.** Under `oidc`, the person signs in to the service through the instance's identity provider (the authorization code flow, the service a confidential client) and the service calls the hub with the person's own access token, so the person is the author and the hub's grants apply to them (ADR-0068 decision 4: a write to `main` needs a maintainer of `main`; any other branch, its owner or a maintainer). No `Armature-User` header is sent beside the token, which the hub would read as a relay. A `Relay` grant (ADR-0067 decision 5) is used only where no person is present: results pulled on a schedule (§16 question 18). Under `header`, the development arrangement, the service is the component that decides who the person is, as `deployment.md` says of any client beside an instance.
- **Branch.** The page lists the branches the person may write and defaults to the one the record was last published from; refusals are shown as the hub gives them.
- **Commits.** The service writes to the remote, so the design commit is always a remote commit and the stamp names no workspace.
- **Files.** Packages are streamed to temporary storage for the request and deleted when the response ends (§16 question 19), with a size limit the administrator sets; a Storyline package with video runs to hundreds of megabytes. The `.story` source is optional here: the page can hash it in the browser without uploading it.
- **Credentials** for SCORM Cloud or an LRS come from the service's environment, never from the graph or the page.

### 9.3 The CLI

`armature-storyline publish | identify | status | results | export-questions`, against whatever hub `ARMATURE_HUB_URL` names, with `ARMATURE_USER` under `header`, `ARMATURE_LOCAL_TOKEN` on a workspace hub, or a token under `oidc`. It is how the tests and the developer drive the core, and how a team scripts publishing. The local page is the CLI's `serve --local` and the service its `serve --service`.

---

## 10. Questions out: `export-questions`

```
armature-storyline export-questions --assessment Assessment/module-3-capstone --ref <commit> --out questions.xls
```

Writes the assessment's items, in placement order, into the Excel template this project holds, and a sidecar file recording the commit, the items and their order for §6's case 2. Both pages offer the same as a download.

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

This is one way. Storyline is never read back as a source of item content; a question edited in Storyline shows up as a difference finding at the next publish (§5 step 4), and the designer decides which side is right.

---

## 11. Testing

Storyline cannot run in CI (Windows, licensed), so the tests run on packages, not on Storyline.

- **Fixture builds.** One small `.story` project (two scenes, a knowledge check, a scored quiz of six questions across MC, MR, TF and a freeform question), published to SCORM 1.2, SCORM 2004 4th edition, xAPI, cmi5 and a web folder; then republished after reordering two slides and editing one question; then after importing one question slide from the other scene. The packages and their `.story` source are committed as fixtures; together they are a few megabytes.
- **Reader tests**: each fixture's inventory, interaction map and slide ids; the reordered build mapping to the same slide ids; the imported slide as M0 found it.
- **Stamp tests**: the tree hash equal for a zip with and without a top folder and for its folder; unchanged by the stamp; a stamp copied onto the reordered build reported stale; a stamp holding nothing outside §4's list (a test reads every field).
- **Contract tests against a seeded hub**, as Armature's own CI runs them: publish, rebuild, a difference finding, `status` and `identify` after a change on the seed; and against a workspace hub in the same process, the stamp's local commit resolved after a push.
- **Boundary tests** for the local server: a foreign `Host`, a foreign `Origin`, a missing or wrong session key, each refused.
- **Results tests** on recorded responses: a SCORM Cloud registration payload, a Moodle report file, and a set of xAPI statements, each turned into the expected dataset and metrics.
- **By hand, once per Storyline release:** the Excel round trip (export from the seed, import into the fixture project, publish, the first-publish match complete), and the stamped SCORM 2004 package uploaded to SCORM Cloud and Moodle and launched.

---

## 12. The demo

Seven minutes: Storyline, the desktop program and the viewer side by side, then a browser on the service.

1. **Questions out.** Export Module 3's capstone items to the template; import them into a Storyline project (recorded ahead, since import takes time).
2. **Publish and stamp.** Publish to SCORM 2004, open the bridge from the desktop program, drop the zip: every question mapped, no differences. Record and stamp; push in the program. In the viewer, the assessment's attachments and each item's Storyline identity.
3. **A difference.** Edit one question's correct answer in Storyline, republish, drop it again: a finding on that item says the build disagrees with the design.
4. **Results.** Upload the stamped package to SCORM Cloud, pull a cohort's registrations with `results`. Open the metric's Focus page and run the Walkthrough: Narrative 1, for a course built in a closed tool.
5. **What is this package?** Change the assessed objective's Bloom's level in Armature. Take the package as the LMS holds it (or the copy that was uploaded, if the LMS gives none back) and drop it on the service's "What is this package?": it names its build and design commit and says the design has moved since, with the objective that moved.

Beat 4 answers the adoption objection; beat 5 is what the stamp adds.

---

## 13. What Armature's repository is asked for

Nothing in the hub, the API or the schema is required. Three things, one of them conditional:

1. **The desktop program's tool list** (`docs/desktop-program-plan.md` §7, §13, §15 question 11), triggered by this plan as the first tool to ask to be launched. The smallest form that serves the bridge: a tool registered by a descriptor file its installer writes into a folder the program reads (name, command, arguments, `kind: "page"`), or added by hand in Settings by choosing the executable; started with the three variables; its ready line read for the page's address; an Open button; stopped when the program quits; its output in the Log page. The design is that plan's to settle; the bridge needs only the variables and the ready line.
2. **Possibly one read on a workspace hub.** `identify` resolves a stamp's local commit through the remote's `Armature-Workspace-Commit` trailer, which the history route returns. If a tool on the machine also needs the remote form of a local commit before a push has been read back (to stamp the remote form directly), that is an ask of the workspace hub, tested against the two-client rule first: the MCP server, which names commits to a person, is the likely second client. M2 finds out whether it is needed.
3. **The documents** that describe the bridge, updated when this plan is accepted: the development plan's §2 row, `docs/demo-coverage.md`'s Storyline and Drift cells and its delivery-stamp note, the README's line, and SESSION.md.

---

## 14. Implementation plan

Milestones in the bridge's repository, `mossglenn/armature-storyline`, each a pull request with its tests, except M3's second half, which is a pull request here.

**Before M0.** A Windows PC with a Storyline 360 license to publish the fixtures, and SCORM Cloud and Moodle accounts for the upload checks.

**M0 · Verify the package.** Publish the fixture project in all five forms and confirm what the plan rests on: the slide map and slide ids in `data.js`, the per-slide question data, that a reorder keeps slide ids, what happens to a slide's id when it is imported from another scene or project, where interaction ids can be predicted from the data files, whether SCORM Cloud, Moodle and Canvas accept and launch a package with an unlisted `armature.json`, and what a republish into the same folder does to it. Acceptance: a written note of what holds, with the fixtures committed. If slide ids are not readable, §6 falls back to text matching with confirmation at every rebuild; if an LMS rejects the unlisted file, §16 question 14 is reopened; either way the plan is revised before M1.

**M1 · The core: read, map, hash, stamp, identify.** The package reader for SCORM 2004, SCORM 1.2 and the web folder; the interaction map; the tree hash; the stamp writer; `identify` without a hub (the stamp against the tree); the CLI. Acceptance: the fixtures' maps are correct, the reordered build maps to the same slides, the stamp tests pass, and a stamped fixture uploads and launches on SCORM Cloud.

**M2 · Record to the graph.** `publish` with §6's matching, the difference findings, the attachments and `ExternalRef`s in one commit; `identify` and `status` against a hub; against a seeded hub and a workspace hub. Acceptance: beats 2 (by CLI) and 3 against a seeded hub; a stamp's local commit resolved after a push.

**M3 · On the designer's machine.** The page and the local server with its boundary; the Windows executable. Here, the desktop program's tool list (§13 item 1). Acceptance: beats 2 and 3 on the Windows PC, the bridge opened from the program and its writes pushed by it.

**M4 · Results.** `results` with SCORM Cloud first, then Moodle's report, on the CLI and the page. Acceptance: beat 4; the dataset's `asOf` is the build's design commit and the Walkthrough runs from its metric.

**M5 · Beside a remote hub.** The service: the container, the compose override and site file, the sign-in, temporary storage. Acceptance: beat 5 on a rehearsal instance under `oidc` (a Lima VM, then the Droplet when one stands), with the person as the author of the service's writes.

**M6 · Questions out.** `export-questions` on the CLI and both pages. Acceptance: beat 1.

**M7 · xAPI and cmi5.** The `tincan.xml` reader, xAPI activity IRIs as identities, results from an LRS. Acceptance: the xAPI fixture's statements become the same dataset as its SCORM twin.

Sequencing: M0 is a short spike and decides whether M1 is straightforward; M1 and M2 are one or two sessions each; M3 two, one of them the program's; M4 one; M5 one or two with its rehearsal; M6 one; M7 one or two. M3 before M5, because the designer's machine is where Storyline is.

---

## 15. What is deliberately not built

- **Reading or writing the `.story` file.** Undocumented; recorded by hash only.
- **Changing what runs.** No injected JavaScript, no edited `scormdriver.js` to rename interaction ids, no edits to the manifest, no change to any file Storyline wrote. One inert file is added.
- **Code in the hub, or a page in the desktop program.** The bridge is a client, and Storyline's formats stay in its repository.
- **Importing item content from Storyline.** The design is Armature's; a difference is a finding for a person to resolve.
- **Learner-level data in the graph**, kept by either front end, or written to the service's disk (ADR-0058).
- **Per-option metrics** until metrics can name a fragment (§7).
- **A custom xAPI statement carrying the commit.** Possible through the trigger's JSON editor, but unsupported by Articulate and a manual step per project; revisit if an LRS deployment cannot identify builds any other way.
- **A signed stamp.** The stamp points at the graph, which is the authority; signing waits for a reader that must trust a package without reaching the hub.
- **Question banks and random draws** in the first version. A draw changes which questions a learner sees and adds the draw number to the interaction id; the map can carry it, but the fixture project starts without one.

---

## 16. Questions to settle

Each with the options and the recommendation the plan above is written to.

1. **Where the bridge lives.**
   - (a) Its own repository, `mossglenn/armature-storyline`, installing `@armature/client` by git reference.
   - (b) A package in Armature's workspace.

   *Recommendation: (a).* It is a client, like CoQui, Quiver and the MCP server, and it carries Storyline's formats, which CLAUDE.md keeps out of Armature's repository.

2. **Form.**
   - (a) A CLI.
   - (b) A small local web page.
   - (c) A desktop app.

   *As first written:* (a) first, a page if terminal confirmation proved awkward. *Decided 2026-11-09 (Amos):* one core with a CLI, a local page the desktop program launches, and the same page as a service beside a remote hub (§9).

3. **First publish format.**
   - (a) SCORM 2004 4th edition through SCORM Cloud.
   - (b) xAPI to an LRS.
   - (c) cmi5.

   *Recommendation: (a).* It is what most LMS deliveries use, reports question text, and SCORM Cloud gives versioned courses, which is the build join §7 needs. xAPI and cmi5 are M7.

4. **Where the build stamp lives.**
   - (a) In the graph: attachments and the map, nothing in the package.
   - (b) A file added to the package naming the commit and the map.
   - (c) A custom xAPI statement at launch, carrying the commit as a context extension.

   *As first written:* (a), since Articulate does not support changes to published output and nothing at runtime would read the file. *Decided 2026-11-09 (Amos): (b), with (a) kept as the record:* an inert `armature.json` that names the tree it describes (§4). What it buys is a package that can say what it is wherever it goes; what it costs is a change Articulate does not support, bounded to one file nothing runs, checked against LMS uploads in M0. (c) stays out (§15).

5. **Identity of a question across builds.**
   - (a) The internal slide id from the published data files.
   - (b) Question text.
   - (c) The positional interaction id.

   *Recommendation: (a), verified in M0, with (b) as the fallback.* (c) changes whenever slides move. M0 also decides what a slide brought in from another scene does to (a).

6. **What a Storyline project is in the graph.**
   - (a) A `LearningActivity` for content and knowledge checks, an `Assessment` for a scored quiz, both when the project has both.
   - (b) Always an `Activity`.
   - (c) A new class.

   *Recommendation: (a).* It uses the schema as it stands: knowledge checks are formative uses of items (ADR-0061), and a scored quiz is an assessment with placements. (c) fails the two-client rule.

7. **Where the `.story` bytes live.**
   - (a) Wherever the designer keeps them, recorded by hash (`store: Other`).
   - (b) A Git repository with Large File Storage, recorded with its revision.
   - (c) A hub-managed store.

   *Recommendation: (a) for the demo, (b) as the documented practice for teams.* (c) waits for the hub-managed attachment endpoints, deferred until a client has a file to attach; this bridge could be that client, but it does not need it. On the service the `source` attachment is optional, hashed in the browser when given.

8. **Unmatched questions.**
   - (a) A finding only.
   - (b) A `Draft` item proposed on a branch, from the question's text and choices.

   *Recommendation: (b), behind a flag.* It turns a hand-built course into a starting inventory, which is how a team with existing Storyline courses would begin. The default is (a).

9. **Results source after SCORM Cloud.**
   - (a) Moodle's interactions report.
   - (b) An LRS.
   - (c) A Canvas route.

   *Recommendation: (a) in M4, (b) in M7.* Canvas has no question-level SCORM data, so it needs an LRS, which (b) covers.

10. **Per-option results.**
    - (a) Compute and show them now, write nothing.
    - (b) Propose `fragmentId` on `LearningMetric` now.

    *Recommendation: (a).* The hub change waits for a second client (§7).

11. **Whose identity writes.**
    - (a) The person using it: the workspace's owner on the designer's machine, the signed-in person on the service.
    - (b) An agent `User` for the bridge.

    *Recommendation: (a).* A person publishes and confirms the mapping. The bridge is their tool, not an agent with judgment of its own.

12. **The delivery-stamp ADR.**
    - (a) Write it now from this plan.
    - (b) Write it when a second bridge needs the same shape, from both.

    *Recommendation: (b).* It follows the two-client rule. §3 and the stamp's format in §4 are the draft; whether other bridges can carry their stamp inside what they deliver, as this one now does, is the first thing the second instance tests.

13. **Which commit the stamp names on a workspace hub** (new 2026-11-09).
    - (a) The design commit as the workspace hub reports it, local or not, marked with the workspace's name; resolved after push through the `Armature-Workspace-Commit` trailer.
    - (b) Refuse to stamp until the design commit is on the remote.
    - (c) Stamp, then re-stamp after the push with the remote form.

    *Recommendation: (a).* Designers work offline, and the resolution is mechanical. The page recommends pushing before an upload. (b) makes the program's push a step inside the bridge's flow, which the bridge cannot take; (c) produces two packages for one build.

14. **Listing the stamp in the package's manifest** (new).
    - (a) Unlisted: the manifest stays byte for byte.
    - (b) Listed in the resource's files in `imsmanifest.xml` (and the xAPI and cmi5 equivalents).

    *Recommendation: (a), pending M0.* Every file Storyline wrote stays unchanged, which keeps the tree hash meaningful and the change minimal. If an LMS rejects an unlisted file, (b) for that format.

15. **A folder input** (new).
    - (a) A stamped zip, the folder unchanged.
    - (b) Also, on request, `armature.json` written into the folder.

    *Recommendation: (a), with (b) behind `--in-place` for a web-folder publication hosted as files.* The input is otherwise never changed, and a stamp left in a folder Storyline republishes into is caught as stale (§4).

16. **What the stamp names about the hub** (new).
    - (a) The instance's name and address from its public profile, when it publishes one.
    - (b) Nothing about the hub: the reader must know which hub to ask.

    *Recommendation: (a).* `identify` needs a hub to ask, and the profile is already public. Nothing else about the hub, and nothing about any person, is in the stamp (§4).

17. **Packaging on the designer's machine** (new).
    - (a) A single-file executable per platform.
    - (b) A script run on the desktop program's own Node.
    - (c) A desktop application of its own.

    *Recommendation: (a).* A designer installs nothing else, and the bridge's release is its own. (b) ties the bridge to the program's Node version and file layout; (c) duplicates the program's shell for one window.

18. **The service's identity** (new).
    - (a) The person signs in to the service, which calls the hub with the person's token.
    - (b) The service's own credential with a `Relay` grant naming the people it serves.

    *Recommendation: (a) for everything a person does on the page, (b) only for results pulled on a schedule.* A relay is for earlier work delivered when no person is present (ADR-0067 decision 5) and needs an administrator's grant. ADR-0067 decision 2 names native clients' sign-in; a web client signing in a present person is the same flow with a confidential client, and CoQui will need it too.

19. **Packages on the service** (new).
    - (a) Held for the request, then deleted.
    - (b) Kept for a while, so the stamped package can be downloaded again.

    *Recommendation: (a).* A package is a course's whole content, and the service has no reason to keep it: the graph already records the build, and the same input can be stamped again.
