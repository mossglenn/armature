# Demo coverage

**Date:** 2026-10-27 · **Status:** Working document. It places the built, planned and proposed client tools against the hub's capabilities, so that the next demo tool is chosen for what no demo shows yet. Read against `docs/development-plan.md` and `.claude/SESSION.md` as of 2026-10-26; update it when a tool changes status or the hub gains a capability.

**How to read it.** Capabilities run down the side and tools across the top. ● means the tool's demo *shows* the capability; ○ means the tool *uses* it without making it the point. Each row gets the hub's own coverage verdict (ADR-0029's default thresholds), counting only ● for the tools in scope: Uncovered is 0, Partially is 1, Fully is 2 to 4, Over is 5 or more. Three verdict columns give the three scopes: built tools only, built and planned, and everything including the proposed tools. *Partial* marks a hub capability that is not finished.

An interactive version of the same matrix, with a note behind every dot, is a private claude.ai artifact: https://claude.ai/artifact/AYoCccDJUpozFWQakMasNi

Abbreviations: ADR (Architecture Decision Record), MCP (Model Context Protocol), SME (subject-matter expert), LMS (learning management system), QTI (Question and Test Interoperability), CASE (Competencies and Academic Standards Exchange).

## The tools

| Tool | Status | What it is |
|---|---|---|
| CoQui | Built | SME review of assessment items in rounds |
| Viewer | Built | The Coverage View and the Design Graph |
| Quiver | Planned | Local-first item manager, and the first client that must merge |
| MCP server | Proposed | Any agent asks design questions through the intelligence reads |
| Formalizer | Proposed | Proposes structure from the free-text rationale it finds |
| Ripple | Proposed | Edit on a branch, see everything the change touches |
| Lint | Proposed | Soft design rules, run before and after a merge |
| Drift | Proposed | The delivered course compared with the design it came from |
| Crosswalk | Proposed | Objectives mapped to a standards framework, affirmed by an SME |
| Whyfinder | Proposed | Why is this here, answered on the live course page |
| Projection | Proposed | One graph, one document per audience |

The viewer is counted as a tool because the Coverage View and the Design Graph are clients of the hub like any plugin. Quiver's cells come from its plan as Armature's documents describe it (`mossglenn/quiver`, `docs/plan.md` there); check them against that plan.

## The matrix

| Capability | Built | + Planned | All | CoQui | Viewer | Quiver | MCP server | Formalizer | Ripple | Lint | Drift | Crosswalk | Whyfinder | Projection |
|---|---|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **Version control** | | | | | | | | | | | | | | |
| Read any record at a commit<br>`?ref= on every read` | Fully 2 | Fully 2 | Over 7 | ● | ● | ○ | ● | ○ | ● | ○ | ● | ○ | ● | ● |
| Branches<br>`POST /branches` | Partially 1 | Fully 2 | Fully 4 | ● | ○ | ● | ○ |  | ● | ● |  | ○ |  |  |
| History and changes since<br>`history · changes?since=` | Partially 1 | Fully 2 | Fully 4 | ○ | ● | ● | ● | ○ | ○ |  | ● |  |  | ○ |
| Three-way merge with conflicts *(Partial)*<br>`merge route · policy open (§6)` | Uncovered 0 | Partially 1 | Fully 2 | ○ |  | ● |  |  | ○ | ● |  |  |  |  |
| **Writes** | | | | | | | | | | | | | | |
| One write path with invariants<br>`generic writes · ADR-0024` | Partially 1 | Fully 2 | Fully 4 | ● |  | ● | ○ | ○ | ● |  |  | ● |  |  |
| Batch writes with If-Match<br>`batch · optimistic concurrency` | Uncovered 0 | Partially 1 | Partially 1 | ○ |  | ● |  |  |  |  |  |  |  |  |
| Identity on every write *(Partial)*<br>`Armature-User · OIDC not built` | Partially 1 | Fully 2 | Fully 2 | ● |  | ● | ○ |  |  |  |  |  |  |  |
| **Review** | | | | | | | | | | | | | | |
| Findings and notes, by fragment<br>`ADR-0020 · ADR-0023` | Partially 1 | Partially 1 | Over 5 | ● | ○ | ○ | ○ | ● | ● | ● | ● |  | ○ |  |
| Attestations that go stale<br>`ADR-0028` | Fully 2 | Fully 2 | Fully 4 | ● | ● |  | ○ | ○ | ● |  |  | ● | ○ | ○ |
| **Design intelligence** | | | | | | | | | | | | | | |
| Coverage at any ref<br>`/intelligence/coverage · ADR-0029` | Fully 2 | Fully 2 | Over 5 | ● | ● | ○ | ● |  | ○ | ● |  | ● |  | ○ |
| Alignment<br>`/intelligence/alignment` | Fully 2 | Fully 2 | Over 5 | ● | ● | ○ | ● |  | ● | ● |  |  |  |  |
| Trace<br>`/intelligence/trace` | Partially 1 | Partially 1 | Fully 4 |  | ● |  | ● |  | ○ |  |  | ○ | ● | ● |
| Impact<br>`/intelligence/impact` | Uncovered 0 | Uncovered 0 | Fully 2 |  | ○ |  | ● |  | ● | ○ | ○ |  |  |  |
| Ordered module content<br>`/intelligence/module-content · ADR-0005` | Partially 1 | Partially 1 | Fully 3 |  | ● | ○ | ○ |  |  | ● |  |  | ○ | ● |
| Item statistics<br>`/intelligence/item-statistics · ADR-0058` | Partially 1 | Partially 1 | Partially 1 |  | ● |  | ○ |  |  |  |  |  |  |  |
| **Ecosystem** | | | | | | | | | | | | | | |
| External references<br>`ExternalRef · ADR-0030` | Uncovered 0 | Uncovered 0 | Fully 3 |  |  |  |  |  |  |  | ● | ● | ● | ○ |
| Attachments *(Partial)*<br>`tool-managed only · hub endpoints deferred` | Uncovered 0 | Uncovered 0 | Partially 1 |  |  |  |  |  |  |  | ● |  |  |  |
| Export profiles and slices<br>`GET /export · ADR-0031` | Partially 1 | Fully 2 | Fully 4 |  | ● | ● | ○ | ● |  |  | ○ | ○ |  | ● |
| Outcome records at asOf<br>`datasets, metrics · ADR-0057, ADR-0063` | Partially 1 | Partially 1 | Fully 2 |  | ● |  |  |  |  |  | ● | ○ |  |  |
| **Toolkit and guards** | | | | | | | | | | | | | | |
| Discovery and capabilities<br>`/discover · ADR-0059` | Uncovered 0 | Uncovered 0 | Fully 2 |  | ○ |  | ● | ● |  | ○ |  |  |  |  |
| Typed client<br>`@armature/client` | Partially 1 | Fully 2 | Over 5 | ○ | ● | ● | ● |  | ○ | ● |  |  | ● |  |
| Agent provenance<br>`agent User · endorsements` | Uncovered 0 | Uncovered 0 | Fully 2 |  |  | ○ | ● | ● |  |  |  |  |  |  |
| No per-person aggregates<br>`person_filter_refused · ADR-0021` | Uncovered 0 | Uncovered 0 | Fully 2 |  |  |  | ● | ● |  |  |  |  |  |  |

Totals over 23 capabilities: built tools, Uncovered 8, Partially 11, Fully 4, Over 0; built and planned, Uncovered 6, Partially 7, Fully 10, Over 0; everything, Uncovered 0, Partially 3, Fully 15, Over 5.

## Gaps, and which proposed tool closes them

With the built and planned tools, 6 capabilities have no demo that shows them: impact, external references, attachments, discovery and capabilities, agent provenance, no per-person aggregates.

| Proposed tool | Gaps closed | Which |
|---|:-:|---|
| MCP server | 4 | Impact; Discovery and capabilities; Agent provenance; No per-person aggregates |
| Formalizer | 3 | Discovery and capabilities; Agent provenance; No per-person aggregates |
| Drift | 2 | External references; Attachments |
| Ripple | 1 | Impact |
| Crosswalk | 1 | External references |
| Whyfinder | 1 | External references |
| Lint | 0 | none |
| Projection | 0 | none |

## Corrections to the brainstorm (2026-10-27)

- **A separate review plugin was dropped.** CoQui already writes fragment-level attestations and the viewer shows them going Stale, so it would show nothing new.
- **Ripple is mostly interface.** Its traversal is the impact read, built in Phase 4; its demo value is pairing that read with a branch and attestation staleness.
- **The MCP server wraps reads, not a query language.** ADR-0062 rules out a raw query route, so each MCP tool maps to an intelligence read, a list filter or a declared slice.
- **Lint is soft rules beside the invariants engine.** Run after a merge, it also covers what the merge route skips (Quiver's scenarios 7 and 8, SESSION.md What's Next item 12), and could use the engine's pure part that Quiver and CoQui both want as a package.
- **Outcome records have no writing client.** Only the seed writes datasets and metrics; Drift, or a Canvas importer reading results for Quiver's text2qti exports, would be the first.

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
- ○ **Coverage at any ref.** Coverage before and after.
- ● **Alignment.** A verb change opens Bloom gaps.
- ○ **Trace.** Follows the change on to activities and metrics.
- ● **Impact.** Everything that references the edited objective.
- ○ **Typed client.** Built on the client package.

### Lint (proposed)

- ○ **Read any record at a commit.** Checks a branch at its head.
- ● **Branches.** Runs on a branch before it merges.
- ● **Three-way merge with conflicts.** Checks the merged state, which the merge route does not.
- ● **Findings and notes, by fragment.** A violation the person keeps becomes a finding.
- ● **Coverage at any ref.** Rule: an objective Uncovered or OverAssessed.
- ● **Alignment.** Rules: Bloom gaps, objectives no activity targets.
- ○ **Impact.** Orphans: records nothing references.
- ● **Ordered module content.** Rule: assessed before it is practiced.
- ○ **Discovery and capabilities.** Rule sets declared against a schema version.
- ● **Typed client.** Ships as a command line on the client package.

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

### Whyfinder (proposed)

- ● **Read any record at a commit.** Answers at the commit the course was built from.
- ○ **Findings and notes, by fragment.** Shows the notes on the record.
- ○ **Attestations that go stale.** 'Affirmed by an expert as of commit X.'
- ● **Trace.** Activity to objective to need to evidence.
- ○ **Ordered module content.** Places the activity in its module.
- ● **External references.** A course page URL resolves to its record through an ExternalRef.
- ● **Typed client.** A read-only browser extension on the client.

### Projection (proposed)

- ● **Read any record at a commit.** Each document names its commit.
- ○ **History and changes since.** Regenerated after a merge, with what changed.
- ○ **Attestations that go stale.** The SME packet lists what is affirmed and what is stale.
- ○ **Coverage at any ref.** Coverage figures in the faculty summary.
- ● **Trace.** The faculty summary walks need to objective to evidence.
- ● **Ordered module content.** Sequenced module content is the document's spine.
- ○ **External references.** The accreditor's standard ids.
- ● **Export profiles and slices.** Slices and profiles per audience.
