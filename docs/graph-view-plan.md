# The Design Graph: plan

*Status: accepted 2026-10-22, the questions in §14 answered the same day. A plan for the viewer's graph pages, Phase 8 of `development-plan.md`. When the pages are built, this document becomes their description and the decisions here move to the explainer and SESSION.md.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CSS (Cascading Style Sheets), DOM (Document Object Model), PNG (Portable Network Graphics), PR (pull request), SVG (Scalable Vector Graphics), URL (Uniform Resource Locator).

---

## 1. Purpose

The viewer gets a set of pages that draw the artifact graph: every design record on a branch at a commit, the relationships between them as the schema declares them, and the design intelligence the hub computes, laid over the same drawing. These pages are the face of Armature: what a reader of the position paper, a conference audience or a prospective collaborator sees first, and the source of the figures in papers and slides. So the pages have two jobs that pull in different directions and both have to be met:

- **An instrument.** A designer or researcher opens the graph to answer a question: what assesses this objective, why does this objective exist, what did this cohort meet, what changed since the pilot. Interaction, search, selection and the detail panel serve that.
- **A figure.** A reader of a paper sees one still image and must understand it without a legend read twice. Consistent layout, a fixed class palette, glyphs that survive black-and-white printing, and a stamp that names the commit the figure was drawn from serve that.

Three constraints from the rest of the project hold throughout:

1. **The viewer is a client.** The pages read the hub over HTTP through `@armature/client` and never touch the store (`app/lib/viewer.ts`; Development Principle 1). Nothing in this plan changes the API or the schema. The graph is derived in the viewer from the schema as data (`CLASS_FIELDS`, `CLASS_CATEGORY`, `CLASS_ANCESTORS` in `@armature/types`) and from documents the existing reads return.
2. **The browser never reaches the hub.** Inside a compose network the hub is private (`hubPublicUrl()` is undefined), so every read happens in a server component and is handed to the client component as props. Anything a click needs is either already serialized or a navigation to a URL the server renders.
3. **Nothing derived is stored** (ADR-0056). Coverage, alignment, attestation state and the trace are reads at a ref; the graph pages show them and store nothing.

