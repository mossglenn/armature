# Armature: Schema Precedents and Plugin Candidates

Oct 19, 2026 · @Amos Glenn

## Scope

This doc lists outside projects worth studying for Armature's schema, and tools that could become Armature plugins or show how a plugin system should work. Only kept findings appear; rejected candidates are left out.

Results were checked against the repo's schema guide, ADR list and development plan. Standards Armature already names (CASE, QTI, xAPI, LTI, H5P/PCI, DataShop, Torus as a data source) appear only where they add a new angle. Notable gaps in Armature's own docs: no MCP server, no capability negotiation beyond the `/api/v1` prefix, and no built `GET /api/v1/schema` or typed client yet.

## Part 1: Projects to incorporate or learn from

The strongest finds independently validate decisions Armature already made (fragment addressing, attestation) and supply ready vocabularies for deferred work (`DesignDecision`, `externalRefs`, AI provenance).

### A. Rationale, claims and attestation

These bear on `DesignNote`, `DesignFinding`, `Attestation` and the deferred `DesignDecision`.

| Project | What it offers | Where it lands in Armature |
| --- | --- | --- |
| [W3C Web Annotation Data Model](https://www.w3.org/TR/annotation-model/) (Recommendation, 2017) | Annotations target a `{source, selector, state}` resource; `FragmentSelector` and `State` sit beside a `motivation` vocabulary (assessing, commenting, questioning, moderating, describing) | Near-exact match to `{subject, fragmentId, asOf}`. Best outside validation of ADR-0028; a JSON-LD export shape for notes, findings and attestations; a vocabulary to compare with `DesignNoteCategory` |
| [Design Intent Ontology (DIO)](https://w3id.org/dio/) | IBIS-derived: Design Issue, Alternative vs. Mandated Solution, Argument/Justification backed by Evidence, Design Decision; issue status Active, On Hold, Resolved, Terminated; PROV-typed agents and entities | Worked shape for the deferred `DesignDecision` and `relatesToDecision`; informs the deferred fourth `DesignFinding` status. Single-author 2016 work, no stated license: borrow the structure, don't import it |
| [Micropublications](https://pmc.ncbi.nlm.nih.gov/articles/PMC4530550/) (Clark et al., 2014) | Claims supported or challenged by evidence, forming argument graphs | `NeedEvidenceLink(confidence)` and `DesignFinding` are claim–evidence relations. Adds the missing *challenges* relation; citable precedent for design relations as arguable claims |
| [Nanopublications](https://nanopub.readthedocs.io/en/latest/publishing/publishing-nanopublications.html) | Assertion, provenance and signed publication info held separately | Closest analogue to `Attestation`. Signing is one long-term answer to the header-trust identity gap; natural format for the research exporter |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/) | Provenance vocabulary that DIO, nanopubs and xAPI Profiles build on | Deferred `proposedBy`/`acceptedBy` is PROV's qualified attribution with roles. Using PROV terms in the JSON-LD export gives interoperability for free |

### B. Competency and objective graphs

These bear on `LearningObjective`, `PrerequisiteRecord` and the reserved `externalRefs` slot.

| Project | What it offers | Where it lands in Armature |
| --- | --- | --- |
| [CaSS](https://github.com/cassproject/CaSS) (Apache 2.0) | Frameworks, competencies, levels, relations, alignments, assertions in schema.org JSON-LD; relations requires, narrows, broadens, is the same as, is equivalent to; assertions with agent, evidence, 0–1 confidence, expiry, signatures | Armature relates objectives only by prerequisite. CaSS shows the next relations designers will want. Its assertion model is a contrast case when defending `Attestation`'s narrower scope |
| [CTDL-ASN alignment terms](https://purl.org/ctdlasn/terms/) | Graded alignment: exact, broad, narrow, major, minor, prerequisite; plus `isVersionOf`, `derivedFrom` | Field-tested scale to seed ADR-0030's enum instead of inventing one |
| [schema.org / LRMI `AlignmentObject`](https://schema.org/AlignmentObject) | `alignmentType` values include assesses, teaches, requires | `AssessmentItem.assesses` and `LearningActivity.targets` map one-to-one; makes JSON-LD export readable by LRMI consumers at near-zero cost |
| [Learning Commons Knowledge Graph](https://docs.learningcommons.org/knowledge-graph/understanding-knowledge-graph/introduction) (CC BY 4.0) | K-12 standards, learning components, progressions and curriculum; [every relationship carries](https://docs.learningcommons.org/knowledge-graph/schema-reference/common-relationship-properties) author, provider, attribution and license; served as JSONL, REST, an MCP server and agent plugins | Closest living example of relationships with provenance in education; its learning components are effectively the deferred knowledge components. Also a Part 2 plugin |
| [curriculum\_knowledge\_graph](https://github.com/devissaputra/curriculum_knowledge_graph) | Research prototype (0 stars, synthetic data): relations as claims with confidence, source, evidence and review date; `alignment_gaps()` flags outcomes with no assessment; coverage stated as not a quality score | Not for adoption. Evidence of independent convergence on Armature's idea; know it before a reviewer cites it |

### C. Learning-design lineage

| Project | What it offers | Where it lands in Armature |
| --- | --- | --- |
| [ILDE / LdShake + Glue!-PS](https://ilde.upf.edu/api/html/) (METIS, 2012–15) | Shared environment hosting several design tools over REST, from conceptualizing to authoring to deploying; Glue!-PS deployed to Moodle via one adapter per tool representation and one per VLE | Nearest historical precedent for hub plus many design tools. The two-sided adapter split is the plugin/format boundary; why it didn't last is material for the paper |
| [OLI Torus](https://github.com/Simon-Initiative/oli-torus) (MIT) | Resources and revisions frozen into publications that delivery points at; activities referenced, not embedded, each with parts; third-party activity framework | Publications are precedent for naming released commits within `asOf`; activity parts parallel fragments. Already a planned data source and in the CMU network |
| [xAPI Profiles structure](https://github.com/adlnet/xapi-profiles/blob/aaronesilvers-patch-3/xapi-profiles-structure.md) | Versions linked by `wasRevisionOf`; concepts related by SKOS broader/narrower; validation rules as data via JSONPath | Precedent for versioning the 12 enums and a future relation-type registry; shows invariants expressed declaratively |

### D. Typed-graph analogue outside education

| Project | What it offers | Where it lands in Armature |
| --- | --- | --- |
| [Backstage catalog](https://backstage.io/docs/features/software-catalog/descriptor-format) | `apiVersion/kind/metadata/spec` envelope; [relations derived from spec fields and exposed as paired inverses](https://backstage.io/docs/features/software-catalog/well-known-relations) (`ownedBy`/`ownerOf`); organizations add their own kinds | Production precedent for ADR-0004 (reference on the child, inverse computed on read); custom kinds show a plugin-extensible relation registry at scale |

## Part 2: Plugin candidates and plugin exemplars

Categories 1–5 are plugins Armature could have; category 6 is systems whose plugin contracts are worth copying. The most transferable single item is MCP's per-request versioning model, a ready design for ADR-0039.

### 1. Item exporters (CoQui-adjacent)

| Tool | What it does | Why it fits Armature |
| --- | --- | --- |
| [Storyline Excel/text import](https://www.articulatesupport.com/article/Storyline-360-Importing-Questions-from-Excel-Spreadsheets-and-Text-Files) (the project's attached template) | Columns: Question Type, Points, Question Text, up to 10 choices; `*` marks correct, `\|` separates a choice from its feedback; formatting stripped, imports land in a scene not a bank, no IDs or objectives mentioned | Easy mapping: `itemType` to MC/MR/TF, `ItemInstance.pointValue` to Points, options with `isCorrect` and `feedback`. Good first exporter for demos. One-way only: `fragmentId`, `assesses` and `purpose` are lost |
| [text2qti](https://pypi.org/project/text2qti/) (v0.8.0, Aug 2026) | Markdown-like plain text to a QTI 1.2 zip that Canvas imports | Emitting its syntax reaches Canvas without writing QTI. Reversed, it models a plain-text authoring importer that assigns `fragmentId` on parse |
| [R/exams](https://www.rdocumentation.org/packages/exams) (v2.4-4, Jul 2026) | One exercise source rendered to Moodle XML, QTI 1.2/2.1, Canvas, Blackboard, OpenOlat, PDF and scannable forms | Exemplar of one canonical item, many renderers: the pattern ADR-0031 export profiles imply |
| [Moodle import/export format plugins](https://docs.Moodle.org/32/en/Development:Import/export_for_questiontype_plugins) | Question types (`qtype`) and serialization formats (`qformat`, e.g. GIFT) are separate plugin types | Precedent for keeping ADR-0034 (interaction registry) and ADR-0031 (export profiles) as separate axes |

### 2. Item preview and review

| Tool | What it does | Why it fits Armature |
| --- | --- | --- |
| [amp-up QTI 3 item player](https://github.com/amp-up-io/qti3-item-player) (MIT; Vue 3 variant updated May 2026) | Renders QTI 3 assessment items | A reviewer UI that shows items as learners will see them and records an `Attestation`; doubles as a validator for QTI 3 export |

### 3. Outcomes importers (Narrative 1)

| Tool | What it does | Why it fits Armature |
| --- | --- | --- |
| [Canvas Outcome Results API](https://developerdocs.instructure.com/services/canvas/resources/outcome_results) | Results, rollups (course-level `aggregate=course`), contributing scores, mastery distribution | Map Canvas outcomes to `LearningObjective` via `externalRefs`; write aggregates as `LearningDataset` and `LearningMetric`. Course-level only keeps per-user data out (ADR-0021). Results align at quiz level, not item level |
| [Ralph](https://github.com/openfun/ralph) (MIT) | LRS, CLI and library converting edX tracking logs to and from xAPI | Ralph ingests and normalizes; the Armature plugin only aggregates per item and writes `LearningMetric` |
| [GIRTH](https://www.github.com/eribean/girth) (MIT) | Item response theory estimation: Rasch, 1PL/2PL/3PL, graded response, partial credit | Item-analysis worker producing difficulty and discrimination as `LearningMetric` with `subject` = item and `asOf` = the dataset, per ADR-0058. Person-level data never reaches the hub |

### 4. Curriculum and competency mapping

| Tool | What it does | Why it fits Armature |
| --- | --- | --- |
| [OpenSALT](https://opensalt.readthedocs.io) | Open-source CASE framework editor and server | Practical CASE source and sink for the planned objective/curriculum mapper |
| [CaSS](https://cass.credentialengine.org/docs/guide/overview) (as a service) | Competency frameworks and relation types | Import frameworks as objectives |
| [Learning Commons KG](https://docs.learningcommons.org/knowledge-graph/understanding-knowledge-graph/introduction) | REST API and MCP server over an education graph | Suggest standards or learning-component alignments for objectives |

### 5. AI design assistant

| Tool | What it does | Why it fits Armature |
| --- | --- | --- |
| [Cross-Dataset Bloom Question Classification](https://arxiv.org/abs/2606.13684) (Apr 2026) | Supervised classifiers degraded badly on unseen datasets; prompted LLMs with in-context examples plus course-specific verbs were more stable; authors built a UI for classifying whole banks | An `agent:bloom-tagger` user proposes `bloomsLevel` and a human accepts it via `Attestation`: the cleanest agent-provenance demo. Raises a `DesignFinding` when an item's level falls below its objective's. Code release unconfirmed |
| [Learning Commons MCP server](https://docs.learningcommons.org/knowledge-graph/understanding-knowledge-graph/introduction) (exemplar) | Education graph exposed to LLMs over MCP | Armature names no MCP server. A thin `@armature/mcp` over the intelligence reads is the cheapest AI plugin and a strong demo |

### 6. Plugin-architecture exemplars

| System | Contract worth copying | What it would give Armature |
| --- | --- | --- |
| [MCP versioning, revision 2026-07-28](https://modelcontextprotocol.io/specification/latest/basic/lifecycle) | No `initialize` handshake: every request declares its protocol version (`_meta` or `MCP-Protocol-Version` header); unsupported version returns an error listing supported ones; optional `server/discover`; namespaced `extensions` map with a mandatory fall-back-or-reject rule | Design for ADR-0039 in the same stateless-HTTP setting: an `Armature-Capabilities` header, `GET /api/v1/discover`, reverse-DNS capability IDs (answers the open naming question) |
| [VS Code extension manifest](https://code.visualstudio.com/api/references/extension-manifest) | Required `engines.vscode` range (never `*`), `activationEvents`, `contributes`, `capabilities` for untrusted workspaces, `extensionDependencies` | Model for the `@armature/client` contract: required host range plus declared degraded modes |
| [Obsidian manifest](https://docs.obsidian.md/Reference/Manifest) | `minAppVersion` and `isDesktopOnly` on top of the basics | Minimum viable compatibility contract before negotiation exists |
| [Zotero translator framework](https://www.zotero.org/support/dev/translators) | Type bitmask (import 1, export 2, web 4, search 8); stable GUID, `target`, `minVersion`, `priority`; light `detect*` before heavy `do*`; embedded test cases; central repo synced after PR review | Best model for importer/exporter plugins; embedded tests fit the Phase 7 Armature-owned contract test |
| [H5P `semantics.json`](https://h5p.org/semantics) | Content type declares fields; the editor is generated from it and the same file validates content | Pattern for ADR-0034; with ADR-0027 categories and a future `GET /schema`, implies a generic schema-generated editor plugin |
| [Directus extensions](https://directus.com/docs/guides/extensions/overview) | App extensions (interfaces, displays, layouts, panels, modules, themes) vs. API extensions (hooks, endpoints, operations) | Taxonomy for deciding which plugin kinds stay client-side and whether code ever runs in the hub (the plan says not) |
| [Backstage](https://backstage.io/docs/features/software-catalog/well-known-relations) and [Torus](https://github.com/Simon-Initiative/oli-torus) | Plugin ecosystem around a typed entity graph; third-party activity framework in education | Closest structural match to Armature as a whole, and the same idea within its domain |

## Worth capturing

- **Web Annotation as the anchor citation for ADR-0028.** A W3C standard independently arrived at `{subject, part selector, version state}`. Cite it in the paper's literature check and in the ADR's related work.
- **MCP's per-request version and capability model as the starting design for ADR-0039.** It solves the same problem in the same stateless-HTTP setting and is already deployed.

### Open questions

- [x] Draft ADR-0039 from the MCP model? *Done 2026-10-20 as ADR-0059 (Proposed), numbered past the candidate block per the ADR index's rule; it adopts candidate 0039's capabilities half and leaves projections and cadence open.*
- [x] Pick a first exporter: Storyline (demo value) or text2qti (Canvas reach)? *text2qti, decided 2026-10-20; recorded in the development plan §8 with the reasons (an LMS the outcomes importer can read back from; a reversible syntax; no QTI authoring). Plugin work, outside this repository.*
- [x] Add a *challenges* relation alongside `NeedEvidenceLink`, or wait for usage evidence per progressive formalization? *Wait, decided 2026-10-20. `confidence` is reliability, not direction, so a negative value is not the answer; the path when evidence arrives is an optional `relation` enum on the link. Recorded as a plan §6 question with the evidence that would act on it, and noted in the schema guide and explainer.*
