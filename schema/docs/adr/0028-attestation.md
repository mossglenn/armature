# ADR-0028: Attestation — A Person's Verdict on a Design Record as of a Commit

> **In brief.** This decision answers: how does the graph record that a person, an expert reviewer
> for example, looked at a design record and endorsed it or not, and how does anyone later tell
> whether that judgment still applies? It adds `Attestation`: one person's verdict (`Affirmed` or
> `Declined`) about one record, or one part of it, as the record stood at a named commit (a saved
> version of the design). A verdict may be about a specific written claim ("this option is the only
> correct answer") or, when a tool has no claims, about the record itself. Each person holds one
> current attestation per record, part and claim; earlier verdicts stay in the history. Whether an
> attestation is out of date is never stored: Armature works it out on request by comparing the part
> as it was with the part as it is. The same decision lets design notes and findings point at one
> part of a question. Accepted and built 2026-10-18. (ADR stands for Architecture Decision
> Record.)

## Status

Accepted and implemented (2026-10-18), on `phase-5/attestation` (Phase 5 of
`docs/development-plan.md`). The number was reserved by the plan (§5). Platform checks AA and AB in
`scripts/platform_checks.js` (added and passing 2026-10-18, TerminusDB v12.0.7) verify the two
store behaviors it depends on.

**Added while building (2026-10-18):** decision 5's last paragraph, that an attestation's subject
may not be written in the same request. Building the exit-criterion test showed that a verdict
written with its subject would read `Unanchored` (the subject created) or `Stale` (the subject
changed) from the start. Also found while building: the write pipeline's lookup of the record a
Hash-keyed write replaces queried every key field in the store, and a template on an `Optional`
reference is a store 500 (check Y2). It now sends the required key fields to the store and matches
the optional ones in the hub, absent only against absent, as the store hashes them (AA3).

Amends ADR-0012 and ADR-0020 (an optional `fragmentId` on `DesignNote` and `DesignFinding`,
decision 6), applies ADR-0023 decision 5, and amends ADR-0057 decision 5 for `Attestation` only (an
attestation's replace refills `asOf`, decision 5 below).

## Context

CoQui, the first plugin, structures expert review of assessment items. Its review outcome per
claim, per reviewer, is the one piece of review discourse its membership test lets into the hub
(`docs/armature-asks-from-Coqui.md`, O-J): "a reviewer affirmed this claim about this option, as of
this version". It proposed an `Attestation` type carrying a subject, an optional `fragmentId`, its
grid, claim lineage, claim version and claim text, a verdict (`Affirmed` or `Cannot`), a reason, the
version attested with its commit, and the reviewer.

The plan's two-client test (§2) adopted the generic form: a verdict by a `User` about a claim
regarding a target plus an optional fragment, as of a commit. CoQui's grid and claim version are its
vocabulary and travel inside an opaque `claimRef`. The second clients are the curriculum mapper (a
subject-matter expert, SME, affirms that an item aligns with an objective) and the AI design
assistant (a person accepts a proposal).

Writing the ADR raised a question the plan had not: must every attestation carry a claim? The plan
specified `claimText` as required, which makes CoQui's method (review means affirming or declining
discrete written claims) part of the hub's vocabulary. A holistic sign-off tool ("I have reviewed
this item and endorse it"), or an AI assistant whose human accepts a proposal, would have to invent
a claim string to record a verdict. Nothing else in the hub depends on attestations: no invariant,
coverage rule or readiness gate reads one, and `ItemStatus` remains the readiness signal (ADR-0018).
A tool that never attests is unaffected either way. The question is what the hub's vocabulary says
review is.

What the store does, verified before this ADR relied on it:

- **A Hash key may include `Optional` fields** (check AA1), and an absent field is not confused with
  another field's value: `fragmentId: "b"` with no `claimRef` and `claimRef: "b"` with no
  `fragmentId` are two documents (AA2, AA3). A second insert under the same key fields is refused
  (`DocumentIdAlreadyExists`, AA4); a `PUT` with `create=true`, no `@id` and the same key fields
  replaces the document in place, also when every optional key field is absent (AA5).
- **The store's diff of an item is positional.** A one-option edit is reported as
  `options: [{}, {text: SwapValue}]`, by list index, not by `fragmentId` (AB1). A reorder would
  appear as changes to every moved option.
- **A replace with identical content is a change at the store.** It makes a commit, appears in the
  item's per-document history, and regenerates every subdocument `@id` (AB4; J4 found the
  regeneration). Counting history entries overstates revisions.