The prototype of 2026-10-22 (React Flow 12.12 with dagre 3.1 over the seed's export and one trace, kept as a published artifact) settled the renderer and showed the shape: it is the reference for the look, not the code.

---

## 2. What comparable tools settled

The graph pages borrow conventions that users of three families of tools already know, and decline the ones that do not fit a design graph.

**Lineage viewers** (dbt's documentation site and the catalogs built on it, Dagster's asset graph, OpenLineage's Marquez). These draw a directed acyclic graph left to right, upstream on the left, with a node-type filter, a depth control, and click-through from a node to its page. dbt's selector grammar names the operations users want: `+node` (everything upstream), `node+` (everything downstream), `+node+` (both). Dagster added expand-and-collapse of groups and a sidebar listing assets by group, after large graphs became unreadable. Adopted: the left-to-right reading direction, the upstream/downstream expansion from a selected node, the type filter with counts, the sidebar as the way into a large graph. Declined for now: group collapsing, because a module is not a container (an objective can be declared by two modules, an activity placed twice; ADR-0005); §10 keeps it as a later option.

**Graph explorers** (Obsidian's graph view, Neo4j Bloom, Gephi Lite). These settled the *local graph* (one note and its neighbors to a chosen depth), color groups defined by a query, filters that persist, dimming of everything not connected to the hovered node, and a search box as the primary way to find a node. Bloom's *perspectives* (a saved choice of which classes and relationships to show, with styling) and *scenes* (a saved drawing) are the useful abstractions behind what §6 calls lenses and what the URL state makes shareable. Declined: force-directed layout and node size by degree. Both are right for a graph with no intrinsic direction; a design graph has one (the lifecycle the trace read walks), and size by degree would make the course the biggest node for no reason a reader cares about.

**Research maps** (Connected Papers, Litmaps, ResearchRabbit). These are the visual standard a learning-engineering audience knows. What makes them work is a single seed as the entry point, a clean light drawing with few colors, and one optional encoding at a time (time on an axis, a collection's color). Adopted: the single-seed focus page, restraint in color, one lens at a time. Their figures are what Armature's figures will be compared with.

**React Flow's own patterns.** Nodes as DOM elements (so they are styled with the viewer's own CSS and are focusable), a minimap, fit-to-view controls, a download-image example built on `html-to-image`, and dagre as the recommended tree layout. Adopted as is.

One thing none of these tools has and Armature does: every drawing is at a named commit. The URL of a view and the stamp on an exported figure name the branch and commit, so a figure in a paper is reproducible by anyone with the export (`docs/research-path.md`). That is the project's distinguishing feature carried into its pictures.

---

## 3. The pages

Three pages and one mode, all under `/graph`, all taking `?branch=` or `?ref=` like every other page and showing the commit they drew.

### 3.1 The Design Graph (`/graph`)

The whole store at a ref: every artifact on the branch, laid out by lifecycle stage in columns, every relationship as an edge. This is page 1. It is not "the course": a store may hold several courses, or a study's graph with no course at all, so the page's name is **Design Graph** (chosen 2026-10-22) and its header reads "Everything on `main` at commit `n1is93e9` · 66 records". The rest of this document says "the Graph" for short.

Layout: a header strip (title, the viewer's navigation, branch and commit, search), a filter rail on the left (classes with counts and toggles, the lens picker), the canvas in the middle with lifecycle column headers across the top, and a detail panel on the right when something is selected. On a phone the three stack with the canvas first.

### 3.2 The Focus page (`/graph/:type/:id`)

One record and its neighborhood as the trace read returns it (`GET /intelligence/trace/:type/:id`): nodes, the edges with the field or junction they follow, and the annotations (notes, findings, attestations with their state) as chips on the records they are about. The root is outlined. The same layout rules as the Graph, so the Focus page is a clean extract of it, which is what a figure wants. Reached by double-clicking a node on the Graph, from "Trace" in the detail panel, and from the Coverage View (every objective, item, dataset and metric links here).

The trace read accepts nine types (metric, dataset, assessment, item, objective, need, evidence, module, activity). For any other type the Focus page shows the record's references and the records referencing it (the impact read's answer), derived in the viewer, without the lifecycle walk.

### 3.3 The Walkthrough (`/graph/:type/:id?walk=1`)

The Focus page with a stepper: the trace walked one hop at a time with the camera following, the path so far kept lit, and a panel of text per step that says what the hop means. It exists for Narrative 1 (§7) but is generic: it walks any trace from any root the read accepts, with step text templated from the classes crossed, not from the seed's content. `?walk=<n>` names the step, so a figure can be any step of the walk.

### 3.4 Figure mode

Not a page: a state of any of the three, entered from "Export figure". Light theme regardless of the viewer's, white ground, no grid, controls and minimap hidden, labels one size larger, an optional legend tile, and a stamp in a corner: `Armature · main @ n1is93e9 · /graph?select=… · 2026-10-22`. Exported as PNG at 2× or 3× device pixels through `html-to-image` (React Flow's documented path). A vector export is §11's later work.

---

## 4. Visual language

The drawing has to read in a paper printed in black and white, on a projector, and on a phone in the dark. Every encoding below is therefore redundant: class is carried by a hue, a glyph and the eyebrow text; status by a chip's tone and its word. The palette and glyphs become `docs/visual-language.md`, the reference for slides and papers, so that a figure drawn by hand in a talk uses the same colors as the page.

### 4.1 A node

A fixed-size card (232 by 72 CSS pixels; fixed so the layout needs no measurement and can run on the server):

```
┃ ◆ ASSESSMENTITEM
┃ Identifying training data bias
┃ [Approved] [Analyze] [Affirmed · Current]
```

- A 3-pixel **class stripe** on the left in the class hue, and the class **glyph** and name as a small-caps eyebrow in muted text.
- The **label** on one line, ellipsized, with the full text on hover and in the panel.
- Up to three **chips**: the record's `status` (tone: Approved green, Draft and InReview amber, Retired neutral), its Bloom's level or `activityType` or `role`, a metric's value and unit, a dataset's cohort, and anything an annotation adds (an attestation's verdict and state, a finding's status, "Note"). `asOf` is a chip in monospace that reads "as of n1is93e9" and is a link to the same view at that commit.
- **Selected**: a 2-pixel ring in the accent color. **Root** (on the Focus page): a ring in the class hue. **Dimmed** (not in the current neighborhood or lens): 35% opacity, edges included.

Annotation records (`DesignNote`, `DesignFinding`) use the same card with a dashed border, so they read as commentary on the design rather than part of it.

### 4.2 Classes: stages, hues, glyphs

The lifecycle order is the one encoding the schema does not carry; it is a table in `app/lib/graph/stages.ts`, the only place it lives, and a test fails when a class in `CLASS_CATEGORY` has no entry (as the generator fails on a class with no category).

*(The table below is the order as built and revised on 2026-10-22; §14 items 13 and 14 record the revision. The first draft of this plan had items and activities in one column with the group first, and Tailwind's 600 steps as hues, which the validator rejected.)*

| Stage | Column header | Classes | Hue | Glyph |
|---|---|---|---|---|
| 0 | Evidence | `DescriptiveEvidence` (and any `LearningEvidence`) | aqua | file-text |
| 1 | Needs | `LearningNeed` | orange | target |
| 2 | Objectives | `LearningObjective` | blue | flag |
| 3 | Items | `AssessmentItem` | plum | circle-help |
| 4 | Activities | `LearningActivity` | leaf (light green) | play |
| 5 | Assessments and lessons | `Assessment`, `Lesson` | violet, forest (dark green) | clipboard-check, layers |
| 6 | Modules | `Module` | magenta | box |
| 7 | Course | `Course` | yellow | book-open |
| 8 | Datasets | `LearningDataset` | cyan | table |
| 9 | Metrics | `LearningMetric` | brown | gauge |
| 10 | Notes and findings | `DesignNote`, `DesignFinding` | gray | pencil, triangle-alert |

The order is backward design's: items (the evidence that an objective is met) before activities (the experiences that produce it), then the two containers a module holds in one column, so that every edge in that part of the drawing spans at most one column. Outcome records sit in their own two columns after the course rather than beside the modules, so the header reads as the loop the project describes: design on the left, delivery in the middle, measurement on the right, and a metric's `subject` edge reaching back across to the item it measures. Notes and findings trail everything: they are about the design, not in it.

Hues were chosen by enumeration with the dataviz skill's validator (`docs/visual-language.md` says how): a container and what it holds are one family (two purples, two greens), objective is blue, and every adjacent pair passes in both themes. No green passes beside orange for a reader with a color-vision deficiency, which is why modules are magenta. The glyph and the eyebrow make the hue redundant in any case. Semantic tones (green, amber, red for status, verdict and coverage) are separate from the class hues and never used for a class.

Glyphs are a dozen inline SVG paths (taken from Lucide, ISC-licensed, copied rather than depended on), 12 pixels, `currentColor`, shown in the eyebrow, the legend and the panel. They are the reason a black-and-white print still tells an item from an activity.

### 4.3 Edges

The schema's relationship category (`CLASS_CATEGORY[cls] === 'relationship'`) decides how a document is drawn, without a list of classes:

- A **junction** (a relationship document with two references to non-person records: `ModuleObjective`, `ItemInstance`, `PrerequisiteRecord`, `NeedEvidenceLink`, `ModuleActivityLink`, `ModuleLessonLink`, `LessonActivityLink`, `ActivityItemLink`) is a **labeled edge** between the two. The label is the junction's data: `role` and `sequence` for a declaration ("Primary · #2"), `status` for a placement, `prerequisiteType`, `confidence`. The edge carries the document; clicking it opens the junction in the panel with its rationale. The edge's id is the junction's id, which is also what the trace read's `through` names, so a trace highlights these edges by id. "Draw relationships as edges" is on by default; off, the junctions are nodes with their own reference edges, the store's own view, for the reader who wants to see that a relationship is a document (ADR-0003).
- A relationship with **one** non-person reference (an `Attestation`: `subject` plus `attestedBy`) is a **chip** on its subject, never a node or an edge, because its other end is a person (ADR-0021: nothing is drawn per person).
- A **reference field** on an artifact (`AssessmentItem.assesses`, `LearningActivity.targets`, `Module.course`, `LearningMetric.subject`, `LearningDataset.producedBy`, `DesignNote.subject`) is a plain edge, thinner, labeled with the field name on hover and when either end is selected, unlabeled otherwise. Edges from a note or finding are dashed.
- A **same-stage** edge (a prerequisite between objectives) is drawn but not given to the layout engine, so it never pushes a node out of its column (§9.2).
- Every edge points **along the lifecycle**, from the earlier stage to the later one, whichever document holds the reference. ADR-0004 puts the reference on the child (`ModuleObjective.module`, `ItemInstance.assessment`); the drawing reads evidence → need → objective → item → assessment → module → course → dataset → metric regardless. Arrowheads are small and the same muted gray as the edge; the direction is the reading order, not a claim about causation.

Edge weight: junction edges 1.5 pixels, reference edges 1.25, both in a muted gray that works on both themes; the selected node's edges in the accent color.

### 4.4 Type, color and theme

The viewer's existing faces (Geist and Geist Mono), the zinc neutrals it already uses, light and dark through the same Tailwind variants. Light is the default for figures and the theme the paper figures are drawn in; the page follows the viewer's theme otherwise. Commit ids, sequences and metric values are monospace with tabular numerals.

---

## 5. Navigation and interaction

### 5.1 Getting in

- The viewer's header gains a navigation: **Design Graph · Modules**, with the branch and commit shown on every page and, from PR 4, a branch picker.
- **Search** (`/` or ⌘K): type-ahead over every node's label, id and class on the current page; selecting a result selects the node and brings it into view. On the Graph the search box is the primary way into a large store, as in every explorer tool.
- Links from elsewhere: the index page links the Graph; the Coverage View links each objective, item, dataset and metric to its Focus page; every "raw data" footer link stays.

### 5.2 Moving around

- Pan by drag, zoom by wheel or pinch, fit to view, zoom to selection, a minimap for orientation. Nodes are not draggable: the layout is a statement about the graph, not a sketch, and a figure must be reproducible.
- **Lifecycle column headers** across the top of the canvas, fixed while panning vertically, so the reader always knows which stage a node is in.
- **Hover** a node: its edges and neighbors brighten, everything else dims slightly; the full label shows. Hover an edge: its field name or junction label shows. *(Built 2026-10-22, after PR 4; PR 1 had left hover at a shadow. Otherwise a junction's label is always shown and a field name only when an end is selected, and both hide below zoom 0.6, a hovered edge's excepted.)*
- **Select** a node (click, or Enter when focused): the panel opens; the node's edges turn the accent color; the canvas enters the *neighbors* relation (§5.3). Click the canvas or press Escape to clear.
- **Double-click** a node, or "Focus" in the panel: the Focus page for that record.
- **Keyboard**: nodes are DOM elements in React Flow's tab order; Tab moves between them, Enter selects, Escape clears, arrows pan (a screen's worth with Shift), `f` fits, `z` frames the selection with its lit relation (also the panel's Frame action), `/` searches. From PR 3, `←`/`→` step the Walkthrough, and `↑`/`↓` still pan.

### 5.3 Relations from a selected node

The question "what is related to this?" has several answers on page 1, chosen by a control in the panel header, each shown in place by lighting the related nodes and edges and dimming the rest, never by navigating away:

| Relation | What lights up | Source |
|---|---|---|
| **Neighbors** (default) | The records one edge away, junction edges included | Derived in the viewer from the drawn graph |
| **Upstream** `+node` / **Downstream** `node+` / **Both** | Everything reachable against or along the lifecycle direction, to a chosen depth (1, 2, all) | Derived in the viewer; dbt's selector grammar |
| **Trace** | The hub's trace neighborhood: the lifecycle walk in both directions, modules attached as context, formative uses followed | `GET /intelligence/trace/:type/:id` for the selected record, read by the server when `?related=trace` |
| **About it** | The notes, findings and attestations whose `subject` is this record, drawn as nodes with dashed edges even when the Notes column is hidden | Derived from the export: every annotation record is already in it |
| **Referenced by** | Every document that references this one, grouped by class | Derived from the export (the impact read's answer, computed the same way); the hub's read is the fallback for a type the viewer does not draw |

Every relation is in the URL (`?select=<id>&related=trace&depth=2`), so a colleague can be sent exactly the lit subgraph, and a figure's caption can cite it.

---

## 6. The detail panel

Opens on the right (below the canvas on a phone) for a node or an edge. For a node, four tabs:

1. **Fields.** The record's own fields in the schema's order, with the id in monospace; references as links that select the target on the canvas (or, for a hidden class, show it as text with a "show class" affordance); fragments (an item's stem, options and feedbacks) as a nested list by `fragmentId`, never by nested id; `externalRefs` and `attachments` as their system and identifier. `createdBy` as text, since people are not drawn.
2. **About it.** Notes and findings whose `subject` is this record, each with its `fragmentId` when it is about one part and its `status` and `resolutionRationale` when it is a finding; attestations with verdict, claim text, attester and **state** (Current, Stale, FragmentRemoved, Unanchored). The state comes from `GET /intelligence/attestations/:type/:id`, which the server reads when the record is selected (`?select=`); until it arrives the verdict shows without a state. This tab is the text form of the graph's "About it" relation.
3. **Referenced by.** The impact read's answer, grouped by class and field, each entry selectable; for a junction, the container it sits in (`within`).
4. **History.** The commits that touched this record (`GET /documents/:type/:id/history`), newest first, each with its author, message and time; each a link to the same page at `?ref=<commit>`, and a "diff from here to head" link to the raw diff. Read by the server when the record is selected.

Actions at the top: **Focus** (the Focus page), **Walk** (the Walkthrough, for a traceable type), **Coverage View** (for a module, at the same ref), **View as of** (for a dataset, metric or finding: the Graph at `?ref=<asOf>`), **Raw JSON** (the hub's document URL, when `hubPublicUrl()` exists).

For an edge: the junction document's fields (rationale first, since it is what a junction exists to carry), both ends as selectable links, and the same History tab. For a plain reference edge: the field, both ends.

What is instant and what is a round trip: Fields, About it (without state), Referenced by and the relations in §5.3 except Trace come from the export already in the page, so selection is immediate. Attestation state, History and Trace are hub reads; selecting a node writes `?select=` to the URL with `router.replace`, the server component re-renders with those reads, and the panel fills in. Everything a reader sees is thus a URL, and the browser still never calls the hub.

---

## 7. Narrative 1 on the page

Narrative 1 (PROJECT_CONTEXT.md): a cohort performed poorly on an item; trace the result back through the graph to the objective and the module, and ask whether the module's assessment coverage was adequate *when that cohort met the design*. The seed carries one administration, so the walk runs on `main` from `LearningMetric/mod3-bias-type-difficulty`: the bias item, approved and attested, that 38% of the spring 2026 pilot answered correctly.

### 7.1 Entry points

1. **From the Coverage View** of "Risks and Ethical Use": the item's statistic line ("Spring 2026 pilot (2026-05-14): 0.38 proportion correct") gains a link, **Trace this result**, to the Walkthrough. This is the demo's opening: a number a designer would notice, one click from its explanation.
2. **From the Graph** with the **Outcomes lens** (§8): metrics are tinted by value, the low one stands out, and the panel's **Walk** action starts the walk.
3. **The URL** `/graph/LearningMetric/mod3-bias-type-difficulty?walk=1`, for slides and the explainer.

### 7.2 The walk

The Focus page with the stepper. Each step: the camera pans and zooms to the step's node (or edge), the path walked so far stays lit, the rest is dimmed, and the step panel shows a heading, two or three sentences templated from the hop, and the record's key fields. The templates are per class crossed, so the same stepper walks any trace; the seed is what makes this one good.

| Step | Node or edge | What the panel says (seed values in parentheses) |
|---|---|---|
| 1 · The result | `LearningMetric` | "{value} {unit} on *{item}*, {cohort}, {date}." (0.38 proportion correct; spring 2026 pilot). "A metric names what it measures (`subject`) and where it came from (`derivedFrom`); it is never a field on the item (ADR-0058)." |
| 2 · The administration | `derivedFrom` → `LearningDataset` | "The dataset records which assessment produced it and the commit the cohort met: *as of {asOf}*." The `asOf` chip is lit. "Everything after this step is read at that commit." |
| 3 · The assessment | `producedBy` → `Assessment` | "{n} items were placed in *{assessment}*; {approved} placements were approved." The placement edges fan out. |
| 4 · The item | placement edge → `AssessmentItem` | "*{label}*, {status}, {bloomsLevel}. Attested {verdict} on {part} by {attester}; the verdict is {state} against the part as it stands now." Findings and notes, if any. |
| 5 · The objective | `assesses` → `LearningObjective` | "The item assesses *{objective}*. {k} other items placed in this module assess it too." |
| 6 · The declaration | `ModuleObjective` edge → `Module` | "*{module}* declares the objective as {role} (#{sequence}): {roleRationale}." |
| 7 · Adequate when? | the module, with the coverage read at `?ref=<asOf>` | "When the cohort met the design, *{objective}* was **{verdict then}** ({items then} eligible items); today it is **{verdict now}** ({items now})." A link to the Coverage View at the dataset's `asOf`. "Coverage is computed at a ref, never stored (ADR-0056, ADR-0057)." |
| 8 · Then and now | the whole focus graph, **Then / Now** toggle | The graph re-read at `asOf` beside the head: records added since are outlined (in the seed: the attestation and the outcome records themselves, which did not exist when the cohort sat the assessment). "The design history is the commit graph (ADR-0025)." |
| 9 · Why this objective? | `generatedBy` → `LearningNeed` | "*{need}*, {priority}: {rationale}." |
| 10 · The evidence | `NeedEvidenceLink` edge → `DescriptiveEvidence` | "*{evidence}* ({confidence} confidence): {description}. The loop closes: a measurement led back to the evidence that justified the design." |

Steps 9 and 10 are the upstream continuation, offered after step 8 as "Continue: why does this objective exist?"; they are what distinguishes Armature from an analytics tool and belong in the walk, after the question the narrative asks has been answered.

Orientation: the Focus page keeps the lifecycle left to right, with the metric at the far right, so the walk moves leftward; the camera makes the direction explicit and the lit path accumulates behind it. A flipped layout for outcome-rooted traces was considered and declined: one orientation across every page is what makes the figures comparable.

### 7.3 Capturing it

The walk is built to be screen-recorded (the camera moves are smooth, `prefers-reduced-motion` makes them cuts) and to be exported step by step as figures (`?walk=7` in figure mode is the paper's "adequate when" figure). The explainer's Narrative 1 section gets the step 7 figure, exported from the page, with its stamp.

---

## 8. Lenses

A lens recolors the drawing by one intelligence read, one at a time, chosen in the filter rail, in the URL as `?lens=`:

| Lens | Read | What changes |
|---|---|---|
| **Coverage** | `GET /intelligence/coverage?course=` (every module) | Objectives tinted by verdict (Uncovered red, PartiallyAssessed amber, FullyAssessed green, OverAssessed blue), the delivered figure by default and the projected one by toggle; the counts in the legend; the thresholds as parameters |
| **Alignment** | `GET /intelligence/alignment` | Items that assess no objective and objectives no activity targets outlined; the rest dimmed |
| **Attestations** | `GET /intelligence/attestations/:type/:id` for every attested record (from the export's attestation documents) | Records with a Current attestation green-chipped, Stale amber, FragmentRemoved red; unattested unchanged |
| **Outcomes** | the export's metrics | Items tinted by their most recent metric's value (a diverging scale around the median), datasets and metrics brightened; the Walk action one click away |
| **Changes since** | `GET /branches/:name/changes?since=<commit>` | Records added since the commit outlined green, changed amber, removed shown as ghosts; `?since=` names the commit; the panel's History tab links here |

Lenses compose with the class filters and the relations. Two lenses at once was considered and declined: one question per drawing is what keeps a figure readable.

---

## 9. Architecture

### 9.1 Reads

| Need | Read | When |
|---|---|---|
| The whole graph at a ref | `GET /export?profile=full` | Every Graph render; one call; the `ETag` is the commit shown |
| A record's neighborhood | `GET /intelligence/trace/:type/:id` | Focus page; the Graph when `?related=trace` |
| Attestation state | `GET /intelligence/attestations/:type/:id` | A selected record; the Attestations lens |
| History | `GET /documents/:type/:id/history` | A selected record |
| Coverage, alignment | `GET /intelligence/coverage?course=`, `/alignment` | Their lenses; step 7 of the walk at `?ref=<asOf>` |
| Changes | `GET /branches/:name/changes?since=` | The Changes lens; step 8 |
| Branches | `GET /branches` | The branch picker |

The export is the whole graph, which is the right source at the scale the project is at (66 documents in the seed; a real course is a few hundred to a few thousand) and the wrong one past a few thousand. §12 names the ceiling and what replaces it. The export's `profile=full` includes `User` documents; the viewer drops them before serializing, so no person reaches the browser (the pseudonymous profile is not needed for that).

### 9.2 Modules

```
app/lib/graph/
  stages.ts     The visual language as data: stage, column header, hue and glyph per class
                (a test fails for a class without an entry); the status and verdict tones
  derive.ts     Pure: documents + the schema as data → { nodes, edges, chips }. Folds a
                class's ancestors' reference fields in; skips fields targeting User; collapses
                a relationship document with two non-person references to an edge and one
                with a single reference to a chip on its subject; orients every edge by stage;
                marks same-stage edges; derives the "about it" and "referenced by" relations
  layout.ts     dagre over fixed node sizes, rank direction LR, with the stage pinned to a
                column (an invisible anchor chain, one anchor per stage, with an invisible
                edge from each stage's anchor to every node in it; same-stage edges withheld
                from the ranking and drawn afterward). Runs on the server; the client
                component receives positions. If pinning through dagre proves brittle, the
                fallback is an 80-line layered layout of our own (columns by stage, order by
                barycenter sweeps), which is less than the layout engine would cost us
  relations.ts  Neighbors, upstream, downstream to a depth; the trace's node and edge ids
                mapped onto the drawn graph
  walk.ts       The Walkthrough's steps from a trace: the hop order and the per-class
                templates of §7.2
  figure.ts     (PR 5) The same layout drawn as plain SVG for vector figures
app/app/graph/
  page.tsx                  Server: the export at the ref, derive, layout; the selected
                            record's reads when ?select= names one; props to the client
  GraphCanvas.tsx           'use client': React Flow, read-only; the column headers; hover,
                            select, relations, lenses applied as node and edge classes
  GraphPanel.tsx            The detail panel and its tabs
  FilterRail.tsx            Classes with counts, the edges toggle, the lens picker
  Search.tsx                Type-ahead over the serialized nodes
  nodes/ArmatureNode.tsx    The card of §4.1
  edges/JunctionEdge.tsx    The labeled edge of §4.3, selectable
  [type]/[id]/page.tsx      The Focus page and, with ?walk=, the Walkthrough
app/app/layout.tsx          The header with the navigation
```

Everything under `app/lib/graph/` is pure TypeScript with no React and no DOM, so it is unit-tested with fixtures and runs on the server. The derivation written for the prototype is its first draft.

### 9.3 State

All of it in the URL, read by the server component and mirrored into client state: `branch` or `ref`, `select`, `related` and `depth`, `hide` (a comma-separated class list), `edges=nodes` (junctions as nodes), `lens` and its parameters (`since`, `fullyAssessedAt`, `overAssessedAbove`), `walk`. The client updates the URL with `router.replace` without scrolling; the server re-renders with whatever new reads the URL asks for; React keeps the canvas mounted across the re-render because the component tree is the same. Legend choices are additionally remembered per viewer in `localStorage`, wrapped in try/catch, as a convenience only.

### 9.4 Dependencies

`@xyflow/react` 12.12.0 (MIT, 60 KB gzipped), `@dagrejs/dagre` 3.1.1 (MIT, 16 KB), `@types/dagre`, `html-to-image` (MIT, for PR 4), added to `app/package.json`; about 90 KB of client JavaScript on the graph pages only. No icon package: the glyphs are inline. No ELK unless §10's grouping is wanted. React 19 and the React Compiler are already in the app; React Flow 12 supports React 19.

---

## 10. Scale, limits and what is deliberately not built

- **Up to about 300 drawn nodes**, everything in this plan works as described, and the expectation (2026-10-22) is that no store will hold more than a few hundred documents for some time, so scoping and virtualization stay in PR 5. Between 300 and 2,000, three things keep it usable: `onlyRenderVisibleElements`, the class filters (the rail suggests hiding items first, the most numerous class), and **scoping** (`?module=<id>`: the module's declarations, content, assessments, items and outcomes only). Past that, the export read itself is the limit, and the answer is the hub-side graph read that §13 names, with scoping as its parameter.
- **Grouping by module** (compound nodes) is not built. A module is not a container in the schema, and dagre does not lay out sub-flows whose members connect outside them; ELK would, at seven times dagre's size. If a presentation needs it, the stage columns and the module relation (select a module, Downstream) give the picture.
- **Editing** is not built. The viewer only reads; a tool that writes is a plugin.
- **Force layout** is not offered. The lifecycle direction is the point.
- **People** are never drawn, as nodes or edges; `createdBy` and `attestedBy` are text in the panel (ADR-0021).

---

## 11. Figures

PR 4 builds the PNG export (§3.4): React Flow's `getNodesBounds` and `getViewportForBounds` to frame the drawing, `html-to-image`'s `toPng` at a chosen pixel ratio, figure mode's styles applied during capture, the stamp composed from the URL state. Fonts are the page's; the export embeds what the browser rendered.

Vector output, for LaTeX and print, is PR 5: `figure.ts` draws the same nodes and edges as plain SVG (rectangles, text, the glyph paths, the arrowheads) from the layout the page already computed, with the stamp as text. `html-to-image`'s SVG output is `foreignObject` markup that vector editors drop, so it is not the vector path; a renderer of our own is small because the node is simple. The explainer and the position paper's successors take their figures from this.

A third output, raised 2026-10-22 and kept for after the vector one: the same derived graph as a **text diagram** (Mermaid, or Graphviz DOT), so a figure can be pasted into a Markdown document, a wiki or a slide tool that renders Mermaid and edited there. It is a serialization of `derive.ts`'s output with the class palette as Mermaid `classDef`s, cheap once the derivation exists; the layout is then the renderer's, not ours, which is why it comes after the SVG that reproduces the page.

---

## 12. Accessibility

The list pages remain the primary accessible form of every intelligence read; the graph is an additional view, never the only one. Within it: nodes are DOM elements with an accessible name ("AssessmentItem, Identifying training data bias, Approved, Analyze") and are in the tab order; the panel is plain HTML and is the text form of everything the canvas lights up (About it, Referenced by, the lit relation's members as a list); color never carries a meaning alone; focus is visible; `prefers-reduced-motion` turns camera moves into cuts; the filter rail and search are ordinary form controls.

---

## 13. Implementation plan

Five pull requests on `viewer/graph-view` and its successors, each with its tests, its documentation and a screenshot check (the headless-Chrome recipe in SESSION.md, both themes), merged in order. CI's `app` job (lint, `tsc`, the types check) covers the code, and from PR 1 a **browser smoke test** covers the pages: Playwright drives the built viewer against the contract job's seeded store and a started hub, opens the Graph and the Focus page of the seed's metric, and asserts the node count, a selection, the panel's content and the absence of console errors. The rule behind it (2026-10-22): a test is included unless it is very unlikely to show a real problem or is very costly to run; this one is neither, at about two minutes. Each later PR extends it with the page or step it adds.

**PR 1 · The Design Graph page.** `stages.ts`, `derive.ts`, `layout.ts`, `relations.ts` with unit tests (a junction with two references becomes an edge; with one, a chip; ancestors' fields are folded in; `User` fields skipped; a Set reference yields one edge per target; an unresolved target is skipped; every edge points along the lifecycle; same-stage edges are withheld from ranking; every class in `CLASS_CATEGORY` has a stage; the seed derives to the expected counts, read through the hub like the other contract tests). The `/graph` page: canvas, column headers, filter rail, search, selection with the Fields, About it (without state) and Referenced by tabs, the Neighbors, Upstream, Downstream and About it relations, URL state, light and dark, the navigation in the layout, the index link. The Playwright smoke test and its CI job. `docs/visual-language.md` with the palette, glyphs and node anatomy. README and the explainer's viewer section updated. Acceptance: the seed renders in its columns; selecting the bias item lights its objective, its placement and its metric and lists its attestation; `?select=` and `?hide=` reproduce a view from the URL alone; the smoke test passes in CI.

**PR 2 · The Focus page and the trace.** `[type]/[id]/page.tsx` from the trace read with annotations as chips; the Trace relation on the Graph (`?related=trace`); the panel's attestation state and History tab (server reads on `?select=`); the `asOf` chip as a link; Coverage View links to Focus pages; breadcrumb. Acceptance: the Focus page of the metric matches the prototype's second view, with states; the Coverage View's item statistic links to it. *(Built 2026-10-22. One change from the design above: the Focus page reads the export too and draws the trace's records with the Graph's own derivation and layout, restricted to the walk (`lib/graph/focus.ts`), rather than drawing the trace's summaries; the panel then has every record's fields on the Focus page as well. A selection on either page is routed, so the server reads attestation state, history and, with the Trace relation, the trace; view-only changes stay in `replaceState`. The hub's commit `timestamp` is a number of seconds, which the client's type had wrong.)*

**PR 3 · The Walkthrough and time travel.** `walk.ts` with the templates of §7.2 and a test that walks the seed's trace to its ten steps; the stepper with camera, lit path and keyboard; step 7's coverage read at `asOf`; step 8's Then/Now with the changes read; "Trace this result" in the Coverage View; `?walk=`. Acceptance: the seed's walk runs from the Coverage View to the evidence with every number correct; `?walk=7` renders the "adequate when" state directly. *(Built 2026-10-22. Two changes from §7.2: the walk is built for every traceable root, not only a metric, starting at the root's stage, so an item's walk has six steps and an objective's five; and "then and now" is not a toggle, since the metric itself did not exist at `asOf` and its Focus page cannot be read there. The step outlines what the branch gained since the commit (added green, changed amber) and links to the Design Graph at that commit with the module selected. The seed's step 7 reads "partially assessed, 1 eligible item" then and now, which is the truth of the seed, not a defect of the walk.)*

**PR 4 · Lenses, figures, branches.** The five lenses of §8; figure mode and PNG export with the stamp; the branch picker; the explainer's Narrative 1 figure exported from the page. Acceptance: each lens reproduces its read's numbers; an exported figure carries the commit it was drawn at. *(Built 2026-10-22. The lenses are `lib/graph/lenses.ts`, pure over the derived graph and a read the server makes (`app/graph/lensReads.ts`), each a map of marks on nodes, a tinted fill or a ring always with its word on a chip, plus a legend whose counts are the read's own numbers, which the tests check on the seed. Three refinements to §8: the coverage lens also rings an objective no module declares, and gives one declared twice the weaker verdict; the alignment lens outlines all four of the read's lists, not two; the attestations lens rings the record rather than recoloring the chip, since the chip already carries the state. The changes lens draws the deleted records as ghosts from the export at the `since` commit, offers the commits the graph's own records name as choices, and is linked from each entry of the panel's History tab. Figure mode is `?figure=1` with `?legend=1` for the tile, so a figure is a URL too; its export inlines the stylesheet's SVG styles first, because html-to-image 1.11 copies computed styles onto an `<svg>` element but not its children, which left every edge unstroked. The branch picker lists the hub's branches in the navigation with each head, the layout's read. The explainer's figure is `docs/figures/narrative-1-adequate-when.png`, `?walk=7` fitted, exported at 2×.)*

**PR 5 · Vector figures and scale** (when a paper or a larger store asks). `figure.ts` and SVG export; `?module=` scoping; `onlyRenderVisibleElements`; the hub-side graph read if a second client (the course builder's "course tree at one commit", the curriculum mapper) wants the same derivation, in which case `derive.ts` moves behind `GET /intelligence/graph` and the viewer becomes its first client.

Sequencing: PR 1 is the largest and establishes everything the others reuse; PR 2 and PR 3 are Narrative 1; PR 4 is the paper's needs; PR 5 waits for a trigger. Each PR is one or two sessions.

---

## 14. Questions settled by asking

Asked and answered 2026-10-22 (Amos); the plan above is written to these answers.

1. **Name and route.** "Design Graph" at `/graph`; navigation "Design Graph · Modules".
2. **Fixed lifecycle columns** (pinned stages), not dagre's free ranking as in the prototype: what makes figures comparable across papers.
3. **Outcomes in their own columns** after the course, so the header reads as the loop.
4. **Glyphs per class**, inline, from Lucide's shapes, for print.
5. **Figures**: PNG with the stamp first (PR 4); vector SVG later (PR 5); then possibly a text diagram such as Mermaid (§11).
6. **Selection and the hub**: instant for what the export holds, a URL round trip for attestation state, history and the trace, so every panel state is a linkable URL. Linkable is fine for now.
7. **The Walkthrough** is generic (any trace, templated text), with the upstream continuation to the need and the evidence offered after the coverage step.
8. **Scale**: no store is expected to hold more than a few hundred documents for some time; scoping and virtualization stay in PR 5.
9. **People are never drawn**; `createdBy` and `attestedBy` are panel text (ADR-0021).
10. **Branch picker and the Changes lens** in PR 4.
11. **A browser smoke test in CI**, from PR 1. The general rule: include a test unless it is very unlikely to show a real problem or is very costly in time or resources.
12. **This file is the plan**, with a Phase 8 entry in `development-plan.md` pointing at it; it is rewritten as the pages' description when they exist.

Decided on reviewing PR 1 (2026-10-22):

13. **The column order follows backward design**: evidence · needs · objectives · items · activities · assessments and lessons · modules · course · datasets · metrics · notes and findings. Items before activities (the evidence before the experiences), and both containers a module holds in one column after them, so every edge in that part of the drawing spans at most one column (a placement skips the activities, an activity's `targets` skips the items). The first build had items and activities in one column with the group first, which drew the two containment chains in opposite directions.
14. **Paired hues for a container and what it holds**: items and assessments are two purples, activities and lessons two greens, each pair checked against the palette's adjacent-pair rules since activities and lessons are neighboring columns.
15. **`ActivityGroup` is renamed `Lesson`** (done the same day, ADR-0064): an ordered set of activities a module schedules, the peer of an assessment (an ordered set of items); `LessonActivityLink` and `ModuleLessonLink` with it.
