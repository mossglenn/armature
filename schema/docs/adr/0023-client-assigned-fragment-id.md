# ADR-0023: Client-Assigned fragmentId for Addressing Item Parts

> **In brief.** This decision answered: once answer options are no longer separate records, how can a
> comment or review point at one specific option of a test question? It decided that the authoring
> tool gives each part of a question a permanent identifier, `fragmentId`, when the part is created,
> never changed and never derived from the part's position, and that Armature's only job is to check
> that no two parts of one question share an identifier. It still holds and is implemented; its open
> question (how to name the question itself before it first reaches Armature) was answered by ADR-0024
> (an Architecture Decision Record, or ADR), which lets a tool choose a record's identifier.

## Status
Accepted. Implemented in `schema.json` on 2026-10-07 as `Fragment.fragmentId`, inherited by every
part type (ADR-0033). The open question below is resolved by ADR-0024: a client may supply the item's
`@id` on first write, so a pre-sync comment can name both the item and the part. Platform evidence
for decision 3 arrived with the implementation: a replace of the item regenerates every
subdocument's store id (`scripts/platform_checks.js`, check J4), so the nested `@id` could never have
served as part identity.

**Note 2026-10-08:** decision 4's uniqueness check is enforced since Phase 3 as constraint 8
(`app/lib/api/invariants/assessmentItem.ts`). `DesignNote.subject` and `DesignFinding.subject`
are `Set<DesignRecord>` (ADR-0017), not `Set<ArmatureDocument>` as decision 5 and §Consequences
say; the point they make, that a whole-record reference cannot name one option, is unchanged.

## Context

ADR-0022 embeds an `AssessmentItem`'s stem and options directly on the item, removing their document identity. CoQui still needs a stable, unique-within-the-item handle for each part, so that a comment or attestation can say "this is about option B" rather than "this is about the item" — and it needs that handle to exist during authoring, before the item has ever been sent to Armature for the first time.

Armature's identifier-assignment machinery — whichever single convention ADR-0016 (Decision 5) eventually settles on for primary artifacts — is a property of *documents*. Since stem and options are no longer documents, there is nothing for that machinery to act on, and by construction it cannot supply a pre-sync handle for something that doesn't yet exist in Armature's store. The assigner has to be whichever system holds the part before Armature does — which is CoQui.

## Decision

1. **CoQui assigns a stable, immutable identifier to each addressable part of an item** (each option, and the stem if it needs independent addressing) at creation time in the authoring tool, before the item is ever sent to Armature.

2. **The identifier is named `fragmentId`**, not `id` or any other term that could be mistaken for an Armature document identifier. It is modeled on the URL fragment convention — a stable resource identity plus a `#fragment` addressing a part of it — so a comment or attestation target is the compound reference:

   ```
   { itemId: <Armature-assigned>, fragmentId: <CoQui-assigned> }
   ```

3. **Generation rule:** `fragmentId` is generated once, at part creation, using a client-side unique token (UUID or a shorter scheme such as nanoid). It is never regenerated and never derived from array position or display order. Reordering options for presentation must never change any option's `fragmentId`.

4. **Armature's only responsibility toward `fragmentId` is validating uniqueness within a single item on ingest** — no two parts of the same `AssessmentItem` document may share one. Armature never assigns, globally deduplicates, or regenerates a `fragmentId`; it is opaque authored content as far as the document schema is concerned, the same way option text is.

5. **Any comment/attestation document type introduced to carry feedback on a part must target the compound reference above, not a bare document reference.** This differs from the existing `DesignNote`/`DesignFinding` pattern (ADR-0012, ADR-0020), whose `subject`/target fields are `Set<ArmatureDocument>` — a whole-document reference has no way to say "this specific option." No such comment/attestation type exists in the schema yet; this ADR fixes the shape its target field must take when it is designed, not the type itself.

   > **Later change (2026-10-08):** both `subject` fields are `Set<DesignRecord>` (ADR-0017). The
   > Attestation type is planned as ADR-0028 (`docs/development-plan.md` Phase 5; not yet written),
   > which the plan says will apply this compound-target rule and add an optional `fragmentId` to
   > `DesignNote` and `DesignFinding`.

## Open Question — not resolved by this ADR

During the window before an item has ever been sent to Armature, the item itself has no Armature-assigned `itemId` yet either — so a pre-sync comment needs a way to reference the item, not just the part within it. The likely direction is having CoQui generate the item's permanent identifier client-side and having Armature accept a client-supplied `@id` on first write, rather than the store assigning one — but that is a change to the identifier-assignment convention ADR-0016 (Decision 5) recommends for primary artifacts generally, not something specific to items or to this ADR's subject. It should be resolved as its own decision once the client-supplied-ID question is settled for primary artifacts as a whole, rather than folded into this ADR.

> **Later change (2026-10-07):** resolved by ADR-0024. A client may supply the `@id` of any primary
> artifact on its first write, so a pre-sync comment can name both the item and the part.

## Consequences

**Positive**

- CoQui can support commenting and attestation workflows entirely pre-sync, without a round trip to Armature to obtain identifiers.
- Identity is stable across content edits and display reordering — the same stability goal ADR-0016 was pursuing for `Response` before ADR-0022 removed the need for `Response` to carry it.
- Clean separation of responsibility: CoQui owns addressing *within* an item; Armature owns identity and referential integrity *across* items.

**Negative / Neutral**

- Introduces a second identifier system alongside Armature's document IDs. Consistent naming (`fragmentId`, never `id`) is the only thing preventing the two from being confused in code or documentation, and that discipline has to be maintained deliberately.
- Any future comment/attestation type needs a compound-target shape rather than a reused `Set<ArmatureDocument>` field — a new pattern, not a drop-in extension of ADR-0012/ADR-0020.
- Leaves the pre-sync item-identity question (above) open; CoQui cannot fully solve part-level commenting pre-sync until that companion question is also resolved.

  > **Later change (2026-10-08):** the reused field is `Set<DesignRecord>` (ADR-0017), and the
  > pre-sync question is resolved by ADR-0024.

## Related

- ADR-0022 — embeds stem/options on `AssessmentItem`; this ADR is the addressing mechanism that replaces the document identity ADR-0022 removes
- ADR-0012 — `DesignNote` free-form rationale; whole-document `subject` pattern this ADR's target shape departs from
- ADR-0016 — identifier-assignment convention for primary artifacts; directly relevant to the open pre-sync item-identity question
- ADR-0020 — `DesignFinding`; same whole-document targeting limitation as ADR-0012
- ADR-0024 — client-supplied identifiers; resolves the open question above
- ADR-0033 — `fragmentId` on the abstract `Fragment`, inherited by every part type
