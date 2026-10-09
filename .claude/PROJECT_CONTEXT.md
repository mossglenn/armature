# Armature — Project Context

This file provides background on the problem space, audiences, strategic positioning, and demo goals. Read this to understand *why* decisions are made, not just *what* was decided. The same material, expanded for human readers with the full history and every mechanism, is in `docs/how-armature-works.md`.

---

## The Problem Armature Addresses

### The visibility gap in instructional design

Instructional design is increasingly practiced as a discipline that aspires to engineering rigor — evidence-based, systematic, measurable. But the tooling doesn't support that aspiration at the design stage.

Current tools (authoring tools, LMS platforms, analytics systems) capture:
- What content was built
- How learners performed after delivery

They don't capture:
- Why design decisions were made
- How artifacts relate to each other
- What evidence informed an objective
- Why one objective was designated a prerequisite for another

This means the design process itself is not inspectable data. It lives in documents, email threads, and designers' memories. When a course needs revision, you can see what exists — you can't easily see why it was designed that way.

### The structural absence

This isn't a workflow problem — it's a structural one. No junction exists to hold a prerequisite relationship's rationale. No schema connects an objective to the learning need that generated it. Even if designers wanted to record these decisions, the tools don't provide a place to put them.

Armature provides that structure.

### Why this matters for learning engineering as a field

Engineering disciplines mature by studying the relationship between process and outcome. Learning engineering can rigorously study *what works* — which artifacts produce which outcomes — but not *what design practices produce things that work*. Until the design process becomes inspectable data, the ability to study and improve learning engineering as a design discipline remains structurally limited.

---

## Audiences

