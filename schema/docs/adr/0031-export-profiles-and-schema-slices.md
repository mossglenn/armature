# ADR-0031: Export Profiles and Schema Slices

> **In brief.** This decision answers: how does a whole design, or a chosen part of it, leave
> Armature as one file that another system or a researcher can use? The answer is an export route
> that returns the graph exactly as it stood at one commit, together with the schema it obeys, in
> the database's own JSON-LD shape (JSON for Linked Data). A *profile* says what happens to the
> people in it: kept as they are, replaced by stable opaque tokens, or reduced to their
> institution. A *slice* says which kinds of record are included, and slices are a small
> configuration file rather than code. A full export loaded into an empty database reproduces the
> graph. It still holds.

## Status

Accepted and implemented (2026-10-20). Written in Phase 6 of `docs/development-plan.md`, which
reserved the number. Implements the export-time anonymization ADR-0021's deferred section
anticipated; ADR-0021 carries a dated note. Verified by `scripts/platform_checks.js` check AE
(§Verification). Formats beyond JSON-LD are not offered (§Alternatives).

## Context

The position paper's §5 and §6 (plan principles P7 and P8) want learning scientists to adopt
Armature data-first: stand up a constrained instance for one study, collect, and export a
comparable, anonymized corpus. ADR-0021 decided that Armature never models practitioner
performance, and deferred the question of what a graph looks like when it leaves the deployment it
was made in: `User` documents travel with the graph for interpretability (ADR-0015), which is right
for handing a course to another institution and wrong for a research corpus. Its deferred section
named the answer, "anonymization is a property of an export mode, not of the graph", and two
candidate modes: pseudonymization with stable tokens, and institution-only attribution, "the
cheapest option" because it reuses a field that already exists.

Nothing could yet leave the hub as a whole. Every read is one document, one type, or one
intelligence question at a ref. The research exporter and the text2qti exporter plugin (plan §8,
decided 2026-10-20) both need the graph at a commit in one piece, and the exit criterion the plan
set for this phase is that an export at a commit, re-imported into an empty database, reproduces
the graph.

The precedents survey (`docs/research/schema-precedents-and-plugin-candidates.md`, Part 1 §A)
named the vocabularies an export could speak so that other tools read it: the W3C Web Annotation
Data Model for notes, findings and attestations, PROV-O for provenance, and LRMI `AlignmentObject`
for `assesses` and `targets`.

Four store facts shape the design (check AE): the schema graph is readable at a commit (AE1);
every instance document at a commit comes back in one read when no type is given (AE2); a branch
created with no origin is empty, with an empty schema graph (AE3, AE4); and the schema the store
returns is not the schema it accepts, because it decorates every `Set` with
`@max_cardinality: "inf"` and then refuses that as a bad cast (AE5). Once that decoration is
removed, the schema loads into the empty branch and every exported document posts back in one
request with its identifiers, Hash-keyed records and nested subdocument ids included, and the two
states compare equal (AE5 to AE7).

## Decision

### 1. One route, the graph at a ref

`GET /api/v1/export?branch=|ref=&profile=&slice=` returns one JSON document:

```json
{
  "@context": { "@type": "@context", "@base": "…", "@schema": "…" },
  "armature": { "ref": "<commit>", "profile": "full", "slice": "full", "pseudonyms": "none",
                "counts": { "documents": 49, "byType": { "AssessmentItem": 6, "…": 0 } },
                "unresolved": [] },
  "schema":    [ "…the schema graph at the ref, as it can be reloaded…" ],
  "documents": [ "…every document of the slice, under the profile…" ]
}
```

The `ETag` is the commit exported, and `armature.ref` repeats it so the file carries its own pin
(ADR-0025: a commit id stays valid because history is never rewritten). The documents are the
store's native shape, unchanged: `@id`, `@type`, the fields as stored, subdocuments inline. The
schema is the schema graph at the same ref with the store's `@max_cardinality: "inf"` decoration
removed (`normalizeSchema`, AE5), so the file is self-describing and reloadable. `GET
/api/v1/export/slices` returns the slice configuration. The route reads only: an export is a
read at a ref like any other, and carries nothing about history (§Open).

