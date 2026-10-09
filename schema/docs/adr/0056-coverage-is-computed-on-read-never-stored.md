# ADR-0056: Coverage Is Computed on Read, Never Stored

## Status

Accepted (2026-10-08). Supersedes ADR-0007's decision that `ModuleObjective` carries a computed
`coverageStatus`, and ADR-0029 decisions 4 to 6 (computed fields rejected on write, the recompute
in the write's commit, the recompute triggers and the merge behaviour). ADR-0029 decisions 1 to 3
(the population counted, the two eligibility rules adopted from ADR-0019, and the default
thresholds) stand as the default algorithm of the coverage read. ADR-0019's two populations stand
as the read's two outputs. `CoverageStatus` leaves the schema: it is the computation's vocabulary,
not the graph's. The reversal was decided the same day ADR-0029 was accepted, once the merge
recompute it required had been built and could be weighed.

## Context

ADR-0007 (2026, before the version-control model) made `coverageStatus` a field on
`ModuleObjective`, recomputed by the API after any change to its inputs, so that coverage would be
"always fresh" and queryable. ADR-0019 added a second computed field for the projected figure.
ADR-0029 defined the algorithm and, taking the stored field as given, specified how the hub would
keep it true: the fields declared computed in the schema metadata and refused from clients, the
recompute run inside every write's commit, and, for merges, a follow-on commit plus a resolution
path for conflicts on the computed fields alone.

Building that exposed what the stored field is. Every other value in the graph records a human
act or an observation: an objective someone wrote, a placement someone made, a reason, a finding,
a commit with an author. A coverage verdict is neither. It is the output of a formula with
thresholds ADR-0029 itself calls provisional and unevidenced, written into a designer's commit
under the designer's name. The costs it imposed in one day:

- A required field clients had to invent a value for, which is how the seed came to mark an
  objective `FullyAssessed` on the strength of one `Draft` item and stayed wrong for months.
- A computed-field mechanism in the schema metadata and the generator, so the hub could refuse
  what the schema forced it to require.
- A pipeline step that writes documents the caller did not name into the caller's commit.
- For merges, three commits per two-sided recompute, the first two carrying values known to be
  wrong, and a resolution path for conflicts that had no design decision behind them. The
  store's `apply` takes no documents, so this was the best a stored value allowed.
- A `stale` flag on the coverage read: the read admitting the stored value could be wrong.

None of this exists for alignment, which the hub computes on read from `bloomsLevel` and stores
nowhere. The asymmetry had no justification beyond ADR-0007's date.

Three questions settle it. Is coverage inherent in the structure? Its inputs are: placements,
assessments, modules, `assesses`, statuses, all in the graph and reconstructible at any commit.
The verdict is a reading of that structure, not part of it. Does the reading depend on who reads?
Yes: "fully assessed at two items" is a judgment, a psychometrician, a program manager and an
authoring hint want different cuts, and candidate ADR-0043 already imagines several coverage
models coexisting, which one stored enum cannot serve. Does the hub still need to compute it? Yes,
by plan principle P4: plugins must not each reimplement coverage. P4 says the hub exposes these
computations as read endpoints. It does not say it stores them.

The version-control model makes the case decisive. A derived value stored in a versioned graph
conflicts on merge whenever two branches derive it differently, even when nothing they decided
conflicts. Storing what people decided and what was observed, and deriving the rest at the ref
being read, is the only shape that merges without machinery.

## Decision

### 1. The graph stores decisions and observations; coverage is derived at read time

`ModuleObjective` carries design intent only: `role`, `roleRationale`, `sequence`, and its two
ends. `coverageStatus` and `projectedCoverageStatus` are removed from the schema, along with the
`CoverageStatus` enum and the `@metadata.armature.computed` list. The generator's support for
computed fields is removed with them; no class declares one.

The same rule applies to every future derived quantity: alignment scores, redundancy, difficulty
summaries. The hub stores the relation and the attributes a person assigned, and computes a score
on read. A score that someone wants to be a matter of record is a human judgment, and it is
recorded as a `DesignFinding`, or as an Attestation once ADR-0028 lands, with a person's name and
reason on it.

### 2. The coverage read is the product, and it returns the counts

`GET /api/v1/intelligence/coverage/:moduleId` computes coverage from the graph at the requested
ref with the algorithm of ADR-0029 decisions 1 to 3: the distinct items placed in the module's
assessments that assess each declared objective, counted twice, once over Approved items with
Approved placements and once over everything not Retired. For each declaration it returns both
counts and both default verdicts, and the items behind them. The thresholds are optional query
parameters, `fullyAssessedAt` (default 2) and `overAssessedAbove` (default 4), echoed in the
response, so a client or a researcher applies its own cut and the default stays a default. A
course-wide form, `GET /api/v1/intelligence/coverage?course=`, returns every module's
declarations the same way, which replaces the list filter the stored field used to allow.

Because every read is at a ref (ADR-0025 decision 3), coverage at any past commit is the same
read with `ref=`. Nothing is stored and nothing goes stale.

### 3. The write pipeline and the merge route know nothing about coverage

The pre-commit recompute, its trigger rules and the merge-route recompute are removed. A write
commits the caller's documents and, where ADR-0032 requires it, the carried `User` copy, and
nothing else. A merge is the store's `apply` and its conflict report, and nothing else.
CLAUDE.md constraint 7 is restated: coverage is computed on read by the intelligence routes and
never stored; there is nothing for a write to recompute.

### 4. What the stored field was carrying for Narrative 1 moves to a design fact

The one thing a stored verdict answered that a read at `main` does not is "was coverage adequate
when this cohort took the assessment". That needs the commit the assessment was administered
from. It is a fact about the administration, not a derived value, and it belongs on the record of
the administration. ADR-0057 proposes `asOf` on `LearningDataset` and on the other records that
describe or judge a state of the graph; with it, coverage at delivery is the coverage read at
`ref=<asOf>`.

## Consequences

**Positive**

- `ModuleObjective` is a design record and nothing else; ADR-0007's "double duty" ends.
- No derived value can be stale, wrong by an old threshold, or in conflict on merge. The merge
  route is the store's three-way merge again, with no follow-on commits.
- A researcher who wants a defensible coverage formula applies it to the counts the read returns,
  or to the structure, and cites the formula. The hub's default is one formula among possible
  ones, which is what a provisional threshold should be.
- The generator loses a mechanism; the write pipeline loses a step; the seed loses an import.
  Less code is carrying the same intelligence.

**Negative**

- Coverage is computed per request: a handful of reads per module at demo scale, and the place
  to add a WOQL query over the adapter when a course outgrows that. A course-wide read over many
  modules is the first thing to watch.
- `GET /documents/ModuleObjective?coverageStatus=Uncovered` no longer exists. The course-wide
  coverage read is its replacement.
- Coverage at the time of an administration is not answerable until ADR-0057 lands.
- Removing two required fields and an enum is a breaking schema change at demo scale:
  `load_schema.js --clear-instances` then `seed_data.js`. In a deployment with data, the
  migration endpoint drops the fields.
- Platform check Z, which verified the restore-then-apply sequence the merge resolution relied
  on, stays in `scripts/platform_checks.js` as a verified fact about `apply` that nothing now
  uses.

**Neutral**

- ADR-0029's algorithm, eligibility rules and thresholds are unchanged; they moved from a write to
  a read.
- ADR-0019's two figures are unchanged; the gap between them is still the review backlog, now as
  two outputs of one read.

## Related

- ADR-0007 — `ModuleObjective` as programmatic junction; its computed-field decision is superseded
- ADR-0019 — eligibility by readiness; its two populations are kept as read outputs
- ADR-0025 — reads at a ref are what make stored verdicts unnecessary
- ADR-0029 — the algorithm, kept (decisions 1 to 3); the storage machinery, superseded (4 to 6)
- ADR-0057 — `asOf` on records that refer to a state of the graph
- Candidate ADR-0043 — alignment models as competing hypotheses; now compatible with the hub
- Plan principle P4 — the hub computes design intelligence and exposes it as reads
