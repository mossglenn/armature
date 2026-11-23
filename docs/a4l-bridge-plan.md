# The A4L bridge: plan

*Status: accepted 2026-11-22 by Amos, its thirteen questions in §17 decided the same day, all as recommended, on a decision page. The bridge's repository is [`mossglenn/armature-a4l`](https://github.com/mossglenn/armature-a4l) (public, MIT), whose `docs/plan.md` holds where each milestone stands; this document stays the design. Nothing is built beyond the manifest's columns. A plan for a client of the hub, built outside this repository, joining Armature to A4L, the Architecture for AI-Augmented Learning of the National AI Institute for Adult Learning and Online Education (AI-ALOE) at Georgia Tech, as Goel and Thajchayapong (2026) describe it in the Journal of Learning Engineering. It follows the DataShop bridge plan's shape (`docs/datashop-bridge-plan.md`) and leans on its decisions where the two meet. Nothing here has been checked with the A4L team; every fact about A4L comes from three papers (§2), and M0 is the conversation that checks them.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), AI (artificial intelligence), AI-ALOE (the National AI Institute for Adult Learning and Online Education), API (application programming interface), AWS (Amazon Web Services), CLI (command-line interface), IRB (institutional review board), IRI (Internationalized Resource Identifier), KBAI (Knowledge-Based Artificial Intelligence, the Georgia Tech course A4L 2.0 was deployed in), LMS (learning management system), LTI (Learning Tools Interoperability), OMSCS (Georgia Tech's Online Master of Science in Computer Science), PII (personally identifiable information), SAMI (Social Agent Mediated Interactions), SIS (student information system), TCSG (Technical College System of Georgia), VERA (Virtual Experimental Research Assistant).

---

## 1. Purpose

**The paper's argument.** Goel and Thajchayapong (2026) argue that learning engineering's loop (learning theory informs design, design shapes practice, practice generates data, data refines theory and design) cannot run at today's scale without a data architecture. Learners use several AI tools in one course, data comes from many systems, and the questions worth asking span semesters, not sessions. A4L is their answer: a Data Engine that ingests 1EdTech Caliper Analytics, Edu-API and LTI data and stores it as standardized, pseudonymized records; an Analytics Pipeline that computes micro- and meso-level analytics; and a Visualization Pipeline that puts role-specific dashboards in front of instructors, learners and researchers. Its stated job is to "generate evidence about how well instructional designs are working" (p. 30), in a cycle of "design → implementation → data collection → analysis → evidence-based refinement" (p. 31).

**What A4L does not hold is the design.** Nothing in the three papers records the design: which objectives an activity or an assessment serves, why an AI tool was placed in a module, or which version of the course a cohort met. A4L's records are organized by semester and course ([E] §2.2.1, the sources listed in §2), and its analyses group by course, tool and time. The "design" and "refinement" steps of its own loop happen in instructors' heads and leave no record. That is exactly the gap Armature's position paper names: design data beside learning data, each with its own system of record (`docs/how-armature-works.md` §1). So A4L and Armature are complementary halves of the same loop, and neither should copy the other.

**What "incorporating A4L" means here.** It could mean three things: building an A4L-like learning-data pipeline into Armature; positioning A4L in Armature's documents; or a bridge between the two. The first is ruled out by the project's own boundary: Armature is not a learning record store or an analytics engine (`docs/how-armature-works.md` §2; CLAUDE.md, Development Principle 5). The plan recommends the third, with the second as part of it (§17 question 1). The bridge does three things:

- **Design out.** At a named commit, the bridge writes a *manifest*: each runtime identifier A4L sees (an LTI resource link, an LMS assignment, a Caliper object) mapped to the Armature record it delivers, with that record's objectives, module and commit. A4L joins the manifest to its events, so its analyses can group by objective and by design version, not only by course and week.
- **Evidence back.** A4L's aggregate results come back as `LearningMetric`s about objectives, activities, items and modules. Each sits under a `LearningDataset` whose `asOf` is the commit the cohort met. Where the data contradicts the design, the bridge also writes `DesignFinding`s.
- **Refinement recorded.** When an instructor or designer changes the design in response, that change is a commit on a branch with a merge request. Each finding it answers is addressed. A4L's next term then comes back as a dataset at the new commit, so "did the change help?" becomes a comparison between two commits rather than a recollection.

The third is what only a versioned design graph adds to A4L. A4L can say that questions to the AI teaching assistant spiked in week 6. With Armature it can also say the spike was on one objective, under one version of the module, and that it fell after a worked example was added at a known commit, with the designer's rationale on record.

