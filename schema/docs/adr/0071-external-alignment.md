# ADR-0071: External Alignment: A Relationship Record From an Objective to an Item in an Outside Framework

> **In brief.** This decision answers: when a designer says that a learning objective teaches a
> standard in an outside framework (a state standard, an accreditor's competency, a professional
> framework), where does that claim live, and how is it reviewed and kept current? It proposes a
> new relationship record, `ExternalAlignment`, that links one objective to one item in another
> framework by that framework's identifier, with how strong the match is, why, and a fingerprint of
> the item's wording. Because the alignment is its own record, an expert can affirm it, the
> affirmation goes out of date only when that alignment or the framework's wording changes, and
> anyone can ask which objectives, in any course, teach a given standard. The framework itself is
> never copied into the graph: by default only its identifiers and a fingerprint of each statement
> are stored, and the statement text only where the framework's license allows. Proposed on
> 12 November 2026; nothing is built.

## Status

Proposed (2026-11-12, drafted from `docs/crosswalk-plan.md`). Not accepted and not built. Adopts
candidate ADR-0042 (`docs/research/adr-candidates.md`, "Local structure and external alignment as
separate classes") at a new number, for external alignment only; its local-structure half is not
decided here. It changes the schema, adding one class and two enums, so on acceptance it is
implemented with `schema.json`, the generated types and the appendix in one commit (CLAUDE.md,
"After schema changes"), after the platform checks under Verification have run.

On acceptance it would annotate, with dated notes:

- **ADR-0030**, whose Open section waits on "the curriculum mapper" for a graded relation and for
  more about the external record (framework version, change date, retrieval date, statement
  snapshot): both are answered here, on a new record rather than on `ExternalRef` (decision 4).
  Decision 2's meaning of an `ExternalRef` is sharpened by decision 4's rule.
- **ADR-0028**, whose decision 7 (staleness is a read) applies unchanged to the new type; the
  dated note records that the alignment, not the objective, is the judged subject for an alignment
  verdict (decision 7).
- **ADR-0027**: one more `relationship` class.

## Context

### The client

The development plan's reference client "objective and curriculum mapper" (`docs/development-plan.md`
§2: "link to CASE competencies") is now proposed as Crosswalk (`docs/crosswalk-plan.md`;
`docs/demo-coverage.md`: "Objectives mapped to a standards framework, affirmed by an SME, and where
else each standard is taught"). ADR-0028 and ADR-0030 both name this client as their second user.
Its three jobs are to record mappings, to have a subject-matter expert (SME) affirm each one, and to
answer, from the graph, which standards a course evidences and where else each is taught.

### Why `ExternalRef` cannot carry an alignment

ADR-0030 gave every artifact a set of `ExternalRef` subdocuments (`system`, `identifier`, `label`),
and the seed already places a fictional CASE item on `distinguish-bias-types` that way. Used for
alignment claims, the embedded shape fails in three places:

1. **Affirmation goes stale when nothing it judged changed.** An attestation's subject is one
   `DesignRecord`, optionally a fragment (ADR-0028 decision 1). An `ExternalRef` has no identity and
   is not a fragment (ADR-0030 decision 5), so an SME's verdict on "LO-3 aligns with item X" has to
   name the objective as its subject. The staleness read compares the whole subject at `asOf` and at
   the ref (ADR-0028 decision 7), and ADR-0030 decision 4 showed that the comparison sees changes
   inside nested subdocuments. Adding a second alignment to LO-3 therefore makes every earlier
   verdict on LO-3 `Stale`, for every alignment it carries. Check AR (Verification) demonstrates it.
2. **No reverse lookup.** "Which objectives align with item X" is a filter on an embedded part,
   which the list route refuses (`docs/api.md`: "A filter ... on an embedded part: 400
   `unknown_field`"). A client would read every objective at the ref and scan.
3. **No starting point for a trace.** The trace route starts at a record; an `ExternalRef` is not
   one.

### What the research recommends

`docs/research/learning-data-standards-precedents.md`, "Relations and alignment as fallible,
competing claims", surveyed CASE, SKOS, ASN and CTDL-ASN, CaSS, Wikidata and LRMI, and recommended:
keep local structure and external mapping in different classes (CASE mixes `isChildOf` and
`exactMatchOf` in one enum; SKOS separates them); grade strength (only 542 of 5,175 validated
ESCO–O\*NET matches were exact), with only an exact match ever chaining; record who asserted an
alignment and how, not a bare edge; snapshot the item's statement, because CASE edits wording under
the same identifier; treat `replacedBy` as a migration signal with ESCO's three choices. It also
found that fine-grained alignments are unreliable (kappa ≈ .56 on 57 fine topics against ≈ .72 on
10 broad ones), so an alignment's strength and grain should be visible to every reader.

### Copyright

Many frameworks are copyrighted, and their licenses vary from open (Creative Commons) to
restrictive. A framework's identifiers and codes, and a designer's claim that an objective aligns
with an item, are not the publisher's expression; the statement text, and the framework as a
collected whole, are. A schema that requires the statement text would force some deployments to
copy what their license forbids, and every export would carry it on. Change detection does not need
the text: a fingerprint of it detects a changed statement exactly.

### Why this is the hub's and not the plugin's

Development Principle 5 asks whether something is graph infrastructure or a tool's experience. The
alignment is a design relation between a record in the graph and a record outside it, the case P6
names. It has to be a `DesignRecord` for an attestation to name it, a trace to start from it and an
export to carry it, and other clients read it with no Crosswalk code: a linter rule over alignments,
a projection for an accreditor, Whyfinder's chain of reasons, the Structure analyzer, the viewer.
Candidate ADR-0040's plugin-owned extensions, the one middle path, are not built. Everything about
the outside framework (fetching it, browsing its hierarchy, polling it for changes, the mapping
workflow, rolling evidence up by strand) stays in the plugin (decision 10).

## Decision

### 1. `ExternalAlignment` is a relationship record

`ExternalAlignment` inherits `DesignRecord` directly, like `Attestation`, with
`@metadata.armature.category: "relationship"` (ADR-0027). It carries no `label`, `description` or
`createdBy` of its own; its author is the commit's (ADR-0025, ADR-0032). Being a `DesignRecord`, it
can be the subject of a note, a finding or an attestation with no further schema.

| Field | Type | Meaning |
|---|---|---|
| `objective` | `LearningObjective` | The objective that aligns (decision 5) |
| `system` | `ExternalSystem` | The kind of outside system, as for `ExternalRef` (CASE, CTDL, Other, ...) |
| `identifier` | `xsd:string` | The outside item's identifier as that system writes it: a URI where it has one (a CASE `CFItem` URI), otherwise a stable string the writing tool mints |
| `framework` | `xsd:string` | The framework the item belongs to, by its identifier (a CASE `CFDocument` URI) |
| `frameworkVersion` | `Optional<xsd:string>` | The framework's version as its publisher names it |
| `statementCode` | `Optional<xsd:string>` | The item's human-readable code (`AI-ETH.2.1`), CASE's `humanCodingScheme` |
| `statementHash` | `Optional<xsd:string>` | A fingerprint of the item's normalized statement (decision 3) |
| `hashAlgorithm` | `Optional<xsd:string>` | The IANA Named Information Hash Algorithm name for `statementHash`, as for `Attachment` |
| `statementText` | `Optional<xsd:string>` | The item's statement as retrieved, only where the framework's license allows (decision 3) |
| `gloss` | `Optional<xsd:string>` | The item summarized in the mapper's own words, so a reader without the framework can follow the alignment |
| `sourceChangedAt` | `Optional<xsd:dateTime>` | The item's last change date as the source reports it (CASE `lastChangeDateTime`) |
| `retrievedAt` | `xsd:dateTime` | When the writing tool read the item |
| `strength` | `AlignmentStrength` | How closely the objective matches the item (decision 2) |
| `confidence` | `Optional<ConfidenceLevel>` | How sure the mapper is, reusing the existing enum |
| `rationale` | `Optional<xsd:string>` | Why, in the mapper's words; free text (ADR-0010) |
| `status` | `AlignmentStatus` | `Proposed`, `Active` or `Retired` (decision 6) |
| `replacedBy` | `Optional<ExternalAlignment>` | The alignment that replaced this one when the item was replaced or retargeted (decision 6) |

`@key: { "@type": "Hash", "@fields": ["objective", "system", "identifier"] }`. One alignment per
objective per outside item; a second write with the same three values is a replace (ADR-0024
decision 3), so a retried push is idempotent. None of the three is mutable: retargeting to another
item is a new record. A client never supplies the `@id` (ADR-0024 decision 1); in a batch it reaches
one by `@capture` and `@ref` (`docs/schema-guide.md` §7).

### 2. Strength is graded, and nothing chains

```json
"AlignmentStrength": ["Exact", "Close", "Broad", "Narrow", "Related"]
```

The values follow SKOS's mapping properties as candidate 0042 proposed: `Exact` (the objective and
the item mean the same), `Close` (near enough to use interchangeably for this course's purposes),
`Broad` (the item is broader than the objective), `Narrow` (the item is narrower), `Related`
(associated, not a match). CTDL-ASN's `major`, `minor` and `prerequisite` are left out until a
framework or a client uses them. The hub infers nothing from strength: no transitive alignment, not
even through `Exact`, and no alignment between two outside items. Each value's export term (SKOS
`exactMatch`, `closeMatch`, `broadMatch`, `narrowMatch`, `relatedMatch`) is recorded in the enum's
`@documentation`, ready for the relation-type registry the precedents research proposes as an extension of ADR-0027.

### 3. The statement is fingerprinted, its text stored only where allowed

**Constraint 25:** an `ExternalAlignment` carries `statementText` or `statementHash`, or both
(422 `alignment_without_statement`). `statementHash` and `hashAlgorithm` are present together
(422 `hash_incomplete`), and `statementHash` is checked as constraint 18 checks `contentHash`
(`hash_malformed` for an algorithm the hub knows).

- **The hash** is computed by the writing tool over the statement normalized as: Unicode NFC,
  every run of whitespace replaced by one space, leading and trailing whitespace removed, encoded as
  UTF-8. No case folding: a change of case can be a change of meaning in a code or a name. The
  normalization is part of this decision, so two tools hash the same statement alike and a
  publisher's reformatting raises no false change. The hub checks the shape, never the hash against
  the text, as for attachments (ADR-0030 decision 7).
- **The text** is stored only when the writing tool's policy for that framework allows it. The
  policy is the plugin's (decision 10); the schema only makes the text optional and the
  fingerprint sufficient.
- **The gloss** is the mapper's own words and is theirs to store. It is not a substitute for the
  fingerprint, since it does not change when the publisher's wording does.

Refreshing the hash or the text after the framework changes is a change to the alignment, so every
attestation on it reads `Stale` (decision 7): exactly the alignments whose wording moved go back to
review, and no others.

### 4. `ExternalRef` names the same thing; `ExternalAlignment` claims a relation to a different thing

The two are not alternatives for one purpose:

- An **`ExternalRef`** says "this record *is* that record in another system": the objective's id in
  a Torus project, an item's QTI source, a dataset's xAPI statements (ADR-0030 decision 2, ADR-0063).
  It carries no strength and no judgment.
- An **`ExternalAlignment`** says "this objective *relates to* that item in another framework, this
  closely, for this reason": a claim someone can affirm or decline.

A tool writing an alignment claim writes an `ExternalAlignment`, never an `ExternalRef`. The seed's
CASE `ExternalRef` on `distinguish-bias-types` is such a claim and becomes an `ExternalAlignment`
when this decision is implemented. The hub does not refuse an `ExternalRef` with `system: "CASE"`,
since some are identity references; a linter rule can flag an `ExternalRef` whose identifier also
appears as an alignment of the same objective.

### 5. The aligned record is an objective

`objective` is typed `LearningObjective`. Objectives are what the course claims to teach, and what
coverage, alignment and Narrative 1 already read. A knowledge component (`docs/knowledge-components-plan.md`)
or a course are plausible later subjects; ADR-0010 says wait for the client. Widening the field to
`DesignRecord`, or adding a second optional field, is an additive or weakening change
`load_schema.js` applies in place. Items do not align to outside frameworks directly: items assess
objectives and objectives align outward, so the chain cannot disagree with itself.

### 6. Alignments retire, never vanish

```json
"AlignmentStatus": ["Proposed", "Active", "Retired"]
```

`Proposed` is a mapper's draft, not yet affirmed; `Active` is in force; `Retired` is no longer
claimed (ADR-0024: tools change status, they do not delete). Reads that answer "what does this
course claim" count `Active` only; the status carries no further hub behavior.

`replacedBy` records a retarget, ESCO's second migration choice: when an outside item is replaced
or a mapper decides another item fits better, a new alignment is written and the old one is retired
pointing at it. **Constraint 26:** a `replacedBy` names an alignment of the same objective
(422 `replacement_objective_mismatch`), and an alignment with `replacedBy` is `Retired`
(422 `replaced_not_retired`). The three choices themselves (refresh the fingerprint, retarget,
retire) are the plugin's workflow; each is an ordinary write with an author and a reason.

### 7. Verdicts on an alignment use `Attestation` unchanged

An SME's verdict on an alignment is an `Attestation` whose `subject` is the `ExternalAlignment`.
Since the record is the claim, a claimless endorsement (ADR-0028 decision 2) is enough; a tool may
add a `claimRef` when the verdict is about one aspect, such as the strength. Staleness is ADR-0028
decision 7's read with no change: the judged state is the alignment's, so adding another alignment
to the objective stales nothing (check AR).

**A change to the objective does not stale a verdict on its alignment**, because the objective is a
reference from the alignment, not part of it. A reader that wants to know whether the objective
changed after the verdict reads the objective at the attestation's `asOf` and at the ref, two
ordinary reads at commits. Folding the referenced objective into the staleness read for this type
was considered and deferred (§Alternatives): it would make one relationship type compare across a
reference, a precedent every junction would then inherit, and the client case has not yet shown
which changes to an objective should reopen review (a typo fix should not).

**No guidance about text in claims.** A tool that writes a `claimText` decides what wording goes in
it; one that must not store a framework's statements writes claims in terms of the code.

### 8. Reads

- **Lists.** `GET /api/v1/documents/ExternalAlignment` takes filters on `objective`, `system`,
  `identifier`, `framework` and `status`. All five are required and single-valued, so the store
  applies them (`docs/api.md`, list reads). "Which objectives, in any course of this store, align
  with item X" is `?identifier=`; "everything aligned to this framework" is `?framework=`.
- **Trace.** The trace route accepts an `ExternalAlignment` as a starting record and walks to the
  objective, then as it already does from an objective, with each alignment's attestations as
  context (ADR-0028 decision 7).
- **Export.** The class is included wherever its objectives are in `slices.json`; the export needs
  no plugin code to be read (ADR-0031). The text policy means an export carries statement text only
  where the writing tool stored it.
- **No new intelligence read.** Rolling alignments up by a framework's hierarchy needs the
  hierarchy, which the hub does not hold (decision 10). A standards read, or a path read
  (SESSION.md What's Next item 18), is added only when a second client needs the same roll-up, and
  then takes the hierarchy as input rather than fetching it.

### 9. Contract

A dated entry in `docs/client-changes.md` and a revision in `REVISIONS`: a new type a client may
meet in exports, traces and attestation subjects, and the seed change of decision 4. No new
capability: the generic document routes, the trace route and the attestation read already carry
their capabilities (ADR-0059).

### 10. The hub knows nothing about outside frameworks

The hub never fetches a framework, never parses CASE or CTDL, never stores a framework's hierarchy
and never verifies a hash against a source. `framework`, `identifier` and `statementCode` are
opaque strings to it. A field that only one framework standard would fill does not belong on this
record; it belongs in the writing tool. This is the line Development Principle 5 draws, and it keeps
a CASE consumer from growing inside the hub.

### 11. The two-client test, stated

One client writes alignments today: Crosswalk. The test is met by readers. An alignment's value is
in being read by tools that do not write it: a linter rule (`docs/lint-plan.md`), a projection for
an accreditor, Whyfinder's chain of reasons, the Structure analyzer, the viewer, and an export
handed to another institution. ADR-0030 counted its reference clients the same way. The test exists
to keep one tool's workflow out of the hub; this record carries no workflow (decision 10), so the
risk the test guards against is absent. The likeliest second writers are a Torus bridge, if Torus
projects carry standards alignments, and an importer for a publisher's pre-aligned item bank.

## Alternatives considered

- **`ExternalRef` on the objective, verdicts as attestations on the objective with a `claimRef` per
  alignment.** No schema change beyond ADR-0030's open fields. Rejected: every alignment change
  stales every verdict on the objective (check AR), the reverse lookup is a scan, and a trace has
  nowhere to start. It remains what a client can do on a hub without this decision.
- **A client-assigned identifier on `ExternalRef`, treated as a part so an attestation can name it.**
  Exact staleness with the existing shape. Rejected: it reverses ADR-0030 decision 5 and stretches
  `fragment` past ADR-0027's meaning (a part of an artifact's content), and the reverse lookup is
  still a filter on an embedded part.
- **A graded `relation` enum on `ExternalRef`** (ADR-0030's own open item). Rejected for alignment
  claims: it leaves the claim embedded, with all three failures. It could still serve identity
  references that need a relation, if one ever does.
- **A named crosswalk document grouping alignments** (the research's "crosswalks as named
  documents"; candidate ADR-0043's `AlignmentModel`). Deferred: a mapping round is a branch and a
  framework, which is enough until two competing alignments of one course must coexist on `main`
  (a program's and an accreditor's). It would add records beside this one, not replace it, as the
  knowledge-components plan's stage 9 argues for `assesses`.
- **Alignment data in the plugin's own store, the graph holding nothing.** Rejected: alignments
  could not be attested, traced or exported, and every reader would depend on Crosswalk (§Context,
  "Why this is the hub's").
- **A plugin-owned extension** (candidate ADR-0040). Not available: the extension model is not
  built, and an alignment read by five other clients is the kind of data that model would promote
  into the schema anyway.
- **`statementText` required** (the research's "a snapshot of the statement text"). Rejected for
  the copyright reason in §Context; the fingerprint keeps the change detection the snapshot was
  for.
- **The referenced objective folded into the staleness read for this type.** Deferred (decision 7).
- **Subject typed `DesignRecord` now.** Deferred (decision 5); ADR-0010.

## Verification

To run before acceptance, as checks in `scripts/platform_checks.js`:

| Check | What it must show |
|---|---|
| AR1 | Through the API on the seed: an objective carrying one `ExternalRef` and an attestation about it, with `asOf` at that state; a second `ExternalRef` added; the attestations read reports the attestation `Stale`. The motivating case, demonstrated rather than inferred |
| AR2 | `GET /documents/LearningObjective?externalRefs.identifier=...` is 400 `unknown_field` (confirms `docs/api.md`) |
| AS1 | A Hash-keyed class whose key includes an enum field and a string field holding a URI (with `/`, `:` and `#`) round-trips through the store, and the id the store mints is the id check AI's formula computes, so the file-backed store (ADR-0066) mints the same one |
| AS2 | A filter on a required `xsd:string` field of such a class is applied by the store, not the hub (check Y's distinction) |
| AS3 | A replace with an unchanged key and a changed `statementHash` changes the record, and an attestation on it reads `Stale`; a second alignment of the same objective leaves it `Current` |

## Consequences

**Positive**

- An SME's verdict goes stale when, and only when, that alignment or the framework's wording
  changes.
- "Which objectives teach this standard" is one filtered read in a store, and the same read against
  each of several hubs.
- A trace can start at a standard's alignment and reach items and metrics, extending Narrative 1
  one step outward.
- Copyrighted frameworks can be aligned to without their text entering the graph or its exports.
- ADR-0030's open items find a home without loading `ExternalRef` with fields only alignments need.

**Negative**

- A new type every reader may meet, two enums, and two more constraints.
- Two ways to point outward (`ExternalRef` and `ExternalAlignment`), held apart by a rule (decision
  4) rather than by the schema.
- A change of meaning in an objective does not reopen review of its alignments by itself
  (decision 7); a client has to look.
- With only the fingerprint stored, a reader without access to the framework sees a code and the
  mapper's gloss, not the statement.

**Neutral**

- The seed gains alignments and loses one `ExternalRef`; tests that read the seed's
  `externalRefs` change with it.
- Strength is recorded but drives no hub behavior.

## Open

- **Which changes to an objective should reopen review of its alignments**, and whether the
  staleness read should then compare across the reference (decision 7).
- **A second subject type** (a knowledge component), when that plan's stage 4 is built.
- **A named crosswalk or alignment model**, when two alignments of one course must coexist on
  `main` (candidate ADR-0043).
- **A standards roll-up or path read**, when a second client needs Crosswalk's evidence table.
- **More `ExternalSystem` values** (`CTDL`; a value for tool-minted local frameworks), as adapters
  arrive.
- **The relation-type registry** the precedents research proposes as an extension of ADR-0027,
  which would hold the strength values' export terms as data.

## Related

- ADR-0002, ADR-0003, ADR-0004 — references and junctions; this is a junction toward the outside
- ADR-0010 — `rationale` and `gloss` as text; the subject kept narrow
- ADR-0021 — the alignment read takes no filter by person
- ADR-0024 — identifiers, replace, status instead of delete
- ADR-0027 — a `relationship` class
- ADR-0028 — the verdicts on an alignment; annotated on acceptance
- ADR-0030 — `ExternalRef` and `Attachment`; its open items answered here; annotated on acceptance
- ADR-0031 — export slices and profiles
- ADR-0057 — `asOf`, which lets a client compare the objective at a verdict's commit
- ADR-0066 — the file-backed store's Hash ids (check AS1)
- ADR-0070 (proposed) — a required check over alignments is a plugin's verdict, not hub logic
- Candidate ADR-0042 — adopted here for external alignment; candidates 0040, 0043, 0044
- `docs/crosswalk-plan.md` — the client and its build order
- `docs/research/learning-data-standards-precedents.md` — the precedents