### Primary: ICICLE research community (IEEE Industry Connections Industry Consortium on Learning Engineering)
Learning engineering researchers who will evaluate Armature as a contribution to the field's infrastructure. They care about:
- Theoretical grounding (why this matters for the field)
- Technical rigor (is the schema well-designed?)
- Novelty (what doesn't exist yet that this addresses?)
- Reproducibility (can design processes be studied with this?)

### Secondary: Potential employers and collaborators
Technical hiring managers and learning engineering leads evaluating Amos's work. They care about:
- System design capability
- Clarity of problem framing
- Evidence of thoughtful trade-offs
- Practical demo (does it actually work?)

### Tertiary: Instructional design practitioners
Designers who might use tools built on Armature. They care about:
- Does this solve a real workflow problem?
- Is CoQui worth trying?
- Can I understand what this graph thing does in plain language?

---

## Positioning

### What Armature is not
- Not an LMS
- Not a content repository
- Not an adaptive learning engine
- Not a post-delivery analytics platform

### What Armature is
Infrastructure — the layer underneath tools that makes design decisions visible and queryable. Like Git underneath text editors, or a database underneath an application.

### Relationship to existing systems
- **LearnSphere / DataShop (CMU):** Post-delivery analytics. Studies what learners did. Armature is pre-delivery design infrastructure. They are complementary — Armature could feed data downstream to LearnSphere, closing the full loop from design decision through learner outcome back to design revision.
- **OLI / Torus (CMU):** Integrated authoring and delivery platform with relational (Postgres) backend. Not a graph. No design rationale capture. Armature differs by modeling relationships explicitly and treating the design process as primary data.
- **xAPI / LTI / QTI / CASE:** Standards for interoperability: xAPI (Experience API) for learning activity records, LTI (Learning Tools Interoperability) for launching tools from an LMS (learning management system), QTI (Question and Test Interoperability) for assessment items, CASE (Competencies and Academic Standards Exchange) for competency frameworks. Armature references these by identifier (plan principle P6; external references planned for Phase 6) rather than competing with or translating between them.

---

## Demo Goals

Two narratives need to be demonstrable:

### Narrative 1: Graph intelligence (outcomes → design)
Show how outcome data can be traced back through the graph to identify at-risk objectives.

Flow: LearningMetric → (derivedFrom) LearningDataset → (producedBy) Assessment → ItemInstance → AssessmentItem → (assesses) LearningObjective → ModuleObjective → Module, then the coverage read for that module

The trace read (`GET /api/v1/intelligence/trace/LearningMetric/<id>`) walks this path; the coverage read answers the last question. "Adequate *when*" needs the commit the cohort's assessment was taken from, which is ADR-0057's proposal (`asOf`); until it lands, coverage can be read at any commit but nothing records which one the administration used.

The demo should show: "Here's a cohort that performed poorly. Here are the items they struggled with. Here are the objectives those items assess. Here's the module that declared those objectives. Here's whether the module's assessment coverage was adequate."

This demonstrates Armature as post-delivery intelligence infrastructure.

### Narrative 2: Graph-informed authoring (design → graph)
Show CoQui using Armature graph data to inform decisions during item authoring.

Flow: Designer creates/edits an AssessmentItem → CoQui queries the Armature coverage and alignment reads → UI surfaces which objectives are under-assessed (the projected figure shows progress while items are still in review)

This demonstrates Armature as pre-delivery design-time intelligence.

### Demo environment
- Local: TerminusDB in Docker Compose and the API on the host (`npm run dev`) for screen-capture video; Phase 7 containerizes the API so Compose runs both
- Web: Deployed to Railway or Render for stakeholder access
- Seed data: A realistic but fictional course ("Introduction to AI for Instructional Designers", 48 documents). It has no activities, datasets or metrics yet, so Narrative 1 is demonstrated in tests that write a dataset and metric on a scratch branch; seeding one dataset is planned for Phase 6

---

## Reference Clients

CoQui is the only real client, and a hub shaped to fit one client is a backend, not infrastructure. To keep the hub generic, every ask is tested against the tools below (the two-client test, CLAUDE.md Development Principle 6): a capability enters the hub only when at least two of these clients would need it, and only in the generic form they share. The table is a checklist, not a commitment to build anything. `docs/development-plan.md` §2 applies it to each of CoQui's asks; the table below is copied from there, which is the authoritative version.

| Reference client | What it does | What it needs from the hub |
|---|---|---|
| **CoQui** (real) | SME review of assessment items in rounds | Read by id at a commit; branch per round; replace-by-id writes; findings; attestations on item parts; users; history |
| **Objective and curriculum mapper** | Author objectives, prerequisites, module declarations; link to CASE competencies | Transitive prerequisite queries; objective history and impact analysis; external competency references; ModuleObjective writes; coverage reads |
| **Needs-analysis intake** | Record evidence, needs, priorities; the LEED-tracker decision log as a graph | Evidence and need writes; NeedEvidenceLink confidence; DesignNote and a future DesignDecision; provenance trace from objective back to evidence |
| **Activity and strategy designer** | Plan activities and groups per module; see strategy coverage | Sequenced module content (ADR-0005); "which objectives have no Practice activity" queries; ActivityGroup flatness enforced |
| **Outcomes importer** | Pull results from an LMS, DataShop or Torus; close the loop (Narrative 1) | LearningDataset and LearningMetric writes; item statistics (stored or computed: see §6); xAPI and QTI references; bulk atomic writes |
| **Research exporter** | Produce comparable, anonymized design-data corpora across courses | Schema slices; JSON-LD export at a commit; export profiles with pseudonymization (ADR-0021); schema self-description; attachments resolvable or deliberately excluded per profile |
| **AI design assistant** | Propose items, objectives or alignments inside another tool | Agent `User` provenance; design-intelligence reads for context; the same write path and constraints as humans |
| **Rich item authoring tool** | Author drag-and-drop, hotspot and media-bearing items on a shared item bank | Items as a tree of addressable fragments, typed or generic; attachment references on fragments; interaction types with versioned renderers; impact analysis when a renderer or an image changes; the same review surface CoQui uses |
| **Complex learning object designer** (distant) | Develop simulations and other multi-file learning objects, with their own asset store or the hub's | References to a revision of an asset tree, with hash and reason; impact analysis when an asset revision moves; attestations and findings against a revision; the asset store's history reachable, not replayed |

Three CoQui concepts fail the test and never enter the hub: the **round**, the **craft grid**, and CoQui's **review workflow states**. They map onto branches, `claimRef`, `ItemStatus` and `User` at CoQui's boundary.

---

## CoQui

CoQui is the first plugin built on Armature. It is an assessment-item tool that addresses the SME (subject-matter expert) review bottleneck in instructional design workflows: it structures expert review of items in rounds and records findings and judgments on items and their parts.

**Why CoQui is the first plugin:**
- Solves a concrete, real workflow problem (SME review of assessment items)
- Assessment items are the most relationship-dense artifact type in the graph
- Building it validates the API design before investing in more complex tools
- Demonstrates the hub-plugin architecture concretely

**CoQui is a separate repository.** It is not part of this repo. The boundary: anything that is Armature graph infrastructure lives here. Anything that is CoQui's authoring UX, workflow, or SME collaboration features lives in the CoQui repo.

CoQui will be built fresh against the Armature API — not retrofitted from a previous table-based design.

---

## Technical Decisions Already Made

These are settled. Don't re-open them without a strong reason.

- **TerminusDB** as the graph store (closed-world assumption, deterministic queries, document model)
- **All relationships use references, not ownership** (ADR-0002); an item's parts are the one embedded exception (ADR-0022, ADR-0033)
- **Junction documents for semantically rich M:M relationships** (ADR-0003)
- **Back-references on children** (ADR-0004)
- **Shared integer sequence space for module content** (ADR-0005)
- **Minimum cardinality is enforced at schema level** (ADR-0013, superseding ADR-0006); the rules the store cannot express are enforced by the API's invariants engine
- **ModuleObjective is the junction for a module's declaration of an objective** (ADR-0007), written by clients through the generic document API, and carries no computed value: coverage is derived on read, never stored (ADR-0056). (ADR-0007 originally said it would be created programmatically by the API and not edited through a UI; that is not what was built)
- **The API is a boundary CoQui never crosses** — plugins talk to Armature routes, never to TerminusDB. The API is a host-neutral Hono application under `/api/v1` (ADR-0054), served by the Next.js app in this repo for the current phase (ADR-0026); a separate process serving the same application remains the destination and the triggers for the move are recorded in ADR-0026

---

## Open Questions

These are not yet decided. Treat them as design questions to explore, not gaps to fill arbitrarily.

- **Authentication model:** Not needed for the demo. Identity *resolution* is built (ADR-0032, Phase 3): a pluggable resolver, currently a trusted `Armature-User` header, maps a request to a `User` on `main`. *Authentication* (an `oidc` resolver, OpenID Connect) is named and deferred until a deployment leaves the local machine.
- **Merge policy, project boundaries, AI provenance beyond `createdBy`, lossless writes across schema versions, whether item statistics (`difficultyIndex`, `discriminationIndex`) are stored observations or computed reads, the unbuilt `GET /api/v1/schema`:** see `docs/development-plan.md` §6 for each question and the evidence that would settle it.

Resolved since this list was written: the API framework question (ADR-0026 as amended by ADR-0054: the API is a Hono application hosted by Next.js for now; no Express or Fastify service); the seed data content domain ("Introduction to AI for Instructional Designers", `scripts/seed_data.js`); and the coverage computation algorithm (ADR-0029, 2026-10-08: the verdict is by the number of distinct eligible items placed in the module's assessments, `FullyAssessed` at two to four by default, thresholds provisional and passed as parameters to the coverage read; ADR-0056 the same day: the verdict is computed on read and never stored).
