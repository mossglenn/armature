# Crosswalk: plan

*Status: draft 2026-11-12, revised the same evening; nothing decided. Written in a claude.ai session from `main` at `15a42b2`. Crosswalk is a client of the hub, built in its own repository (`mossglenn/crosswalk`, proposed), like CoQui and Quiver. Its hub half is proposed as ADR-0071 (`schema/docs/adr/0071-external-alignment.md`), not yet accepted. What it asks of Armature's repository is §13; the decision that shapes everything else is §4.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), CASE (1EdTech Competencies and Academic Standards Exchange), CTDL (Credential Transparency Description Language), ASN (Achievement Standards Network), SKOS (Simple Knowledge Organization System), SME (subject-matter expert), OIDC (OpenID Connect).

---

## 0. What changed in this revision (2026-11-12 evening)

- **ADR-0071 drafted** from §4: `ExternalAlignment` as a relationship record, with its fields, two constraints and the platform checks to run first. §4.3 now summarizes it and points there; where the two differ, the ADR holds.
- **Statement text is no longer required** (§4.3, §11). An alignment carries a fingerprint of the item's normalized statement, its text only where the framework's license allows, and optionally the mapper's own gloss. The per-framework text policy is the plugin's (§5.4).
- **The hub/plugin split is stated** (§4.4), with the two-client test argued from readers.
- **The objective-meaning gap has a proposed answer** (§8): a client compares the objective at the verdict's `asOf`; the hub's staleness read is unchanged.
- §13 and §16 follow.

## 1. In brief

**Crosswalk maps a course's objectives to an outside standards framework, has an SME affirm each mapping, and answers three questions from the graph: which standards does this course teach and assess, how well, and where else is each standard taught.** It is the development plan's "objective and curriculum mapper" reference client (`docs/development-plan.md` §2), the client ADR-0028 and ADR-0030 already name as their second user.

- **What it demonstrates that nothing else does:** a design relation whose other end is outside the graph (P6), judged by an expert, going stale when either end moves, and rolled up into evidence an accreditor would ask for. Narrative 1 traced outcomes to objectives; Crosswalk extends the same chain one step outward, to the standard.
- **The central decision (§4):** where a mapping lives. The demo matrix says "writes ExternalRefs onto objectives". That works for a demo and breaks in two places under real use: every SME affirmation on an objective goes `Stale` when *any* mapping on it changes, and "where else is this standard taught" cannot be filtered, because the hub refuses filters on embedded parts. **Recommendation: a Hash-keyed relationship record, `ExternalAlignment`, adopting candidate ADR-0042 as ADR-0071** (proposed), with platform checks AP and AQ run before it is accepted.
- **The source side (§5):** CASE is the standard the repo names, and it is the right first adapter, but it is K-12-heavy. The seed course (AI for instructional designers) will mostly map to frameworks that are not published in CASE. A CSV/spreadsheet adapter is not optional; it is likely the demo's path.
- **Linking without copying (§11):** the graph holds identifiers, codes and a fingerprint of each statement; the text only where the license allows. Copyrighted frameworks can be aligned to without their text entering the graph or its exports.
- **What stays out of the hub (§4.4):** the framework itself (a cached copy lives in the plugin), the text policy, the mapping workflow, suggestions, drift polling and the evidence report. The hub gains one relationship type, two enums and two constraints.

## 2. What the repo already fixes

Read against `main` at `15a42b2` (2026-11-12). Constraints the plan works inside, not choices it makes.