- **Comparing fragments by `fragmentId`, with nested `@id`s removed, at two commits** reports
  exactly the changed fragment (AB2), and nothing for a reorder (AB5).
- **A merge writes new commits on the target**, so the branch commit an attestation was made at is
  not in the target's history (AB6, and check V: a merge commit has one parent). It remains readable
  by its id after the merge and after the branch is deleted (AB7, T2), and the comparison from it to
  the target's head reports the changed fragment (AB7).

## Decision

### 1. `Attestation` is a relationship record

`Attestation` inherits `DesignRecord` directly, like the Hash-keyed junctions, with
`@metadata.armature.category: "relationship"` (ADR-0027). A judgment is a relation with properties
(plan principle P1): it relates a person to a record, optionally a part of it, optionally a claim,
at a commit. It carries no `label`, `description` or `createdBy`; its attester is its own field
(decision 4). Being a `DesignRecord`, it can itself be the subject of a note, a finding or another
attestation.

| Field | Type | Meaning |
|---|---|---|
| `subject` | `DesignRecord` | The record judged. One record, not a set: a part belongs to one record, and a verdict about two records is two verdicts |
| `fragmentId` | `Optional<xsd:string>` | The part judged, by its client-assigned identifier (ADR-0023); absent for the record as a whole |
| `claimRef` | `Optional<xsd:string>` | An opaque, client-scoped identifier for the claim and its lineage. CoQui puts its grid, claim and claim version here; the hub never parses it |
| `claimText` | `Optional<xsd:string>` | The claim's wording as the attester saw it |
| `verdict` | `AttestationVerdict` | `Affirmed` or `Declined` (decision 2 says what each means without a claim) |
| `reason` | `Optional<xsd:string>` | Why, in the attester's words; most useful on a decline |
| `asOf` | `Optional<xsd:string>` | The commit of the subject the verdict is about (ADR-0057; decision 5) |
| `attestedBy` | `Optional<User>` | The person or agent who gave the verdict (decision 4) |

`attestedBy` and `asOf` are `Optional` in the schema and always present in the store for
attestations written through the API, the pattern `createdBy` (ADR-0032) and `asOf` (ADR-0057
decision 2) already follow. A required field would make the generated request schema require the
client to send a value the hub must not take from the body.

### 2. The claim is optional, and comes whole or not at all

An attestation either carries a claim, `claimRef` and `claimText` together, or carries neither. A
claim with wording but no identity would share its key with the attester's claimless verdict on the
same subject and silently replace it. An identity with no wording would be unreadable to anyone
without the plugin. Either half alone is refused, 422 `claim_incomplete`.

- **With a claim**, the verdict is about the claim: the attester affirms or declines that the claim
  holds of the subject (or fragment) as it stood at `asOf`. CoQui and the curriculum mapper write
  these.
- **Without a claim**, the verdict is an endorsement: the attester endorses, or withholds endorsement
  of, the subject (or fragment) as it stood at `asOf`. A sign-off review tool and the AI assistant's
  "a person accepted this proposal" write these.

The two coexist. One person's endorsement of an item and their claim verdicts on the same item hash
differently (check AA3), so neither replaces the other.

Rewording a claim keeps its `claimRef`, so the new verdict replaces the old one, which is CoQui's
"latest live attestation per claim per reviewer". Two claims with different `claimRef`s are two
records.

