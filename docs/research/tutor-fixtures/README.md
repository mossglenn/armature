# Tutor and adaptive content fixtures

**Date:** 2026-11-11 · **Status:** Research fixtures, not a decision. They are the evidence for stage 1 of `docs/knowledge-components-plan.md` (the mapping study) and test material for the shapes its §4 sketches. Nothing here is loaded into a store, imported by a script or run; the code files are kept to be read.

Every file is copied unmodified from its source at the commit named below, except the three OATutor files marked *excerpt*, which keep the source's own shape and hold only the rows for the problems copied here. No learner data is included (ADR-0058): the ALOSI `learners.json` holds two test records with integer identifiers and nothing else.

---

## 1. What is here

| Folder | Source, commit | Original path | License |
|---|---|---|---|
| `oatutor/` | [CAHLR/OATutor-Content](https://github.com/CAHLR/OATutor-Content) at `1925dec` | `content-pool/<problem>/`, `skillModel.json`, `coursePlans.json`, `bkt-params/defaultBKTParams.json` | CC BY 4.0, stated in the repository's README and in each content file's `license` field (the repository has no LICENSE file) |
| `oli-torus/` | [Simon-Initiative/oli-torus](https://github.com/Simon-Initiative/oli-torus) at `9541634` | `test/oli/interop/digest/` | MIT (`oli-torus/LICENSE.md`) |
| `alosi/` | [harvard-vpal/adaptive-engine](https://github.com/harvard-vpal/adaptive-engine) at `209e7a5` | `app/engine/fixtures/*.json`, `app/engine/models.py` | Apache-2.0 (`alosi/LICENSE`) |
| `perseus/` | [Khan/perseus](https://github.com/Khan/perseus) at `e722e95` | `packages/perseus/src/__testdata__/server-item-renderer.testdata.ts` | MIT (`perseus/LICENSE`) |

---

## 2. Each source, and what it tests

### OATutor (`oatutor/`)

An open adaptive tutor whose content is JSON in git. Three problems, chosen for the cases the plan has to handle:

| Problem | Why it is here |
|---|---|
| `a38bd54basicrules2` | Four steps, each tagged with two real KCs (`the_multiplication_rule`, `the_addition_rule`); hints and ten scaffolds |
| `a38bd54basicrules25` | The same lesson, tagged `addition_rule`: the same skill under a second name (§3) |
| `a833c22linear20` | One KC name split at its commas into three "KCs" (§3) |

The shape:

- **Problem** (`<problem>/<problem>.json`): `id`, `title`, `body`, `variabilization`, `oer`, `license`, `lesson`, `lessonId`, `courseName`. Steps are not listed in it; they are the folders under `steps/`.
- **Step** (`steps/<step>/<step>.json`): `stepAnswer`, `problemType` (`TextBox`, ...), `stepTitle`, `stepBody`, `answerType`, `answerLatex`, `variabilization`.
- **Tutoring pathway** (`steps/<step>/tutoring/<step>DefaultPathway.json`): a list of `hint` and `scaffold` entries, each with `dependencies` naming earlier entries, so hints form a dependency graph, not a ladder. A scaffold is a sub-question with its own `problemType`, `answerType` and `hintAnswer`.
- **Skill model** (`skillModel.excerpt.json`): step id to a list of KC names; the source holds 18,054 steps, 96% with one KC (and nearly half the rest are split names, §3).
- **Course plans** (`coursePlans.excerpt.json`): courses with lessons; each lesson's `learningObjectives` maps KC names to a mastery threshold (0.85 throughout). This is adaptive policy as data, the kind `docs/knowledge-components-plan.md` §9 keeps out of the schema.
- **BKT parameters** (`defaultBKTParams.excerpt.json`): `probMastery`, `probTransit`, `probSlip`, `probGuess` per KC, every value 0.1 here.

Tests it serves: KCs at step grain and more than one KC per step (plan stage 7); hints and scaffolds against `hints: List<TextFragment>`, which the dependencies and scaffolds outgrow; KC identity and naming (§3); the policy boundary (plan §9).

### OLI Torus (`oli-torus/`)

The course digest Torus exports and ingests, one JSON file per resource, from its interop tests.

- **Activity** (`41.json`, `37.json`, ...): `subType` (`oli_multiple_choice`, `oli_short_answer`, `oli_check_all_that_apply`), `content.authoring.parts`, and `objectives` as a map from **part id** to objective ids (`{"1": ["22"]}`).
- **Part**: `hints`, `responses` (each a `rule`, a `score` and `feedback`) and a `scoringStrategy`.
- **Objective** (`22.json`, `23.json`, ...): `title` and `objectives`, its sub-objectives. `22` ("Identify the primary dishes and typical drinks of Galicia") has `25` and `26`; `23` has `27` and `28`.
- **Mixed levels**: activity `37.json` is tagged `["27", "26", "23"]`, two sub-objectives and a parent. Activities `41` and `42` are tagged with parents, `36` and `6534` with sub-objectives.
- `_hierarchy.json` is the course outline; `_project.json` the manifest.

Tests it serves: objectives per part (fragment grain, plan stage 7); an objective hierarchy whose leaves behave as KCs, the shape `KnowledgeComponent.supports` would take (plan §4); implied objectives when an item is tagged at two levels at once (plan §4 rule 1).

### ALOSI adaptive engine (`alosi/`)

The engine Harvard and Microsoft built for adaptive assessment in MOOCs. `models.py` is the data model, kept to be read:

- `KnowledgeComponent` with a `mastery_prior`.
- `PrerequisiteRelation` between KCs, **with a numeric weight** (`value`).
- `Activity` with many KCs, a `difficulty`, `prerequisite_activities`, and its `Collection` (the pool, with `max_problems`).
- `Guess`, `Slip` and `Transit` per (activity, KC); `EngineSettings` with the recommendation weights and BKT defaults.

The fixtures (`knowledge_components.json`, `activities.json`, `collections.json`, `engine_settings.json`) are Django fixtures of that model.

Tests it serves: KC prerequisites with strength (plan §9, "for now, by trigger"); a pool as a collection; the learner-model configuration the schema refuses (plan §9).

### Perseus (`perseus/`)

Khan Academy's exercise format. The file is TypeScript, not JSON: `itemWithMultipleNumericInputs` and its neighbors show an item as markdown with embedded widgets (several widgets make a multipart item) and a list of hints.

Tests it serves: a multipart item whose parts are widgets rather than steps; hints as a flat list.

---

## 3. What the files already show

- **KCs sit on steps** in OATutor and on parts in Torus. Item-grain KCs are a first step, not the whole answer (plan §3).
- **KC identity drifts in authored content.** OATutor's lesson 3.3 declares both `addition_rule` and `the_addition_rule`, and `multiplication_rule` beside `the_multiplication_rule`; `a38bd54basicrules2` and `a38bd54basicrules25` use one of each. A KC with its own identity and label, rather than a name string, is what the plan's (b) gives; a duplicate is a finding a read can raise.
- **Split names become false KCs.** "Determining whether a linear function is increasing, decreasing, or constant" became three KCs at its commas (`determing_whether_a_linear_function_is_increasing`, `decreasing`, `or_constant`), and the fragments `decreasing` and `or_constant` recur in other lessons and courses, so unrelated steps look as if they share a skill. In the full source, 322 of the 688 steps with more than one KC have a fragment beginning `and_` or `or_`, so nearly half the apparent multi-KC steps are one skill split at its commas; counting KCs per step without checking names overstates them.
- **A lesson is reused across courses** under different names: lesson id `5DUi1qV6-6Ykh-vIBOVeBPEX` is "Lesson 3.4" in Mission College: Introductory Statistics and "Lesson 3.3" in OpenStax: Introductory Stats.
- **Step identifiers derived from position overflow.** OATutor names steps by the problem id and a letter; past `z` they run into `{`, `|`, `}` (`content-pool/a1f1064rev1/steps/`) and then control characters (`content-pool/a89b247ds100-su19-final-Q6/steps/`, step ids ending `\177`, `\302\200`). Not copied: those paths break on some file systems. It is the case ADR-0023 guards against.
- **Hints are not one shape.** OATutor's form a dependency graph with scaffolds; Torus's sit on parts; Perseus's are a flat list; CTAT's (below) hang off correct links in levels.

---

## 4. Not copied, and why

- **CTAT** ([CMUCTAT/CTAT](https://github.com/CMUCTAT/CTAT) at `4716009`). Its license is for noncommercial research use, permits no copies beyond an organization's internal backups, and no access for third parties; this repository is public. Read them upstream:
  - `Examples/FractionAddition-CustomLogging.brd`: an example-tracing behavior graph; each edge a selection, action and input, `Correct Action` or `Buggy Action`, a buggy message, hint levels and a `<rule>` (skill and category); a `<productionRule>` inventory; `<EdgesGroups ordered="false">`.
  - `docs/HTML Factors/MassProduction/factors-template.brd` and `factors-template.txt`: a template with `%(name)%` placeholders and a table with one column per problem; the three generated graphs in `docs/HTML Factors/FinalBRDs/`. The shape of candidate ADR-0052 (item templates).
  - `docs/Buggy tutors/`: rule-based tutors in Nools, which are executable logic, not design data.
- **Eedi** (NeurIPS 2020 Education Challenge): a subject tree in `subject_metadata.csv` (name, level, parent), useful for a KC hierarchy; licensed CC BY-NC-ND 4.0, which forbids sharing adaptations, and its answer records are learner data.
- **Junyi Academy**: an exercise table with a `prerequisite` column and pairwise prerequisite ratings, useful for KC prerequisites; license not checked, and it ships with learner logs.

---

## 5. Refreshing

```bash
git clone --depth 1 https://github.com/CAHLR/OATutor-Content
git clone --depth 1 https://github.com/harvard-vpal/adaptive-engine
git clone --depth 1 --filter=blob:none --sparse https://github.com/Simon-Initiative/oli-torus
git -C oli-torus sparse-checkout set test/oli/interop/digest
git clone --depth 1 --filter=blob:none --sparse https://github.com/Khan/perseus
git -C perseus sparse-checkout set packages/perseus/src/__testdata__
```

Copy the paths in §1 at a named commit, update the commits in §1, and regenerate the three OATutor excerpts with the rows for the copied problems' steps, their lessons (by `lessonId`) and every KC either names.