**Constraints, which hold throughout** (the same as the DataShop bridge's, §1 there):

- **The bridge is a client.** It reaches the hub through `@armature/client` and needs no change to the API or the schema. Caliper, Edu-API and A4L's formats stay in its repository (CLAUDE.md, Development Principles 1 and 5).
- **Learner data never enters the graph or stays with the bridge.** Only aggregates over groups above a threshold cross (§11; ADR-0058). The bridge never receives A4L's raw or pseudonymized events.
- **No per-person aggregate about designers or reviewers** (ADR-0021).
- **Data proposes, people decide.** The bridge writes metrics, which are measurements, and findings, which a person addresses or dismisses (ADR-0020, ADR-0028). A redesign is a person's commit.
- **Reference standards; don't translate them** (`docs/research/learning-data-standards-precedents.md`, "Don't translate between record standards"). The bridge never turns Caliper events into Armature records or the reverse. Two identifiers and a commit are the whole join.

---

## 2. What A4L gives a tool

Read 2026-11-22. Sources: **[J]** Goel and Thajchayapong (2026), *On why learning engineering needs data architecture*, Journal of Learning Engineering 1(1), 27–41, doi:10.68597/a.143023 (pages cited are the journal's); **[E]** Thajchayapong et al., *Evolution of A4L: A data architecture for AI-augmented learning*, arXiv:2511.11877 (November 2025), with 1EdTech staff among its authors; **[A1]** Goel et al., *A4L: An architecture for AI-augmented learning*, arXiv:2505.06314, the A4L 1.0 paper; **[C]** the Caliper Analytics 1.2 specification, read the same day; **[?]** what no source answers, for M0.

| What | Source |
|---|---|
| Three components: the Data Engine (ingest, standardize, pseudonymize, store), the Analytics Pipeline (micro- and meso-level analytics) and the Visualization Pipeline (role-specific dashboards), deployed as independent services | [J] pp. 31–33 |
| A cloud-agnostic reference architecture; Georgia Tech's instance runs on AWS (API Gateway, Lambda, Step Functions, SQS, S3, Redshift) | [J] p. 32; [E] §2.2.1, §2.4.1 |
| Three ingestion endpoints, each validating a JSON Schema: Edu-API (rosters and courses), Caliper (learning activity events), and an application events endpoint for tool-specific interactions | [E] §2.2.2 |
| Learner, course and activity identifiers aligned at ingestion (the institution's student identifier, single sign-on); data stored by semester and course | [E] §2.2.1; [J] p. 32 |
| Preprocessing as extensible tasks: A, the raw event store; B, pseudonymized events; C, aggregates ("Key Metrics"); D, auxiliary work such as **metadata enrichment** | [E] §2.2.4 |
| PII kept apart from research-ready data, which carries stable pseudonymous identifiers; deployment needed data-sharing agreements, identity management and role-based access | [J] pp. 32–34; [E] §2.2.5 |
| Analyses driven by a declarative JSON *payload*: an Analysis Config (statistical procedures with independent and dependent variables, merge groups, merge keys) and a Datasets Config (a source as a file or an SQL selection, columns, sanitize and transform actions); scheduled; results written as tables to Results Storage | [E] §2.3, Figures 2 to 4 |
| Dashboards embedded in the LMS through LTI; instructor, learner and researcher views; LLM-generated recommendations beside the charts (GPT-4o at the time of [E]) | [J] p. 33; [E] §2.4 |
| Deployed in KBAI (spring 2026) and OMSCS KBAI (summer 2026). Jill Watson (a conversational teaching assistant), SAMI (social learning) and VERA (simulation) are ingested automatically through Caliper; Ivy (interactive video) is not yet integrated | [J] pp. 35–37 |
| In [E], only Jill Watson's dashboard had automated ingestion, and SAMI's and VERA's data was inserted by hand; [J], eleven months later, reports all three automated | [E] §2.4.1; [J] p. 37 |
| Named as a candidate for wider adoption: TCSG, where several colleges share enterprise systems | [J] p. 34 |
| A4L names DataShop, ADL's Total Learning Architecture, the Unizin Data Platform and My Learning Analytics as precedents, which aggregate data but offer no configurable analytics | [E] §2.3 |
| **Caliper's `DigitalResource`, and so `AssignableDigitalResource`, `Assessment` and `AssessmentItem`, carries `learningObjectives` (an array of `LearningObjective` entities or their IRIs), `version` (a string) and `isPartOf`** | [C] B.5, B.6, B.7, B.18 |
| Caliper's `LearningObjective` is an entity with only `id` and `type` required | [C] B.27 |
| Every Caliper `Event` and `Entity` may carry `extensions`, "a map of additional attributes not defined by the model" | [C] §2.1, §2.2 |
| Caliper aggregate use metrics (`AggregateMeasure`): assessments passed and submitted, minutes on task, skills and standards mastered, units completed and passed, words read | [C] B.2, J.1 to J.8 |
| Whether A4L's Caliper validation keeps `learningObjectives` and `extensions` or strips what its schema does not name | [?] M0 |
| Whether A4L's results can leave it, and in what form: an export of Results Storage, an API, nothing yet | [?] M0 |
| Whether a table from outside (the manifest) can be loaded as a dataset an analysis payload joins | [?] M0 |
| Whether A4L's code or payload schema is published | [?] M0; none of the three papers links code |

Five facts shape everything below:

1. **A4L has no design in it.** It has course, activity and learner identifiers, but no objectives, no alignment and no design versions. Caliper has a slot for objectives on every resource, and no paper uses it.
2. **The join needs no new standard.** Caliper already carries `learningObjectives` and `extensions`. A4L already has a metadata-enrichment step and payloads that merge datasets on shared keys. A manifest keyed on identifiers A4L already holds is enough.
3. **A4L's outputs are aggregates in tables**, which is the shape of `LearningMetric`. But no paper documents a way out other than its own dashboards.
4. **A4L's "meso level" is Armature's module and course.** Its meso analytics aggregate "across learners, instructors, AI tools, courses, and instructional contexts" ([J] p. 33). Armature's modules, their declared objectives and roles, and its commits are the instructional context made explicit.
5. **A4L's AI tools are activities in Armature's terms.** Jill Watson, SAMI and VERA are LTI tools placed in a course. In the graph each is a `LearningActivity` that targets objectives, placed in modules, with an `LTI` external reference. Recording them that way is a designer's work through types that already exist (§10).

---

## 3. Two vocabularies

| A4L and Caliper | Armature | Note |
|---|---|---|
| Course, course offering, course section (Edu-API, Caliper) | `Course`, `Module` | A section and a semester are delivery: they name a cohort, not a design |
| A semester's data for one course | `LearningDataset` | `cohort` names the section and term; `asOf` the commit the cohort met; `externalRefs` the A4L dataset |
| AI tool (Jill Watson, SAMI, VERA) launched by LTI | `LearningActivity`, with an `LTI` `ExternalRef` | Placed in modules; `targets` the objectives it supports (§10) |
| Caliper `AssessmentItem`, `Assessment` | `AssessmentItem`, `Assessment` | Joined by the runtime identifier recorded as an `ExternalRef`, never by reusing the Armature identifier |
| Caliper `LearningObjective` | `LearningObjective` | Named by the Armature record, only when events are stamped (§5) |
| Caliper `version` on a resource | The design commit | Only when stamped; the bridge prefers `extensions` (§17 question 4) |
| Key Metrics; an analysis's result table | `LearningMetric`, about the record each row names | `unit` names the measure and the analysis |
| Analysis payload | An `Attachment` on the dataset, by hash | So a metric can be traced to the procedure that computed it |
| Instructor's interpretation and intervention on a dashboard | `DesignFinding`, `DesignNote`, a commit on a branch, a merge request | Only when it changes the design; an intervention for one learner is never recorded (§9) |
| Learner, raw event, pseudonymous identifier | — | Never in the graph or the bridge |
| Dashboard | — | A4L's; the viewer is Armature's |

A word kept apart: A4L's papers call Jill Watson and its peers "AI agents". Armature's vocabulary has already chosen *agent* for something else: a registered non-person that writes design records for a person (`@armature/vocabulary`, term `agent`; `docs/naming-vocabulary.md` §9). In Armature's documents the papers' agents are **AI learning tools**, and Armature's agents keep the word (§17 question 8).

---

## 4. What is recorded where

```
LearningActivity "Jill Watson, Module 3"                      (§10; written by the designer)
    activityType  Other
    targets       LearningObjective/…, LearningObjective/…
    externalRefs  LTI    <the tool's LTI resource link identifier>
    attachments   configuration  <hash of the tool's course configuration, revision of its repository>

LearningDataset "KBAI Spring 2027, section A (A4L)"
    asOf          <the design commit the cohort met>
    cohort        "KBAI Spring 2027, section A"
    externalRefs  Other  a4l:<instance>/<dataset or results table>   label: the A4L dataset's name
    attachments   manifest   <hash of the manifest A4L joined>
                  payload    <hash of the analysis payload that produced the results>
                  results    <hash of the results table exactly as pulled>

LearningMetric  subject LearningObjective/…   unit "Jill Watson questions per learner (A4L help-seeking)"   derivedFrom the dataset
LearningMetric  subject LearningActivity/…    unit "sessions per learner (A4L engagement)"
LearningMetric  subject Module/…              unit "minutes on task per learner, median (Caliper MinutesOnTask)"
DesignFinding   subject LearningObjective/…   "Questions on this objective were 3.1 times the module's median …"
```

- **The dataset** is one `LearningDataset` per A4L results table and Armature module or course. Its `asOf` is the commit of the design the cohort met (§7). Its `externalRefs` entry uses `system: Other` and an `a4l:` prefix, as the DataShop bridge uses `datashop:` (ADR-0030; §17 question 13 of that plan).
- **Three attachments** make the pull checkable: the manifest A4L joined, the payload that computed the results, and the results exactly as pulled. Each is by SHA-256 with `store: Other`. None holds learner data (§11).
- **Metrics** are measurements (ADR-0058) about the record each result row names through the manifest. A row that names no record is reported, not written.
- **Findings** are judgments the data supports and a person must answer (§7).

Nothing here needs a new field, type or rule.

---

## 5. Design out: the manifest and the stamp

```
armature-a4l manifest --course Course/kbai --ref k3j9x2a --out manifest-k3j9x2a.csv
```

**The manifest** is a table, one row per runtime identifier the bridge can map, with these columns:

| Column | From |
|---|---|
| `runtime_system`, `runtime_id` | The `ExternalRef` on the record (an LTI resource link, an LMS assignment, a Caliper object IRI) |
| `record`, `record_type` | The Armature record that identifier delivers |
| `objective` | One row per objective the record targets or assesses at the commit; a record aligned to none has one row with this column empty (ADR-0060) |
| `module`, `module_role` | The module that places the record, and the objective's role there (`ModuleObjective.role`) |
| `commit`, `instance` | The commit, and the hub's instance name and address from `GET /discover` |

It is design data, regenerated from the commit whenever it is wanted and never stored in the graph (ADR-0056). It holds no person's name, no rationale and no finding (§8). One row per objective is what lets A4L's payload merge on `runtime_id` and group by `objective` without parsing a list.

**How A4L uses it**, in the order the plan recommends (§17 question 3):

1. **Joined in an analysis.** The manifest is loaded into A4L's warehouse as one more dataset, and a payload's Datasets Config merges it with the events on `runtime_id`. This needs nothing of A4L but a table and a payload, which A4L's design already allows ([E] §2.3). The cost is that every analysis that wants objectives must name the join.
2. **Enrichment at ingestion.** A4L's task D, metadata enrichment ([E] §2.2.4), looks each event's object up in the current manifest and adds the record, objectives and commit to the stored event. Then every analysis has them. This is A4L's code to change, so it waits for the A4L team to want it.
3. **Stamped at the source.** A tool whose content was built from Armature (a course the course builder generated, a Storyline build with its stamp) writes the objectives into the Caliper object's `learningObjectives`, and writes the commit and the record into `extensions` under one key (§17 question 4):

```json
"object": {
  "id": "https://lms.example.edu/courses/12/quizzes/7/items/3",
  "type": "AssessmentItem",
  "learningObjectives": ["<objective IRI>", "<objective IRI>"],
  "extensions": { "armature": { "instance": "<instance name>", "commit": "k3j9x2a…", "record": "AssessmentItem/bias-types-2" } }
}
```

The object's `id` stays the runtime system's own. Reusing the Armature identifier as the runtime identifier is what cmi5 forbids and what the precedents study recommends against (`docs/research/learning-data-standards-precedents.md`, "Placements"). Form 3 is a delivery stamp in Caliper's terms: a third instance of the shape the delivery-stamp ADR waits for, after the Storyline and DataShop plans (§14). It is also the only form that needs an IRI for an Armature record outside the hub. The plan defers that form until a tool stamps (§17 question 5).

---

## 6. Matching runtime identifiers to records

A4L knows resources by the identifiers the LMS and the tools gave them; Armature knows records by identifier. The manifest can only contain what is mapped. Mapping happens in this order:

1. **From the records' own `ExternalRef`s.** An activity that names its LTI resource link, an item that names its LMS identifier or its Caliper object IRI, is mapped directly. The Storyline bridge records such identifiers for what it builds (`docs/storyline-bridge-plan.md` §4); for a course built in the LMS, the designer records them.
2. **From names.** A Caliper object's `name`, or an LMS assignment title, matched to record labels, proposed with its similarity and written as an `ExternalRef` only when the designer confirms. Unlike the DataShop step map, these identifiers survive across terms, so they belong on the record, not on one dataset (`docs/datashop-bridge-plan.md` §6 draws the same line the other way).
3. **Otherwise unmapped.** Reported with the number of events A4L holds for it, if A4L can say, so the designer sees how much of the course the design does not describe.

---

## 7. Evidence back: `pull` and `compare`

```
armature-a4l pull --results results.parquet --payload payload.json --manifest manifest-k3j9x2a.csv --as-of <commit> --cohort "KBAI Spring 2027, section A"
armature-a4l compare --course Course/kbai --datasets <dataset>,<dataset> --measure "…"
```

**What comes back, and how.** A4L documents no outbound interface. The first version therefore reads a results table, in one of the forms A4L's Results Storage writes (Parquet or CSV), that someone with access to A4L exported and handed to the person running the bridge (§17 question 6). The bridge accepts only tables whose rows are groups: by record through the manifest, by module, by cohort. It refuses any table with a column that names or numbers a learner (§11).

**`pull` writes, in one commit:**

- **The dataset record** (§4), created on the first pull and replaced after, with its three attachments.
- **Metrics**, one per result row per measure: about the objective, the activity (the AI learning tool), the item, the module or the cohort. `unit` names the measure and the analysis label from the payload, and `description` carries the payload's procedure and group size.
- **Findings**, `Open`, written by a small set of rules each stated with its threshold in the finding's text, for example:

| What the data shows | Finding on |
|---|---|
| Help-seeking from an AI learning tool on one objective far above the module's median | The objective: its instruction may not be working, or the objective may bundle several skills |
| An activity that targets an objective with little or no use | The activity: learners may not reach it, or not need it |
| An objective declared `Primary` in a module with no activity or item events mapped to it | The module's declaration: what the design says is central, the data does not see |
| Items aligned to an objective whose results disagree with the tool interactions on it | The objective, for a person to read both |

The rules are the bridge's, revised as real data shows which ones help. A finding is never a change to the design.

**Which commit** (`asOf`). The dataset's `asOf` is the commit of the design the cohort met. If the course was stamped (form 3 in §5) or the manifest A4L joined names one, the bridge reads it from there. Otherwise the person names it, and the bridge refuses to guess (constraint 13; §17 question 10).

**`compare`** sets the same measure from two datasets side by side. Those datasets come from two cohorts at two commits, and the comparison shows the design changes between them: the commits' diff restricted to the records the measure is about. It is a read the bridge computes and prints, never a stored value (ADR-0056). It answers the question A4L's meso level is built for and cannot answer alone: whether a change to the design, rather than a change of cohort or week, went with a change in the data. Two commits are not a controlled experiment, and the output says so. A study design is the researcher's, and an experiment bridge (`docs/demo-coverage.md`) would be the place for one.

---

## 8. Context out: what A4L receives

A4L receives the manifest (§5) and nothing else:

- record identifiers, record types, objective identifiers, module identifiers and objective roles, at one commit;
- the instance name and address, so a researcher who finds the table in A4L's warehouse years later can follow it to the design.

It carries no labels beyond what a dashboard needs to show an objective by name (§17 question 9 of the DataShop plan made the same choice for DataShop's external analysis), no person's name, no rationale and no finding. A researcher with access to the hub reads those there, under the hub's own rules (ADR-0068). A fuller design export, the pseudonymous profile of `GET /export` (ADR-0031), is an option for a study that wants one, never the default.

---

## 9. The refinement step

A4L's loop ends with an instructor reading a dashboard and acting ([J] pp. 37–38): setting parameters, giving feedback, designing interventions. Those actions are of two kinds, and only one is design:

- **An action for one learner or one section** (a message, a meeting, a hint, an extension) is teaching. It is A4L's and the instructor's, and it is never recorded in Armature. That is not a gap in Armature: it is the line between design data and learning data.
- **A change to what every future cohort meets** (a new worked example, an activity moved, an AI learning tool reconfigured or retargeted, an objective split) is design. The designer makes it on a branch, addresses the findings it answers, and merges it through a merge request (ADR-0072). The commit is what the next term's dataset will name in `asOf`.

The first version of the bridge connects these only through the findings and `asOf`. A link from an A4L dashboard to the finding or the record in the viewer (an LTI launch into the viewer's Focus page) is a later step, and it is A4L's to want (§16).

---

## 10. AI learning tools as design records

The papers' central claim is that a course now has a community of AI learning tools, not one tutor ([J] pp. 29, 36). For the design, each deployment of such a tool is a decision with a rationale: why this tool, in these modules, for these objectives, configured this way. Armature can record it today, with no schema change:

- **One `LearningActivity` per tool per module it serves**, `activityType` from the existing enum (`Discussion` for a social tool like SAMI, `Simulation` for VERA, `Other` for a teaching assistant like Jill Watson). The activity `targets` the objectives the tool is there to support, carries the tool's LTI resource link as an `ExternalRef`, and has a `ModuleActivityLink` to each module that places it.
- **Its configuration**, when the tool has one worth versioning (a teaching assistant's course knowledge base, a simulation's model), as an `Attachment` with a hash and, in Git, a revision (ADR-0030). A change to that configuration then shows up as a change to the activity, with an impact read over everything that depends on it.
- **The rationale** in the activity's description and in `DesignNote`s, as for any design decision.

Recorded this way, the tools become part of what coverage and alignment reads see, and part of what the manifest maps. That is what lets A4L's analyses group a tool's interactions by objective. A teaching assistant that serves the whole course raises a modeling question (one activity placed in every module, or one per module) that the first real course should answer (§17 question 7). A new type for AI learning tools waits for a second client that needs something an activity cannot hold (Development Principle 6).

---

## 11. Privacy and the line it holds

- **Learners.** The bridge never receives an event, raw or pseudonymized, or any learner identifier. It reads aggregate tables only, refuses a table with a learner column, and writes no metric for a group smaller than its threshold: 10 by default, configurable upward only, or A4L's own threshold if that is stricter (§17 question 9). A4L's governance (its data-sharing agreements and role-based access, [J] p. 34) decides who may export a results table at all; the bridge adds nothing to what it may contain.
- **Designers and reviewers.** Nothing is computed per author (ADR-0021). The findings are about objectives, activities, items and modules.
- **Instructors.** A4L's dashboards are partly about instructors' sections. The bridge writes no metric whose group is one instructor's section, unless the cohort is that section by design and the dataset says so.
- **What A4L receives** is design data only (§8).
- **Pseudonymous identifiers** are A4L's and stay there. The bridge never joins anything on a learner, so it never needs one.

---

## 12. Identity, credentials and where it runs

- **A person runs it**, as with the DataShop bridge (`docs/datashop-bridge-plan.md` §10): an agent's own credential only reads (ADR-0067 decision 10, ADR-0068 decision 4), so the bridge writes as the person running it. That means the CLI against any hub, and later a page the desktop program launches, writing into the person's workspace.
- **No A4L credentials** in the first version: it reads a file someone exported. A later version reading A4L directly would hold the person's A4L access in the operating system's keychain, never in the graph, a manifest or a stamp.
- **Where the code runs.** Node 20 or later, TypeScript, on `@armature/client`, with the same core-and-front-ends shape as the DataShop and Storyline bridges, so the three can share the local page's server and packaging.

---

## 13. Testing

A4L's code is not published and its data is real learners', so tests run on fixtures built from the papers and checked against A4L in M0.

- **Synthetic Caliper events**, generated from the seed course with fictional learners: tool-use events for two AI learning tools placed in Modules 1 and 3, assessment item events for Module 3's items, each object identified by a runtime IRI the seed's records name as `ExternalRef`s. They are used only to produce the next fixture, never sent anywhere.
- **A results fixture**, the synthetic events aggregated by a payload written in the shape of [E]'s Figure 4, by a small local stand-in for A4L's analysis module (DuckDB over the events and the manifest). The stand-in exists to make the fixture reproducible, not to imitate A4L.
- **Manifest tests**: an item assessing two objectives, none, a tool activity placed in two modules, an unmapped runtime identifier.
- **Contract tests against a seeded hub**, as Armature's CI runs them: `pull` writing the dataset, metrics and findings in one commit; a second pull replacing them; `asOf` refused when the subjects did not exist there.
- **Privacy tests**: a results table with a learner column refused; no metric under the threshold; nothing in the manifest but the columns of §5 (a test reads every byte the bridge writes).

---

## 14. What Armature's repository is asked for

Nothing in the hub, the API or the schema is required. Five things the plan bears on, each waiting for its own trigger:

1. **The delivery-stamp ADR** (SESSION.md item 15). Form 3 of §5 is a stamp in Caliper, after the Storyline build's stamp and the DataShop bridge's model name. That makes a third instance, and the first that rides an open standard's own fields.
2. **An IRI for a record outside the hub.** Caliper's `learningObjectives` takes IRIs. The precedents study recommends minting IRIs under an instance base URI (`docs/research/learning-data-standards-precedents.md`, "Mint IRIs under an instance base URI"). This is the first plan that needs one, and only for form 3 (§17 question 5).
3. **`ExternalSystem`.** The bridge uses `LTI`, which exists, and `Other` with prefixes (`a4l:`, an LMS's). A `Caliper` or `EduAPI` value waits, as `DataShop` does, for one ADR when the bridges exist (`docs/datashop-bridge-plan.md` §17 question 13).
4. **A `measure` enum beside `LearningMetric.unit`** (SESSION.md item 11). This bridge's measures (help-seeking, engagement, minutes on task) are evidence for it, as are DataShop's.
5. **Documents**, when this plan is accepted (*done 2026-11-22 with the acceptance*): `docs/demo-coverage.md` (an A4L column and profile row), the development plan's §2 outcomes-importer row, the README's plan table, `docs/how-armature-works.md` (A4L as a named instance of learning-data infrastructure, beside DataShop and the Total Learning Architecture, in the explainer's account of design data and learning data), `docs/research-path.md` (a study joining an A4L course), and SESSION.md.

---

## 15. Where it meets other plugins

- **The DataShop bridge.** A4L names DataShop as a precedent ([E] §2.3). The two bridges share the dataset-at-`asOf`, metrics and findings pattern and the "person names the commit" rule. Their `compare` and `compare-models` commands are the two candidates for a hub read comparing measures across commits, should a second client want one.
- **The Storyline bridge and the course builder.** They are where form 3's stamp would come from.
- **The MCP server** (`mossglenn/armature-mcp`). A4L's dashboards already put an LLM's recommendations beside the charts ([E] §2.4). That LLM sees learner data and no design. Given the MCP server's reads, it could answer "why is this activity here, and what was it meant to support?" from the design. That is A4L's integration to want; the server needs nothing new for it.
- **Lint** (`mossglenn/armature-lint`). A rule such as "an AI learning tool that targets no objective declared in its module" is a design rule, not a data rule, and belongs there if it is wanted.

---

## 16. Implementation plan

Milestones in the bridge's repository, `mossglenn/armature-a4l` (§17 question 2), each a pull request with its tests.

**Before M0.** A short note to the A4L team, built from §1 and §5, once this plan is accepted (§17 question 13, decided). Amos sends it, or approves it before anyone does.

**M0 · Check the facts with A4L.** The [?] rows of §2: whether Caliper `extensions` and `learningObjectives` survive A4L's validation; how results can leave A4L; whether a manifest can be joined in a payload; whether the payload schema is published. Acceptance: a written note of what holds, and the fixtures of §13 adjusted to it. If results cannot leave A4L at all, the bridge stops at the manifest (M1), and evidence back waits.

**M1 · The core and `manifest`.** Mapping from `ExternalRef`s and confirmed names, the manifest table, the instance profile. Acceptance: the manifest for the seed course at two commits, with the unmapped report.

**M2 · `pull`.** The dataset, its attachments, metrics and findings from the results fixture, against a seeded hub. Acceptance: demo beats 1 and 2; the privacy tests pass.

**M3 · `compare` and the refinement loop.** Acceptance: demo beats 3 and 4.

**M4 · On the person's machine.** The page the desktop program launches, shared with the other bridges. Acceptance: the demo from the page.

**M5 · With a real A4L course.** A KBAI or OMSCS term, or a TCSG college if A4L goes there, with the course's design in an Armature instance. Acceptance: one pull from a real results table with every row mapped. Waits for M0's answers and a course willing to share.

**The demo**, six minutes, the viewer beside the results fixture:

1. **The design, in A4L's terms.** The seed course's Module 3 in the viewer, with a teaching-assistant activity targeting its objectives. Run `manifest`, then show the stand-in analysis grouping the assistant's questions by objective instead of by week.
2. **The evidence.** Run `pull`. In the viewer, the dataset with its three attachments, the metrics on each objective, and a finding on the one where questions spiked.
3. **The response.** On a branch, add a worked example targeting that objective, address the finding, and merge through a merge request. The next term's results come back as a dataset at the new commit.
4. **The comparison.** Run `compare`: the measure at both commits, and the design change between them, which A4L alone could not name.

Beat 4 is what only a versioned design graph adds.

---

## 17. Questions to settle

Each with its options and the recommendation the plan above is written to. **All thirteen decided 2026-11-22 by Amos, as recommended.**

1. **What incorporating A4L means.**
   - (a) A bridge between the two, plus A4L's place in Armature's documents.
   - (b) An A4L-like learning-data pipeline inside Armature.
   - (c) Only a mention in the documents.

   *Decided as recommended: (a).* (b) crosses the project's boundary (Armature is not a learning record store or an analytics engine); (c) leaves the paper's loop without its design half.

2. **Where the bridge lives.**
   - (a) Its own repository, `mossglenn/armature-a4l`.
   - (b) A package in Armature's workspace.

   *Decided as recommended: (a)*, as for every bridge: it carries Caliper's and A4L's formats, which CLAUDE.md keeps out of Armature's repository.

3. **How design identity reaches A4L's data.**
   - (a) The manifest joined in an analysis payload.
   - (b) The manifest applied at ingestion by A4L's metadata enrichment.
   - (c) Stamped into Caliper events by the tools.

   *Decided as recommended: (a) first, (b) when the A4L team wants it, (c) for tools generated from Armature.* (a) needs nothing of A4L but a table; (b) is A4L's code; (c) asks every tool to know Armature, which only tools built from the design will.

4. **Where a stamp carries the commit** (form 3 only).
   - (a) `extensions.armature`, with the instance, the commit and the record.
   - (b) Caliper's `version`.

   *Decided as recommended: (a).* `version` belongs to the runtime resource (a quiz has its own versions), and a reader of `version` cannot tell a design commit from it.

5. **An IRI for an Armature record outside the hub.**
   - (a) Defer: the manifest uses identifiers with the instance name and address, and the IRI is decided when the first tool stamps.
   - (b) An ADR now, minting IRIs under an instance base URI.

   *Decided as recommended: (a).* Only form 3 needs an IRI, and no tool stamps yet; the decision should be made with a real consumer (Principle 8).

6. **How results come back.**
   - (a) A results table exported from A4L, which the person gives the bridge.
   - (b) An A4L outbound API, if one exists or is built.
   - (c) The bridge queries A4L's warehouse.

   *Decided as recommended: (a) now, (b) if M0 finds one.* (c) never: it would put warehouse credentials, near raw and pseudonymized data, in a design tool.

7. **AI learning tools in the graph.**
   - (a) A `LearningActivity` per tool per module, with an `LTI` reference, `targets` and its configuration as an attachment.
   - (b) One activity per tool per course, placed in every module.
   - (c) Not recorded; the manifest maps tools to modules only.
   - (d) A new type.

   *Decided as recommended: (a)*, with (b) tried if a course-wide teaching assistant makes (a) repetitive. (c) loses the objectives the tool is there for, the very thing A4L lacks; (d) waits for a second client.

8. **What Armature's documents call the papers' "AI agents".**
   - (a) "AI learning tools", keeping *agent* for Armature's chosen term.
   - (b) "Pedagogical agents", with a note in `docs/naming-vocabulary.md`.

   *Decided as recommended: (a).* *Agent* is chosen in the shared vocabulary for a non-person that writes design records; a second sense in the same documents would confuse exactly the readers who use both.

9. **The smallest group a metric is written for.**
   - (a) 10 by default, configurable upward only, or A4L's threshold where stricter.
   - (b) Any group A4L reports.

   *Decided as recommended: (a)*, as the DataShop bridge does.

10. **`asOf` for a cohort whose course was not stamped.**
    - (a) The person names the commit; the bridge refuses without one.
    - (b) The commit of the manifest A4L joined.

    *Decided as recommended: (a), with (b) offered as the default the person confirms.* A manifest joined in March may describe a design that changed in February. The person knows which version the cohort met, and the hub checks the subjects exist there (constraint 13).

11. **Interventions for individual learners.**
    - (a) Never recorded in Armature.
    - (b) Recorded as notes without the learner.

    *Decided as recommended: (a).* They are teaching, not design; even without a name, a note about one learner's intervention is learning data.

12. **Comparing measures across commits.**
    - (a) A read the bridge computes.
    - (b) A hub read.

    *Decided as recommended: (a)* until a second client, DataShop's `compare-models` the likeliest, wants the same read (Principle 6).

13. **Approaching the A4L team.**
    - (a) After this plan is accepted, with a short note of §1 and §5.
    - (b) Now, with this draft.
    - (c) Not until M1 exists to show.

    *Decided as recommended: (a)*, Amos's call. M0's questions are A4L's to answer, and a manifest built on the seed (M1) is a good second message, not a first one.
