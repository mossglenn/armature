# ADR-0063: Outcome Records Name Their Source

> **In brief.** This decision answers: when results from a test or a study enter Armature, how does
> a reader know where they came from? A dataset (the results of one administration of an
> assessment) and a metric (one measurement) now have to say: either they point at the assessment
> inside Armature that produced them, or they carry a reference to the outside system they came
> from. One with neither is refused. This replaces a rule the plan had deferred because it could not
> be stated until external references existed. It still holds.

## Status

Accepted and implemented (2026-10-20). Constraint 20. Resolves the pending rule CLAUDE.md and the
schema documentation carried since Phase 1 ("`LearningDataset.producedBy` required for
Armature-administered assessments"), made expressible by ADR-0030. Annotates ADR-0057 and
ADR-0058, whose records this rule covers.

## Context

`LearningDataset.producedBy` and `LearningMetric.derivedFrom` have been optional since Phase 1
because results may come from outside: a dataset from a pre-Armature assessment, a metric from a
benchmark study. The plan deferred the rule "producedBy is required when the dataset is created by
an Armature-administered assessment" to Phase 6, and the schema's `@documentation` said so. The
rule could not be checked: nothing on a dataset said whether its assessment was Armature's.

ADR-0030 gave a record a way to say where it came from when the answer is outside the graph:
`externalRefs`, an identifier in another system (an xAPI activity, a QTI test, an LMS export). With
it the deferred rule has an honest, checkable form that needs no notion of "Armature's assessment":
an outcome record names its source, inside or outside. Narrative 1 (PROJECT_CONTEXT) depends on
that chain: metric to dataset to assessment to items to objectives to module. A dataset that names
no source breaks the chain at the first link, and the research exporter (ADR-0031) would carry a
measurement no reader can trace.

The outcomes importer and the research exporter both need it, so the ask passes the two-client
test. The seed gains the dataset the plan asked for (one administration of the Module 3 capstone
to a spring pilot cohort, with three metrics) so Narrative 1 runs on `main` and not only in tests.

## Decision

### 1. Constraint 20: a dataset or metric names where it came from

- A `LearningDataset` carries `producedBy` (the `Assessment` whose administration produced it) or
  at least one `externalRef` (the system it was imported from). Neither: 422 `dataset_without_source`.
- A `LearningMetric` carries `derivedFrom` (the dataset it was computed from) or at least one
  `externalRef`. Neither: 422 `metric_without_source`. A metric derived from a dataset takes its
  source from the dataset and needs no reference of its own.

Both forms may be present: a dataset produced by an Armature assessment and exported from an LMS
names both, and the trace follows `producedBy`.

### 2. Checked in the invariants engine, like every other rule

`app/lib/api/invariants/observations.ts`, registered for the two types. Shape stays Zod's; the
store still enforces that `producedBy` and `derivedFrom` exist. Nothing about "Armature's
assessment" is inferred: the writer says what the source is, and the rule only insists that
something is said.

### 3. The seed carries one administration

`scripts/seed_data.js` writes, in a third commit after the attestation, a `LearningDataset`
produced by the Module 3 capstone assessment (spring 2026 pilot cohort, with an xAPI activity
reference as its external source too) and three `LearningMetric`s derived from it: the difficulty
of the bias-type item (0.38, hard), the difficulty of the prompt item (0.83) and the cohort's mean
score (no subject). Their `asOf` is the seed's first commit, the state the cohort met. One
objective gains a CASE reference so ADR-0030's other half is visible too. Narrative 1 now walks on
`main`: `GET /api/v1/intelligence/trace/LearningMetric/mod3-bias-type-difficulty`, then coverage
of `risks-and-ethics` at `ref=<the dataset's asOf>`.

## Alternatives considered

- **Keep the deferred wording** ("required when Armature-administered"). Rejected: unstatable
  without a flag saying whose assessment it was, and a flag would be a field about provenance that
  `externalRefs` and `producedBy` already carry between them.
- **Require `producedBy` always.** Rejected: an imported pre-Armature dataset has no assessment in
  the graph, and refusing it keeps true history out (the reasoning of ADR-0060).
- **Leave both optional with no rule.** Rejected: Narrative 1 and the research exporter both
  depend on the chain being whole, and a measurement with no source is not evidence.

## Consequences

**Positive**

- Every measurement in the graph is traceable to an assessment or to the system it came from;
  the trace and the export never meet a sourceless metric.
- The pending rule is closed in a form the engine checks, with no new field.
- Narrative 1 is demonstrable on the seed, not only in tests; the seed also shows an external
  reference on an objective and on a dataset.

**Negative**

- An importer loading a bare table of scores must name its source before the hub accepts it; that
  is the point, but it is one more field to map.
- The seed grows to 53 documents in three commits; documents that describe it change.

**Neutral**

- No schema change beyond `@documentation`; the schema reloads without clearing. The seed is
  reloaded (`node scripts/seed_data.js` replaces the instance graph).

## Related

- ADR-0030 — `externalRefs`, the form an outside source takes; annotated
- ADR-0057 — `asOf` on datasets and metrics; the seed's `asOf` is the first commit
- ADR-0058 — item statistics are metrics about the item; the seed's two difficulties are examples
- ADR-0031 — the export the rule keeps whole
- ADR-0060 — refusing a true state keeps history out; why `producedBy` is not required outright
- `docs/development-plan.md` Phase 6 ("Outcomes import path"); `.claude/CLAUDE.md` constraint 20
