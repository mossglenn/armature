# The DataShop bridge: plan

*Status: draft 2026-11-09, for review; the questions in §17 are open, each with a recommendation the plan is written to. A plan for a client of the hub, built outside this repository. It replaces the DataShop bridge's column in `docs/demo-coverage.md` (2026-10-27) as the description of what the tool does, and corrects one cell there (§11). It cites the Storyline bridge plan as revised on 2026-11-09 (branch `docs/storyline-bridge-revision`, in review), whose §4 is the stamp and §9.1 the page the desktop program launches. When the bridge exists, this document becomes its description and its own repository carries the code.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), AFM (Additive Factors Model, the logistic model DataShop fits to a knowledge-component model), AIC and BIC (Akaike and Bayesian information criteria), API (application programming interface), CLI (command-line interface), HMAC (hash-based message authentication code), IRB (institutional review board), KC (knowledge component), LFA (Learning Factors Analysis), LMS (learning management system), RMSE (root mean square error), TSV (tab-separated values), xAPI (Experience API).

---

## 1. Purpose

DataShop, at Carnegie Mellon University, holds learner interaction data from tutors and courses and fits competing models of the skills behind it. Armature holds the design: which objectives each item assesses, and why. The two meet at one structure. A DataShop **knowledge-component model** maps each step a learner takes to the skills it exercises; Armature's **alignment**, every `AssessmentItem.assesses` link at a commit, maps each item to the objectives it gives evidence of. Exported as a KC model, the alignment becomes a hypothesis DataShop can score against what learners did.

The bridge does three things:

- **Alignment out.** The alignment at a named commit goes to a DataShop dataset as a KC model, named after the commit, where DataShop fits it beside its baselines and any other model a researcher has proposed.
- **Evidence back.** The fit, the learning curve for each objective, and item statistics come back as metrics about the objective, the item and the assessment, and as findings where the data contradicts the design: an objective whose curve shows no learning, or an alignment that predicts worse than DataShop's baselines.
- **Proposals back.** A DataShop KC model that splits or merges what Armature treats as one objective, and fits better, comes back as a finding on that objective for a person to answer, never as a change to the design.

It is the tool that makes the alignment testable, which is what candidate ADR-0043 (alignment models as competing, scored hypotheses) waits for evidence of; the first concrete instance of Narrative 1 with a statistical model behind it; and, with OLI Torus, the shortest path to a pilot with real learner data (`docs/demo-coverage.md`, notes). In the demo coverage matrix it shows external references and attachments, which no built tool shows, and makes outcome records at `asOf`, trace and item statistics its point.

Constraints from the rest of the project, which hold throughout:

- **The bridge is a client.** It reaches the hub through `@armature/client` and needs no change to the API or the schema. DataShop's formats stay in its repository (CLAUDE.md, Development Principles 1 and 5).
- **Learner data never enters the graph or stays with the bridge.** Where the bridge must read per-learner rows to compute an item statistic, it reads them in memory, counts and discards them; only aggregates cross (ADR-0058). DataShop's student identifiers are already anonymous; they are still never written anywhere.
- **No per-person aggregate about designers or reviewers** (ADR-0021). Statistics are about items, objectives and assessments, never about who wrote them.
- **Data proposes, people decide.** Nothing the bridge reads changes an objective, an item or an alignment. It writes metrics, which are measurements, and findings, which a person addresses or dismisses (ADR-0020, ADR-0028). A redesign is a person's commit on a branch.
- **DataShop is a system of record for learner data, Armature for design data** (`.claude/PROJECT_CONTEXT.md`, "Relationship to existing systems"). Neither copies the other's.

---

## 2. What DataShop gives a tool

Researched 2026-11-09. **[A]** marks what DataShop documents; **[C]** what papers, code or community material show; **[?]** what nobody has checked yet. M0 verifies [C] and [?].