### 3. Identity is a Hash over subject, fragment, claim and attester

`@key: { "@type": "Hash", "@fields": ["subject", "fragmentId", "claimRef", "attestedBy"] }`.
One person holds at most one attestation per subject, part and claim, and the store guarantees it.
"The latest attestation per claim per reviewer" is a read by key, not a search. A later verdict
under the same key replaces the record (AA5); the earlier one is in the commit history with its
author and reason (ADR-0025).

The key obeys ADR-0024 decision 6 (keys never include mutable fields). `subject` and `attestedBy`
are references, as on every junction. `fragmentId` and `claimRef` are identifiers, not content: a
`fragmentId` is never regenerated (ADR-0023 decision 3), and a `claimRef` names a claim's lineage,
which survives rewording. Changing either one means judging a different part or claim, so it gives a
different record. Everything a person may revise (`claimText`, `verdict`, `reason`, `asOf`) is
outside the key.

A client never supplies an attestation's `@id`. As for every Hash-keyed type (ADR-0024 decision 1),
the store refuses an id that does not match the hash (400 `bad_id`), and a write with the same key
fields is a replace (decision 3 there; check AA5). CoQui's handoff proposed minting
`Attestation/coqui-<itemId>-<fragmentId or item>-<lineage>-<reviewer>`. It writes without an id
instead and keeps its own identifier as a mapping on its side. A retried push is still idempotent,
because the same key fields give the same id.

### 4. `attestedBy` is the resolved identity, never the body

The attester is the identity the request resolved to (ADR-0032), filled by the pipeline exactly as
`createdBy` is, and the commit's author is the same `User`. Because `attestedBy` is part of the key,
the pipeline fills it before it looks for an existing document (write step 2), so a replace finds
the caller's own attestation and never another person's. A body that supplies an `attestedBy`
naming anyone but the caller is refused, 422 `attester_not_caller`; one that names the caller, or
omits it, is accepted. A plugin pushing on behalf of several reviewers sends each reviewer's
attestations under that reviewer's identity, one request per reviewer.

An agent is a `User` with an `agent:` `externalId` (ADR-0032), so an AI's verdict is an attestation
like a person's (plan principle P5: human and agent judgments look alike).

### 5. `asOf` names the state judged, and every write of an attestation is a verdict

`Attestation` joins `AS_OF_SUBJECTS` (`app/lib/api/invariants/asOf.ts`) with `subject`: the subject
must exist at `asOf` (constraint 13, ADR-0057 decision 3). On create, an omitted `asOf` is filled
with the head the write starts from, or the `If-Match` commit (ADR-0057 decisions 2 and 5).

On replace, an attestation differs from a finding. ADR-0057 decision 5 keeps a finding's stored
`asOf`, because a finding's status changes (`Addressed`) without its author re-judging the subject.
Every field of an attestation outside its key is part of the judgment: a new verdict, a new reason
or new wording is the attester judging again, now. **A replace of an attestation that omits `asOf`
is therefore refilled from the head, not kept.** A client that re-sends an old verdict (CoQui's
retried push, an importer) supplies the `asOf` it means, and the hub checks it. This amends ADR-0057
decision 5 for `Attestation` only.

**An attestation's subject is not written in the same request** (422 `subject_in_same_write`, added
while building). A commit cannot name itself (ADR-0057 decision 5), so the filled `asOf` would name
a state without the subject, if the write creates it, or with its earlier version, if the write
changes it. The staleness read would report the verdict `Unanchored` or `Stale` from the moment it
was given. ADR-0057 accepts the first case for a finding, which is about what its author saw plus
what they added; a verdict is about one state, and that state must hold what it judges. A client
writes the subject, then attests it.

### 6. A record about a part names the pair (record, `fragmentId`) on itself

ADR-0023 decision 5 fixed the shape for part-level references: the compound
`{ document, fragmentId }`, not a bare document reference. This ADR makes it the general rule and
applies it now. Any record that points at a part carries the record in its reference field and the
part in a sibling `fragmentId`.

