# ADR-0010: Intentionally Deferred Schema Features

## Status
Accepted

## Context
Several features were identified as potentially valuable but excluded from the initial schema to keep the design focused and the implementation scope manageable for the demo phase.

## Decision
The following are intentionally absent from the current schema:

### Versioning and change history
No `version`, `createdAt`, or `updatedAt` fields on any document type. TerminusDB provides built-in branch and commit history at the database level — every write is recorded with a timestamp and can be traversed. This may be sufficient for Armature's needs without per-document version fields. Revisit when branching and diffing use cases become concrete.

### Authorship and provenance
No `createdBy` or `updatedBy` fields. These would require a `User` or `Agent` type and an authentication model. Deferred until the multi-user collaboration use case is defined. When added, the cleanest approach is a shared abstract base class or mixin that all document types inherit, rather than adding fields individually.

### Knowledge components
The diagram notes knowledge components as future work for `ActivityGroup` reusability beyond the flat single-level constraint. Not modeled until the use case is concrete.

### xAPI, LTI, and QTI integration points
Interoperability with external standards is an API-layer concern — the schema does not need to model it. xAPI statements reference Armature documents by URI; LTI launch parameters are passed at delivery time; QTI export is a serialization of `AssessmentItem` and `Response` data. None require schema changes.

## Consequences
- The schema is simpler and more focused for the demo phase.
- Each deferred feature has a clear rationale for deferral and a note on the likely implementation approach when the time comes.
- TerminusDB's database-level history reduces the urgency of per-document versioning — this should be evaluated before adding version fields.