| What | Where | Source |
|---|---|---|
| DataShop is maintained: release 11.4 on 2026-04-11 added DOIs for datasets; 11.0 on 2024-06-02 | News | [A] [About DataShop](https://pslcdatashop.web.cmu.edu/about/) |
| Web services, a REST API under `https://pslcdatashop.web.cmu.edu/services/`; reference version 0.41; the services list dated October 2018 | API reference | [A] [web services](https://pslcdatashop.web.cmu.edu/about/webservices.html), [API v0.41](https://pslcdatashop.web.cmu.edu/api/DataShop%20Public%20API-v0.41.pdf) |
| Authentication by a per-account access key and secret: a `date` header and `authorization: DATASHOP <key>:<signature>`, the signature an HMAC-SHA1 over method, content MD5, content type, timestamp and path | API reference | [A] API v0.41 |
| An official client in Java only (built for Java 1.6); others are told to ask DataShop for help with signing | Web services page | [A] web services |
| Datasets, projects and samples listed with metadata; access levels public, view, edit, admin, private | `datasets/…` | [A] API v0.41 |
| Transaction and student-step exports, tab-delimited, 100 rows by default and 5,000 at most per request with `offset`; released datasets only; a stale cache answers code −14 while it rebuilds | `datasets/[id]/transactions`, `datasets/[id]/steps` | [A] API v0.41 |
| **KC model export**: a template of the dataset's steps (Step ID, problem hierarchy, problem and step names) with an empty column for a new model | `datasets/[id]/exportkcm?kc_model=` | [A] API v0.41 |
| **KC model import**: a TSV whose first column is Step ID and whose other columns are headed `KC (ModelName)`; a model name of letters, digits, spaces, dashes and underscores, at most 50 characters; an existing name refused (−19); AFM and cross-validation run in the background after a success; edit access needed | `datasets/[id]/importkcm/` | [A] API v0.41 |
| Model values per KC model: AIC, BIC, log likelihood, parameter count, cross-validation values | `datasets/[id]/exportmodelvalues?kc_model=` | [A] API v0.41 |
| Learning-curve categories per KC: Good, Too little data, Low and flat, No learning, Still high, with each KC's AFM intercept and slope; thresholds as parameters (opportunities 3, students 10, low error 20, high error 40, AFM slope 0.001 by default) | `datasets/[id]/learningcurves/classify` | [A] API v0.41 |
| Learning-curve points per KC: error rate, assistance score, predicted error rate, counts per opportunity | `datasets/[id]/learningcurves/points` | [A] API v0.41 |
| Two automatic baseline KC models, **Single-KC** (every step one skill) and **Unique-step** (every step its own skill), meant as benchmarks | Every dataset | [C] [KCluster, 2025](https://arxiv.org/pdf/2505.06469) |
| **External analyses**: a text file attached to a dataset, with a title (255 characters), description (500), optional KC model and statistical model; binary files only through the web application; edit access to add | `datasets/[id]/analyses/add` | [A] API v0.41 |
| **Custom fields** at transaction level only (number, string, date) | `datasets/[id]/customfields/…` | [A] API v0.41 |
| New data arrives as logged tutor messages (XML) or an imported tab-delimited transaction file (`Anon Student Id`, `Problem Name`, `Step Name`, `Outcome`, `KC (model)` columns, several KCs on a step separated by `~~`); a new dataset is visible only to its principal investigator until access is granted | Upload | [A] [FAQ](https://pslcdatashop.web.cmu.edu/about/faq.html); [C] [cheat sheet](https://datashop.phzh.ch/downloads/DataShopCheatSheet.pdf) |
| Whether the web services can load transactions into a new dataset, or only create its record | `projects/[id]/datasets/add` | [?] M0 |
| **OLI Torus writes DataShop data**: a dataset job of type `datashop` builds DataShop's XML from Torus's xAPI statements; its local generator names each problem `Activity <id>, Part <id>` and carries the activity's attached objectives with each attempt | Torus source | [C] `oli-torus` main, 2026-11-09: `lib/oli/analytics/datasets/dataset_job.ex`, `test/support/dataset/python/dataset/local_datashop.py` |
| KC refinement from learning curves in DataShop driving a tutor redesign, evaluated in a classroom study: more practice, higher estimated mastery, no difference in learning gain | Precedent | [C] [Lyu et al., 2026](https://arxiv.org/abs/2603.29094) |

Four facts shape everything below:

1. **DataShop's unit is the step, Armature's is the item.** A step is one thing a learner does inside a problem; an item may be one step (a multiple-choice question) or several (a Torus activity's parts). The bridge needs a map from DataShop's steps to Armature's items, and to a part of an item where a step is one (§6).
2. **A KC model is a step-to-skill table, and DataShop keeps every one it is given, by name.** A name cannot be reused, so a model named after a commit is written once, and the alignment at two commits is two models DataShop can compare.
3. **Everything DataShop computes about a model is aggregate.** Fit statistics, curve categories, intercepts and slopes come back without a learner in them. Item statistics are the exception: they need the student-step export, read and discarded (§7).
4. **The signing is documented but the client is Java.** The bridge signs requests itself from the documented scheme, checked against DataShop in M0, with the official Java client as the fallback (§17 question 3).

---

## 3. Two vocabularies

| DataShop | Armature | Note |
|---|---|---|
| Dataset | `LearningDataset` | One administration, or one course's data over a period; `externalRefs` names the DataShop dataset |
| Problem, step | `AssessmentItem`, or a part of one (`fragmentId`) | Through the step map (§6); a step with no item is reported, not invented |
| Knowledge component | `LearningObjective` | Only in the models the bridge writes; a researcher's KCs stay DataShop's |
| KC model | The alignment at a commit | Not a record in Armature (candidate ADR-0043 would make one); named for its commit |
| Opportunity, learning curve | — | Read, never stored; the curve's category becomes a metric and possibly a finding |
| AFM intercept and slope per KC | `LearningMetric` about the objective | `unit` names the model and the measure |
| AIC, BIC, cross-validated RMSE per model | `LearningMetric` about the assessment or module the alignment covered | One per model compared, baselines included |
| Student, transaction | — | Never in the graph |
| External analysis | A text file the bridge attaches to the dataset | Carries the commit, the hub and the step map back to DataShop's readers (§8) |

---

## 4. What is recorded where

```
LearningDataset "Module 3 pilot, Fall 2026 (DataShop 5868)"
    asOf          <the design commit the learners met>
    producedBy    Assessment/module-3-capstone            (when the delivery maps to one)
    externalRefs  Other  datashop:dataset/5868            label: the DataShop dataset's name
    attachments   step-map      <hash of the step → item map the designer confirmed>
                  kc-model      <hash of the KC model file the bridge imported>
                  model-values  <hash of DataShop's model values export after the fit>

LearningMetric  subject AssessmentItem/…      unit "proportion correct, first attempt"   derivedFrom the dataset
LearningMetric  subject LearningObjective/…   unit "AFM slope (Armature k3j9x2a)"         derivedFrom the dataset
LearningMetric  subject LearningObjective/…   unit "learning curve: No learning (Armature k3j9x2a)"
LearningMetric  subject Assessment/…          unit "BIC (Armature k3j9x2a)"               and one per baseline compared
DesignFinding   subject LearningObjective/…   "DataShop finds no learning across 9 opportunities …"
```

- **The dataset** is one `LearningDataset` per DataShop dataset and Armature assessment or module. Its `asOf` is the commit of the design the learners met (§7, "Which commit"), not the commit whose alignment was exported, which may be later; its `externalRefs` entry uses `system: Other` and a `datashop:` prefix, as the Storyline bridge does for its system (ADR-0030; §17 question 13).
- **Three attachments** make the import checkable: the step map, the KC model file exactly as imported, and DataShop's model values export after the fit, each by SHA-256 with `store: Other` and `storeUri` the DataShop dataset's address. The graph holds no learner data, and none of the three contains any.
- **Metrics** are measurements (ADR-0058): item statistics about items, AFM parameters and the curve category about objectives, model fit about the assessment or module whose alignment was tested. The model's name and the measure go in `unit`, which is free text today; the bridge is evidence for the `measure` enum beside `unit` that SESSION.md carries as an open item.
- **Findings** are judgments the data supports and a person must answer (§7).

Nothing here needs a new field, type or rule.

---

## 5. Alignment out: `push-model`

```
armature-datashop push-model --dataset 5868 --module Module/module-3 --ref k3j9x2a
```

1. **Read the dataset's steps.** `exportkcm` gives the dataset's Step IDs with their problem hierarchy, problem and step names.
2. **Map steps to items** with the step map (§6), confirming any new mapping with the designer.
3. **Read the alignment at the ref**: each mapped item's `assesses` at that commit, through the hub's document reads with `ref=`.
4. **Write the KC model file.** First column Step ID, then the `KC (Armature <commit>)` column, one objective per step, in the form DataShop's template takes for a step with several KCs (repeated columns or the `~~` separator; M0 confirms which the import accepts). A KC is named by the objective's identifier (M0 confirms which characters a KC name may hold). A mapped item that assesses nothing leaves its steps without a KC, as the alignment read lists it (ADR-0060); an unmapped step is left empty and counted in the report.
5. **Import it** with `importkcm`. The model name is `Armature ` followed by the commit's first 12 characters (21 characters in all, within DataShop's 50). The name is the stamp: whoever opens the dataset in DataShop sees which commit of which design the model is. A model with that name already in the dataset means this commit was pushed before, and the bridge reports it rather than failing.
6. **Wait for the fit.** DataShop computes AFM and cross-validation in the background; the bridge polls the dataset's metadata until the model's values appear, and says so if it gives up.
7. **Attach the context** to the dataset as an external analysis (§8), so DataShop's readers can find the design.

`push-model` writes nothing to the hub. `pull` (§7) records what DataShop computed, so a model can be pushed, examined in DataShop's own reports and only then pulled.

**Scope.** A model covers the items of one module or one assessment, the scope of a coverage read, and DataShop fits the whole dataset with it: steps outside the scope go unlabeled and fall outside every KC's curve. Pushing a whole course is pushing every module's items at once (§17 question 5).

---

## 6. Matching steps to items

DataShop knows problems and steps by the names the delivering system gave them; Armature knows items by identifier. The step map joins them, built in this order:

1. **From the delivering system's identity.** A Torus course names each DataShop problem `Activity <id>, Part <id>` (§2); when the Torus bridge has recorded Torus activity identifiers on items as `ExternalRef`s, the map follows directly, and a part maps to a `fragmentId` where Armature has one. A Storyline build's stamp maps positional interaction identifiers to items (`docs/storyline-bridge-plan.md` §4); data converted from that build keeps the interaction identifier as the step name. A tutor built in another tool brings a mapping file.
2. **From text**, when the dataset carries problem text in a custom field or the step name is the question: proposed with its similarity, written only when the designer confirms.
3. **Otherwise unmapped**, reported with the number of transactions it holds, so the designer sees how much of the data the model will not describe.

The map is a file the designer confirms (on the page or with `--map-file`), and it is recorded as the dataset's `step-map` attachment, not as `ExternalRef`s on items: a step name belongs to one dataset, and items would accumulate a reference per dataset. The stable identity that survives across datasets (a Torus activity identifier, a Storyline slide identifier) is the other bridges' to record.

---

## 7. Evidence back: `pull` and `compare-models`

```
armature-datashop pull --dataset 5868 --module Module/module-3 --as-of <commit> [--models "Armature k3j9x2a"]
armature-datashop compare-models --dataset 5868 --module Module/module-3 --model "LFA search 2"
```

**`pull` writes, in one commit:**

- **The dataset record** (§4), created on the first pull and replaced after, with its attachments.
- **Item statistics**, one metric per item per measure: proportion correct on the first attempt, attempts, and hints requested where the dataset records them. They come from the student-step export, paged 5,000 rows at a time, read in memory and counted per mapped step; the rows are discarded and no learner identifier is written anywhere.
- **Per objective, for each Armature model pulled:** the AFM intercept and slope and the learning-curve category as metrics, the thresholds DataShop used in the metric's `description`.
- **Per model compared:** AIC, BIC and the cross-validated RMSE of the Armature model and of the two baselines, as metrics about the assessment or module.
- **Findings**, `Open`, one per objective whose curve says the design has a question to answer, each with the numbers and the thresholds in its text:

| Curve category | Finding on the objective |
|---|---|
| No learning | Errors do not fall with practice: the objective may bundle several skills, or its instruction may not be working |
| Still high | Errors fall but stay above the high threshold: more practice or support before the assessment |
| Low and flat | Learners already know it: the practice may be spent elsewhere |
| Too little data | Too few opportunities to judge; set beside the coverage read for the module, which counts placements, not opportunities |
| Good | None |

  And one finding on the assessment or module when the Armature model's cross-validated RMSE or BIC is worse than Unique-step's or Single-KC's: the alignment predicts learners' errors less well than treating every step as its own skill, or all as one. The finding names the measure; a better fit is not always a better predictor ([AIED 2021](https://link.springer.com/chapter/10.1007/978-3-030-78292-4_40)), so the text gives both.

**`compare-models`** reads another KC model in the dataset (a researcher's, or one LFA found) with `exportkcm` and sets its step-to-skill table beside the Armature alignment through the step map. Where it splits one objective's steps between several KCs, or joins several objectives' steps under one, and fits better on both measures, it writes one finding on each objective concerned, quoting the partition and the fit. It is the data-driven redesign loop of Stamper and Koedinger (2011) and Lyu et al. (2026), with the difference that the redesign is recorded: the designer answers the finding on a branch (split the objective, re-align the items), `push-model` sends the new commit's alignment, and the next `pull` says whether it fit better.

**Which commit** (`asOf`). The dataset's `asOf` is the commit of the design the learners met. Where the delivery was stamped (a Storyline build's stamp, a Torus publication the Torus bridge recorded), the bridge reads it from there. Otherwise the designer names it, and the bridge refuses to guess, since every metric copies it and the hub checks the subjects exist there (constraint 13; §17 question 7). The alignment a model tests can be later than `asOf`: that is the point of testing a revised alignment against old data, and the model's name says which.

---

## 8. Context out: the external analysis

Each `push-model` attaches one text file to the DataShop dataset, through `analyses/add`, titled `Armature alignment <commit>`, with `kc_model` naming the model and `statistical_model` `AFM`:

- the hub's instance name and address from its public profile (`GET /discover`, `instance`), the branch and the commit;
- the step map, as step to item identifier and `fragmentId`;
- each objective identifier with its label and Bloom's level at the commit.

It is what lets a researcher who finds the dataset in DataShop, perhaps years later, follow it to the design. It holds no person's name, no rationale text and no finding, since a DataShop dataset may be public; a researcher with access to the hub reads those there, under the hub's own rules (§17 question 10). A fuller design export, the pseudonymous profile of `GET /export` (ADR-0031), is an option for a study that wants it, never the default.

---

## 9. Learner data into DataShop

DataShop needs transaction data before any of the above can run. The bridge does not provide it in the first version:

- **Torus already does**, from its own xAPI statements (§2), with its objectives as a KC model. That is the pilot path.
- **A tutor logging to DataShop** (CTAT and others) already does.
- **An LMS or Storyline course** does not. Converting its responses into a DataShop import would make the bridge a carrier of per-learner data from one system to another, under an IRB protocol, with consent, anonymization and a data-sharing agreement that belong to the study, not to a tool. If a study asks for it, a separate converter can be built, owned by the study, outside both the hub and this bridge (§17 question 9).

What the bridge does read is DataShop's own aggregates, and student-step rows in memory for item statistics (§7).

---

## 10. Identity, credentials and where it runs

- **A person runs it.** ADR-0067 decision 10 and ADR-0068 decision 4 leave a service's own credential reading only, so the batch "service `User` beside the hub" the demo coverage profile gives this tool cannot write. The bridge writes as the person who runs it: the CLI against any hub, and, like the Storyline bridge, a page the desktop program launches, writing into the person's workspace, which the program pushes (`docs/storyline-bridge-plan.md` §9.1). Most of the bridge's runs are a researcher's or designer's deliberate step, which suits this.
- **Scheduled pulls**, for a course whose dataset grows each term, are a later form: a service beside a remote hub holding a `Relay` grant that names the person who set the schedule (ADR-0067 decision 5). Whether a pull a person configured is "a person's earlier work" in the relay's sense is §17 question 11.
- **DataShop credentials** are the person's own access key and secret, created on their DataShop account: in the operating system's keychain on the desktop, the environment for the CLI, never in the graph, a stamp or an external analysis. DataShop's own permissions apply: view access to pull, edit access to push a model or attach an analysis.
- **Where the code runs.** Node 20 or later, TypeScript, on `@armature/client`, with the HMAC signing written from the documented scheme. The same core-and-front-ends shape as the Storyline bridge, so the two can share the local page's server, its boundary and its packaging (§17 question 2).

---

## 11. Privacy and the line it holds

- **Learners.** No learner identifier, row or response is written to the graph, the bridge's disk, an attachment or the external analysis. Statistics are written only for groups DataShop's own thresholds call adequate (10 students by default), so a metric cannot describe one learner (§17 question 8).
- **Designers and reviewers.** Nothing is computed per author: the findings are about objectives, items and models (ADR-0021). The external analysis names no one.
- **What DataShop receives** from the bridge is a KC model (step identifiers to objective identifiers) and the context file of §8. Both are design data; neither describes a person.
- **A correction to `docs/demo-coverage.md`.** Its profile table gives this tool "a service `User`, beside the hub", written before ADR-0067's later changes of 2026-10-30. The bridge runs as a person (§10), and the table changes when this plan is accepted.

---

## 12. Testing

DataShop is a shared service with real research data, so tests do not write to datasets they do not own.

- **A synthetic dataset.** Generated from the seed's Module 3 with fictional learners, step names following the Torus convention, uploaded once to a private DataShop project the bridge's developers own, and committed as a fixture beside its transaction file. Torus's own `generate_local_datashop.py` is a precedent for generating DataShop data locally.
- **Recorded responses**: each DataShop service the bridge calls, recorded once against the synthetic dataset and replayed in CI, including the −14 cache answer, the −19 existing-name refusal and the background fit's states.
- **Signing**: test vectors computed with the official Java client, so the TypeScript signature is checked against DataShop's own.
- **Mapping and model files**: the step map from a Torus-style dataset and from a Storyline-stamped one; the KC model file for an item that assesses two objectives, none, and an unmapped step.
- **Contract tests against a seeded hub**, as Armature's CI runs them: `pull` writing the dataset, metrics and findings in one commit; a second pull replacing them; `asOf` refused when the subjects did not exist there.
- **Privacy tests**: no learner identifier in any write, attachment or external analysis (a test scans every byte the bridge sends); no metric for a group under the threshold.

---

## 13. The demo

Six minutes, DataShop and the viewer side by side, on the synthetic dataset.

1. **The hypothesis.** In the viewer, Module 3's coverage read: every objective FullyAssessed. Run `push-model`: DataShop shows a new KC model, `Armature <commit>`, beside Single-KC and Unique-step.
2. **The test.** In DataShop, the model's learning curves; one objective's curve is flat. Run `pull`: in the viewer, the objective's AFM slope and its finding, the dataset with its three attachments.
3. **Trace.** From the finding's objective, the trace to its items and the module that declares it: coverage said enough items, the data says no learning.
4. **The alternative.** `compare-models` against a model that splits that objective's steps in two: a finding with both fits.
5. **The response.** On a branch, split the objective and re-align its items; `push-model` at the new commit; `pull`: the new model fits better than the old, and the history shows the design change between the two models.

Beat 3 is Narrative 1 with a statistical model behind it; beat 5 is what only a versioned design graph adds.

---

## 14. What Armature's repository is asked for

Nothing in the hub, the API or the schema is required. Four things the plan bears on, each waiting for its own rule:

1. **`fragmentId` on `LearningMetric`** (SESSION.md, open item on per-option results). A Torus activity's parts are separate DataShop steps, and their statistics belong to a part of the item. The Storyline bridge was the first client on paper; this is the second, which the two-client rule asks for (§17 question 12).
2. **Candidate ADR-0043, alignment models.** The bridge treats the alignment at a commit as the model and names it in `unit` and in DataShop. When a person wants two alignments to coexist inside Armature (a researcher's alternative beside the designer's), that is the ADR's trigger; this bridge is its first client.
3. **The delivery-stamp ADR** (SESSION.md, open item). This bridge reads stamps (Storyline's, Torus's publications) and writes one of its own, the model's name and the external analysis, inside a system it does not deliver to. It is a second instance of the shape, and the ADR's drafting can now start from two (§17 question 14).
4. **Documents**, when this plan is accepted: the development plan's §2 outcomes-importer row, `docs/demo-coverage.md`'s DataShop column and profile, the README's plan table, and SESSION.md.

---

## 15. Implementation plan

Milestones in the bridge's repository, `mossglenn/armature-datashop`, each a pull request with its tests.

**Before M0.** A DataShop account with web-service keys, and a private project in which the developers can create a dataset.

**M0 · Verify the service.** Sign a request from TypeScript and read a public dataset's metadata; generate the synthetic dataset and upload it; confirm the KC model import's form for a step with several KCs, the background fit's timing and how its completion shows, whether model values include the baselines, and whether the web services can load transactions. Acceptance: a written note of what holds, the fixtures committed. If signing from TypeScript fails, the Java client becomes the transport (§17 question 3).

**M1 · The core and `push-model`.** The signed client, the step map from a Torus-style dataset and a mapping file, the KC model file, the import and the wait, the external analysis. Acceptance: beat 1 on the synthetic dataset; a second push of the same commit reported, not failed.

**M2 · `pull`.** The dataset record, item statistics from the student-step export, AFM parameters, curve categories and model fit as metrics, the findings; against a seeded hub. Acceptance: beats 2 and 3; the privacy tests pass.

**M3 · `compare-models` and the response loop.** Acceptance: beats 4 and 5.

**M4 · On the person's machine.** The page the desktop program launches, shared with the Storyline bridge where §17 question 2 decides; credentials in the keychain. Acceptance: the demo from the page.

**M5 · From Torus.** A real Torus course's dataset, the step map from the Torus bridge's identifiers, `asOf` from its publication. Acceptance: one pull from a Torus dataset with every step mapped. Waits for the Torus bridge and a course willing to share.

Sequencing: M0 is a short spike; M1 and M2 one or two sessions each; M3 one; M4 one, less if the Storyline bridge's page exists; M5 when a pilot exists.

---

## 16. What is deliberately not built

- **Moving learner data** into DataShop or anywhere else (§9).
- **Changing the design from data.** No objective, item or alignment is written by the bridge; the data's verdicts are findings.
- **Storing learning curves.** They are DataShop's to compute and show; the graph keeps the category and the parameters that support a finding, and the model values file by hash.
- **A KC class in Armature.** A researcher's KCs stay in DataShop; Armature's objectives are what it exports as KCs.
- **Running models.** AFM, LFA and their kin run in DataShop or LearnSphere; the bridge reads their results.
- **Statistics about people**, learners or designers.

---

## 17. Questions to settle

Each with the options and the recommendation the plan above is written to.

1. **Where the bridge lives.**
   - (a) Its own repository, `mossglenn/armature-datashop`.
   - (b) A package in Armature's workspace.

   *Recommendation: (a).* It is a client and carries DataShop's formats, which CLAUDE.md keeps out of Armature's repository.

2. **Its relation to the Storyline bridge.**
   - (a) Separate tools sharing a small library for the local page, its server and boundary, and packaging.
   - (b) One "outcomes bridge" with Storyline and DataShop as modes.

   *Recommendation: (a).* They talk to different systems with different permissions and release on different clocks; the shared part is the front end, not the domain.

3. **Signing requests.**
   - (a) In TypeScript, from the documented HMAC-SHA1 scheme, checked against the Java client's vectors.
   - (b) The official Java client, called from Node.

   *Recommendation: (a), with (b) as M0's fallback.* (b) puts a Java runtime on every designer's machine.

4. **What a step maps to.**
   - (a) An item, or a part of an item where a step is one.
   - (b) Always the whole item.

   *Recommendation: (a)* in the step map and the KC model; item statistics stay per item until `fragmentId` on metrics exists (§14 item 1).

5. **The scope of one KC model.**
   - (a) One module or one assessment, the scope of a coverage read.
   - (b) The whole course in every model.

   *Recommendation: (a), with a course as every module at once.* It matches the reads the findings sit beside; DataShop's fit is over the whole dataset either way.

6. **The model's name.**
   - (a) `Armature ` and the commit's first 12 characters.
   - (b) A name the person chooses, with the commit in the external analysis.

   *Recommendation: (a).* The name is the stamp DataShop shows everywhere; a chosen name loses it, and DataShop forbids reuse, so a commit is pushed once.

7. **`asOf` for a dataset whose delivery was not stamped.**
   - (a) The person names the commit; the bridge refuses without one.
   - (b) The commit whose alignment was pushed.
   - (c) The earliest commit at which every mapped item exists.

   *Recommendation: (a).* `asOf` is what the learners met; (b) confuses the hypothesis with the delivery, and (c) is a guess the hub's checks would accept.

8. **The smallest group a statistic is written for.**
   - (a) DataShop's student threshold, 10 by default, configurable upward only.
   - (b) Any group.

   *Recommendation: (a).* It keeps a metric from describing one learner and reuses a threshold DataShop's own reports already apply.

9. **Learner data into DataShop.**
   - (a) Not in the bridge; Torus and logging tutors provide it; a study's own converter when one is needed.
   - (b) A converter in the bridge for LMS and Storyline results.

   *Recommendation: (a).* A tool that moves per-learner data needs an IRB protocol and an agreement behind every run; that is a study's instrument, not a design tool's feature.

10. **What the external analysis carries.**
    - (a) The commit, the hub, the step map, objective identifiers, labels and Bloom's levels.
    - (b) Also the pseudonymous design export at the commit.
    - (c) Nothing; the model's name is enough.

    *Recommendation: (a), with (b) on request for a study.* A DataShop dataset may be public, and rationale text and findings are the hub's to share under its own rules.

11. **Scheduled pulls.**
    - (a) Later, as a service with a `Relay` grant naming the person who set the schedule.
    - (b) Later, through a workspace hub on a machine left running.
    - (c) Not at all; a person pulls.

    *Recommendation: (c) now, (a) when a course asks for it.* (a) stretches "a person's earlier work" (ADR-0067 decision 5) to records the person did not write; it should be decided with ADR-0067's owner when the case is real.

12. **`fragmentId` on `LearningMetric`.**
    - (a) Propose it when M2 shows a part-level statistic with nowhere to go.
    - (b) Propose it now, from this plan and the Storyline plan.

    *Recommendation: (a).* Two clients on paper meet the letter of the rule; one built client showing the gap meets its intent.

13. **The `ExternalSystem` value.**
    - (a) `Other` with a `datashop:` prefix, as the Storyline bridge uses `storyline:`.
    - (b) Add `DataShop` to the enum.

    *Recommendation: (a)* until the two bridges exist; then one ADR can add both values, with ADR-0030's note that the enum grows as clients arrive.

14. **The delivery-stamp ADR.**
    - (a) Draft it now from the Storyline stamp and this bridge's model name and external analysis.
    - (b) Wait until both bridges are built.

    *Recommendation: (b), with the two plans' sections kept as the draft.* The DataShop instance is not a delivery, so whether it belongs to the same ADR is itself a question the built tools will answer.
