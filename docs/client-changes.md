# Changes for client tools

What changed in the Armature API (application programming interface) and schema that a client
tool must know about, newest first. Each entry says what changed, what a client does differently,
and where the detail lives. Entries are tool-neutral; where CoQui, the first plugin, has to map
something at its boundary, a **CoQui** note says how.

This file starts where CoQui's handoff stops: [`armature-asks-from-Coqui.md`](armature-asks-from-Coqui.md)
records what CoQui asked for on 2026-10-05, reading the repository at commit `3f00f40`. A client
that last synchronized with Armature at a given date reads every entry above that date.

The contract itself is the [API reference](api.md); the reasons are the
[Architecture Decision Records](../schema/docs/adr/README.md) (ADRs). This file never restates
them in full. It is updated whenever a change reaches `main` that a client would act on.

---

## 2026-10-18 · Attestations (ADR-0028; PR #16)

**What changed.** A new record type, `Attestation`: one person's verdict, `Affirmed` or
`Declined`, about a design record or one part of it, as of a commit. A new read,
`GET /api/v1/intelligence/attestations/:type/:id`, reports whether each verdict still holds. An
optional `fragmentId` on `DesignNote` and `DesignFinding` lets notes and findings point at one part.

**What a client does.**

- **Write attestations through `POST /api/v1/documents` without an `@id`.** The hub derives the
  identifier from `subject`, `fragmentId`, `claimRef` and `attestedBy`. Writing the same four again
  replaces the verdict; a supplied `@id` is a 400 `bad_id`.
- **Send a claim whole or not at all.** `claimRef` (an identifier your tool chooses for the claim
  and its lineage, kept when the wording changes) and `claimText` (the wording) come together, or
  neither for a plain endorsement of the record. Half a claim is a 422 `claim_incomplete`.
- **Attest as the reviewer.** `attestedBy` is always the identity the request resolved to. A tool
  pushing several reviewers' verdicts sends each reviewer's in a request carrying that reviewer's
  `Armature-User`. A body naming anyone else is a 422 `attester_not_caller`.
- **Write the record first, then attest it, in two requests.** An attestation's subject may not
  be written in the same request (422 `subject_in_same_write`): the commit the verdict names must
  already hold what it judges.
- **Supply `asOf` when re-sending an old verdict.** Every write of an attestation is a new verdict,
  so an omitted `asOf` is filled with the branch head again, also on a replace. A retried push or
  an import of past verdicts sends the commit the verdict was about.
- **Read staleness, do not compute it.** The attestations read compares the judged part at `asOf`
  and now, by `fragmentId`, and reports `Current`, `Stale`, `FragmentRemoved` or `Unanchored`. It
  works after a merge, when the attested commit is on another branch.
- **Name parts on notes and findings** with `fragmentId`. The record then names exactly one
  `subject`, and the part must exist in it (422 `fragment_needs_one_subject`, `unknown_fragment`).
- `attestedBy` cannot be used as a list filter (400 `person_filter_refused`, ADR-0021).

**CoQui.** The type follows the shape CoQui proposed (O-J), with four mappings at its boundary:

| CoQui's proposal | In the hub |
|---|---|
| `Attestation/coqui-<itemId>-<fragmentId or item>-<lineage>-<reviewer>` | No client id. Keep that string as CoQui's own mapping; the same key fields give the same hub id, so a retried push is idempotent |
| `grid`, `claim` (lineage), `claimVersion` | Inside the opaque `claimRef`; the wording in `claimText` |
| `verdict: Cannot` | `Declined` |
| `asOf` (the item version) and `sourceCommit` | `asOf` is the commit; supply the version's `sourceCommit` on every push. CoQui's version row stays in CoQui |

The outbox rows held for this type can now be sent: per reviewer, after the item's own push.
A decline that is not a finding crosses as `Declined` with its `reason`.