- `Attestation.fragmentId` (decision 1).
- `DesignNote.fragmentId` and `DesignFinding.fragmentId`, `Optional<xsd:string>`, so "why did we
  replace this image" and "this drop zone is ambiguous" point at a part (plan §4, folded into this
  ADR). Their `subject` is a `Set`; when `fragmentId` is present, `subject` must have exactly one
  member, 422 `fragment_needs_one_subject`. A finding's `fragmentId` is a part of its `subject`, never
  of `regarding`.

For all three, the fragment must exist in the subject, 422 `unknown_fragment`: at `asOf` when the
record carries an `asOf` that constraint 13 checks, otherwise in the subject as the write leaves it.
A subject's fragments are found from the schema, not from a list of types: every field whose class
is in the `fragment` category (ADR-0027), searched by `fragmentId`. Today that is `AssessmentItem`'s
stem, options and feedbacks; a later type with parts gains the rule without a change here.

### 7. Staleness is a read

Nothing about staleness is stored (ADR-0056). `GET /api/v1/intelligence/attestations/:type/:id`,
at `?branch=` or `?ref=` like every read, lists the attestations whose `subject` is that record
and gives each a derived `state`:

| `state` | When |
|---|---|
| `Current` | The judged part reads the same at `asOf` and at the ref |
| `Stale` | It reads differently |
| `FragmentRemoved` | The attestation names a `fragmentId` the subject no longer has at the ref |
| `Unanchored` | The attestation has no `asOf` (written outside the pipeline), so there is nothing to compare |

"The judged part" is the fragment found by `fragmentId` when the attestation names one, otherwise
the whole subject. Either is compared in a canonical form with every nested `@id` removed, because
replaces regenerate them (J4, AB4). Fragments are matched by `fragmentId`, never by position, so a
reorder changes no fragment (AB5). A reorder does change the whole item, whose order is its own.
The read compares two document reads, at `asOf` and at the ref, and does not walk history. This is
the only form that works after a merge, where the commit attested is not in the target's history
(AB6, AB7). It is also the form that ignores no-op replaces (AB4).

`Stale` is not a verdict. A stale affirmation is still a true record that the attester affirmed the
earlier state; the read says the state has moved since.

The trace route (`/api/v1/intelligence/trace/:type/:id`) adds, to the summary of each node it
reports, the attestations about that node with their `state`, as context it does not walk through.

### 8. No per-person aggregate

ADR-0021's non-aggregation guard already refuses `attestedBy` as a list filter, because it targets
`User` (built 2026-10-18). The attestations read is by subject only. It takes no attester parameter
and returns no count per person. An attestation is provenance, no more aggregable per person than
`createdBy` (`docs/armature-asks-from-Coqui.md`, lessons).

### Not adopted

- **CoQui's `grid` and `claimVersion` as fields.** They are CoQui's vocabulary and travel in
  `claimRef` (plan §2).
- **CoQui's `Cannot`.** `Declined` is the tool-neutral word; CoQui maps onto it at its boundary.
- **`sourceCommit` beside a plugin's version.** `asOf` is the commit. CoQui's version row is
  CoQui's pin and stays in CoQui.
- **A content hash beside `asOf`** (research candidate 0036). The hub never rewrites history
  (ADR-0025 decision 6), so a commit id stays valid and the state it names stays readable (T2, AB7).
- **A required claim** (decision 2), and **`claimText` in the key** (rewording would fork the record
  and break "latest per claim").
- **The claim–evidence–warrant structure of evidence-centered design, and nanopublications**
  (research survey). Nothing in real usage has asked for structure in a claim yet (ADR-0010's rule:
  free text first, formalized when usage shows the pattern).

## Consequences

**Positive**

- "Was this alignment confirmed, by whom, and does it still hold?" is answerable from the graph
  alone, at any ref, with no plugin code. That is the plan's Phase 5 exit criterion.
