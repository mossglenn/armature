# ADR-0030: External References and Attachments

> **In brief.** This decision answers: how does a record in Armature point at things that live
> outside the graph? Two kinds of outside thing matter. An *external reference* names an identifier
> in another system, such as a competency in a CASE framework (Competencies and Academic Standards
> Exchange) or a question in a QTI package (Question and Test Interoperability). An *attachment*
> names bytes, such as an image in a question or a whole tree of files behind a simulation, held in
> a store Armature may or may not operate. Both are small embedded records that point outward, and
> an attachment always carries a content hash (a fingerprint of the bytes) so a reader can tell
> whether what it fetched is what the designer meant. The graph never holds the bytes. It still
> holds.

## Status

Accepted and implemented (2026-10-20). Written in Phase 6 of `docs/development-plan.md`, which
reserved the number. Amends ADR-0025 (externally versioned artifacts, decision 6 below), ADR-0033
(`Fragment.text` becomes optional, as that ADR anticipated) and ADR-0002 (a second embedded
exception). Adds constraints 18 and 19 and rewords constraint 9. Verified by
`scripts/platform_checks.js` check AD (§Verification). The hub-managed attachment endpoints the
plan describes are not built; the tool-managed path is (decision 7).

## Context

The position paper's sixth principle (plan §1 P6) is that Armature references open standards by
identifier rather than competing with or translating between them, and its scope includes
media-bearing items and complex learning objects: "trees of large binaries, edited in place by
several people over many revisions" (plan §3, "Rich artifacts"). The schema had no place for
either. A `LearningObjective` could not say which CASE competency it realizes; an `ItemOption`
could not be a picture; nothing could say "this module was built against revision X of that asset
tree".

ADR-0033 left a hook: `Fragment.text` is required "today" and "becomes `Optional` when attachment
references arrive, so an image or audio fragment can carry no inline text". The plan's Phase 6
section drafted the field list, with the reasoning that the shape must not foreclose versioned
assets: `revision` and `path` belong in it from day one, because a simulation authoring tool must be
able to say "built against revision X" without a schema change, and the content hash is mandatory
because it is what makes a reference an unforgeable coordinate (P3) whatever the backend.

