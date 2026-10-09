# ADR-0022: AssessmentItem Stem and Options Are Embedded Structure, Not a Separate Response Document

> **In brief.** This decision answered: should each answer option of a test question be a separate
> record in the database? It decided no: a question's stem (its prompt) and its options are stored
> inside the question's own record as embedded parts, and the separate `Response` record type was
> removed, because options are never shared between questions and moving one to another question would
> silently change its meaning. It still holds and is implemented. ADR-0033 (an Architecture Decision
> Record, or ADR) later generalized the embedded parts into "fragments", and each part is addressed by
> a `fragmentId` the authoring tool assigns (ADR-0023).

## Status
Accepted. Implemented in `schema.json` on 2026-10-07: `Response` removed; `AssessmentItem` carries
`stem: TextFragment`, `options: List<ItemOption>`, and optional `correctFeedback` and
`incorrectFeedback: TextFragment`, with `ItemOption` and `TextFragment` as specialisations of an
abstract `Fragment` subdocument (ADR-0033). Reload rather than migration was chosen for the demo
store (`load_schema.js --clear-instances` then `seed_data.js`); a deployment holding real data would
use the store's migration endpoint (`DeleteClass`, `CreateClassProperty`, `CastClassProperty`, with
`dry_run`) instead.

Amends ADR-0002 (item parts are embedded subdocuments, the one exception to references rather than
ownership; with ADR-0033) and ADR-0004 and ADR-0014 (their `Response` lines are struck).
**Supersedes ADR-0016 in part, corrected 2026-10-08:** only ADR-0016's `Response`-specific points
are superseded. Its decisions 1, 2 and 4 remain binding (restated by ADR-0024), and decision 5 is
resolved by ADR-0024. The "in full" wording in §Consequences and §Related below is corrected by
notes there. Generalized by ADR-0033. The option constraints in decision 4 are enforced since
Phase 3 (2026-10-08) as constraints 8 and 9.

## Context

The schema currently models an item's answer options as `Response` — a standalone primary artifact holding a back-reference to its parent (`Response.item → AssessmentItem`, ADR-0004), inheriting `ArmatureDocument` (ADR-0014), and — per ADR-0016 (Proposed) — in the process of having its key strategy reworked from a composite Hash key to `Random`, specifically to stop editing an option's text from changing that option's identity.

> **Later change (2026-10-08):** ADR-0016 was accepted, and is now superseded in part by this ADR
> (its `Response`-specific points only).

CoQui's development surfaced the question this ADR resolves: is there ever a legitimate reason for an individual option to have graph identity independent of its parent item?

The answer is no, for a reason stronger than convenience:

- **Options are never shared across items.** Nothing in assessment design calls for the same `Response` document to be referenced by two `AssessmentItem`s. Splitting an entity out as its own document is normally justified by reuse across parents — that justification doesn't exist here.
- **Moving an option between items is dangerous, not useful.** An option's meaning is a function of its item's stem and its sibling options. Relocating a `Response` to a different `AssessmentItem` — trivial to do accidentally once it's a separate document with its own `@id` — would silently change what that option means, or produce nonsense. The schema currently has no guard against this.
- **The remaining justification for the split was change-history granularity** — being able to trace a specific option's edits over time. This does not require document identity. TerminusDB's storage model versions at the triple level, including into nested arrays and objects, not only at whole-document boundaries. A diff between two commits of the same `AssessmentItem` already exposes exactly which embedded option changed, with no schema decomposition required to get that.

With the reuse case absent and the versioning case already satisfied by the store itself, `Response`'s document status has no remaining justification. Its only real function — giving an option a stable identity so a comment or rationale can point at it — is better served by a lighter mechanism (ADR-0023) that doesn't carry the cost of full document identity, including the relocation risk above.

## Decision

1. **`Response` is removed as a standalone document type.** `AssessmentItem`'s existing stem/prompt content is retained as a direct field on `AssessmentItem`; its options move from separate `Response` documents into an embedded, ordered structure on `AssessmentItem` itself (e.g., `AssessmentItem.options: List<ItemOption>`, where `ItemOption` is a subdocument type, not a document type). The exact field name and subdocument shape are an implementation detail for the schema file itself and are not fixed by this ADR.

