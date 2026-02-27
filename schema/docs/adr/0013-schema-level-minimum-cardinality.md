# ADR-0013: Schema-Level Minimum Cardinality (Conditional)

## Status
Accepted. Supersedes ADR-0006.

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

### Verification step
Before applying:
```python
from terminusdb_client import Client
client = Client("http://localhost:6363")
# Check installed version against TerminusDB changelog for @min_cardinality support
```

Or check the TerminusDB release notes for the version in use.

## Consequences (if accepted)
- `AssessmentItem` and `LearningActivity` documents that omit their objective mappings are rejected at the database level, not just the API level.
- Direct writes (migrations, test scripts) are validated without requiring API mediation.
- The schema becomes the authoritative source of truth for these constraints.
- No change to existing data — adding `@min_cardinality: 1` to a `Set` that already contains at least one element is a non-breaking migration.

## Consequences (if version check fails)
- Status remains Proposed.
- ADR-0006 remains the operative decision.
- Revisit when TerminusDB is upgraded.

## Related
ADR-0006 (minimum cardinality enforced by API — to be superseded by this ADR if accepted)
