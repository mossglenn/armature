# ADR-0058: Item Statistics Are Metrics About the Item

> **In brief.** This decision answers: where do an assessment question's statistics live, such as
> the share of learners who answered it correctly (difficulty) or how well it separates stronger
> from weaker learners (discrimination)? It removes the two number fields on the question itself and
> records each statistic as its own measurement, a `LearningMetric` that names the question it
> measures, the administration it came from and the version of the design it describes. Summaries,
> such as a question's latest difficulty, are worked out when someone asks.

## Status

Accepted and implemented (2026-10-18). Removes `AssessmentItem.difficultyIndex` and
`AssessmentItem.discriminationIndex` (ADR-0009 decision 1); adds `LearningMetric.subject`. Resolves
the open question ADR-0056 left on ADR-0009's fields and the plan's §6 entry "Item statistics:
stored or computed?".

**Note 2026-10-20:** the seed carries two item statistics of the kind this ADR describes
(`LearningMetric/mod3-bias-type-difficulty`, `LearningMetric/mod3-effective-prompt-difficulty`), each
`derivedFrom` the spring pilot dataset with its `asOf`; ADR-0063 requires every metric to name its
dataset or an external source (constraint 20).

**Note 2026-10-22, decision 3's bank-wide read.** The first client to need one is the viewer's
Coverage View, which shows each item's statistics beside the coverage it counts toward, so
Narrative 1's starting point (an approved, attested item that 38% of a cohort answered correctly)
sits on the same page as its objective's verdict. The form it needs is the one this ADR left open
deliberately unchosen: `GET /api/v1/intelligence/item-statistics` (`?module=`, `?unit=`, at any
ref) returns each item with every metric about it and the administration each came from, newest
first, and summarizes nothing. Which figure is "the" difficulty stays the client's choice; the
order only spares a client that wants the latest administration from sorting. Items with no
statistic are listed apart. Capability `armature/intelligence.item-statistics`, revision
2026-10-22.

## Context

ADR-0009 added `difficultyIndex` and `discriminationIndex` to `AssessmentItem` as classical item
statistics "computed from LearningDataset results", stored on the item so the bank could be
queried by difficulty. No code ever wrote them. ADR-0056 then named difficulty summaries among the
derived values the graph must not store, which left the fields in question.

Two facts decide it.

1. **Armature holds no learner responses.** A `LearningDataset` records that an assessment was
   administered to a cohort; a `LearningMetric` records a measurement taken from it. The
   statistics are produced by the tool that holds the responses (a learning management system,
   DataShop, psychometric software) and arrive as numbers. "Compute on read from datasets" has
   nothing to compute from; the choice is only where the imported numbers live.
2. **An item statistic is a fact about a cohort meeting a version of the item.** A p-value of 0.42
   is that cohort's result on the item as it stood then. One number on the item names neither,
   and each import would overwrite the last.

Storing them on the item also writes outcome data onto an authored document: every import is a
commit to the item, interleaved with its authors' edits, moving the branch under their `If-Match`
and conflicting in merges with item changes made on another branch.

`LearningMetric` already is "a quantitative measurement of learning performance", with
`derivedFrom` naming its dataset and, since ADR-0057, `asOf` naming the design state. What it
lacks is the design record it measures: PROJECT_CONTEXT's Narrative 1 test writes a metric
labeled "Item 1 p-value" that cannot point at item 1, so the trace reaches the item only through
the whole assessment.

The two-client test: the outcomes importer writes item statistics; CoQui's item review shows an
item's performance beside its findings; the research exporter pairs item statistics with the item
version that produced them; the AI design assistant reads them to suggest revisions.

## Decision

### 1. `LearningMetric.subject: Optional<DesignRecord>`, the record the metric measures

An item statistic is a `LearningMetric` whose `subject` is the `AssessmentItem`, whose
`derivedFrom` is the dataset of the administration, and whose `asOf` is that dataset's (ADR-0057).
`value` holds the number and `unit` says what it is (`proportion correct`, `point-biserial`).

The field is a `DesignRecord`, not an `AssessmentItem`, because the same shape serves a metric
about an objective (a mastery rate), an activity (a completion rate) or a module, and the
position paper's scope covers those even where no near-term client asks for them yet. It is
single-valued: a metric measures one thing. A metric with no `subject` is about its dataset's
cohort as a whole, as before.

`unit` stays free text. When usage shows which measures recur, a `measure` enum can be added beside
it without breaking existing records (ADR-0010's progressive formalization).

### 2. `difficultyIndex` and `discriminationIndex` leave `AssessmentItem`

Neither field has ever held a value, so removing them changes no stored document.

### 3. Summaries are reads

"The metrics about this item" is the list route: `GET /api/v1/documents/LearningMetric?subject=<item>`
(an Optional reference, filtered in the hub). The trace walks `subject` in both directions: from a
metric to what it measures, and from any record it reaches to the metrics about it. A bank-wide
read such as "items by latest difficulty" is not built: which summary is wanted (latest, per
cohort, across cohorts, at which state) is a client's question, and the first client that needs one
decides its form. It will be an intelligence read, never a stored field (ADR-0056).

### 4. Constraint 13 covers the subject

A metric's `subject` must exist at its `asOf`, as a dataset's `producedBy` and a finding's
`subject` must (ADR-0057). This is checked whenever the value was not taken from the branch head:
a supplied `asOf`, one kept on a replace, or one copied from a dataset that holds a supplied or
stored value. An item created after the administration cannot carry that administration's
statistics.

## Consequences

**Positive**

- Each statistic carries its cohort (through the dataset), its design state (`asOf`) and who
  imported it (the commit), so statistics from different cohorts and item versions sit side by side
  instead of overwriting one another.
- Imports never touch item documents; an item's history is its authors' history.
- Narrative 1's trace reaches the item a metric measures directly.
- ADR-0056's split holds exactly: the observation is stored; the summary is computed.

**Negative**

- Filtering the bank by difficulty is no longer a filter on the item; it needs a read over metrics,
  which is not yet built (decision 3).
- `unit` free text means a p-value and a point-biserial are told apart by convention until a
  `measure` vocabulary is warranted.
- Removing two fields is a breaking schema change in form. Since no document holds them, a schema
  load without clearing data applies it.

**Neutral**

- The seed has no datasets or metrics, so item statistics are shown only in tests until the seed
  gains outcome data (Phase 6).

## Related

- ADR-0009 — added the two fields (decision 1), annotated
- ADR-0010 — progressive formalization; why `unit` stays text
- ADR-0056 — derived values are reads, never stored
- ADR-0057 — `asOf`, which this decision relies on for the item version
