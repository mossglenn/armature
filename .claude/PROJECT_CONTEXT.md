# Armature — Project Context

This file provides background on the problem space, audiences, strategic positioning, and demo goals. Read this to understand *why* decisions are made, not just *what* was decided.

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

### Primary: ICICLE research community
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
- **xAPI / LTI / QTI:** Standards for interoperability. Armature is compatible with these at the API layer — not competing with them.

---

## Demo Goals

Two narratives need to be demonstrable:

### Narrative 1: Graph intelligence (outcomes → design)
Show how outcome data can be traced back through the graph to identify at-risk objectives.

Flow: LearningDataset → LearningMetric → AssessmentItem → LearningObjective → ModuleObjective (CoverageStatus) → Module

The demo should show: "Here's a cohort that performed poorly. Here are the items they struggled with. Here are the objectives those items assess. Here's the module that declared those objectives. Here's whether the module's assessment coverage was adequate."

This demonstrates Armature as post-delivery intelligence infrastructure.

### Narrative 2: Graph-informed authoring (design → graph)
Show CoQui using Armature graph data to inform decisions during item authoring.

Flow: Designer creates/edits an AssessmentItem → CoQui queries Armature API for objective coverage → UI surfaces which objectives are under-assessed

This demonstrates Armature as pre-delivery design-time intelligence.

### Demo environment
- Local: Docker Compose (TerminusDB + Armature API) for screen capture video
- Web: Deployed to Railway or Render for stakeholder access
- Seed data: A realistic but fictional course with enough artifacts to make both narratives compelling

---

## CoQui

CoQui is the first plugin built on Armature. It is an assessment authoring tool — specifically, it addresses the SME review bottleneck in instructional design workflows.

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
- **All relationships use references, not ownership** (ADR-0002)
- **Junction documents for semantically rich M:M relationships** (ADR-0003)
- **Back-references on children** (ADR-0004)
- **Shared integer sequence space for module content** (ADR-0005)
- **API enforces minimum cardinality** (ADR-0006)
- **ModuleObjective is programmatic, not UI-editable** (ADR-0007)
- **Separate API service** (not Next.js API routes in CoQui) — the separation demonstrates the hub-plugin architecture

---

## Open Questions

These are not yet decided. Treat them as design questions to explore, not gaps to fill arbitrarily.

- **API framework:** Express vs. Fastify. No strong reason to prefer one yet.
- **Seed data content domain:** What is the demo course about? Should be realistic enough to be convincing, simple enough to build quickly.
- **Coverage computation algorithm:** What exactly makes a `CoverageStatus` value "FullyAssessed" vs. "PartiallyAssessed"? Needs definition before the API can implement it.
- **Authentication model:** Not needed for the demo. Deferred per ADR-0010.