### 2. Slices are configuration

A slice is a named list of class names in `app/lib/api/export/slices.json`, with a description. A
document is in a slice when its type is one of the names or inherits one (`CLASS_ANCESTORS`), so
`full` is the two names `DesignRecord` and `User`. Two more ship as examples of what a study would
declare: `outcomes-loop`, the paper's needs-to-objectives-to-outcomes path (evidence, needs,
objectives, prerequisites, items, placements, assessments, modules and their declarations, the
course, datasets, metrics, users), and `review` (items with the findings, notes and attestations
about them). A slice that a study needs is a new entry, not code.

A slice is not closed under references, because a `DesignRecord`-typed field (a metric's
`subject`, a note's `subject`) can name any record. The export reports every reference from a
document in it to a document not in it as `armature.unresolved` (`{ id, field, target }`), and
drops nothing: a record is exported whole or not at all. A slice with unresolved references will
not re-import, which is the correct outcome: a slice is for analysis, the full profile is for
reproduction.

### 3. Three profiles

- **`full`.** People as stored. For reuse by another institution, where ADR-0015's
  interpretability is the point.
- **`pseudonymous`.** Every `User` becomes `{ "@id": "User/<token>", "@type": "User",
  "externalId": "<token>" }` and nothing else; every reference to a user (`createdBy`,
  `attestedBy`, any later field whose target is `User`, found in the generated field map as
  ADR-0021's guard finds them) is rewritten to the token's id. The token is the first 32
  hexadecimal digits of an HMAC-SHA256 (a keyed hash) of the `User` id under a key.
- **`institutional`.** The pseudonymous profile plus `institution` on each `User`: "verified by an
  expert at Memorial Health" keeps the warrant and drops the person (ADR-0021).

The key is `ARMATURE_EXPORT_KEY`, a deployment setting. With it, the same person has the same token
in every export of that deployment, so a corpus can be compared across time;
`armature.pseudonyms` says `stable`. Without it, a random key is minted for the one export and
`pseudonyms` says `per-export`, so the default deployment still produces a valid anonymized file
and the reader knows the tokens do not carry over. The key never appears in an export.

The profiles rewrite `User` documents and references only. Free text (a rationale, a finding, a
commit message) is not scrubbed, and ADR-0021's caveat stands: with three designers on a course a
pseudonym is re-identifiable from context. A profile is a floor, not a guarantee.

### 4. Re-import is an operator action

The plugin API has no import route, and cannot: the write pipeline sets `createdBy` and
`attestedBy` from the caller's identity, fills or checks `asOf` against commits the target
database holds, and applies every rule, all of which a faithful reproduction must bypass.
Re-import is therefore the operator's work (ADR-0062): load the exported `schema` into an empty
database or branch, then post the exported `documents` in one request. The adapter carries the
three operator-side methods this needs (`createEmptyBranch`, `replaceSchema`, `insertDocuments`),
with no route over them, and the reproduction test uses them as the operator would. The exported
`asOf` values keep naming commits of the source deployment, which the file's `armature.ref` is one
of; a reproduced graph is a copy of a state, not a continuation of a history.

### 5. JSON-LD, the store's shape, no other format

The export is the store's JSON-LD with the store's `@context`. Turtle and RDF/XML, which the
documentation lists under enterprise pages, are not promised; nothing was verified on the
open-source build and no client has asked. The vocabulary alignments the survey named (Web
Annotation for `{ subject, fragmentId, asOf }`, PROV-O for `createdBy`, LRMI `AlignmentObject`
for `assesses` and `targets`) are recorded here as the mapping an export *reader* applies, and
not written into the `@context`: changing a field's IRI would change what the store reads back on
re-import (decision 4), and no consumer has yet validated the mapping (§Open).

## Alternatives considered

- **An import route on the plugin API.** Rejected (decision 4): it would have to skip identity,
  `asOf` and every rule, which is exactly what ADR-0062 keeps off `/api/v1`.
- **Closure of a slice under references** (follow every reference out of the slice and include
  the target). Rejected: everything in the graph connects, so closure returns the whole graph for
  any useful slice. Reporting the dangling references is honest and cheap.
- **A random token per export always.** Rejected: a research corpus compared across two exports
  of one deployment needs the same person to be the same token; the key makes that a deployment
  choice, and its absence is reported rather than silent.
- **Scrubbing free text.** Declined: no reliable way, and a false sense of safety is worse than a
  stated limit.
- **Other serializations now.** Declined until a consumer asks and the open-source build is
  verified to produce them.
- **A `@context` mapped to PROV-O, Web Annotation and LRMI.** Deferred (decision 5).

## Verification

`scripts/platform_checks.js` check AE, run 2026-10-20 against `terminusdb/terminusdb-server:v12.0.7`:

| Check | Result | Evidence |
|---|---|---|
| AE1 | PASS | The schema graph is readable at a commit path, `@context` included |
| AE2 | PASS | Every instance document at a commit comes back in one read with no type given |
| AE3, AE4 | PASS, INFO | A branch created with no origin is empty: no documents, a schema graph of one entry |
| AE5a | INFO | The schema exactly as the store returns it does not load: 400 `api:BadCast` on `@max_cardinality: "inf"` |
| AE5 | PASS | With that decoration dropped the schema loads into the empty branch |
| AE6 | PASS | Every exported document posts back in one request with its `@id`, Hash-keyed records and nested subdocument ids included |
| AE7 | PASS | The two states compare equal once nested `@id`s are removed |

The integration tests in `app/lib/api/export.test.ts` walk the exit criterion against the seed:
a full export at a commit, loaded into an empty branch through the adapter, exports again as the
same graph; the pseudonymous export contains no `displayName`, `email` or original user id, and the
same key yields the same tokens.

## Consequences

**Positive**

- The research path is structurally possible (P7, P8): one request yields a self-describing,
  pinned, anonymized corpus; a slice for a study is a configuration entry.
- A course can be handed to another institution as one file that reproduces the graph.
- Exporter plugins (text2qti first) have the whole graph at a commit to read from.
- ADR-0021's deferred question is answered as it anticipated, without touching the schema.

**Negative**

- An export reads every document in one request, which is fine at demo scale and will need paging
  or streaming at deployment scale.
- Pseudonymity is limited to people's documents and references; text is not scrubbed and small
  teams are re-identifiable. Documented in the export's shape (`pseudonyms`) and here.
- The store's returned schema is not its accepted schema; the normalization is one more place the
  hub knows a store quirk (recorded in plan §9).

**Neutral**

- History is not exported. A reproduced graph is a state; its commit log is one commit.
- `ARMATURE_EXPORT_KEY` joins the app's environment table as optional.

## Open

- **A vocabulary-mapped `@context`** (PROV-O, Web Annotation, LRMI) as an alternative
  serialization or a sidecar, once a consumer validates the mapping (decision 5).
- **History in the export** (the commit log, or a range), when the research path asks a question
  about process rather than state.
- **Paging or streaming** when a deployment's graph outgrows one response.
- **A packaging convention** (checksum, the schema revision, a citation) for a research package;
  `docs/research-path.md` is the place to start.

## Related

- ADR-0021 — no practitioner performance data; its deferred section is implemented here
- ADR-0015, ADR-0032 — `User` documents and identity; what the profiles rewrite
- ADR-0025 — the commit id as the pin an export carries
- ADR-0027 — the generated maps the slices and the `User`-field rewrite read
- ADR-0055 — the adapter gains read methods for the export and operator-side methods for re-import
- ADR-0062 (Proposed) — re-import is operator work outside the plugin API
- `docs/development-plan.md` Phase 6, §8 (no format work beyond JSON-LD), §9 (check AE)
- `docs/research/schema-precedents-and-plugin-candidates.md` Part 1 §A — the vocabularies
