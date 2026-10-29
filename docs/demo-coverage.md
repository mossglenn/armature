# Demo coverage

**Date:** 2026-10-27, graph-native tools added 2026-10-28 · **Status:** Working document. It places the built, planned and proposed client tools against the hub's capabilities, so that the next demo tool is chosen for what no demo shows yet. Read against `docs/development-plan.md` and `.claude/SESSION.md` as of 2026-10-26; update it when a tool changes status or the hub gains a capability.

**How to read it.** Capabilities run down the side and tools across the top. ● means the tool's demo *shows* the capability; ○ means the tool *uses* it without making it the point. Each row gets the hub's own coverage verdict (ADR-0029's default thresholds), counting only ● for the tools in scope: Uncovered is 0, Partially is 1, Fully is 2 to 4, Over is 5 or more. Three verdict columns give the three scopes: built tools only, built and planned, and everything including the proposed tools. *Partial* marks a hub capability that is not finished.

An interactive version of the matrix as of 2026-10-27 (before the three graph-native tools), with a note behind every dot, is a private claude.ai artifact: https://claude.ai/artifact/AYoCccDJUpozFWQakMasNi

Abbreviations: ADR (Architecture Decision Record), MCP (Model Context Protocol), SCORM (Sharable Content Object Reference Model), XLIFF (XML Localization Interchange File Format), SME (subject-matter expert), LMS (learning management system), QTI (Question and Test Interoperability), CASE (Competencies and Academic Standards Exchange).

## The tools

| Tool | Status | What it is |
|---|---|---|
| CoQui | Built | SME review of assessment items in rounds |
| Viewer | Built | The Coverage View and the Design Graph |
| Quiver | Planned | Local-first item manager, and the first client that must merge |
| MCP server | Proposed | Any agent asks design questions through the intelligence reads |
| Storyline bridge | Proposed | Stamps published Storyline packages and joins their results to the graph |
| DataShop bridge | Proposed | Tests the design's alignment against learner data as a DataShop knowledge-component model |
| Q-matrix exporter | Proposed | The alignment at a commit as a Q-matrix for DataShop, knowledge tracing, IRT and diagnosis models |
| Experiment bridge | Proposed | Conditions as branches, delivered through UpGrade or Terracotta, with results per condition |
| Torus bridge | Proposed | Objectives and activities linked with OLI Torus; results arrive through DataShop |
| LEED importer | Proposed | LEED tracker decision logs brought into the graph as notes and evidence |
| Formalizer | Proposed | Proposes structure from the free-text rationale it finds |
| Ripple | Proposed | Edit on a branch, see everything the change touches, every intelligence read compared with `main` |
| Lint | Proposed | Soft design rules, run before and after a merge, including graph patterns: alignment triangles and prerequisite order |
| Drift | Proposed | The delivered course compared with the design it came from |
| Crosswalk | Proposed | Objectives mapped to a standards framework, affirmed by an SME, and where else each standard is taught |
| Whyfinder | Proposed | Why is this here, answered on the live course page as a chain of reasons with its weakest evidence |
| Projection | Proposed | One graph, one document per audience |
| Process miner | Proposed | The commit graph read as a record of design process: did the team design backward? |
| Response tracker | Proposed | What the design changed after each administration's results, and whether the next results moved |
| Structure analyzer | Proposed | Graph algorithms over the design: single points of failure, load-bearing objectives, hidden modules, structural duplicates |

The viewer is counted as a tool because the Coverage View and the Design Graph are clients of the hub like any plugin. Quiver's cells come from its plan as Armature's documents describe it (`mossglenn/quiver`, `docs/plan.md` there); check them against that plan.

## The matrix

| Capability | Built | + Planned | All | CoQui | Viewer | Quiver | MCP server | Storyline bridge | DataShop bridge | Q-matrix exporter | Experiment bridge | Torus bridge | LEED importer | Formalizer | Ripple | Lint | Drift | Crosswalk | Whyfinder | Projection | Process miner | Response tracker | Structure analyzer |
|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Version control** | | | | | | | | | | | | | | | | | | | | | | | |
| Read any record at a commit<br>`?ref= on every read` | Fully 2 | Fully 2 | Over 14 | ● | ● | ○ | ● | ● | ● | ● | ● | ● | ○ | ○ | ● | ○ | ● | ○ | ● | ● | ● | ● | ○ |
| Branches<br>`POST /branches` | Partially 1 | Fully 2 | Over 6 | ● | ○ | ● | ○ | ○ | ○ |  | ● | ○ | ● |  | ● | ● |  | ○ |  |  | ○ |  |  |
| History and changes since<br>`history · changes?since=` | Partially 1 | Fully 2 | Over 10 | ○ | ● | ● | ● | ● | ○ | ○ | ● | ● | ● | ○ | ○ |  | ● |  |  | ○ | ● | ● |  |
| Three-way merge with conflicts *(Partial)*<br>`merge route · policy open (§6)` | Uncovered 0 | Partially 1 | Fully 3 | ○ |  | ● |  |  |  |  | ● | ○ | ○ |  | ○ | ● |  |  |  |  | ○ |  |  |
| **Writes** | | | | | | | | | | | | | | | | | | | | | | | |
| One write path with invariants<br>`generic writes · ADR-0024` | Partially 1 | Fully 2 | Over 8 | ● |  | ● | ○ | ● | ● |  | ○ | ● | ● | ○ | ● |  |  | ● |  |  |  |  |  |
| Batch writes with If-Match<br>`batch · optimistic concurrency` | Uncovered 0 | Partially 1 | Fully 3 | ○ |  | ● |  | ○ | ○ |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |
| Identity on every write *(Partial)*<br>`Armature-User · OIDC not built` | Partially 1 | Fully 2 | Fully 2 | ● |  | ● | ○ | ○ |  |  | ○ | ○ | ○ |  |  |  |  |  |  |  | ○ |  |  |
| **Review** | | | | | | | | | | | | | | | | | | | | | | | |
| Findings and notes, by fragment<br>`ADR-0020 · ADR-0023` | Partially 1 | Partially 1 | Over 10 | ● | ○ | ○ | ○ | ● | ● |  | ● | ● | ● | ● | ● | ● | ● |  | ○ |  | ○ | ○ | ○ |
| Attestations that go stale<br>`ADR-0028` | Fully 2 | Fully 2 | Fully 4 | ● | ● |  | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ |  | ● | ○ | ○ | ○ |  |  |
| **Design intelligence** | | | | | | | | | | | | | | | | | | | | | | | |
| Coverage at any ref<br>`/intelligence/coverage · ADR-0029` | Fully 2 | Fully 2 | Over 10 | ● | ● | ○ | ● | ○ | ● | ○ | ● | ● |  |  | ● | ● |  | ● |  | ○ |  | ○ | ● |
| Alignment<br>`/intelligence/alignment` | Fully 2 | Fully 2 | Over 6 | ● | ● | ○ | ● |  | ○ | ● |  | ○ |  |  | ● | ● |  |  |  |  |  |  | ○ |
| Trace<br>`/intelligence/trace` | Partially 1 | Partially 1 | Over 8 |  | ● |  | ● | ● | ● |  | ○ | ● | ● |  | ○ |  |  | ○ | ● | ● |  | ○ | ○ |
| Impact<br>`/intelligence/impact` | Uncovered 0 | Uncovered 0 | Over 5 |  | ○ |  | ● | ● |  |  | ○ | ● |  |  | ● | ○ | ○ |  |  |  |  |  | ● |
| Ordered module content<br>`/intelligence/module-content · ADR-0005` | Partially 1 | Partially 1 | Fully 4 |  | ● | ○ | ○ | ○ |  |  | ○ | ● |  |  | ○ | ● |  |  | ○ | ● |  |  | ○ |
| Item statistics<br>`/intelligence/item-statistics · ADR-0058` | Partially 1 | Partially 1 | Over 5 |  | ● |  | ○ | ● | ● |  | ● | ○ |  |  |  |  |  |  |  |  |  | ● |  |
| **Ecosystem** | | | | | | | | | | | | | | | | | | | | | | | |
| External references<br>`ExternalRef · ADR-0030` | Uncovered 0 | Uncovered 0 | Over 8 |  |  |  |  | ● | ● | ○ | ● | ● | ● |  |  |  | ● | ● | ● | ○ |  |  |  |
| Attachments *(Partial)*<br>`tool-managed only · hub endpoints deferred` | Uncovered 0 | Uncovered 0 | Fully 4 |  |  |  |  | ● | ● |  |  | ○ | ● |  |  |  | ● |  |  |  |  |  |  |
| Export profiles and slices<br>`GET /export · ADR-0031` | Partially 1 | Fully 2 | Over 8 |  | ● | ● | ○ | ○ | ● | ● | ○ | ○ |  | ● |  |  | ○ | ○ |  | ● | ● |  | ● |
| Outcome records at asOf<br>`datasets, metrics · ADR-0057, ADR-0063` | Partially 1 | Partially 1 | Over 6 |  | ● |  |  | ● | ● |  | ● | ○ |  |  |  |  | ● | ○ |  |  |  | ● |  |
| **Toolkit and guards** | | | | | | | | | | | | | | | | | | | | | | | |
| Discovery and capabilities<br>`/discover · ADR-0059` | Uncovered 0 | Uncovered 0 | Fully 3 |  | ○ |  | ● |  |  | ● |  |  |  | ● |  | ○ |  |  |  |  |  |  |  |
| Typed client<br>`@armature/client` | Partially 1 | Fully 2 | Over 11 | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ● |  | ○ | ● |  |  | ● |  | ○ | ○ | ○ |
| Agent provenance<br>`agent User · endorsements` | Uncovered 0 | Uncovered 0 | Fully 2 |  |  | ○ | ● |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |
| No per-person aggregates<br>`person_filter_refused · ADR-0021` | Uncovered 0 | Uncovered 0 | Fully 3 |  |  |  | ● |  |  |  |  |  | ○ | ● |  | ○ |  |  |  |  | ● |  |  |

Totals over 23 capabilities: built tools, Uncovered 8, Partially 11, Fully 4, Over 0; built and planned, Uncovered 6, Partially 7, Fully 10, Over 0; everything, Uncovered 0, Partially 0, Fully 9, Over 14.

## Gaps, and which proposed tool closes them

With the built and planned tools, 6 capabilities have no demo that shows them: impact, external references, attachments, discovery and capabilities, agent provenance, no per-person aggregates.

| Proposed tool | Gaps closed | Which |
|---|:-:|---|
| MCP server | 4 | Impact; Discovery and capabilities; Agent provenance; No per-person aggregates |
| Storyline bridge | 3 | Impact; External references; Attachments |
| Formalizer | 3 | Discovery and capabilities; Agent provenance; No per-person aggregates |
| DataShop bridge | 2 | External references; Attachments |
| Torus bridge | 2 | Impact; External references |
| LEED importer | 2 | External references; Attachments |
| Drift | 2 | External references; Attachments |
| Process miner | 1 | No per-person aggregates |
| Structure analyzer | 1 | Impact |
| Q-matrix exporter | 1 | Discovery and capabilities |
| Experiment bridge | 1 | External references |
| Ripple | 1 | Impact |
| Crosswalk | 1 | External references |
| Whyfinder | 1 | External references |
| Lint | 0 | none |
| Projection | 0 | none |
| Response tracker | 0 | none |

## Notes and corrections (2026-10-27)

- **A separate review plugin was dropped.** CoQui already writes fragment-level attestations and the viewer shows them going Stale, so it would show nothing new.
- **Ripple is mostly interface.** Its traversal is the impact read, built in Phase 4; its demo value is pairing that read with a branch and attestation staleness.
- **The MCP server wraps reads, not a query language.** ADR-0062 rules out a raw query route, so each MCP tool maps to an intelligence read, a list filter or a declared slice.
- **Lint is soft rules beside the invariants engine.** Run after a merge, it also covers what the merge route skips (Quiver's scenarios 7 and 8, SESSION.md What's Next item 12), and could use the engine's pure part that Quiver and CoQui both want as a package.
- **A Storyline bridge comes before Drift.** Drift's hard part is the publish-time mapping from interactions to items, which the bridge builds; with it, Drift is a view over the bridge's records. The bridge reads only what Storyline exports (the published SCORM or xAPI package, the translation XLIFF, the Excel question import), never the `.story` file itself: that format is undocumented and changes between versions.
- **The DataShop bridge makes alignment testable.** DataShop fits competing knowledge-component models against learner data; exporting the design's `assesses` links as one turns the alignment into a hypothesis with a score. It is the evidence ADR-0043's candidate (alignment models scored against datasets) needs. Only aggregates cross into the graph: curves and fit, never student-step records (ADR-0058).
- **An experiment needs no new type yet.** A note links its condition branches until UpGrade and Terracotta show what an experiment record should hold (P9). Together they pass the two-client test.
- **The Q-matrix exporter is the shared piece.** DataShop, knowledge tracing, IRT (item response theory) and diagnosis models all take one, so the DataShop bridge builds on it. The format lives in the plugin, not in `slices.json` (P2).
- **Torus is the likeliest pilot.** It already ties objectives to activities and feeds DataShop, so Torus to DataShop to Armature closes Narrative 1 with no new instrumentation. Armature adds what Torus does not hold: needs, evidence, rationale and history.
- **Five proposals share one delivery stamp.** The Storyline, DataShop and experiment bridges, Drift and an LRS (learning record store) listener each need the delivered thing to carry the design commit and record ids, and a mapping reported back as `ExternalRef`s. ADR-0057 holds the `asOf` half; the rest is worth one ADR before a second bridge invents its own.
- **Outcome records have no writing client.** Only the seed writes datasets and metrics; the Storyline bridge, the DataShop bridge, Drift, or a Canvas importer reading results for Quiver's text2qti exports, would be the first.

## Graph-native intelligence (2026-10-28)

Amos asked what plugins could do by leaning into the data being a graph, with relationships as first-class records. Sixteen ideas came out of it; this section records them and where each went.

**What the graph adds, honestly.** At Armature's scale (a few thousand documents) nothing below is impossible over JSON files or SQL: the hub already walks the graph in its own code, and sends the store no graph queries (no WOQL, TerminusDB's query language; checked 2026-10-28). The graph earns its keep in four ways: **paths** of any length (prerequisite chains, need-to-outcome chains, ripples), which are recursive queries elsewhere; **relationships that carry reasons** (a `ModuleObjective`'s role and rationale, a `PrerequisiteRecord`'s rationale, a `NeedEvidenceLink`'s confidence), so a path can be explained step by step and a relationship can be the subject of a finding or an attestation; **graph × time**, since every read works at any commit and a diff is a change to the graph; and **graph algorithms** (bridges, centrality, clusters), which run anywhere but mean something only on a graph. Time is the distinctive one: asking how a design evolved, in what order things were connected, by whom and why, needs every state of the graph with its authors and reasons.

**Where the sixteen went:**

| Idea | Went to |
|---|---|
| 1. Why is this here: the upstream chain from an item to the evidence, one reason per step, with breaks flagged | Whyfinder |
| 2. Weakest-link evidence: the lowest `NeedEvidenceLink` confidence each item or module depends on | Whyfinder |
| 3. Prerequisite order: cycles, objectives assessed before their prerequisites are taught, the longest chain | Lint |
| 4. Constructive alignment triangles: activity, item and formative use around each objective, with the missing side named | Lint |
| 5. Independent review: items attested only by their own author | Lint, with care (ADR-0021) |
| 6. Bloom's level along prerequisite edges | Lint |
| 7. What-if: every intelligence read on a branch compared with `main` | Ripple |
| 8. Trust decay: attestation staleness carried up to modules and the course | A proposed Design Graph lens; the viewer's attestation reads already exist |
| 9. Backward-design process mining from the commit graph | Process miner |
| 10. One record's decision timeline: every connection it had, when, by whom, with each message | Process miner |
| 11. Design-response analytics across administrations | Response tracker |
| 12. Single points of failure: objectives with one item, items whose retirement drops several | Structure analyzer |
| 13. Load-bearing objectives: the most central between needs and items | Structure analyzer |
| 14. Hidden modules: clusters of objectives compared with module boundaries | Structure analyzer |
| 15. Structural duplicates: items with nearly the same neighborhood | Structure analyzer |
| 16. Reuse across courses: objectives sharing a CASE identifier | Crosswalk |

**Notes on them:**

- **The Process miner is the research story.** Backward design (Wiggins and McTighe) predicts objectives, then assessments, then activities; the commit graph records the order things were actually created and connected. Measuring adherence to a process model is a learning-engineering question only a versioned graph of design decisions answers. It reads by stage and role, never by person (ADR-0021), and pseudonymous exports for a study (ADR-0031).
- **Structural duplicates cover part of the deferred redundancy detection.** The development plan deferred "a new item is redundant in the bank" because it needs text similarity, which is not structural (P4). Similarity of position in the graph is structural, so idea 15 honors P4.
- **Independent review sits near the non-aggregation line.** It is a pattern about records (an item's attestations), not a summary of a person; its design must keep it so.
- **Plugins cannot send graph queries.** ADR-0062 refuses a raw query route, so each idea is an intelligence read, if it passes the two-client test, or computed by a plugin from `GET /export`. Ideas 1 to 4, 7 and 11 share one shape (paths from one record to another through named relationships, with each step's fields), so a **generic path read**, declared as configuration the way slices are, would serve Whyfinder, Lint, Ripple and the Response tracker at once: a candidate ADR when the first of them is built.
- **Traversal stays in the hub.** Moving these reads into the store as WOQL would make them faster and more expressive but TerminusDB-only, and the workspace hub's file-backed store (`docs/workspace-hub-plan.md` §10) would lose them. Hub code over documents works on any store; WOQL waits for scale to require it (SESSION.md What's Next item 4).

## How each tool exercises its capabilities

### CoQui (built)

- ● **Read any record at a commit.** Imports items at a commit and names the commit it reviewed.
- ● **Branches.** One branch per review round, `coqui-<roundId>`.
- ○ **History and changes since.** Item history for reviewers.
- ○ **Three-way merge with conflicts.** Merges a round back. Its first real conflict report is still evidence to come.
- ● **One write path with invariants.** Replaces items by the id CoQui supplies.
- ○ **Batch writes with If-Match.** Its outbox drains queued writes when the hub is reachable.
- ● **Identity on every write.** Writes as the reviewer through Armature-User.
- ● **Findings and notes, by fragment.** Opens and dismisses findings on one part of an item.
- ● **Attestations that go stale.** Affirms an option; the viewer then shows it Current on the round branch.
- ● **Coverage at any ref.** Narrative 2: under-assessed objectives surface while authoring.
- ● **Alignment.** Bloom gaps for the item being reviewed.
- ○ **Typed client.** CI installs the client on CoQui's stack; its httpHub has not moved onto it yet.

### Viewer (built)

- ● **Read any record at a commit.** Every drawing is at a named commit, and exported figures carry it.
- ○ **Branches.** The branch picker; opens CoQui's round branch with the attestations lens.
- ● **History and changes since.** The History tab, and 'then and now' from the changes read.
- ○ **Findings and notes, by fragment.** Notes and findings drawn as dashed annotations.
- ● **Attestations that go stale.** The attestations lens: Current, Stale, FragmentRemoved.
- ● **Coverage at any ref.** The Coverage View and the coverage lens.
- ● **Alignment.** The alignment lens.
- ● **Trace.** The Focus page and Narrative 1's ten-step Walkthrough.
- ○ **Impact.** 'Referenced by' in the detail panel.
- ● **Ordered module content.** First client of the module-content read.
- ● **Item statistics.** First client of the item-statistics read.
- ● **Export profiles and slices.** The Design Graph is derived from GET /export.
- ● **Outcome records at asOf.** 'Adequate when?' reads coverage at the dataset's asOf.
- ○ **Discovery and capabilities.** Derives the drawing from the schema as data.
- ● **Typed client.** The Next.js app reaches the hub only through @armature/client.

### Quiver (planned)

- ○ **Read any record at a commit.** Refreshes records at a ref.
- ● **Branches.** One branch per workspace, `<user>/<name>`.
- ● **History and changes since.** changes?since= refreshes a workspace.
- ● **Three-way merge with conflicts.** Pull and deliver are merges, reviewed fragment by fragment. Scenarios 7 and 8 show the route skips the invariants.
- ● **One write path with invariants.** Local commits with reasons, pushed through the one write path.
- ● **Batch writes with If-Match.** Push is a batch write with If-Match.
- ● **Identity on every write.** Two users in two workspaces; OIDC is milestone 8.
- ○ **Findings and notes, by fragment.** A lint hint becomes a finding only when the person records it.
- ○ **Coverage at any ref.** Assembles formative assessments against objectives.
- ○ **Alignment.** Aligns items to objectives.
- ○ **Ordered module content.** Formative use in activities; may create a Module when an assessment has none.
- ● **Export profiles and slices.** A workspace is cloned from GET /export; asks for an authoring slice. The text2qti exporter is milestone 4.
- ● **Typed client.** First consumer of the client package.
- ○ **Agent provenance.** AI drafting is milestone 6.

### MCP server (proposed)

- ● **Read any record at a commit.** Every tool takes a ref, and every answer names its commit.
- ○ **Branches.** Summarizes what a branch changed.
- ● **History and changes since.** 'What changed on this branch since Tuesday?'
- ○ **One write path with invariants.** If given write tools, proposals land on a branch only.
- ○ **Identity on every write.** Runs as an agent User.
- ○ **Findings and notes, by fragment.** Files a finding as the agent.
- ○ **Attestations that go stale.** A person accepts the agent's proposal with a claimless attestation.
- ● **Coverage at any ref.** One tool per intelligence read.
- ● **Alignment.** One tool per intelligence read.
- ● **Trace.** One tool per intelligence read.
- ● **Impact.** 'What breaks if I change this objective?'
- ○ **Ordered module content.** Context for sequencing questions.
- ○ **Item statistics.** Context for item-quality questions.
- ○ **Export profiles and slices.** Declared slices for larger context, never a raw query (ADR-0062).
- ● **Discovery and capabilities.** The tool list is generated from /discover, so a missing capability is a missing tool.
- ● **Typed client.** Built on @armature/client.
- ● **Agent provenance.** Every write is marked as the agent's; acceptance is a person's endorsement.
- ● **No per-person aggregates.** Ask 'which reviewer declines most?' and the hub refuses, not the prompt.

### Storyline bridge (proposed)

- ● **Read any record at a commit.** The design as it was at the commit stamped into the package.
- ○ **Branches.** Item records proposed from an inventory land on a branch for review.
- ● **History and changes since.** Each rebuild moves the attachment's revision in a commit that says why.
- ● **One write path with invariants.** Registers the attachments and ExternalRefs, and proposes items for quiz slides with no record.
- ○ **Batch writes with If-Match.** One publish is written as one batch.
- ○ **Identity on every write.** Writes as the designer who published.
- ● **Findings and notes, by fragment.** Interactions with no design record, and records with no interaction, become findings.
- ○ **Attestations that go stale.** SME sign-off on a build's hash needs attestations on a revision, which are not built yet (ADR-0028 compares fragments).
- ○ **Coverage at any ref.** Coverage of objectives by the items placed in the Storyline quiz.
- ● **Trace.** A result on an interaction traces to its item, objective and module: Narrative 1 for a Storyline course.
- ● **Impact.** An objective change reaches the Storyline Activity and flags the build as predating it.
- ○ **Ordered module content.** Places the Storyline Activity in its module.
- ● **Item statistics.** Item statistics from cmi.interactions or xAPI results, per mapped item.
- ● **External references.** Storyline interaction IDs recorded as ExternalRefs on items and their parts, captured after each publish.
- ● **Attachments.** The .story source and the published package, each hashed, with roles source and rendered.
- ○ **Export profiles and slices.** Reads items to emit Storyline's Excel question import, one way: fragmentId, assesses and identity are lost until the next publish maps them back.
- ● **Outcome records at asOf.** Results join through the asOf stamped into the package (ADR-0057).
- ● **Typed client.** Built on @armature/client.

### DataShop bridge (proposed)

- ● **Read any record at a commit.** Exports the alignment at a named commit; the knowledge-component model is named after it.
- ○ **Branches.** Findings from a poor fit can be answered on a branch that revises the alignment.
- ○ **History and changes since.** Compares the fit of the alignment at two commits.
- ● **One write path with invariants.** Writes the dataset, its metrics and the ExternalRefs it reads back.
- ○ **Batch writes with If-Match.** One import is written as one batch.
- ● **Findings and notes, by fragment.** A learning curve that does not fall, or a fit worse than DataShop's baselines, becomes a finding on the objective.
- ○ **Attestations that go stale.** The alignment an SME affirmed is the model DataShop fits; a poor fit questions the affirmation.
- ● **Coverage at any ref.** Coverage counts the assesses links; this tests whether those links describe one skill per objective.
- ○ **Alignment.** Rests on the same assesses links as the alignment read.
- ● **Trace.** A flat curve on an objective traces back to its items and the module that declared it.
- ● **Item statistics.** Item statistics read back from DataShop, as metrics about the item (ADR-0058).
- ● **External references.** The DataShop dataset id and its problem names as ExternalRefs on the dataset and items.
- ● **Attachments.** The knowledge-component model file DataShop exports, referenced by hash. Learner data is never copied.
- ● **Export profiles and slices.** The pseudonymous slice at the delivered commit, posted to the DataShop dataset as an external analysis.
- ● **Outcome records at asOf.** A LearningDataset that names DataShop as its source, at the delivered asOf; metrics about items, objectives and the alignment's fit.
- ● **Typed client.** Built on @armature/client.

### Q-matrix exporter (proposed)

- ● **Read any record at a commit.** Every matrix is the alignment at a named commit, and says which.
- ○ **History and changes since.** Two commits' matrices diffed show what an alignment change was.
- ○ **Attestations that go stale.** Can export only the alignments an SME affirmed.
- ○ **Coverage at any ref.** The same assesses links coverage counts.
- ● **Alignment.** Exports the assesses links the alignment read judges: items or fragments as rows, objectives as columns.
- ○ **External references.** Column ids can carry each objective's ExternalRefs, so a model is fit against a standard's ids.
- ● **Export profiles and slices.** A format plugin over GET /export at a ref; slices select the classes, the plugin shapes the matrix (P2).
- ● **Discovery and capabilities.** Reads /schema for which fields assess what, so a schema change cannot silently change the matrix.
- ● **Typed client.** Built on @armature/client; the DataShop bridge uses it.

### Experiment bridge (proposed)

- ● **Read any record at a commit.** Each condition is delivered from its own commit, stamped as its asOf.
- ● **Branches.** A condition is a branch.
- ● **History and changes since.** The manipulation is the diff between the conditions' commits.
- ● **Three-way merge with conflicts.** Adopting the winning condition is a merge to main, with the result as the reason.
- ○ **One write path with invariants.** Records the experiment as a note linking its branches.
- ○ **Identity on every write.** Writes as the researcher who ran it.
- ● **Findings and notes, by fragment.** The hypothesis before delivery and the decision after, as notes on the experiment's branches.
- ○ **Attestations that go stale.** An SME signs off each condition before it is delivered.
- ● **Coverage at any ref.** Coverage per condition at its asOf, so a condition that drops an objective's items shows it.
- ○ **Trace.** A condition's result traces to what that condition changed.
- ○ **Impact.** What else the winning change touches, before it merges.
- ○ **Ordered module content.** A sequencing manipulation is two orderings of one module.
- ● **Item statistics.** Item statistics per condition.
- ● **External references.** UpGrade decision points or Terracotta treatments as ExternalRefs on the conditions' records.
- ○ **Export profiles and slices.** A pseudonymous slice per condition for the analysis.
- ● **Outcome records at asOf.** One dataset per condition, each at its own asOf.
- ● **Typed client.** Built on @armature/client.

### Torus bridge (proposed)

- ● **Read any record at a commit.** A Torus course is linked to the design at a commit.
- ○ **Branches.** Objective changes made in Torus are proposed on a branch, never written to main.
- ● **History and changes since.** Each Torus publication moves the stamped commit, with what changed.
- ○ **Three-way merge with conflicts.** Torus edits and Armature edits meet in a merge.
- ● **One write path with invariants.** Writes objectives and activities with ExternalRefs to their Torus counterparts.
- ● **Batch writes with If-Match.** A course sync is one batch with If-Match.
- ○ **Identity on every write.** Writes as the designer who ran the sync.
- ● **Findings and notes, by fragment.** Objectives in Torus with no design record, and the reverse, become findings.
- ○ **Attestations that go stale.** SME sign-off on objectives Torus imported.
- ● **Coverage at any ref.** Torus's objective-to-activity links checked against the design's coverage.
- ○ **Alignment.** The alignment read judges the objectives Torus attached.
- ● **Trace.** Torus results trace past each objective to the needs and evidence behind it, which Torus does not hold.
- ● **Impact.** A changed objective lists the Torus pages and activities to revisit.
- ● **Ordered module content.** Torus's page order compared with the module's ordered content.
- ○ **Item statistics.** Through the DataShop bridge.
- ● **External references.** Torus objective, page and activity ids as ExternalRefs.
- ○ **Attachments.** A Torus publication referenced as a revision.
- ○ **Export profiles and slices.** Reads the design at a ref to compare with the course.
- ○ **Outcome records at asOf.** Through the DataShop bridge.
- ● **Typed client.** Built on @armature/client.

### LEED importer (proposed)

- ○ **Read any record at a commit.** Checks a log against the design at a ref before importing.
- ● **Branches.** Each imported log lands on a branch for the designer to review before it merges.
- ● **History and changes since.** Each logged decision keeps its date and reason on its note; the import's commit names the log it came from.
- ○ **Three-way merge with conflicts.** The reviewed import merges to main.
- ● **One write path with invariants.** Writes notes, evidence and needs from the log.
- ● **Batch writes with If-Match.** A log is imported as one atomic batch.
- ○ **Identity on every write.** Entries written as their original authors need delegation, one of the OIDC ADR's four decisions.
- ● **Findings and notes, by fragment.** Each logged decision and its rationale as a note, and as a DesignDecision once ADR-0010's second layer exists.
- ○ **Attestations that go stale.** A logged sign-off becomes an endorsement.
- ● **Trace.** An objective traces back to the logged decision and the evidence it cited.
- ● **External references.** Each entry keeps its LEED tracker id as an ExternalRef.
- ● **Attachments.** The evidence documents the log cites, referenced by hash.
- ● **Typed client.** Built on @armature/client.
- ○ **No per-person aggregates.** Who decided stays text on the record, never a count per person.

### Formalizer (proposed)

- ○ **Read any record at a commit.** Reads the rationale fields at a commit.
- ○ **History and changes since.** When each rationale was written.
- ○ **One write path with invariants.** Proposals land as notes on a branch, never as schema.
- ● **Findings and notes, by fragment.** Notes and finding text are the corpus.
- ○ **Attestations that go stale.** A person endorses a proposal before anyone acts on it.
- ● **Export profiles and slices.** A pseudonymous slice of rationale text.
- ● **Discovery and capabilities.** Reads /schema to find which fields are still free text.
- ● **Agent provenance.** Proposals are the agent's; acceptance is a person's.
- ● **No per-person aggregates.** Clusters by process, never by author.

### Ripple (proposed)

- ● **Read any record at a commit.** Before and after, at two commits.
- ● **Branches.** The edit is made on a branch.
- ○ **History and changes since.** The diff of the change.
- ○ **Three-way merge with conflicts.** Merges once the review findings close.
- ● **One write path with invariants.** The edit itself.
- ● **Findings and notes, by fragment.** Each affected record gets a finding to review.
- ● **Attestations that go stale.** Attestations on the touched parts turn Stale.
- ● **Coverage at any ref.** Every intelligence read compared between the branch and `main`, coverage first: which objectives drop below FullyAssessed.
- ● **Alignment.** A verb change opens Bloom gaps.
- ○ **Trace.** Follows the change on to activities and metrics.
- ● **Impact.** Everything that references the edited objective.
- ○ **Ordered module content.** An activity that loses its only target, or moves out of teaching order.
- ○ **Typed client.** Built on the client package.

### Lint (proposed)

- ○ **Read any record at a commit.** Checks a branch at its head.
- ● **Branches.** Runs on a branch before it merges.
- ● **Three-way merge with conflicts.** Checks the merged state, which the merge route does not.
- ● **Findings and notes, by fragment.** A violation the person keeps becomes a finding.
- ○ **Attestations that go stale.** Rule: an item attested only by its own author (independent review), about records, never a summary of a person.
- ● **Coverage at any ref.** Rule: an objective Uncovered or OverAssessed.
- ● **Alignment.** Rules: Bloom gaps, objectives no activity targets.
- ○ **Impact.** Orphans: records nothing references.
- ● **Ordered module content.** Rule: assessed before it is practiced.
- ○ **Discovery and capabilities.** Rule sets declared against a schema version.
- ● **Typed client.** Ships as a command line on the client package.
- ○ **No per-person aggregates.** The independent-review rule stays a pattern on records, inside ADR-0021's line.
- Graph patterns among its rules (2026-10-28): constructive alignment triangles around each objective, with the missing side named; prerequisite cycles and objectives assessed before their prerequisites are taught; Bloom's level along prerequisite edges.

### Drift (proposed)

- ● **Read any record at a commit.** The design as it was at the package's asOf.
- ● **History and changes since.** What the design changed after delivery.
- ● **Findings and notes, by fragment.** Each divergence recorded as a finding.
- ○ **Impact.** Which records a divergence touches.
- ● **External references.** QTI and LMS ids join delivered items to records.
- ● **Attachments.** The delivered package as a hashed, revision-addressed attachment. This is the client the deferred endpoints wait for.
- ○ **Export profiles and slices.** Compares against an export at asOf.
- ● **Outcome records at asOf.** The asOf stamped in the package (ADR-0057) is the join.

### Crosswalk (proposed)

- ○ **Read any record at a commit.** Reads objectives at a ref.
- ○ **Branches.** Mappings proposed on a branch.
- ● **One write path with invariants.** Writes ExternalRefs onto objectives.
- ● **Attestations that go stale.** An SME affirms each mapping, the curriculum mapper's use in ADR-0028.
- ● **Coverage at any ref.** The evidence table: which standards have assessed objectives.
- ○ **Trace.** From a standard down to items and metrics.
- ● **External references.** CASE identifiers on objectives.
- ○ **Export profiles and slices.** The institutional profile for an accreditor.
- ○ **Outcome records at asOf.** Results as evidence per standard.
- Reuse across courses (2026-10-28): objectives in other courses or stores carrying the same CASE identifier, and how each is assessed there.

### Whyfinder (proposed)

- ● **Read any record at a commit.** Answers at the commit the course was built from.
- ○ **Findings and notes, by fragment.** Shows the notes on the record.
- ○ **Attestations that go stale.** 'Affirmed by an expert as of commit X.'
- ● **Trace.** Activity to objective to need to evidence.
- ○ **Ordered module content.** Places the activity in its module.
- ● **External references.** A course page URL resolves to its record through an ExternalRef.
- ● **Typed client.** A read-only browser extension on the client.
- The chain of reasons (2026-10-28): each step's rationale, role or confidence, with breaks flagged (an objective with no need, a need with no evidence), and the weakest evidence the record depends on.

### Projection (proposed)

- ● **Read any record at a commit.** Each document names its commit.
- ○ **History and changes since.** Regenerated after a merge, with what changed.
- ○ **Attestations that go stale.** The SME packet lists what is affirmed and what is stale.
- ○ **Coverage at any ref.** Coverage figures in the faculty summary.
- ● **Trace.** The faculty summary walks need to objective to evidence.
- ● **Ordered module content.** Sequenced module content is the document's spine.
- ○ **External references.** The accreditor's standard ids.
- ● **Export profiles and slices.** Slices and profiles per audience.

### Process miner (proposed)

- ● **Read any record at a commit.** The graph rebuilt at every commit of a branch.
- ○ **Branches.** Process compared across branches and rounds.
- ● **History and changes since.** The commit log is the data: what was created and connected, in what order, with each message.
- ○ **Three-way merge with conflicts.** Merges as events in the process.
- ○ **Identity on every write.** Every commit has an author, read by role.
- ○ **Findings and notes, by fragment.** Notes and findings as process events.
- ○ **Attestations that go stale.** Review as a stage of the process.
- ● **Export profiles and slices.** A pseudonymous export for a study (ADR-0031).
- ○ **Typed client.** Built on the client package.
- ● **No per-person aggregates.** Patterns by stage and role, never by designer (ADR-0021).
- Also one record's decision timeline: every connection it had, when, by whom and why.

### Response tracker (proposed)

- ● **Read any record at a commit.** The design at each administration's asOf.
- ● **History and changes since.** What changed between one administration and the next.
- ○ **Findings and notes, by fragment.** Findings Addressed as the design's response.
- ○ **Coverage at any ref.** Coverage at each asOf and now.
- ○ **Trace.** From a metric to its item, objective and module.
- ● **Item statistics.** Each item's results across administrations.
- ● **Outcome records at asOf.** Narrative 1 generalized to every administration.
- ○ **Typed client.** Built on the client package.

### Structure analyzer (proposed)

- ○ **Read any record at a commit.** Analyzes the graph at a ref.
- ○ **Findings and notes, by fragment.** A proposal it makes (merge duplicates, regroup modules) becomes a finding a person keeps.
- ● **Coverage at any ref.** Single points of failure: objectives covered by exactly one item.
- ○ **Alignment.** The `assesses` edges the algorithms run over.
- ○ **Trace.** Paths from needs to items, for centrality.
- ● **Impact.** Which objectives an item's retirement would drop; the load-bearing objectives where a change costs most.
- ○ **Ordered module content.** Module boundaries, against the clusters it finds.
- ● **Export profiles and slices.** Reads the whole graph at a commit in one request.
- ○ **Typed client.** Built on the client package.
- Also structural duplicates (items with nearly the same neighborhood) and hidden modules (clusters across module boundaries).