- The hub's review vocabulary does not impose a method. Claim-based review and holistic sign-off
  share one type, one key and one staleness read.
- One current verdict per person, part and claim is a store guarantee; history keeps every earlier
  verdict with its author and reason.
- Staleness survives the workflow CoQui uses: attest on a round branch, merge later.
- Notes and findings can point at a part, which the rich item authoring tool and the complex
  learning object designer need (plan §2) and ADR-0023 promised.

**Negative**

- A claimless `Affirmed` means what the tool meant by it. A researcher reading a corpus cannot tell
  a rigorous expert sign-off from a quick click. `reason` and the commit message soften this; they
  do not fix it.
- Staleness at the subject only. An attestation that an item aligns with an objective is not marked
  `Stale` when the objective's wording changes, because the objective is not the subject (see Open).
- Whole-subject staleness is strict: a no-op difference the canonical form does not remove (a
  changed `description`) marks every whole-subject attestation `Stale`.
- `attestedBy` and `asOf` can be absent in data written outside the pipeline; such an attestation
  hashes without an attester and reads as `Unanchored`. The seed writes both.
- A plugin pushing for many reviewers sends one request per reviewer (decision 4), and an item and
  its verdicts take two requests (decision 5).
- The attestations read costs two document reads per attestation; fine at demo scale, and a cache by
  `(subject, asOf)` is the first remedy when it is not.

**Neutral**

- `DesignNote` and `DesignFinding` gain one optional field each; no stored document changes, so the
  schema loads without clearing data.
- CoQui's handoff ids change shape (decision 3); its outbox already holds attestation rows for
  exactly this type.

## Open

- **A `regarding` on Attestation**, as `DesignFinding` has, for claims about a relationship
  ("this item assesses LO-3"). It would let the curriculum mapper attest an alignment without
  minting a claim string, and would make the attestation stale when either end changes. It would
  have to join the key. Evidence: the curriculum mapper's first alignment attestations.
- **A revision count** ("affirmed two revisions ago"). Counting the commits since `asOf` at which
  the judged part changed needs an order between `asOf` and the target's history entries, which a
  merge breaks (AB6). Timestamps would do, with care. Built when a client asks for the number rather
  than the state.
- **Withdrawing an attestation** without giving a new verdict. CoQui replaces a superseded
  attestation and never deletes. Whether a third verdict, or deletion, is wanted waits for a client
  that needs it.

## Related

- ADR-0012, ADR-0020 — `DesignNote`, `DesignFinding`; amended by decision 6
- ADR-0018 — `ItemStatus`, the readiness signal attestations do not replace
- ADR-0021 — the non-aggregation guard decision 8 relies on
- ADR-0023 — `fragmentId` and the compound target, applied by decision 6
- ADR-0024 — Hash-keyed records take no client id (decision 1); replace semantics (3); never
  delete on a plugin's behalf (5); keys hold no mutable field (6)
- ADR-0025 — history keeps every earlier verdict; commit ids stay valid
- ADR-0032 — identity resolution, the source of `attestedBy`
- ADR-0056 — staleness is derived on read, never stored
- ADR-0057 — `asOf`; decision 5 amended here for `Attestation`
- Platform checks AA (Hash key over Optional fields), AB (fragment-level change between commits),
  J4, T2, V
- W3C Web Annotation Data Model (Recommendation, 2017): an annotation targets a resource through a
  `source`, a `FragmentSelector` and a `State`, which independently arrives at this ADR's
  (`subject`, `fragmentId`, `asOf`); its `motivation` vocabulary (assessing, commenting,
  questioning, moderating) is a comparison point for `DesignNoteCategory`, and its JSON-LD is a
  candidate export shape for notes, findings and attestations under ADR-0031. Identified after this
  ADR was accepted, in the precedents survey of 2026-10-20
  (`docs/research/schema-precedents-and-plugin-candidates.md`, Part 1 §A)
