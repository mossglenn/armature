# ADR-0027: Schema Self-Description via `@metadata`

> **In brief.** This decision answered: how can a tool learn from the schema itself which kinds of
> record are design artifacts, which are relationships between them, which are embedded parts and
> which are supporting machinery? It decided that every class in the schema carries one of four
> category labels (`infrastructure`, `fragment`, `artifact` or `relationship`) in its metadata, that
> the code generators read these labels instead of hand-kept lists, and that a class without a label
> fails the build. It still holds and is implemented, except decision 4: the planned address
> `GET /api/v1/schema`, which would let a tool read the schema from the application programming
> interface (API), has not been built.

## Status
Accepted (2026-10-07). Implements ADR-0017 §2.

Amends ADR-0017 §2: adds a fourth category, `fragment`, and deletes `JUNCTION_IDS` rather than
deriving it. **Decision 4 not yet built (2026-10-08):** `GET /api/v1/schema` was not built in
Phase 2 or Phase 3, and no phase of `docs/development-plan.md` currently owns it.

## Context

Armature distinguished artifacts from relationships, but the distinction lived in two hand-maintained
constants: `JUNCTION_IDS` and `CLASS_ORDER` in `scripts/generate-types.js`, and a second copy in
`scripts/generate-schema-appendix.js`. CLAUDE.md instructed contributors to update both when adding a
type. CoQui's toolkit notes called deriving this from the schema "the highest-leverage change" for a
second client, because any tool that wants to treat relationships differently from artifacts (render
them, export them, exclude them from a slice) otherwise rebuilds the list by hand.

ADR-0017 decided that category is metadata, not a class, and reserved the shape
`@metadata.armature.category`. Platform behaviour verified on TerminusDB v12.0.7
(`scripts/platform_checks.js`, check C): `@metadata` survives schema load and is returned by the
schema graph's document API, including on abstract classes. The documentation recommends nesting
metadata one level, which the `armature` namespace does.

## Decision

1. **Every class declares `@metadata.armature.category`**, one of four values:

   | Category | Classes | Meaning |
   |---|---|---|
   | `infrastructure` | `User`, `DesignRecord`, `ArmatureDocument` | Not records of design in themselves: the identity type and the abstract roots |
   | `fragment` | `Fragment`, `TextFragment`, `ItemOption` | `@subdocument` classes: addressable parts of an artifact, returned inline, never referenced from outside (ADR-0033) |
   | `artifact` | the primary instructional documents, `DesignNote`, `DesignFinding` | Things a designer authors or the API computes about them |
   | `relationship` | the seven junction documents, including `PrerequisiteRecord` | Reified relationships carrying their own data |

   ADR-0017 named three categories; `fragment` is added here because a subdocument is neither an
   artifact (it has no identity) nor infrastructure, and generators must treat it differently from
   both (inline type, no `@id` reference).

   > **Later change (2026-10-08):** under ADR-0056 the API stores nothing it computes, so an
   > `artifact` is a thing a person or tool authors; "or the API computes about them" no longer
   > describes any stored record.

2. **Generators derive everything from the metadata.** `generate-types.js` groups output by category,
   emits inheritance as declared (`@inherits`, or `TerminusDocument`), inlines `@subdocument` types,
   and exports a `CLASS_CATEGORY` map and `SUBDOCUMENT_CLASSES` list so the app can ask the same
   question at runtime. `generate-schema-appendix.js` badges relationships and subdocuments from the
   same source. `JUNCTION_IDS` and `CLASS_ORDER` are deleted from both.

3. **A class without a category fails generation.** `npm run check:types` runs in CI, so a new
   class added without its category breaks the build rather than silently landing in the wrong
   group. This is the one place the taxonomy is enforced.

4. **`GET /api/v1/schema`** (Phase 2 or 3, with the generic routes) returns the schema graph so a
   tool discovers types and categories from the hub rather than from a copy of `schema.json`.

   > **Later change (2026-10-08):** not built. Phases 2 and 3 shipped without it, and no phase
   > currently owns it. Until it exists, a tool reads categories from `schema.json` or from the
   > generated `CLASS_CATEGORY` map in `app/lib/types.ts`.

5. **Not adopted now.** The research survey proposes extending the metadata into a relation-type
   registry (endpoints, inverse, transitivity, coverage role, maturity, export term) and a `reserved`
   list of retired property names enforced by CI. Both are recorded as the natural next use of this
   mechanism and wait for a second consumer (ADR-0027's own two-client test): the first is the
   research exporter's need to say which relations a slice includes.

## Consequences

- Adding a type is one edit to `schema.json` plus regeneration. CLAUDE.md's five-step procedure
  loses its two "update the generator" steps.
- The taxonomy is visible in the schema, where every tool can read it, and in the generated
  `CLASS_CATEGORY` map, where the app can.
- Every class gains a `@metadata` block; keeping it accurate is the same burden `JUNCTION_IDS`
  carried, relocated to where a mistake is visible.
- `@metadata` is free-form JSON to the store. Nothing validates the category values server-side;
  the generator does, and it is the only consumer today.

## Related
- ADR-0017 — category as metadata, not class; the decision this implements
- ADR-0033 — the `fragment` category's members
- `docs/research/adr-candidates.md` — relation-type registry and `reserved` names, deferred
- ADR-0029 — added a `@metadata.armature.computed` list; ADR-0056 removed it, so no class declares one
