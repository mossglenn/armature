# ADR-0015: User Type and Authorship Model

> **In brief.** Armature records who created each design record. This decision separated three jobs:
> an outside login system proves who someone is, the database controls who may access it, and
> Armature keeps its own `User` record for each participant, which travels with the design data.
> Each named record gets a `createdBy` pointer to a `User`. It still holds; ADR-0032 later built the
> identity lookup and tightened two details: every write through Armature's application programming
> interface (API) must now identify its author, and a `User` is created automatically only when the
> login supplies a display name. (ADR stands for Architecture Decision Record.)

## Status
Accepted

**Amended by ADR-0032** (2026-10-08), which implements this boundary. `main` is the `User` registry.
Identity comes from a pluggable resolver (`ARMATURE_IDENTITY`: `header` by default, reading
`Armature-User: <externalId>`; `oidc`, for OpenID Connect, named but not built). First-encounter
creation happens only when the claims carry a `displayName`, which the header resolver never
supplies. Every API write requires an identity (401 `identity_required` or `unknown_user`) and sets
`createdBy` on create, preserving it on replace. ADR-0025 confirms the "no `updatedBy`" decision.

## Context
With ArmatureDocument established as the abstract base for all primary artifact types (ADR-0014), the path to authorship is clear: add a `createdBy` field to `ArmatureDocument` referencing a `User` type. The design question is where the lines are between three distinct systems: the external auth system (identity), TerminusDB (database access control), and Armature (design process participation).

## Decision

### Boundary model
Three systems, three responsibilities:

- **External auth system** (OIDC, SSO, or similar): authenticates identity. Armature does not manage passwords, sessions, or tokens.
- **TerminusDB**: controls database-level access (read/write/admin roles on the database instance). This is infrastructure configuration, not domain data.
- **Armature `User` type**: represents a person or system agent as a participant in the design process. This is domain data — it travels with the graph on export.

The Armature API sits at the junction between auth and schema: when a request arrives with an authenticated identity, the API resolves it to a `User` document (creating one on first encounter) and writes that reference into `createdBy` at document creation time.

> **Later change (2026-10-08):** As built (ADR-0032, `app/lib/api/identity.ts`), the API creates a
> `User` on first encounter only when the identity claims carry a `displayName`. The default header
> resolver supplies only an `externalId`, so with it a `User` is registered first through
> `POST /api/v1/users` on `main`, and an unregistered identity is refused with 401 `unknown_user`.

### User type
`User` is a standalone document type — it does not inherit from `ArmatureDocument`. It is infrastructure for the design process, not an instructional design artifact, and should not be a valid subject of a `DesignNote`.

> **Later change (2026-10-08):** Enforced since Phase 3 (2026-10-08): `User` is outside
> `DesignRecord` (ADR-0017), and the API rejects a `User` as a note's subject (constraint 0,
> `app/lib/api/invariants/references.ts`).

Fields:
- `displayName: xsd:string` — human-readable name for UIs and exports
- `externalId: xsd:string` — stable identifier from the auth system (e.g., OIDC `sub` claim). Used by the API to resolve authenticated identities to User documents.
- `email: Optional<xsd:string>` — human-readable identity for exports and cross-deployment contexts. Optional because not all deployments expose email and system agents have none. Will often match `externalId` but serves a different purpose: `externalId` is for machine resolution, `email` is for human-readable identity.
- `institution: Optional<xsd:string>` — organizational affiliation. Makes User records meaningful in collaborative contexts and exported graphs where participants come from different organizations.

### createdBy on ArmatureDocument
`createdBy: Optional<User>` is added to `ArmatureDocument`, propagating to all 13 inheriting types. Semantics: "who or what is responsible for this record entering the graph."

> **Later change (2026-10-08):** `ArmatureDocument` has 13 direct subtypes and 14 concrete
> descendants today (`Response` removed by ADR-0022, `DesignFinding` added by ADR-0020). The same
> holds for the count in Consequences.

- For designed artifacts: the designer who authored it.
- For evidence and dataset records: the person who entered or imported the data.
- For system-generated records (future): a system agent `User` document.

**Optional** to accommodate single-user and demo contexts without a full auth system. When auth is not configured, `createdBy` is simply unset.

> **Later change (2026-10-08):** There is no unauthenticated write path. Every API write requires an
> identity (401 `identity_required` without one), and the API sets `createdBy` on create and
> preserves it on replace (ADR-0032). `createdBy` stays Optional because documents written outside
> the API (the seed, administrative scripts, imports) may lack it.

**`createdBy` only, no `updatedBy`**: change history is tracked at the TerminusDB commit level. Adding `updatedBy` as a schema field would record only the most recent editor, obscuring the original design decision author. TerminusDB's commit log provides full change history without schema involvement.

## Consequences
- `User` documents are first-class graph citizens and travel with the graph on export. `externalId` and `email` make identities interpretable without the original auth system.
- `createdBy` propagates to all 13 `ArmatureDocument` inheritors in a single field definition.
- The TerminusDB internal user model is entirely separate — configuring database access control has no effect on Armature `User` documents and vice versa.
- When a `User` document is deleted, `createdBy` references on `ArmatureDocument` instances become dangling. API should prevent `User` deletion if any `createdBy` references exist, or handle as a soft-delete (deferred).

  > **Later change (2026-10-08):** The API exposes no document deletion, `User` included: lifecycle
  > changes are status changes and deletion is an administrative operation (ADR-0024 decision 5).
  > `User` documents are created on `main` only (ADR-0032).
- `externalId` values may not resolve in a new deployment's auth system after export/re-import. The `User` document is intact and human-readable via `displayName`, `email`, and `institution`; only the API's identity-resolution lookup is affected.

## Related
ADR-0010 (authorship deferred, now implemented), ADR-0014 (ArmatureDocument base class), ADR-0032 (identity resolution: implements this boundary; `main` is the `User` registry; first-encounter creation only when the claims carry a `displayName`; `createdBy` set on create and preserved on replace), ADR-0017 (`User` outside `DesignRecord`), ADR-0024 (no deletion through the API), ADR-0025 (change history in the commit graph; confirms no `updatedBy`)