| Source | What it says | What it means for Crosswalk |
| --- | --- | --- |
| `docs/demo-coverage.md`, Crosswalk row and profile | Proposed. "Objectives mapped to a standards framework, affirmed by an SME, and where else each standard is taught." Interactive; acts as the person (mapper or SME); runs beside the hub | Scope and placement are set. Unlike Quiver, it does not need the workspace hub. |
| `demo-coverage.md`, Crosswalk capabilities | Reads at a ref; proposes on a branch; writes ExternalRefs; SME attestations; coverage; trace from a standard to items and metrics; CASE identifiers; the institutional export profile; outcomes at `asOf`; reuse across courses by CASE identifier | Ten capabilities, six of them strong (●). §4 changes "writes ExternalRefs" and makes "trace from a standard" possible. |
| ADR-0030 | `ExternalRef` is a subdocument (`system`, `identifier`, `label`), `Random` key, no `fragmentId`; "a note or attestation is about the artifact or the fragment that carries the reference, never about the reference". Open: a graded `relation`, framework version, change date, retrieval date, statement snapshot, "when the curriculum mapper writes one" | The current shape cannot be attested on its own. Its open items are exactly what Crosswalk needs, and Crosswalk is the client they wait for. |
| ADR-0028 | An attestation's subject is one `DesignRecord`, optionally a fragment; staleness compares the judged part at `asOf` and at the ref; no per-person aggregate; the subject cannot be written in the same request | The judged unit must be the mapping itself, or staleness is noise (§4). The SME attests after the mapping commits. |
| `docs/api.md`, list reads | A filter "on an embedded part: 400 `unknown_field`" | `?externalRefs.identifier=` is refused. Reverse lookup over ExternalRefs means reading every objective and scanning. |
| `docs/research/learning-data-standards-precedents.md`, "Relations and alignment as fallible, competing claims" | Keep local structure and external mapping as separate classes; graded strength (only `exact` chains); assertions with provenance, not bare edges; snapshot the statement because CASE edits wording under the same GUID; treat `replacedBy` as a migration signal with ESCO's three choices; "crosswalks as named documents" | The research has already drafted most of the model. This plan turns it into a build order. |
| Same document, reliability | Twenty raters: kappa ≈ .56 on 57 fine topics, ≈ .72 on 10 broad categories (Herman, Webb & Zuniga 2005) | Fine-grained mappings are noisy. Crosswalk should show strength and favour the coarsest grain that answers the question (§11). |
| `docs/research/adr-candidates.md`, 0042, 0043, 0044 | External alignment as its own junction class; alignment models as competing scored hypotheses; supersession on change of meaning | 0042 is this plan's ADR. 0043 is deferred (§12). 0044 matters when a mapped objective changes meaning. |
| ADR-0024, ADR-0010 | Tools never delete, they change status; free text until usage shows structure | Alignments retire, never vanish. `rationale` stays text. |
| ADR-0068, CoQui's pattern | The branch creator owns it and grants `Maintainer`; a maintainer of `main` merges | One branch per mapping round; the mapper owns it, grants SMEs, a maintainer merges. |
| ADR-0021 | No per-person aggregates | The evidence table reports standards and records, never who affirmed how many. |
| ADR-0070 (proposed) | Check runs and required checks on `main`; the hub runs no rules | "Every objective in an accredited course has an affirmed mapping" is a check Crosswalk or Lint posts, not hub logic (§10). |
| `scripts/seed_data.js` | One `ExternalRef` today: `distinguish-bias-types` → a fictional CASE item `AI-ETH.2.1` on `case.example.edu` | The seed already gestures at Crosswalk. It migrates under §4 (§13). |

## 3. What Crosswalk is for

### 3.1 Who uses it

| Role | Does | Acts as |
| --- | --- | --- |
| **Mapper** (designer, curriculum coordinator) | Picks a framework, proposes mappings on a branch, sets strength and rationale, resolves declines and drift | Themselves |
| **SME** | Affirms or declines each proposed mapping, with a reason | Themselves (Maintainer on the round branch) |
| **Reviewer of evidence** (program lead, accreditation coordinator) | Reads the evidence table and exports it | Nobody (reads only) |
| **Suggester** (optional, M-later) | Proposes candidate mappings by text similarity | An agent `User` (P5) |

### 3.2 The questions it answers

1. **Coverage of the framework:** for each standard in scope, which objectives map to it, at what strength, affirmed or not?
2. **Evidence per standard:** for each mapped objective, which modules declare it, their coverage verdicts (ADR-0029), the items that assess it, and, where datasets exist, how those items performed.
3. **Gaps both ways:** standards no objective maps to; objectives that map to nothing (fine for most, a gap for an accredited course).
4. **Reuse:** where else this standard is taught, in this store's other courses and, later, in other hubs.
5. **Currency:** which mappings rest on a framework statement that has since changed or been replaced.

### 3.3 The demo story

"This course claims to teach Standard X. Here are the three objectives an SME affirmed map to it. One is fully assessed, one partially, one not at all. The cohort that took Module 2 struggled on the items behind the partial one. And the framework revised Standard X's wording in March; the SME's affirmation on that mapping is now Stale." It runs on the seed, and it is Narrative 1 with the standard as its first link.

## 4. The central decision: where a mapping lives

### 4.1 The two failures of ExternalRef-on-objective

**Staleness noise.** An SME attests "LO-3 maps to CFItem X" with the objective as subject and a `claimRef` for the mapping. ADR-0028 compares the whole subject at `asOf` and at the ref. `externalRefs` is a field of the objective, so adding a second mapping (to CFItem Y) changes the objective, and the affirmation on X goes `Stale`. So does every affirmation on the objective, for every mapping. The SME re-reviews mappings that did not change. ADR-0030 decision 4 shows the comparison sees nested changes and nothing else, so this is predictable from the code, not speculation. M0 still proves it with a contract test before anyone writes an ADR, per the decision-grounding principle.

