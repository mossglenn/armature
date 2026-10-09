# ADR-0013: Schema-Level Minimum Cardinality (Conditional)

> **In brief.** Every assessment question and every learning activity must point to at least one
> learning objective. This decision moved that rule from Armature's application programming
> interface (API) into the database schema itself, using TerminusDB's `@min_cardinality` keyword,
> once the installed database version was confirmed to support it. It was accepted and applied in
> February 2026, still holds, and replaced ADR-0006 (an ADR is an Architecture Decision Record). The
> text below still reads as a proposal because it was written before the check was made.

## Status
Accepted. Supersedes ADR-0006.

**Applied 2026-02-26** (commit `44d13b8`). **Verification record (noted 2026-10-08):** the commit
that applied this ADR says the installed TerminusDB version was "confirmed to support this
constraint", but records neither the version nor how; the repository holds no dated verification
result for this ADR. What is on record: the schema has loaded with `@min_cardinality` on every load
since, including on TerminusDB v12.0.7; the scratch schema `scripts/platform_checks.js` loads
contains a `@min_cardinality: 1` Set; and the generated Zod request schemas turn it into `.min(1)`,
which `app/lib/api/write.test.ts` exercises ("enforces @min_cardinality from the schema (constraints
1 and 2)"). The title's "(Conditional)" and the conditional sections below are historical.

## Context
ADR-0006 established that minimum cardinality constraints on `Set` fields — specifically `AssessmentItem.assesses` and `LearningActivity.targets` must each contain at least one element — are enforced by the API because TerminusDB's `Set` type does not support minimum cardinality at the schema level.

Recent TerminusDB versions have added `@min_cardinality` support on `Set` and `List` fields. If this is available in the installed version, migrating these constraints to the schema level would:
- Make the constraints visible and enforceable without going through the API
- Allow direct database writes (scripts, migrations, test fixtures) to be validated at the schema level
- Make the schema self-documenting about these requirements without relying on `@documentation` comments

The migration is conditional because:
1. `@min_cardinality` support must be verified against the installed TerminusDB version before applying the schema change
2. Applying an unsupported keyword would cause the schema to fail to load

## Decision
This ADR is **Proposed** pending verification. When `@min_cardinality: 1` support is confirmed:

> **Later change (2026-10-08):** Accepted and applied 2026-02-26; steps 1 to 3 were carried out. See
> Status for what the repository records about verification.

1. Add `@min_cardinality: 1` to `AssessmentItem.assesses`:
```json
"assesses": {
  "@type": "Set",
  "@class": "LearningObjective",
  "@min_cardinality": 1
}
```

2. Add `@min_cardinality: 1` to `LearningActivity.targets`:
```json
"targets": {
  "@type": "Set",
  "@class": "LearningObjective",
  "@min_cardinality": 1
}
```

3. Update ADR-0006 status to `Superseded by ADR-0013`.

4. API-layer validation for these constraints remains — schema enforcement and API enforcement are complementary, not redundant. The API provides better error messages; the schema provides correctness guarantees for direct writes.

   > **Later change (2026-10-08):** The API's check is no longer hand-written. The generated Zod
   > request schemas (`app/lib/schemas.ts`, from `scripts/generate-types.js`) carry
   > `@min_cardinality` as `.min(1)`, so an empty `assesses` or `targets` is answered with 400
   > before the store sees it (constraints 1 and 2 in `app/lib/api/invariants/index.ts`).

### Verification step
Before applying:
```python
from terminusdb_client import Client
client = Client("http://localhost:6363")
# Check installed version against TerminusDB changelog for @min_cardinality support
```

Or check the TerminusDB release notes for the version in use.

> **Later change (2026-10-08):** This step predates the repository's practice: store behavior an ADR
> depends on is now probed by `scripts/platform_checks.js` (JavaScript) against a scratch database
> before it is encoded.

## Consequences (if accepted)
- `AssessmentItem` and `LearningActivity` documents that omit their objective mappings are rejected at the database level, not just the API level.
- Direct writes (migrations, test scripts) are validated without requiring API mediation.
- The schema becomes the authoritative source of truth for these constraints.
- No change to existing data — adding `@min_cardinality: 1` to a `Set` that already contains at least one element is a non-breaking migration.

## Consequences (if version check fails)
- Status remains Proposed.
- ADR-0006 remains the operative decision.
- Revisit when TerminusDB is upgraded.

> **Later change (2026-10-08):** Did not occur; this ADR was accepted and ADR-0006 is superseded.

## Related
ADR-0006 (minimum cardinality enforced by API — to be superseded by this ADR if accepted)

> **Later change (2026-10-08):** Superseded by this ADR on 2026-02-26.