2. **Embedded options carry no graph-level identity.** No `@id`, no `@key`, no `ArmatureDocument` inheritance. They are opaque content within the item document, exactly as available for editing as any other field on `AssessmentItem`.

3. **Part-level addressing — needed for comments and attestations on a specific option or the stem — is handled entirely by a client-assigned `fragmentId`, not by document identity.** See ADR-0023.

4. **Content-level constraints on options (e.g., no duplicate option text within one item, minimum option count) are validated by the API**, consistent with ADR-0006 and ADR-0013's existing pattern of pushing constraints TerminusDB's schema layer cannot express down to the API.

   > **Later change (2026-10-08):** ADR-0006 is superseded by ADR-0013. These checks are constraints
   > 8 (`fragmentId` unique within an item) and 9 (option text present and unique; correct-option
   > count suits `itemType`) in the invariants engine, `app/lib/api/invariants/assessmentItem.ts`.

## Consequences

**Positive**

- Removes the option-relocation risk entirely: an embedded option cannot be pointed at a different item, because it has no independent existence to redirect. This is stronger protection than a validation rule would have been.
- Removes ADR-0016's motivating problem for `Response` outright — there is no key to get wrong when there is no document.
- Per-option change history is unaffected: still available for free via TerminusDB's native diffing into nested structure.
- Simplifies the primary-artifact surface by one type and removes a document whose only field of substance (`description`, per ADR-0016) was unpopulated in all seeded data.

**Negative / Neutral**

- **Reverses two pieces of previously accepted architecture.** ADR-0004 listed `Response.item → AssessmentItem` as one of six back-reference examples; that line is now obsolete and has been struck in ADR-0004 with a pointer here. ADR-0014 listed `Response` among the thirteen `ArmatureDocument` inheritors; it has been removed, with the same annotation. Neither ADR's broader pattern (back-references for the other five relationships; the abstract base class itself) is affected — only the `Response`-specific lines.
- **ADR-0016 is superseded in full.** Its entire subject was `Response`'s key strategy; with `Response` no longer a document, the problem it solved no longer exists. Its non-`Response` decisions (junction Hash keys, the mutable-field rule, explicit key declaration, single identifier-assignment convention) remain valid guidance for every other type and are called out as such in ADR-0016's supersession note.

  > **Later change (2026-10-08):** "in full" overstates it. ADR-0016 is superseded *in part*: only
  > its `Response`-specific points. Its decisions 1, 2 and 4 remain binding (ADR-0024 restates
  > them) and decision 5 was resolved by ADR-0024, consistent with ADR-0016's own note.

- Any existing API routes, seed data, or documentation treating `Response` as an independently creatable/queryable document (e.g., a `POST /api/responses` endpoint, or `docs/demo-api.md`'s item example, which ADR-0016 already flagged as missing real option text) must be reworked to read and write options as part of the `AssessmentItem` payload.

  > **Later change (2026-10-08):** done. No `/api/responses` route exists, `docs/demo-api.md` is
  > retired, and items with their parts are written through the generic `/api/v1/documents` routes.

- This is a schema change requiring `npm run generate:types` and a coordinated commit, same as any change ADR-0016 would have required — the migration cost doesn't disappear, it just changes shape (removing a type rather than rekeying one).

## Related

- ADR-0004 — back-references on children; the `Response` line is struck here
- ADR-0006, ADR-0013 — constraints enforced by the API rather than the schema; the pattern this ADR relies on for option-level validation
- ADR-0010 — progressive formalization; the governing principle for not carrying document-level structure that usage hasn't demonstrated a need for
- ADR-0012, ADR-0020 — rationale/finding patterns that reference whole documents by identity; contrast with ADR-0023's fragment-level targeting
- ADR-0014 — `ArmatureDocument` inheritance list amended to remove `Response`
- ADR-0016 — superseded in full by this ADR (corrected 2026-10-08: superseded *in part*; see the note in §Consequences)
- ADR-0024 — restates ADR-0016 decisions 1, 2 and 4 and resolves decision 5
- ADR-0033 — generalizes the embedded parts into a tree of fragments
- ADR-0023 — client-assigned `fragmentId`, the mechanism that replaces document identity for part-level addressing