Detail: [ADR-0028](../schema/docs/adr/0028-attestation.md); [API reference, attestations
read](api.md#get-intelligenceattestationstypeid); [schema guide §4.11](schema-guide.md).

## 2026-10-18 · Item statistics are metrics about the item (ADR-0058; PR #15)

**What changed.** `AssessmentItem.difficultyIndex` and `discriminationIndex` are removed. An item
statistic is a `LearningMetric` whose new `subject` field names the item, `derivedFrom` the
administration's `LearningDataset`. `ModuleObjective` declarations are written by any client
through the generic document routes (ADR-0007, confirmed).

**What a client does.** Write item statistics as metrics; list an item's metrics with
`GET /api/v1/documents/LearningMetric?subject=<item id>`. Send no statistics fields on an item:
they are unknown keys, a 400.

Detail: [ADR-0058](../schema/docs/adr/0058-item-statistics-are-metrics-about-the-item.md).

## 2026-10-18 · List filters, and no filter by person (ADR-0021; PR #14)

**What changed.** `GET /api/v1/documents/:type?<field>=<value>` filters `Optional` and `Set` fields
correctly (they had answered 500). A filter on any field that names a `User` (`createdBy`, and now
`attestedBy`) is refused.

**What a client does.** Do not list documents by who made them: 400 `person_filter_refused`. The
API offers no enumeration of one person's work.

## 2026-10-18 · Records name the state they refer to: `asOf` (ADR-0057; PR #12)

**What changed.** `LearningDataset`, `LearningMetric` and `DesignFinding` (and since PR #16
`Attestation`) carry `asOf`, a bare commit identifier. The hub fills it with the branch head on
create, keeps it on replace (except for an attestation, above), copies a dataset's onto its
metrics, and checks every value it did not take from the head (422 `unknown_commit`,
`absent_at_commit`, `as_of_disagrees`).

**What a client does.** A finding judged against an earlier version of its subject sends that
version's commit as `asOf`. To re-judge a finding, send a new `asOf`; a replace without one keeps
the old.

**CoQui.** A finding's `asOf` is the `sourceCommit` of the item version the note was about.

Also on 2026-10-18 (PR #13): deleting a branch that is already gone answers 404 `unknown_ref`
(it had answered 500), and `GET /api/v1/branches` no longer fails when a branch is deleted while
it is read.

## 2026-10-08 · Design intelligence reads; coverage is never stored (ADR-0029, ADR-0056; Phase 4)

**What changed.** Four reads under `/api/v1/intelligence/`: coverage, alignment, trace and impact,
each at any `?branch=` or `?ref=`. Coverage is computed on read; `ModuleObjective` has no coverage
field.

**What a client does.** Read coverage from `GET /api/v1/intelligence/coverage/:moduleId`; never
write it. A `ModuleObjective` with a coverage field is a 400.

**CoQui.** Narrative 2 reads both coverage figures: `coverage` counts Approved items in Approved
placements, and `projected` counts everything not Retired, so it shows progress while items are
still in review.

## 2026-10-08 · Generic writes, identity and the invariants engine (ADR-0024, ADR-0032; Phase 3)

**What changed.** Every type is written through `PUT /api/v1/documents/:type/:id` and
`POST /api/v1/documents`; the demo-era routes are retired. `Armature-User` carries an `externalId`,
resolved to a `User` on `main`. Rules the database cannot express are answered 422 with every
violation at once.

**What a client does.**

- Supply your own `@id` on an artifact's first write if you want one; later writes under it
  replace. Never supply one on a relationship (junction) record.
- Send `Armature-User: <externalId>`, not a `User` id. Register users on `main` with
  `POST /api/v1/users`. Never send `createdBy`; the hub sets it.
- Read the `violations` list on a 422 and the `issues` list on a 400; the codes are stable
  ([API reference](api.md#the-write-pipeline)).

## 2026-10-08 · Version control (ADR-0025; Phase 2)

**What changed.** Reads at a branch or a commit, `ETag` and `If-Match` as bare commit identifiers
(412 when the branch moved), branches, a three-way merge with a per-field conflict report,
per-document history and diff, and changes since a commit.

**What a client does.** Pin reads with `?ref=<commit>`; send `If-Match` on writes that must not
overwrite someone else's change. Never expose or rely on history rewriting: there is no reset,
squash or rebase.

**CoQui.** The handoff's statement that TerminusDB "has no three-way merge with markers" (§4) is
wrong for v12: correct it when PR 6 (`feat/armature-merge`) is picked up. Merge *policy*, who may
merge and whether findings and attestations reach `main` without approval (O-P), is still open
([development plan §6](development-plan.md)).

## 2026-10-07 · Schema catch-up (ADR-0017, 0018, 0020, 0022, 0023, 0024; Phase 1)

**What changed.** `DesignRecord` is the root every note and finding can point at; items carry their
own `status` (`ItemStatus`); `DesignFinding` exists; an item's stem, options and feedback are
embedded fragments with client-assigned `fragmentId`s.

**What a client does.** Assign `fragmentId` once per part and never derive it from position;
address parts as `{ item @id, fragmentId }`, never by the database's nested identifiers.

**CoQui.** One divergence is recorded and undecided: CoQui's handoff gives each option's own
feedback a `{ fragmentId, text }` shape, but `ItemOption.feedback` is plain text.
