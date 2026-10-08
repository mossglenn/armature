# ADR-0033: Items Are a Tree of Fragments

## Status
Accepted (2026-10-07) for the shape: abstract `Fragment` subdocument, `TextFragment` and
`ItemOption` as its specialisations. Generic fragment kinds with a JSON payload are decided here but
not yet added to the schema; they land with the first non-text item type.

## Context

ADR-0022 embeds an item's stem and options in the item document; ADR-0023 gives each part a
client-assigned `fragmentId`. Both were written for multiple-choice items authored in CoQui. The
position paper's scope is wider: drag-and-drop, hotspot and media-bearing items, and eventually
complex learning objects whose content and behaviour live outside the graph. The development plan
(§3, "Rich artifacts") asks that Phase 1 not make `ItemOption` the only way an item can have parts,
so that richer items need no second migration.

Three requirements hold for any item a review tool can work with: its design structure is in the
graph in a shape the tool did not define; every part has a stable address the tool did not mint; and
everything that is not structure is reachable. None depends on the parts being text.

Platform behaviour, verified on TerminusDB v12.0.7 (`scripts/platform_checks.js`):
- an abstract `@subdocument` class with `@key: Random` loads, and concrete subdocument subclasses
  declare their own key (key strategies are not inherited) (check A);
- a `List` typed to the abstract subdocument accepts instances of different subclasses in one
  list, and both survive the round trip with their `@type` (check E);
- an `Optional` single slot typed to the abstract accepts a subclass (check F);
- a `sys:JSON` field on a subdocument stores and returns an arbitrary object (check G);
- subdocuments return inline by default, each with a nested `@id` of the form
  `Parent/id/field/index/Type/random` (checks D, I);
- a subdocument cannot be inserted as a top-level document (check H);
- a replace of the parent regenerates every subdocument's `Random` id (check J4), which is why
  identity must be `fragmentId`, never the store's nested `@id`.

## Decision

1. **`Fragment` is an abstract `@subdocument` with `fragmentId` and `text`.** `text` is required
   today. When attachment references arrive (ADR-0030) it becomes `Optional` so an image or audio
   fragment can carry no inline text; that is a weakening change the store accepts without
   migration. The `@key` is `Random`: `ValueHash` would change a part's store id when its text
   changes, the defect ADR-0016 diagnosed, and in any case the store id is not the part's identity.

2. **`TextFragment` and `ItemOption` are its specialisations.** `TextFragment` adds nothing and
   exists so stem and feedback slots are typed to text rather than to the abstract, which would
   also accept an option. `ItemOption` adds `isCorrect`, optional `feedback` and optional
   `purpose`.

3. **`AssessmentItem` carries `stem: TextFragment`, `options: List<ItemOption>`, and optional
   `correctFeedback` and `incorrectFeedback: TextFragment`.** Order in `options` is presentation
   order; identity is `fragmentId`. Item types without options (Essay, ShortAnswer) have an empty
   list.

4. **Generic fragment kinds are the extension path, not a second mechanism.** When the first item
   type arrives whose parts are neither text nor options, a `GenericFragment` subclass is added with
   `kind: xsd:string` and `payload: Optional<sys:JSON>`, and the item gains `parts: List<Fragment>`
   beside `options`. The store accepts the polymorphic list (check E), so this is an additive
   change. A payload is validated per `kind` by the invariants engine, not by the store, which
   stores `sys:JSON` unchecked; a kind that settles is promoted to a typed subdocument. This is
   ADR-0010's progressive formalisation applied to item parts.

5. **A tool that does not know an item type can still enumerate its fragments**, read each one's
   text, and attach a finding or attestation to one by `fragmentId`. This is the contract the plan
   §8 records as "no item type whose parts cannot be enumerated generically."

6. **Not adopted now, recorded for ADR-0034.** The research recommends `{interactionType,
   typeVersion}` on every item so migrations can select items by type version. The eight values of
   `ItemType` are the interaction types today; a version field is meaningless until the renderer
   registry exists. It is added with ADR-0034, and `ItemType` becomes the built-in registry.

## Consequences

- Phase 1 lands the typed shape without foreclosing the generic one: adding `GenericFragment` and
  `parts` later re-keys nothing.
- Generated types inline fragments as objects (`stem: TextFragment`, `options: ItemOption[]`),
  since that is what the store returns.
- Every write of an item replaces its fragments wholesale and the store mints new nested ids. Any
  external reference to a part goes through `{ itemId, fragmentId }`; nothing may store a nested
  `@id`.
- The invariants engine (Phase 3) owns: `fragmentId` unique across all fragments of one item;
  option text unique within an item; option text present; number of correct options consistent
  with `itemType`.
- Diffs into fragments work at field level (check J3: the changed option's `text` is reported with
  `@before` and `@after`), but list diffs are positional, so a reordering reads as many changes.
  Fragment-aware diffing stays in the plugin, as CoQui concluded.

## Related
- ADR-0022, ADR-0023 — the decisions this generalises
- ADR-0027 — the `fragment` category
- ADR-0030 (planned) — attachment references on fragments; relaxes `text` to Optional
- ADR-0034 (planned) — interaction types and renderers; adds the type version