The precedents survey of 2026-10-20 (`docs/research/schema-precedents-and-plugin-candidates.md`,
Part 1 §B) named vocabularies to borrow rather than invent: CTDL-ASN's graded alignment terms
(exact, broad, narrow, major, minor, prerequisite) if a reference is ever given a *relation* to what
it points at, and CaSS's competency relations as the set designers will ask for next. Three
independent content-addressed designs (Lore, bitchain, Armature's own `fragmentId`) separate a
stable slot identity from the content that fills it (plan §6), which is the same split as
`fragmentId` plus an attachment reference.

Reference clients that need this (PROJECT_CONTEXT): the objective and curriculum mapper (CASE
references), the outcomes importer (xAPI and QTI references), the rich item authoring tool
(attachment references on fragments; impact when an image changes), the course builder (its
source commit stamped into a package) and the complex learning object designer (references to a
revision of an asset tree, with hash and reason). The two-client test is passed several times over.

## Decision

### 1. Two optional subdocument sets on `ArmatureDocument`

```json
"externalRefs": { "@type": "Set", "@class": "ExternalRef" },
"attachments":  { "@type": "Set", "@class": "Attachment" }
```

Every named artifact (everything inheriting `ArmatureDocument`, including `PrerequisiteRecord`)
can carry both. The pure junctions (`ItemInstance`, `ModuleObjective`, the link records) do not: no
client has shown an external alignment of a *relationship*, and ADR-0010 says to wait for one. Both
sets point outward; nothing from the other system is copied into the graph beyond the identifier
and, optionally, a label.

### 2. `ExternalRef`: an identifier in another system

```json
"ExternalRef": {
  "@subdocument": [], "@key": { "@type": "Random" },
  "system": "ExternalSystem",
  "identifier": "xsd:string",
  "label": "Optional<xsd:string>"
}
```

`ExternalSystem` is an enum seeded with `CASE`, `QTI`, `xAPI`, `LTI` and `Other`, extended as
clients arrive. `identifier` is the other system's identifier as that system writes it: a URI where
the system has one (CASE and xAPI do), a string otherwise. `label` is a display convenience, never
the authority. A reference carries no *relation* to its target (exact, broad, narrow); the
reference's meaning is "the other system's record of this thing". When a client needs a graded
alignment, the field is an optional enum beside `identifier`, seeded from CTDL-ASN (§Open).

### 3. `Attachment`: a verifiable coordinate for bytes

```json
"Attachment": {
  "@subdocument": [], "@key": { "@type": "Random" },
  "store": "AttachmentStore",
  "storeUri": "xsd:string",
  "container": "Optional<xsd:string>",
  "revision": "Optional<xsd:string>",
  "path": "Optional<xsd:string>",
  "contentHash": "xsd:string",
  "hashAlgorithm": "xsd:string",
  "mediaType": "Optional<xsd:string>",
  "byteSize": "Optional<xsd:integer>",
  "role": "Optional<xsd:string>",
  "label": "Optional<xsd:string>"
}
```

- `store` is the backend kind, an enum seeded with `S3`, `Lore`, `Git` and `Other`. Naming a kind
  the hub does not operate is allowed; it tells a reader how to interpret the rest.
- `storeUri` says which instance of that store (an endpoint, a bucket URL, a repository URL), so a
  reference survives a deployment with more than one. `container` is the repository, bucket or
  dataset within it when the URI alone does not say.
- `revision` is the store's own immutable version identifier for the state referenced: a Git
  commit, a Lore revision hash, an S3 version id. **Constraint 18:** it is required when `store` is
  a versioned kind (`Git`, `Lore`); a reference to a versioned store without one names no state
  (`revision_required`).
- `path` is the file or subtree within the container at that revision; absent for the whole tree.
- `contentHash` and `hashAlgorithm` are mandatory. For a single file, the file's hash; for a tree,
  the store's root hash for that revision (Lore and Git both expose one). `hashAlgorithm` names an
  entry of the IANA Named Information Hash Algorithm Registry (`sha-256`, `sha-512`, `sha-1`,
  `md5`, and so on), the vocabulary the `ni:` URI scheme and Software Heritage identifiers use, so
  no enum needs extending when a store uses another. **Constraint 18** also checks that
  `contentHash` is lower-case hexadecimal of the length the named algorithm produces, for the
  algorithms the hub knows (`hash_malformed`); an algorithm it does not know is accepted with the
  hash unchecked.
- `mediaType` and `byteSize` are meaningful for single files and optional.
- `role` is free text for what the reference is to the artifact (source, rendered, evidence,
  export), left as text per ADR-0010 until usage shows the categories. `label` is optional.

### 4. Attachments on fragments; `text` becomes optional

`Fragment` gains the same `attachments` set, and `text` becomes `Optional<xsd:string>`, the
weakening ADR-0033 anticipated. An option that is a picture, a stem that is an audio clip, carry an
attachment and no text. **Constraint 19:** a fragment carries text or at least one attachment; one
with neither is `empty_fragment`. Constraint 9 is reworded: option *text, where present,* is unique
within the item (presence is now constraint 19's job), and the correct-option count suits the item
type.

A change to an attachment (a new `contentHash` after an image is re-exported, a new `revision`) is a
change to the fragment that carries it: `fragments.ts` compares parts in a canonical form that
drops the store's nested `@id` at every depth, so the comparison sees the hash change and nothing
else (checks AD6, AD7). An attestation on that part therefore reports `Stale` after the image
changes, exactly as it does after a text edit (ADR-0028). Nothing in the staleness read changed.

### 5. Subdocuments in the `infrastructure` category, with `Random` keys

`ExternalRef` and `Attachment` are `@subdocument` classes with `@key: Random`, like fragments: they
have no identity outside the record that carries them, and their nested store ids regenerate on
every replace (AD6), so nothing may store one. Unlike fragments they carry no `fragmentId` and are
not parts: a note or attestation is about the artifact or the fragment that carries the reference,
never about the reference. Their `@metadata.armature.category` is `infrastructure` (ADR-0027: "not
records of design in themselves"); a fifth category was declined until a reader needs to tell a
coordinate from an abstract root (§Alternatives).

### 6. Externally versioned artifacts (amends ADR-0025)

For an artifact whose bytes live in an asset store, the design process data ADR-0025 promises is
carried by the graph commits that move its `Attachment.revision` or `contentHash`, each with an
author and a reason, plus the asset store's own log, reached through the reference. The graph is a
projection of the asset history, never a replay of it (plan §2): it records the revisions that
mattered to the design, and the store keeps the rest. Branching and merging of design relations
happen only in the graph. The cross-reference convention: a tool that controls the asset store
writes the graph commit id into the asset revision's message when it can, so the two histories
point at each other. The hub never embeds binaries and never serves bytes from a graph document.

### 7. The tool-managed path now; the hub-managed path later

A tool that controls its own store places the reference on the artifact through the ordinary write
path, and the hub checks the shape (Zod) and constraints 18 and 19. The hub does not fetch bytes or
verify hashes in this phase; a reference is a claim the writing tool makes under its own name, and
verification is a read to add when the hub has access to a store. The hub-managed endpoints the
plan describes (`POST /api/v1/attachments` to stream bytes and compute the hash;
`GET /api/v1/attachments/url` for a short-lived fetch URL) and the choice of a hub-operated backend
wait for a reference client with a concrete file to attach (plan §6). Adding a backend then touches
one adapter module, not routes or schema.

## Alternatives considered

- **Blobs in the graph** (base64 in a `sys:JSON` field, or TerminusDB's own file handling).
  Rejected: the paper's "not a content repository"; the store is a graph of decisions, and a
  commit graph that carries images diffs and merges badly.
- **`Attachment` as a document, referenced by id, rather than a subdocument.** ADR-0002 prefers
  references, and a document would make "every artifact using this asset" a reverse lookup. Rejected
  for now: an attachment reference has no identity apart from the artifact that carries it (two
  artifacts naming the same bytes are two references to one content-addressed coordinate, which is
  fine), and the reverse lookup is a scan of attachments by `contentHash` that the impact read can
  do at this scale. If a shared `Asset` record is wanted later, it is a promotion, not a rewrite:
  the subdocument gains a reference to it.
- **A `HashAlgorithm` enum.** Rejected in favor of IANA registry names as a string: Git uses
  `sha-1` and `sha-256`, S3's entity tag is `md5` for simple uploads, Lore uses its own; an enum
  would be extended for every store, and the registry already exists.
- **A `relation` enum on `ExternalRef` now** (CTDL-ASN's graded alignment). Deferred: no client has
  written one; ADR-0010 says add the enum beside the field when usage shows it.
- **A fifth schema category, `reference`.** Declined: every document listing the four categories
  would change, and nothing yet needs to distinguish a coordinate from an abstract root. Revisit
  when a generator or reader needs to.
- **Attachments only on `ArmatureDocument`, not on fragments.** Rejected: the rich item authoring
  tool needs an option that is a picture, and ADR-0033 promised the hook.

## Verification

`scripts/platform_checks.js` check AD, run 2026-10-20 against `terminusdb/terminusdb-server:v12.0.7`:

| Check | Result | Evidence |
|---|---|---|
| AD0 | PASS | The schema reloads with instances present after adding an enum, a subdocument class, a `Set` of it on an abstract class and on `Fragment`, and weakening a required field to `Optional` |
| AD1, AD2 | PASS | A leaf class inherits the `Set` from the abstract class; two subdocuments round-trip inline with their enum values and nested ids of the form `L4/ad-leaf/attachments/Att/…` |
| AD3 | PASS | A document written before the field existed reads back with no `attachments` field (an empty `Set` is absent, as for `assesses`) |
| AD4 | PASS | A document may omit the weakened field |
| AD5 | PASS | A `Set` of subdocuments inside a `List` subdocument: an option with an attachment and no text round-trips |
| AD6 | PASS | A no-op replace regenerates the nested attachment's `@id`; the two states are equal once `@id` is removed at every depth, which is what `fragments.ts` does |
| AD7 | PASS | Changing an attachment's hash changes exactly the fragment that carries it |

## Consequences

**Positive**

- Objectives can name their CASE competencies, items their QTI sources, datasets their xAPI
  statements, by identifier, without translating anything (P6).
- An option can be a picture; a module can say which revision of an asset tree it was built
  against; replacing an image is an ordinary graph write with an author and a reason, and the
  attestations on that part go stale (ADR-0028), which is the review loop the rich item tool needs.
- An additive and weakening schema change: `load_schema.js` applies it without clearing, and every
  existing record is unchanged.
- The hash makes a reference checkable by anyone with access to the store, in any backend, now or
  later.

**Negative**

- Two more subdocument shapes a client may meet on any artifact, and a client that reads
  `fragment.text` as always present must now guard it.
- A reference is unverified: the hub cannot yet say whether the bytes behind a hash exist, let
  alone match. A broken reference is found by the tool that fetches it.
- "Which artifacts use this asset" is a scan until a shared `Asset` record is warranted.

**Neutral**

- The seed carries no references or attachments; they are shown in tests until the seed gains an
  image option or a CASE reference (a content decision).
- Constraint 19 moves a check from shape (400, a missing `text`) to rule (422 `empty_fragment`);
  a client that sent a text-less option before got 400 and now gets 422 with the fragment named.

## Open

- **A graded `relation` on `ExternalRef`** (CTDL-ASN: exact, broad, narrow, major, minor,
  prerequisite), as an optional enum when the curriculum mapper writes one.
- **More about the external record** (candidate 0030 in `docs/research/adr-candidates.md`: the
  framework's version, the source's change date, a retrieval date, a snapshot of the statement
  text), when an import shows which of them a reader needs.
- **Hash verification as a read**, and the hub-managed endpoints and backend, when a reference
  client has a file to attach.
- **A shared `Asset` record** and an impact read over it, when two artifacts referencing one asset
  need to be found faster than a scan.

## Related

- ADR-0002 — references, not ownership; the embedded exceptions are now fragments and these
  coordinates; annotated
- ADR-0010 — progressive formalization: `role` as text, `relation` deferred
- ADR-0022, ADR-0023, ADR-0033 — fragments; `text` optional as ADR-0033 anticipated; annotated
- ADR-0025 — design process data in the commit graph; amended for externally versioned artifacts
- ADR-0027 — categories; the coordinates are `infrastructure`
- ADR-0028 — staleness by fragment, which now sees attachment changes
- ADR-0034 (reserved) — interaction types and renderers; a renderer is an attachment reference on
  a type, loaded sandboxed
- `docs/development-plan.md` Phase 6, §3 "Rich artifacts", §6 (the hub-managed backend), §8
- `docs/research/schema-precedents-and-plugin-candidates.md` Part 1 §B — the vocabularies
