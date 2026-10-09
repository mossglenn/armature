# ADR-0057: Records That Refer to a State of the Graph Name Its Commit

## Status

Proposed (2026-10-08). Follows from ADR-0056, which removed stored coverage and left one question
it had been answering: what the graph looked like when something was observed or judged. Adopt
before Phase 6's outcomes importer and alongside ADR-0028's Attestation, which already carries
`asOf`.

## Context

A `LearningDataset` records that an `Assessment` was administered to a cohort, and a
`LearningMetric` records a measurement derived from it. PROJECT_CONTEXT's Narrative 1 walks from
such a metric back to the items, the objectives and the module that declared them, and asks
"whether the module's assessment coverage was adequate". Adequate *when*: the assessment as it
stood when the cohort sat it, not as it stands when the question is asked. An item may since have
been retired, re-placed, or re-aligned to a different objective.

`LearningDataset.producedBy` names the assessment but not its state. Under ADR-0025 every state of
the graph has a name, the commit id, and every read accepts one (`ref=`). What is missing is the
field that records which commit an administration happened against. The same gap exists for any
record that describes or judges a state: a `DesignFinding` says an item's stem cues its answer, but
of which version of the item? ADR-0028's Attestation already answers this for itself with `asOf`,
"the commit of the target the attestation was made against".

The two-client test: the outcomes importer needs it to put results beside the right design; the
research exporter needs it to pair outcomes with the design that produced them (plan §4 Phase 6,
"comparable design-data corpora"); the AI design assistant and CoQui need it on findings so a
reviewer can see what the finding was about even after the item changed. Four clients.

What a commit id is, in the store: a global identifier in the commit graph (`local/_commits`),
readable at `local/commit/<id>` from any branch (platform checks O and U), surviving the deletion
of the branch that made it (check T2). The hub never rewrites history (ADR-0025 decision 6), so an
id named in a document stays valid. The store cannot check that a string names a commit; the hub
can, by reading `ValidCommit/<id>` (check U), and does so for every caller-supplied ref already.

## Decision

### 1. `asOf: Optional<xsd:string>`, a bare commit id, on the records that refer to a state

Added to:

- `LearningDataset` — the commit the administered assessment was taken from. With it, the
  coverage at delivery is `GET /api/v1/intelligence/coverage/:module?ref=<asOf>`, and the trace
  from a metric can report the items, alignments and verdicts as they were.
- `LearningMetric` — for a metric with no `derivedFrom` dataset; one with a dataset inherits the
  dataset's `asOf` and the hub rejects a disagreeing value (decision 3).
- `DesignFinding` — the state of the subject the finding describes.
- Attestation, when ADR-0028 lands, as that ADR already specifies.

Not added to `DescriptiveEvidence`, `LearningNeed`, or any artifact: evidence gathered before the
course existed refers to no graph state, and an artifact's own history is its history.

The field is a bare commit id, the same form `ETag`, `If-Match` and `ref=` use (ADR-0025 decision
7). It is a string in the schema because a document cannot reference the commit graph; the hub
gives it meaning.

### 2. The hub fills `asOf` with the branch head when a write omits it

A finding written now is about the state now; a dataset written as the results arrive is about the
assessment as it stands. The pipeline sets `asOf` to the head of the branch being written when the
document lacks one, the way it sets `createdBy` from the resolved identity (ADR-0032): a provenance
fact taken from the context of the act, not a value computed from other documents. An importer
loading historical results supplies the real commit, and the schema comment says so. The field is
therefore `Optional` in the schema and always present in the store for documents written through
the API.

### 3. The hub validates `asOf` as an invariant

A supplied `asOf` must name a commit that exists (check U's read of `ValidCommit`), and the
document's subject must exist at that commit: `producedBy` for a dataset, each `subject` for a
finding, the dataset's own `asOf` for a metric that names one. A violation is a 422 like every
other invariant, with the commit and the missing subject named. This is CLAUDE.md's next
constraint, 13.

### 4. Reads at `asOf` are ordinary reads

No new route. A client that has a dataset reads anything at `ref=<asOf>`. The trace read adds
`asOf` to the summary of any node that carries it, so a client walking from a metric knows which
ref to read the rest at. The coverage read gains nothing: it already takes `ref=`.

## Consequences

**Positive**

- Narrative 1 is answerable exactly: the design the cohort met, not the design today.
- Outcomes can be paired with designs across time without storing any derived value, which is
  what ADR-0056 requires and what the research exporter needs.
- A finding stays interpretable after its subject changes; a reviewer reads the subject at `asOf`.
- One field, one meaning, on every record that refers to a state; Attestation is not a special
  case.

**Negative**

- A commit id in a document is a reference the schema cannot check; the hub's invariant is the
  only guard, and data written outside the pipeline (a script, a migration) can hold an id that
  names nothing. The seed writes none and gets none.
- Three optional fields is a non-breaking schema change; the existing seed documents gain no
  `asOf`, and a finding written by the seed has no state to be read at. Reloading the seed through
  the API would fix that and is deferred to Phase 7's toolkit.
- `asOf` on a `LearningDataset` names a commit on whatever branch the administration was taken
  from; after a merge the same state is also reachable through the target's history, but the id
  stays the source's. That is correct and may surprise a client that expects every id to appear in
  `main`'s log.

**Neutral**

- No change to what a commit records; `asOf` is read-side provenance, not commit metadata.

## Open

- Whether the research exporter (ADR-0031) should treat `asOf` as a reference type that an export
  profile resolves, so a corpus carries the referenced state inline.
- Whether `LearningActivity` outcomes, when they exist, want the same field. Likely yes, by the
  same rule; not decided here.

## Related

- ADR-0025 — commits as the unit of design process data; `ref=` reads; bare commit ids
- ADR-0028 — Attestation's `asOf`, the precedent this generalizes
- ADR-0032 — a provenance field the pipeline fills from context, the pattern decision 2 follows
- ADR-0056 — why coverage at delivery became a question only a ref can answer
- Platform checks O, T2, U — commits are global, outlive their branch, and can be checked
