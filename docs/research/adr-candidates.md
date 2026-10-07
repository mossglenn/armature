# ADR candidates from the standards-precedents research

**Date:** 2026-10-06 · **Status:** Candidates, not decisions. Each entry is a proposal to write an ADR; none is Accepted.
**Source:** `docs/research/learning-data-standards-precedents.md` (snapshot of the Claude Doc *What Armature Can Learn from Learning-Data Standards*). Section names below refer to that document.

ADR-0024 to ADR-0034 are already reserved by `docs/development-plan.md` §5. This list does two things:

1. **Amendments** to those reserved ADRs, so the research lands in decisions already planned.
2. **New ADR candidates**, numbered provisionally from ADR-0035. Renumber freely; the order is by when each is cheapest to decide, not by importance.

Priority: **High** = decide before the phase named, because getting it wrong costs data or a migration. **Medium** = decide when the phase starts. **Watch** = record the question; wait for evidence (the plan's two-client test, ADR-0010).

---

## Part 1: Amendments to reserved ADRs

| ADR | Planned title | What the research adds | Precedents |
| --- | --- | --- | --- |
| 0024 | Client-supplied identifiers | IDs are opaque (UUID/ULID), never derived from position or sequence. Import never regenerates IDs silently; any remap is a mapping document recorded in the commit. Restate ADR-0016's rule that keys never contain mutable fields. Cross-reference ADR-0035 (lossless writes). | Torus `ids_added` backfill; OATutor step-ID overflow; Twine unstable PIDs; Adapt regenerating IDs on import |
| 0025 | Design process data lives in the commit graph | Add git-style commit trailers for delegation: `On-behalf-of:` (the person an agent acted for) and `Plan:` (task or prompt reference). Defer pinning and history-rewrite rules to ADR-0036 and releases to ADR-0037. | W3C PROV-O `actedOnBehalfOf` and `Plan`; PAV `authoredBy` vs `curatedBy` |
| 0027 | Schema self-description via `@metadata` | Extend `@metadata` to a relation-type registry: endpoint classes, inverse, transitivity, whether the type feeds coverage or carries outcome data, maturity (development / stable / deprecated), and its SKOS, CTDL-ASN or IEEE SCD export term. Add a `reserved` list of retired property names that CI refuses to reuse. | CaSS (declared but inert relation types); OpenTelemetry stability levels; Protobuf `reserved`; SKOS mapping properties |
| 0028 | Attestation | Give alignment claims ECD/Toulmin semantics: claim, evidence, warrant, optional rebuttal, plus method (human, ML-suggested, imported) and confidence. Withdrawal is a status, never a disappearance. Read the shape as a nanopublication (assertion, provenance, publication info) so a content-hash ID can make exported attestations tamper-evident; Verifiable Credentials only when one must travel between institutions. | CaSS assertions; Mislevy (2003) assessment arguments; xAPI voiding; nanopublications; W3C VC 2.0 |
| 0029 | Coverage algorithm | A coverage verdict names the alignment model it rests on (ADR-0043) and the confidence of the alignments it counted. Report completeness per module (objectives with evidence, alignments with provenance) instead of making those fields required. | Herman, Webb & Zuniga 2005 (kappa .56 at fine grain); DataShop KC models; Ochoa & Duval metadata-quality metrics |
| 0030 | External references and attachments | `ExternalRef` gains the framework version, the source's change date, the retrieval date and a snapshot of the statement text. An attachment revision may carry an **address manifest** so design relations can point inside an asset as `{attachment, revision, addressId}`, validated when the revision moves. Consider SWHID-style typed hashes (file vs tree). | CASE minor edits under the same GUID; Lightcast 4-week refresh; PhET-iO API files; SWHID / ISO 18670 |
| 0031 | Export profiles and schema slices | Three weights: `thin` (IDs, labels, links, alignments), `full` (JSON-LD at a commit plus attachment manifest), `research` (RO-Crate with schema version, change-operator log, PROV-O provenance, pseudonymization method). Select by `_profile`; add `Accept-Profile` only if the W3C draft settles. | Thin Common Cartridge; LTI Deep Linking; RO-Crate; W3C Content Negotiation by Profile (Working Draft) |
| 0033 | Items as a tree of fragments | Put `{interactionType, typeVersion}` on every item in Phase 1, before the registry exists, so migrations can select items by query. Share the extension shape from ADR-0040 for generic fragment payloads. | Torus `ActivityRegistration` and Adapt `_component` both lack a version |
| 0034 | Interaction types and renderers | Items pin a renderer *major* version; minors and patches apply automatically; several majors stay installed side by side. Each renderer version ships declarative migrations with test fixtures, run by the hub as migration commits on a branch, never in place and never client-side. | H5P `upgrades.js` and stranded content; Twine story formats; PhET-iO five-year stability; Adapt `adapt-migrations` |

---

## Part 2: New ADR candidates

| # | Title | Phase | Priority | Depends on |
| --- | --- | --- | --- | --- |
| 0035 | Lossless writes across schema versions | 3 | High | 0024 |
| 0036 | Immutable shared history and durable pins | 2 | High | 0025 |
| 0037 | Release pointers for delivered design states | 2 | Medium | 0036 |
| 0038 | Schema change operators and compatibility rules | 0–1 | High | 0027 |
| 0039 | API evolution: capabilities, projections and cadence | 0 / 7 | Medium | 0026, 0038 |
| 0040 | Extension model and promotion path | 1 | Medium | 0033 |
| 0041 | Profiles as enforceable constraint documents | 3 | Medium | 0040 |
| 0042 | Local structure and external alignment as separate classes | 6 | Medium | 0027, 0030 |
| 0043 | Alignment models as competing, scored hypotheses | 4 | Medium | 0028, 0029 |
| 0044 | Supersession on change of meaning | 5 | Medium | 0036 |
| 0045 | Delivery placements and runtime identity | 6 | Medium | 0037 |
| 0046 | Change feed and time-addressable reads | 2 | Medium | 0036 |
| 0047 | Instance IRIs and cross-instance identity | 1 | Medium | 0024 |
| 0048 | Canonical identity hash for idempotent import | 6 | Watch | 0031 |
| 0049 | Rationale capture conventions | 5 | Medium | 0025 |
| 0050 | Stating the schema's pedagogical assumptions | Any | Watch | — |
| 0051 | Coarse activity descriptors | Later | Watch | 0040 |
| 0052 | Item templates and generated items | Later | Watch | 0033 |
| 0053 | Valid time on releases and placements | Later | Watch | 0037, 0045 |

### ADR-0035: Lossless writes across schema versions

- **Context.** ADR-0024 makes writes replace a document by ID. When the schema adds a field, a client built against the older schema reads the document, edits it, and writes it back without the field, silently erasing data written by newer clients.
- **Candidate decision.** Every write declares the schema version or capability set it was built against. The hub carries forward any field that version could not see. The generated SDK also preserves unknown fields and unknown enum values on round trip. The hub is the backstop because not every client will use the SDK.
- **Precedents.** Kubernetes requires lossless round trips between served versions; Protobuf preserves unknown fields.
- **Open question.** Whether to reject, rather than merge, a write from a client more than one major schema version behind.

### ADR-0036: Immutable shared history and durable pins

- **Context.** Attestations (`asOf`), findings, datasets and exports will store commit IDs. CoQui already found that branch operations can give commits new IDs.
- **Candidate decision.** No squash, rebase or reset on `main` or on any branch whose commits another document references. Evidence documents store the referenced document's content hash beside the commit ID as a second check.
- **Precedents.** Torus publications; Moodle `question_references`; Open Badges 3.0 copying the definition into each signed award.

### ADR-0037: Release pointers for delivered design states

- **Context.** "What was delivered to the Fall cohort" needs a stable name for a commit that is not a moving branch head.
- **Candidate decision.** A named, immutable pointer to a commit. Use TerminusDB tags if they exist (not yet verified); otherwise a small `Release` document holding a commit ID. Placements and datasets reference releases.
- **Precedents.** OLI Torus Publications; Open edX Learning Core Draft/Published pointers.

### ADR-0038: Schema change operators and compatibility rules

- **Context.** Scalar-to-pointer migrations and other schema changes need a migration, a backward projection and an SDK changelog that agree.
- **Candidate decision.** Record every schema change as a named operator (add optional field, rename with alias, decompose scalar into class, retire). Each operator generates the TerminusDB migration (`CreateClassProperty`, `ChangeKey`, `DeleteClass`), the backward projection and the SDK diff. CI enforces compatibility rules: additive optional fields are free, renames need an alias, retired names are reserved.
- **Precedents.** PRISM schema modification operators (Curino et al. 2008); Avro/Protobuf compatibility modes.

### ADR-0039: API evolution: capabilities, projections and cadence

- **Context.** The project prefers semantic capability negotiation to a monolithic API version. The research says capabilities alone do not handle shape changes.
- **Candidate decision.** Capabilities for features (`coverage.read`, `attestation.write`, `fragments.generic`), negotiated LSP-style. Versioned projections for the rare breaking shape change, Stripe-style. Breaking changes batched into announced releases with long overlap. Stable names stay stable; projections are the exception.
- **Precedents.** LSP `initialize`; Stripe version-change modules; Kubernetes conversion; Ed-Fi break-rest cadence; OpenTelemetry's moratorium on schema transforms.

### ADR-0040: Extension model and promotion path

- **Candidate decision.** Plugin-owned data is an optional set of `{uri, value}` extensions on any document. The URI resolves to an `ExtensionDefinition` with an owner, a JSON Schema, a maturity level and a `modifier` flag for extensions consumers must not ignore. An extension used by two reference clients becomes a promotion candidate; after promotion the extension form is still accepted for one release.
- **Precedents.** FHIR extensions and `modifierExtension`; xAPI IRI-keyed extensions; Ed-Fi "if possible, avoid extensions"; Open edX ADR 0002 (export without plugin code).

### ADR-0041: Profiles as enforceable constraint documents

- **Candidate decision.** A profile document lists required classes and fields, allowed relation types and cardinalities. Writes declare a profile; the invariants engine enforces it. CoQui's needs and research slices are profiles.
- **Precedents.** xAPI Profiles saw low adoption because nothing enforced them; Caliper 1.2 profiles; FHIR Implementation Guides.

### ADR-0042: Local structure and external alignment as separate classes

- **Candidate decision.** Within-graph structure (prerequisite, part of) and mappings to external frameworks are different junction classes. External mappings carry graded strength (exact, broad, narrow, close, related). Only `exact` chains.
- **Precedents.** SKOS separates `broader` from `*Match`; CASE mixes `isChildOf` and `exactMatchOf` in one enum; ASN/CTDL-ASN graded alignments; only 542 of 5,175 ESCO–O*NET matches were exact.

### ADR-0043: Alignment models as competing, scored hypotheses

- **Candidate decision.** An `AlignmentModel` is a named set of item or fragment → objective mappings. Several coexist, with two automatic baselines. One is preferred for coverage. The outcomes importer scores each against datasets and records fit as findings. Narrative 1's "at-risk objective" names its model.
- **Precedents.** DataShop / LearnSphere KC models; Stamper & Koedinger 2011; caution from "Better Model, Worse Predictions" (AIED 2021).

### ADR-0044: Supersession on change of meaning

- **Candidate decision.** Wording fixes edit an objective in place. A change of meaning creates a new objective linked by `replacedBy`; the old one is retired, never deleted. This is supersession between artifacts, not the "new version of" relation ADR-0025 rejects.
- **Precedents.** CASE 1.1 implementation guide; xAPI activity-definition rules; ESCO's three migration options for obsolete concepts.
- **Open question.** Who decides that meaning changed, and whether the hub can flag likely cases (for example, a changed Bloom level).

### ADR-0045: Delivery placements and runtime identity

- **Candidate decision.** A placement document links a design artifact, at a release, to its runtime identity: an LTI resource link, an xAPI activity IRI or a QTI identifier. The Armature ID is never reused as the runtime ID. Delivery tools are asked to carry Armature IRIs in statement context.
- **Precedents.** cmi5 (activity ID "MUST NOT match" the publisher ID); LTI `resource_link.id` and `id.history`; ADL Total Learning Architecture.

### ADR-0046: Change feed and time-addressable reads

- **Candidate decision.** `GET /changes?since=<cursor>` returns upserts, status-change tombstones and identity remaps behind an opaque cursor. Every document is readable at a commit, and has a list of its past states.
- **Precedents.** Ed-Fi change queries, `/deletes`, `/keyChanges`; Memento (RFC 7089).

### ADR-0047: Instance IRIs and cross-instance identity

- **Candidate decision.** Mint IRIs under an instance base URI from the first write; client-supplied IDs become the local part. Documents may carry a `sameAs` set. An instance registry is built only if the hub consults it at write time.
- **Precedents.** ASN statement URIs; Open edX taxonomy `export_id`; I2IDL glossary URIs; the archived ADL xAPI Profile Server.

### ADR-0048: Canonical identity hash for idempotent import

- **Candidate decision.** Each type defines a canonical hash of its content minus IDs and audit fields, used to detect duplicates when re-importing research slices or merging instances.
- **Precedents.** Moodle question restore.

### ADR-0049: Rationale capture conventions

- **Candidate decision.** The commit message is required and is the primary rationale. Design notes may carry the seven LEED influence codes as an optional facet. Decision records, when the structured type arrives, use ADR-style status (proposed, accepted, superseded). A note whose subject changed after it was written is reported stale.
- **Precedents.** Architecture Decision Records; MIT LEED tracker (Totino & Kessler 2024, 2025); SEURAT; capture-burden findings (Buckingham Shum & Hammond 1994; Shipman & Marshall 1999).

### ADR-0050: Stating the schema's pedagogical assumptions

- **Candidate decision.** A short schema-level statement of the pedagogical assumptions built into the core classes (for example, objectives as the central node), framed as pedagogical pluralism rather than neutrality.
- **Precedents.** Larnaca Declaration; critiques of IMS LD's neutrality claim; Bowker & Star (1999).

### Watch list: ADR-0051 to ADR-0053

- **0051 Coarse activity descriptors.** Optional activity type (OULDI seven or Laurillard six, as a namespaced code) plus duration on `Activity`. Evidence: Rienties & Toetenel 2016. Trigger: a research partner wants to rerun learning design–analytics studies.
- **0052 Item templates and generated items.** `ItemTemplate` plus a binding table, with "generated from" as a relation. Evidence: CTAT mass production, OATutor. Trigger: the first parameterized item bank.
- **0053 Valid time on releases and placements.** Commits record when the database learned something, not when a design was in force. Trigger: the first cross-term comparison.