**No reverse lookup.** "Where else is CFItem X taught" is a filter on an embedded part, which `api.md` refuses. Crosswalk would list every `LearningObjective` at the ref and scan. That works at seed scale and is the wrong shape for question 4 across courses.

A third, smaller one: **trace has nowhere to start.** "From a standard down to items and metrics" needs a record to start from. An ExternalRef has no identity (ADR-0030 decision 5).

### 4.2 Options

| | Shape | Staleness | Reverse lookup | Schema change | Fits |
| --- | --- | --- | --- | --- | --- |
| **A** | ExternalRef on the objective (as built); attestation on the objective with a `claimRef` per mapping | Noisy: any mapping change stales all | Scan | None (ADR-0030's open fields added) | The demo matrix as written; fastest start |
| **B** | **`ExternalAlignment` relationship record**, Hash-keyed over (objective, system, identifier); attestation on the record | Exact: stale only when this mapping or its statement's fingerprint changes | Filter on a top-level field | One class, two enums | Candidate ADR-0042; "relationships that carry reasons"; the research's "two classes, not one enum" |
| **C** | ExternalRef gains a client-assigned `refId`, treated as a fragment so attestations can name it | Exact | Still a scan | Amends ADR-0028 (non-fragment parts) and reverses ADR-0030 decision 5 | Reuses the fragment machinery, but stretches "fragment" past ADR-0027's meaning |
| **D** | A named `Crosswalk` document holding mappings (the research's "crosswalks as named documents") | Depends on inner shape | Depends | Large | Candidate ADR-0043's `AlignmentModel`; premature (§12) |

### 4.3 Recommendation: B, as ADR-0071

ADR-0071 holds the decision; this section is its summary. `ExternalAlignment` is a relationship record, so it inherits `DesignRecord` and can carry notes, findings and attestations with no new machinery.

```json
"ExternalAlignment": {
  "@inherits": "DesignRecord",
  "@key": { "@type": "Hash", "@fields": ["objective", "system", "identifier"] },
  "@metadata": { "armature": { "category": "relationship" } },
  "objective":        "LearningObjective",
  "system":           "ExternalSystem",
  "identifier":       "xsd:string",
  "framework":        "xsd:string",
  "frameworkVersion": { "@type": "Optional", "@class": "xsd:string" },
  "statementCode":    { "@type": "Optional", "@class": "xsd:string" },
  "statementHash":    { "@type": "Optional", "@class": "xsd:string" },
  "hashAlgorithm":    { "@type": "Optional", "@class": "xsd:string" },
  "statementText":    { "@type": "Optional", "@class": "xsd:string" },
  "gloss":            { "@type": "Optional", "@class": "xsd:string" },
  "sourceChangedAt":  { "@type": "Optional", "@class": "xsd:dateTime" },
  "retrievedAt":      "xsd:dateTime",
  "strength":         "AlignmentStrength",
  "confidence":       { "@type": "Optional", "@class": "ConfidenceLevel" },
  "rationale":        { "@type": "Optional", "@class": "xsd:string" },
  "status":           "AlignmentStatus",
  "replacedBy":       { "@type": "Optional", "@class": "ExternalAlignment" }
}
```

```json
"AlignmentStrength": ["Exact", "Close", "Broad", "Narrow", "Related"]
"AlignmentStatus":   ["Proposed", "Active", "Retired"]
```

What each piece is for:

- **Hash key over (objective, system, identifier).** One alignment per objective per outside item; a second write is a replace (ADR-0024 decision 3), so a retried push is idempotent. No key field is mutable; retargeting is a new record. The client never supplies the `@id`.
- **`framework`** is the CASE `CFDocument` URI (or the tool-minted framework URI), required and top-level, so "everything aligned to this framework" is a store-applied filter.
- **The statement (ADR-0071 decision 3).** Constraint 23: a fingerprint (`statementHash` with `hashAlgorithm`), the text, or both. The fingerprint is computed over a fixed normalization (Unicode NFC, whitespace collapsed and trimmed, UTF-8, no case folding), so two tools agree and reformatting raises no false change. Refreshing it after the framework changes changes the record, so every attestation on it goes `Stale`: exactly the alignments whose wording moved go back to the SME. The text is stored only where the framework's license allows (§5.4); the `gloss` is the mapper's own summary, theirs to store, so a reader without the framework can follow the alignment.
- **`strength`** follows SKOS (candidate 0042). The hub infers nothing from it: no transitive alignment, even through `Exact`.
- **`confidence`** reuses `ConfidenceLevel`.
- **`status` and `replacedBy`** implement "retire, never delete" (ADR-0024) and the `replacedBy` migration signal. Constraint 24: a replacement is an alignment of the same objective, and a replaced alignment is `Retired`.
- **Subject typed `LearningObjective` only.** A knowledge component is the plausible second subject; ADR-0010 says wait.

**What happens to `ExternalRef` on objectives (ADR-0071 decision 4).** An `ExternalRef` says a record *is* that record elsewhere (an objective's id in a Torus project); an `ExternalAlignment` claims a *relation* to a different thing elsewhere. Crosswalk writes alignments only. The seed's one CASE `ExternalRef` is a claim and moves to an `ExternalAlignment`.

### 4.4 What is the hub's and what is Crosswalk's

The test is the one Armature already uses: structure in the hub (P4), workflow in plugins (P2; Development Principle 5).

| The hub (ADR-0071) | Crosswalk |
| --- | --- |
| The claim: objective X aligns with outside item Y, this closely, as worded then | Fetching and caching frameworks (CASE, CSV, CTDL adapters) |
| Its identity, so it can be affirmed, annotated, traced and exported | Browsing the framework tree, search, suggestions |
| Constraints 23 and 24 | The per-framework text policy (§5.4) |
| Store-applied filters on `objective`, `system`, `identifier`, `framework`, `status`; a starting record for trace; `slices.json` | The mapping round: branches, grants, the decline-and-resolve loop |
| Later, only on a second client: a roll-up read that takes the hierarchy as input | Drift polling and the three migration choices; the evidence table and report |

**Why the alignment cannot live in the plugin.** Other tools read it with no Crosswalk code (Lint, Projection, Whyfinder, the Structure analyzer, the viewer, an export to an accreditor); an attestation needs a `DesignRecord` as its subject; and plugin-owned graph data (candidate ADR-0040) is not built, so the only alternative is the plugin's private store, which fails all three.

**The line not to cross.** The hub holds the claim, never the source. Once hub code walks a framework's hierarchy or knows CASE's association types, a CASE consumer is growing inside the hub. A field only one framework standard would fill belongs in the adapter (ADR-0071 decision 10).

**Two-client test (ADR-0071 decision 11).** One writer (Crosswalk), five or more readers. The test exists to keep one tool's workflow out of the hub; this record carries none, so readers are fair evidence, as ADR-0030 counted its own reference clients. The likeliest second writers: a Torus bridge, or an importer for a publisher's pre-aligned item bank.

## 5. The source side: frameworks

### 5.1 One adapter interface, three adapters

```ts
interface FrameworkSource {
  list(): Promise<FrameworkSummary[]>;              // what this source offers
  fetch(frameworkUri: string): Promise<Framework>;  // the whole tree, normalized
  changedSince?(frameworkUri: string, since: string): Promise<ItemChange[]>;
}

interface Framework {
  uri: string; title: string; version?: string; publisher?: string;
  license?: { uri?: string; text?: string };        // §11, licensing
  lastChangeDateTime?: string; retrievedAt: string;
  items: FrameworkItem[];                           // flat, with parent ids
}

interface FrameworkItem {
  uri: string; code?: string; statement: string; type?: string;
  parent?: string; lastChangeDateTime?: string;
  replacedBy?: string[];                            // from CASE associations
}
```

| Adapter | Reads | When |
| --- | --- | --- |
| **CASE** | `GET /CFPackages/{sourcedId}` from a CASE provider (OpenSALT, a state's server, Common Good Learning Tools' Satchel, which hosts what 1EdTech called CASE Network 2); both `ims/case/v1p0` and `ims/case/v1p1` paths, since 1.1 changed only the base path and added fields | M1. The standard the repo names. |
| **CSV / spreadsheet** | A sheet with `code, statement, parent_code` and a header block for framework metadata; Crosswalk mints stable URIs (`urn:crosswalk:<framework-slug>:<code>`) or uses the publisher's if given | M1, beside CASE. Probably the demo's path (§5.2). |
| **CTDL / Credential Registry** | Competency frameworks from the Credential Registry, which publishes CASE frameworks as CTDL as well | Later, when a higher-ed or workforce user asks. |

`ExternalSystem` gains a value per adapter that is not CASE (`CTDL`; CSV frameworks use `Other` with a URI, or a new `LocalFramework` value, §16 question 5).

### 5.2 Where the assumption is shaky

CASE's public network is mostly K-12 state standards. The seed course, "Introduction to AI for Instructional Designers", is professional learning for designers, and the frameworks that fit it (instructional designer competency models, AI literacy frameworks for educators) are more likely published as PDFs or web pages than as CASE packages. If the demo leans on CASE alone, it either maps the course to a K-12 computer science framework (a stretch a viewer will notice) or stays fictional (`case.example.edu`, as the seed does today).

**What M0 settles:** search real CASE providers for a framework that genuinely fits the seed; if none fits, the demo uses the CSV adapter on a framework whose license allows storing statement text, and the CASE adapter is shown on a second, smaller case (one module mapped to a public framework). Either way the CASE adapter is built and tested against a real provider.

### 5.3 The framework stays in the plugin

Crosswalk keeps a local cache of each fetched framework (SQLite or JSON files, the plugin's choice), keyed by URI and retrieval date. Nothing from the framework enters the graph except, per alignment, the identifier, code, a fingerprint of the statement, dates and, only under a `full` policy, the statement text (P6: reference, don't copy; §5.4). The framework's hierarchy (`isChildOf`) drives the browsing UI and the roll-up in the evidence table; it is never written as graph structure. Local structure and external structure stay in different classes, the research's point.

### 5.4 The text policy

Each framework in Crosswalk's configuration carries a policy, read from its license where the source states one (CASE's `CFLicense`) and confirmed by the mapper:

| Policy | Written to the graph | For |
| --- | --- | --- |
| `full` | Fingerprint, code, statement text (with the license's attribution in Crosswalk's report) | Openly licensed frameworks: Creative Commons, many state standards |
| `hash` (default) | Fingerprint and code; text stays in the plugin's cache | Copyrighted or unknown license |
| `none` | Fingerprint only; the code too if allowed | Frameworks whose codes are themselves restricted |

The SME's side-by-side view always shows the full text, from the cache, under the deployment's own license. Frameworks published only as PDFs get an `Attachment` (ADR-0030) on a framework-level record when one exists, or in Crosswalk's configuration until then, pointing at the publisher's document by URL, revision and content hash, with page or section anchors per item in Crosswalk's resolver table.

## 6. The mapping workflow

### 6.1 A round

1. **Open.** The mapper picks a course (or modules) and a framework. Crosswalk creates `crosswalk-<round>` from `main` (ADR-0068: the mapper owns it) and records the framework URI and version in the branch's first commit message.
2. **Propose.** Two panes: the course's objectives (with Bloom level, modules declaring them, current coverage) and the framework tree with search. Dragging an objective onto an item writes an `ExternalAlignment` (`status: Proposed`, `strength` defaulting to `Close`, never `Exact` by default). Rationale is optional text; an `AlignmentDecision` `DesignNote` is offered for longer reasoning.
3. **Assign.** The mapper grants SMEs `Maintainer` on the branch (CoQui's pattern) and sends them a link.
4. **Affirm.** The SME sees each proposed mapping with both texts side by side, the strength, and the objective's assessed items. They affirm or decline, with a reason. Each verdict is an `Attestation` on the alignment record. A claimless endorsement is enough under option B, since the record *is* the claim; a `claimRef` is used only if the SME's verdict is about strength specifically (§16 question 6).
5. **Resolve.** Declines come back to the mapper: change strength, retarget, or retire. Any edit stales the earlier verdict, so the SME sees it again.
6. **Deliver.** When every mapping in scope is affirmed and `Current`, the mapper flips them to `Active` and asks a maintainer of `main` to merge. With ADR-0070 built, "crosswalk-affirmed" can be a required check on that merge (§10).

### 6.2 Rules the client enforces (not the hub)

- The SME cannot affirm their own proposal. A pattern about records (the alignment's author and its attestation's attester), never a count per person (ADR-0021).
- An attestation is written in a request after the alignment's (ADR-0028's `subject_in_same_write`).
- The suggester's proposals arrive as `Proposed` under an agent `User` and need a person's affirmation like any other (P5). Suggestions are text similarity, so they are a convenience, not structural intelligence (P4); they live entirely in the plugin.

## 7. The reads: the evidence table

### 7.1 How Crosswalk computes it (plugin-side first)

| Step | Read | Notes |
| --- | --- | --- |
| Alignments for a framework | `GET /documents/ExternalAlignment?framework=<uri>&ref=<ref>` | One call; a top-level field, so the filter works (it may be hub-applied if `framework` is not required; §4.3 makes it required) |
| Objectives and their modules | `GET /documents/ModuleObjective?ref=` filtered to the objectives in hand | One call, client join |
| Coverage per module | `GET /intelligence/coverage/:moduleId?ref=` | One per module; a course has a handful |
| Items per objective | `GET /intelligence/alignment` | Already used by CoQui |
| Attestation state per alignment | `GET /intelligence/attestations/ExternalAlignment/:id?ref=` | **One per alignment: an N+1.** Fine at a course's 20–60 mappings; the case for a batch form if it grows |
| Outcomes | `GET /intelligence/item-statistics?module=` | Where datasets exist (seed has them) |

The table rolls up by the framework's hierarchy (from the cache): a strand is "evidenced" when its children are. Columns: standard, mapped objectives (strength, attestation state), modules, coverage verdict (approved and all-but-retired, ADR-0019), item count, latest performance, drift flag.

### 7.2 When it becomes a hub read

A `GET /intelligence/standards` (or a path read, SESSION.md item 18) is warranted only when a second client needs the same roll-up: Projection building an accreditor document, or Lint checking "every Active objective in this course has an affirmed mapping". Until then, keeping it in the plugin keeps hierarchy logic and roll-up policy (what counts as "evidenced") out of the hub, which is P2.

### 7.3 Trace from a standard

With option B, trace starts at an `ExternalAlignment`: alignment → objective → items → metrics, with attestations as context (ADR-0028 decision 7). The trace route needs the new type registered as traceable; that is §13's one route-level ask. "All alignments for one standard" is then N traces merged in the client.

### 7.4 Reuse across courses

- **In one store:** `GET /documents/ExternalAlignment?identifier=<uri>` returns every objective, in any course, mapped to that standard; Crosswalk joins to modules and courses and shows how each is assessed there.
- **Across hubs:** Crosswalk holds credentials for several hubs (OIDC) and asks each the same filter. This is the instance-registry question already open in the project notes; Crosswalk should not design the registry, only accept a list of hubs in its configuration. Results show the hub, the course and the coverage verdict, never people.

## 8. Drift: when the framework moves

1. **Poll.** On demand and on a schedule (a service `User` when scheduled, the mapper when on demand), Crosswalk re-fetches each framework in use and compares items by URI against the cache.
2. **Classify.** Per mapped item: unchanged; *reworded* (statement differs, `lastChangeDateTime` moved); *replaced* (a CASE `replacedBy` association, or the item is gone); *removed*.
3. **Offer ESCO's three choices**, each a commit with a reason (ADR-0025):
   - *Update automatically*: refresh `statementHash` (and `statementText` under a `full` policy) and the dates. The record changes, its attestations go `Stale`, the SME re-reviews. The default for rewording.
   - *Have a person retarget*: write a new alignment to the replacement item, set the old one `Retired` with `replacedBy`. The default for replacement.
   - *Retire*: `Retired`, reason recorded.
4. **Never silently.** Drift is a branch (`crosswalk-drift-<date>`) with a summary the mapper reviews, not a write to `main`.

If the *objective* changes meaning (candidate ADR-0044), the alignment's attestations do not go `Stale`: the objective is a reference from the alignment, not part of it. An SME affirmed "LO-3 as worded then maps to X". ADR-0071 decision 7 proposes the answer: **Crosswalk reads the objective at the attestation's `asOf` and at the ref**, two ordinary reads at commits, and flags verdicts whose objective changed; the mapper decides whether the change reopens review (a typo fix should not). Folding the objective into the hub's staleness read is deferred until the client shows which changes matter.

## 9. Export and the accreditor's document

- **v1:** Crosswalk renders the evidence table as HTML and CSV, stamped with the ref it was computed at, so anyone can reproduce it (`?ref=`).
- **With ADR-0031:** the `institutional` export profile plus a slice including `ExternalAlignment` and `Attestation` gives an accreditor a file that reproduces the evidence, people reduced to their institution. Needs the class in `slices.json` (§13).
- **Later:** Projection ("one graph, one document per audience") generalizes the rendering; Crosswalk's table becomes one of its projections. Do not build Projection inside Crosswalk.

## 10. Where it meets other plugins

| Plugin | How |
| --- | --- |
| **Lint** | Rules over alignments: an `Active` objective in a course flagged as accredited has at least one `Active`, affirmed, `Current` alignment; no `Exact` alignment from a `Remember`-level objective to a standard whose verb is higher-order (a hint, not a rule). With ADR-0070, "crosswalk-affirmed" is a required check on `main`. |
| **CoQui** | While authoring, "this item assesses LO-3, which evidences Standard X" as context. A read, no new capability. |
| **Viewer / Design Graph** | A lens showing alignments as edges leaving the graph, coloured by attestation state. |
| **Whyfinder** | The standard as the outermost reason: "this activity is here because LO-3, which the program maps to Standard X." |
| **Knowledge components** | KC ↔ external competency is the natural second subject for `ExternalAlignment` (§4.3). |
| **DataShop bridge** | Outcomes per standard are a roll-up of outcomes per objective. No new data path. |

## 11. Design notes and trade-offs

- **Granularity.** The reliability evidence says fine-grained mappings disagree. Crosswalk should let a mapper align to a strand (a parent item) as readily as to a leaf, show strength on every row, and roll up rather than force leaf mappings.
- **Linking without copying.** Identifiers, codes and the claim that an objective aligns with an item are not the publisher's expression; the statement text and the framework as a whole are. (This is a design position, not legal advice; each framework's license governs.) The options weighed:

  | Option | In the graph | Drift detection | Readable without the plugin |
  | --- | --- | --- | --- |
  | Identifier only | URI, code, version | Weak: the source's change date also moves for non-wording edits | Code only |
  | **Identifier + fingerprint** (chosen default) | Plus a hash of the normalized statement | Exact | Code only |
  | Mapper's gloss | A summary in the mapper's words | None alone | Yes |
  | Plugin-side licensed cache | Nothing more; text in Crosswalk's store | As the graph field gives | No |
  | Attachment to the source document | `storeUri`, `revision`, `contentHash`, anchor | Whole document only | A pointer |
  | Resolver URNs | `urn:crosswalk:<framework>:<code>` | As what sits beside it | Code only |

  ADR-0071 layers them: every alignment carries the identifier, code and fingerprint; text is optional under §5.4's policy; the gloss is optional; PDF-only frameworks get an attachment once, not per alignment.
- **Where text leaks in anyway.** `Attestation.claimText` (Crosswalk writes endorsements, or claims in terms of the code); `DesignNote` and finding text where people quote the standard (a Lint hint can flag long overlaps with cached statements); a real framework's text in `ExternalRef.label`; and the rendered evidence report, which is built from the cache at render time and governed by the license, not by the graph's export.
- **Cost of a new relationship type.** One more class every reader may meet, a client-changes revision, the seed, the generated types, the viewer. Worth it if B's staleness and lookup benefits are real, which M0 checks.
- **N+1 attestation reads.** Acceptable at course scale; named as the trigger for a batch read.
- **Single-store bias.** "Where else is this taught" is most compelling across institutions, and that is the part that depends on unbuilt infrastructure (an instance registry, cross-hub credentials). The single-store version is honest and demoable with a second seeded course.

## 12. What is deliberately not built

- **Crosswalks as named documents / alignment models** (candidate ADR-0043, option D). A round is a branch and a framework URI; that is enough until two competing mappings of the same course must coexist on `main` (a program's mapping and an accreditor's). The trigger mirrors the knowledge-components plan's stage 9.
- **Framework-to-framework crosswalks** (CASE item to CASE item). That is a framework publisher's job and CASE's own associations; Armature maps design records outward, not standards to each other.
- **Transitive inference.** No "LO-3 maps to X, X exactMatch Y, so LO-3 maps to Y". SKOS limits transitivity to `exactMatch` for a reason; v1 does none.
- **Mapping items directly to standards.** Items assess objectives; objectives align to standards. A direct item → standard shortcut duplicates the chain and lets it disagree with itself.
- **A hub-side framework store or CASE provider.** P6.
- **AI suggestions in M1–M4.** They are a later convenience, behind the same affirmation.

## 13. What Armature's repository is asked for

1. **ADR-0071** (proposed 2026-11-12), and Amos's review of it.
2. **Platform checks AP and AQ** (ADR-0071, Verification) before acceptance: the staleness noise on a sibling `ExternalRef` (AP1); the embedded-part filter refused (AP2); a Hash key over an enum and a URI string, with the file-backed store minting the same id (AQ1); a store-applied filter on a required string (AQ2); staleness on a refreshed fingerprint and not on a sibling alignment (AQ3).
3. **On acceptance, build:** `schema.json`, generated types, the appendix; constraints 23 (`alignment_without_statement`, `hash_incomplete`, `hash_malformed`) and 24 (`replacement_objective_mismatch`, `replaced_not_retired`) with failing and passing tests; the type accepted by the trace route; `slices.json` entries; a `client-changes.md` entry and revision; `api.md` rows; dated notes on ADR-0028 and ADR-0030.
4. **Seed:** migrate the `AI-ETH.2.1` ExternalRef to an `ExternalAlignment` with an affirmed attestation; add three to six more alignments across modules so the evidence table has a gap, a partial and a stale; optionally a second small course sharing one standard, for reuse.
5. **`ExternalSystem`:** `CTDL` when that adapter lands; a value for tool-minted local frameworks if §16 question 5 says so.
6. **`docs/demo-coverage.md`:** the Crosswalk row (writes alignments, not ExternalRefs; trace ●), recounted from the cells, when the ADR is accepted.
7. **Later, each on its trigger:** a batch attestations read; a standards roll-up or the path read; a knowledge component as a second subject; the objective folded into staleness.

## 14. Build order

| Milestone | Work | Exit criterion |
| --- | --- | --- |
| **M0 · Spike** (1–2 days) | §13 item 2's checks; the CASE adapter fetching one real package from a public provider into the cache; the framework search for the seed (§5.2) | The test shows the staleness noise; a real CFPackage is cached and browsable; the demo framework chosen |
| **M1 · ADR and hub** | ADR-0071 accepted; §13 items 3 and 4 in Armature's repository; Crosswalk repo scaffold (Next.js 15, React 19, TypeScript, Tailwind, `@armature/client` by git reference, CI against a seeded hub) | ADR accepted; contract tests for the type green; the seed carries alignments; Crosswalk reads them |
| **M2 · Mapping** | Framework adapters (CASE, CSV); the two-pane mapper; branch per round; writes `Proposed` alignments with strength and rationale | A mapper maps a module on a branch; the diff shows only alignments |
| **M3 · Affirmation** | SME view; grants; attestations; decline → resolve loop; `Active` on delivery; merge by a maintainer | Two people (mapper, SME) complete a round; staleness behaves per §4.3 when either edits |
| **M4 · Evidence** | §7.1 table with hierarchy roll-up; trace from an alignment; HTML/CSV export stamped with its ref | Demo story §3.3 runs end to end on the seed |
| **M5 · Drift** | Polling, classification, the three choices on a drift branch | A reworded item in a test framework stales exactly its alignments' attestations; a replaced item produces a retarget proposal |
| **M6 · Reuse** | Single-store reverse lookup; multi-hub over configured hubs | "Where else is X taught" lists the second seeded course with its coverage |
| **M7 · Integrations** | The Lint rule and ADR-0070 check (if built); viewer lens; institutional export slice | One required check blocks a merge with an unaffirmed alignment |

M0 to M4 is the demo. M5 to M7 is what makes it a tool.

## 15. Verification

- **Hub (Armature's repository):** contract tests for the type (key, replace, refusal of a client `@id`, invariants, filter by `framework` and `identifier`, trace from an alignment); constraints 23 and 24 failing and passing; staleness: a refreshed fingerprint stales the alignment's attestations and no other's; adding a second alignment to the same objective stales nothing.
- **Crosswalk:** adapter tests against recorded CASE 1.0 and 1.1 responses and a malformed package; CSV import round trip; the fingerprint normalization against fixed vectors (shared with the hub's documentation, so another tool can check itself); the round workflow against a seeded hub in CI (two `User`s via the `header` resolver); drift classification over a pair of framework snapshots; the evidence table snapshot-tested on the seed.
- **The demo:** a scripted run of §3.3 on a fresh `docker compose up` with the seed, recorded for the screen-capture video.

## 16. Questions to settle

ADR-0071 proposes an answer to several; accepting it settles them.

1. **Option B, or A for the demo and B later?** ADR-0071 proposes B. A is a day faster and leaves a migration.
2. **Names.** `ExternalAlignment` (proposed) vs `StandardAlignment` or `CompetencyAlignment`; `strength` (proposed) vs `relation`, ADR-0030's word.
3. **`status: Proposed`**, or let the branch alone mean proposed? ADR-0071 keeps the status; the branch is simpler.
4. **`Exact` allowed by default, or only after an SME affirms?** A client rule either way; the question is the UI default (proposed: `Close`).
5. **Tool-minted frameworks:** `ExternalSystem.Other` with a URN, or a `LocalFramework` value?
6. **Endorsement or claim** for the SME's verdict? ADR-0071 decision 7: an endorsement is enough; a claim when the verdict is about the strength alone.
7. **The objective-meaning gap (§8):** ADR-0071 proposes the client-side comparison at `asOf`. The open part is which objective changes should reopen review.
8. **The text policy's default:** `hash` (proposed), and whether the mapper may override the policy a license states.
9. **The demo framework:** a real CASE framework that fits the seed, a CSV framework, or the fictional one kept?
10. **Second writer:** ADR-0071 decision 11 argues from readers. Accept that, or name the Torus bridge or a pre-aligned bank importer as the second client?
11. **Repository and release:** its own repository (like CoQui) and its own mark under the Armature endorsement, per the branding decisions?
12. **The normalization for the fingerprint** (ADR-0071 decision 3): NFC, whitespace collapsed, no case folding. Is case folding wanted after all?

## 17. Risks

| Risk | Likelihood | Effect | Mitigation |
| --- | --- | --- | --- |
| No real framework fits the seed | High | Demo looks contrived | CSV adapter; second small case on a real CASE framework (§5.2) |
| ADR-0071 stalls on the two-client test | Medium | M1 slips; the demo falls back to option A | Decide question 10 with the ADR's review |
| Statement licensing limits what is stored | High | Exports show codes, not statements | Fingerprint by default (§5.4, §11); the mapper's gloss for readable exports |
| SMEs find per-mapping affirmation tedious (the capture-burden problem) | Medium | Rounds stall | Batch affirm per strand with per-row decline; strength defaults conservative; affirmation inside the view they already need |
| Two representations of one mapping (ExternalRef and alignment) | Medium | Contradictory data | The ADR's rule (§4.3) and a Lint rule flagging an ExternalRef whose identifier also appears as an alignment |
| Multi-hub reuse depends on unbuilt infrastructure | High | M6's second half waits | Ship single-store reuse; configure hubs by list |
