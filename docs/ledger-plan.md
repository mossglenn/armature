# Ledger: LEED decision tracking for Armature — plan

*Status: draft 2026-11-12, for review. A plan for a client of the hub, built outside this repository (proposed `mossglenn/armature-ledger`), in the shape of `docs/mcp-server-plan.md` and `docs/datashop-bridge-plan.md`. It absorbs the proposed **LEED importer** of `docs/demo-coverage.md` and adds real-time capture. "Ledger" is a working name. The questions in §12 each carry the recommendation the plan is written to.*

Abbreviations: LEED (Learning Engineering Evidence and Decision, the MIT tracker), ADR (Architecture Decision Record), MCP (Model Context Protocol), AI (artificial intelligence), LLM (large language model), CLI (command-line interface), UI (user interface), API (application programming interface), CI (continuous integration), SME (subject-matter expert), MIT (Massachusetts Institute of Technology), ICICLE (the IEEE International Consortium for Innovation and Collaboration in Learning Engineering), SIG (special interest group), JAID (*Journal of Applied Instructional Design*), CSV (comma-separated values), XLSX (the Excel workbook format), VTT (WebVTT, a transcript and caption format), ISO (International Organization for Standardization, here its date format), URL (web address), ID (identifier).

---

## 1. Purpose

Two jobs, one data model:

1. **Import.** Bring existing LEED tracker logs (the MIT template, or a team's adaptation of it) into the graph as addressable, anchored, versioned decisions.
2. **Capture.** Make recording a new decision cheap enough, at the moment it is made, that a designer keeps doing it after week three.

The second job is the harder one, and it is where the evidence points. Totino & Kessler (2025) coded 283 decisions across 18 projects; only 8 of 25 decisions that cited data actually linked to it, and one external project stopped tracking after ideation. The research doc's summary line is the design brief: *tracking fades without a payoff* (`docs/research/learning-data-standards-precedents.md`). So Ledger has three obligations, not two:

- **Capture** at near-zero cost.
- **Anchor and link** after capture, cheaply, ideally by someone or something other than the designer at the moment of decision.
- **Pay back**: show the designer something they could not see without the log (decisions whose subjects have changed, decisions that outcome data now bears on).

### What it demonstrates

From `docs/demo-coverage.md`, the importer alone covers External references and Attachments. With capture and the payoff reads it also exercises: history and changes-since (staleness), attestations (reaffirmation), agent provenance (AI-proposed decisions), trace (decision → evidence → need → objective), and branches (review before merge).

### What it triggers

`docs/development-plan.md` §6 ("Questions to decide deliberately") names this exact evidence as the trigger for `DesignDecision`: *"`DesignNote.category` usage showing recurring structure, or a needs-analysis tool modeling the LEED tracker's columns."* Ledger is that tool. It also gives ADR candidate 0049 (rationale capture conventions) its first client. §9 lays out the path: ship on `DesignNote` with a fixed convention now, propose the structured type once real entries exist.

---

## 2. The LEED tracker, as data

The MIT template's columns (Totino, Kessler & Fruchtman 2024 template; teams are told to adapt):

| LEED column | What it holds | Where it goes in Armature |
|---|---|---|
| Date | When the decision was made | `Decision-Decided-At` (§3), distinct from commit time |
| Key Design Decision | One sentence | `DesignNote.label` + first line of `rationale` |
| Influence/Source | One or more of seven influence codes | `Decision-Influence` (§3) |
| Justification | Why | Body of `rationale` |
| Revisited Decision? When? | Free text | **Derived**: a later reaffirming `Attestation` or a superseding decision (§3.3) |
| Source (data, feedback, context change) | What prompted the revisit | Evidence links on the superseding decision |
| Resulted in change/iteration? | Yes/no + what | **Derived**: commits carrying a `Decision:` trailer (§3.4) |

Two of seven columns become reads, not fields. That follows ADR-0056 (nothing derived is stored) and it removes the two columns that most often go blank in practice, because they ask the designer to remember to come back.

**Influence codes.** Seven, from Totino & Kessler (2025). The repo's notes confirm four (Experience 151, Requirements 136, Context 122, Research 38). *Copy the other three verbatim from the paper before M0* (§12 Q5). Adopting them unchanged makes Armature decision data comparable with the existing LEED corpus, which is a research payoff worth more than a tidier vocabulary.

**Two orthogonal facets.** LEED's influence axis (*what pushed the decision*) and `DesignNoteCategory` (*what kind of decision*: Sequencing, Scope, Alignment…) are different questions. Keep both. An "AlignmentDecision influenced by Research + Requirements" is a better record than either facet alone.

---

## 3. The data model

### 3.1 Phase 1: `DesignNote` with a trailer convention (no schema change)

Every Ledger decision is a `DesignNote`. The structured parts live as git-style trailers at the end of `rationale`, the convention ADR-0025 already reserves for commit messages and ADR-0065 uses (`Armature-Authored-At`). Parseable, human-readable in any viewer, and mechanically migratable to fields later.

```text
label:     Use scenario-based items for Module 3 checks

rationale: |
  Use scenario-based items for Module 3 checks.

  Recall items didn't discriminate in the SME pilot; the objective is
  application-level and the old items tested definitions.

  Decision-Influence: Research, Requirements
  Decision-Decided-At: 2026-11-12T14:05:00-05:00
  Decision-Evidence: DescriptiveEvidence/sme-pilot-round2
  Decision-Captured-Via: raycast
category:  AssessmentStrategyChoice
subject:   [LearningObjective/apply-bias-taxonomy, Module/m3]
externalRefs: []          # imports: the LEED row (§4.4)
```

Trailer keys (all optional except where noted):

| Trailer | Cardinality | Meaning |
|---|---|---|
| `Decision-Decided-At` | 0..1 | Domain time. Defaults to capture time. Imports set it from the Date column. |
| `Decision-Influence` | 0..1, comma list | LEED codes, verbatim |
| `Decision-Evidence` | 0..n | `LearningEvidence` / `LearningDataset` / `LearningMetric` ids, or a URL |
| `Decision-Supersedes` | 0..1 | `DesignNote/<id>` of the decision this replaces |
| `Decision-Alternatives` | 0..1 | Free text: what else was considered |
| `Decision-Captured-Via` | 1 | `raycast`, `cli`, `commit`, `mcp`, `import`, … (needed for §10's evaluation) |
| `Decision-Needs` | 0..n | `anchor`, `why`, `evidence`: triage flags (§5.4) |

**Why not put evidence in `subject`?** `subject` means *what this is about*. Evidence is *what this is because of*. Mixing them in one set re-creates exactly the ambiguity that made 17 of 25 data-citing LEED entries unlinked. The trailer keeps the two relations distinct until the schema can.

**Identifiers.** Live captures: `DesignNote/ledger-<ulid>` (sortable, minted client-side). Imports: `DesignNote/leed-<logId>-<rowId>`, deterministic, so a re-import is a replace, not a duplicate (schema guide §10: "the same push twice is one state").

### 3.2 Anchoring: the `Course` fallback

`DesignNote.subject` has `@min_cardinality: 1`. Many LEED decisions are made before the artifact they concern exists ("Leverage xAPI for learner data"), or concern the whole project.

Rule: if the capture names no subject, the note's subject is the workspace's `Course`, and it carries `Decision-Needs: anchor`. It is honestly about the course. Triage (§5.4) later replaces it with a narrower subject; the replace is in history, so nothing is lost. If no `Course` exists yet (pure needs-analysis phase), Ledger creates one placeholder `Course` once per workspace and says so.

Rejected: a local inbox outside the graph. It would be a second store, it wouldn't push, and it would be invisible to the MCP server and every other tool.

### 3.3 Status is derived, not stored

ADR-style status (Proposed → Accepted → Superseded) without a status field:

| Status | Derived from |
|---|---|
| **Proposed** | Written by an agent `User` (ADR-0067), no person's endorsement |
| **Accepted** | Written by a person, *or* carries a claimless `Affirmed` `Attestation` from a person (ADR-0028; the endorsement the MCP plan §7 already names) |
| **Superseded** | Another decision's `Decision-Supersedes` names it |
| **Reaffirmed** (LEED "revisited, kept") | A later `Affirmed` attestation by a person; its `asOf` is "When?" |

Attestations already go `Stale` when their subject changes. That's the right semantics for "this decision was reaffirmed, but the thing it's about has moved since."

### 3.4 "Resulted in change": the `Decision:` commit trailer

A commit that enacts a decision carries `Decision: DesignNote/<id>` in its message. In-flow capture (§6) sets it automatically. Then "did this decision result in a change?" is a precise history read: the commits carrying the trailer, and what they touched. This needs a dated note on ADR-0025 defining the trailer (§11).

---

## 4. Import

### 4.1 Shape

Batch plugin, the person importing as author, on the designer's machine through the workspace hub (as `docs/demo-coverage.md` already places it). Built like a Zotero translator (the research doc's recommended model for importers): a **profile** maps a team's columns onto the canonical fields of §2.

```text
ledger import <file|sheet-url> --profile mit-2024 [--dry-run]
```

### 4.2 Pipeline

1. **Read.** CSV, XLSX, or a Google Sheet (CSV export URL first; Drive API later). Hash the source bytes.
2. **Profile.** `profiles/mit-2024.json` maps headers → fields, with tolerant matching (case, punctuation, "Influence/Source" vs "Influence"). Unknown columns go into the rationale body verbatim under a `Imported fields:` heading, never dropped.
3. **Normalize.** Dates (US and ISO; ambiguous dates flagged), influence free text → codes (exact match, then a synonym table, then flagged), multi-decision cells split only on explicit bullets.
4. **Stable row ids.** Row numbers shift when someone sorts the sheet. If the sheet has no id column, the dry run proposes adding one (`LEED-ID`, a short ulid) and, for Sheets, can write it back. Without it, re-import falls back to content hashing and warns.
5. **Anchor.** Fuzzy-match each decision's text against record labels at the workspace head (objectives, modules, items, activities). Show candidates with scores; the person accepts, edits or skips per row. Skipped → `Course` fallback + `Decision-Needs: anchor`.
6. **Evidence.** The Source column: URLs → `ExternalRef { system: Other }` on a new `DescriptiveEvidence` (method mapped: "survey" → `Survey`, "SME" → `ExpertReview`, else `Other`); local files → `Attachment` by `sha-256`; references to existing evidence by label → fuzzy match like step 5.
7. **Revision chains.** "Revisited? When?" with a date + changed outcome → a second decision with `Decision-Supersedes`. "Revisited, kept" → noted in the import report (an attestation can't be back-dated under the original person's name, since `attestedBy` is always the caller, rule 15).
8. **Original authors.** A "Who" column, if present, becomes `Co-Authored-By` claims the hub records as sent (ADR-0067 decision 6). Writing as them is refused (ADR-0068 decision 5) and Ledger does not try.
9. **Dry run → write.** A diff of what will be created/replaced; then one atomic batch with `If-Match`. Commit message: `ledger: import <filename> (<n> decisions)` plus trailers `Ledger-Source-Hash: sha-256:<…>` and `Ledger-Profile: mit-2024`.

### 4.3 Where it lands

A workspace hub refuses to create branches (ADR-0065). So the flow is: in the desktop program, create a workspace named for the import (e.g. `leed-import-2026-11`); `ledger import` writes there; review in the viewer; push; merge on the remote. The plan's docs say this in one sentence because it will otherwise surprise people.

### 4.4 Re-import and sheet-as-UI

Deterministic ids plus stable row ids make import idempotent. That opens a mode worth naming: **teams who never leave the spreadsheet.** Run `ledger import` on a schedule (or a watch), and the sheet stays the capture surface while the graph gets the structure. Each row keeps `ExternalRef { system: Other, identifier: "<sheet-url>#LEED-ID=<id>", label: "LEED row <id>" }`. This is the lowest-friction path for existing LEED practitioners, and the one most likely to matter for the MIT relationship (§12 Q10).

### 4.5 Export (round trip)

`ledger export --format leed` writes the MIT column layout from the graph, with the derived columns (§2) filled. Designers can hand a stakeholder the familiar table; researchers can pool Armature-captured decisions with the existing LEED corpus. Overlaps with the proposed Projection plugin; Ledger ships the one profile it needs.

---

## 5. Real-time capture: options considered

Decisions happen in four kinds of place: **inside an Armature tool** (editing, reviewing), **away from the graph** (meetings, a hallway, thinking), **in dialogue with an AI partner**, and **in a shared team artifact** (the sheet). A capture channel is judged on:

- **Cost at the moment** (seconds and context switches)
- **Anchoring** (does it know which records the decision is about, for free?)
- **Evidence linking** (does it know what the decision rests on?)
- **Reach** (which of the four places it covers)
- **Build cost on today's stack**
- **Fit with Armature's identity rules** (who writes, as whom, where)

### 5.1 Twelve candidates

| # | Channel | Cost at moment | Anchoring | Evidence | Reach | Build cost | Notes |
|---|---|---|---|---|---|---|---|
| 1 | **"This was a decision" toggle on commit** in Armature tools | ~1 keystroke | Excellent (the commit's records) | Weak | In-tool | Low per tool, needs adoption | Capture as byproduct; CoQui's revision-reason model |
| 2 | Contextual "Decide…" on any record (viewer, graph viewer) via `armature://decide` deep link | 2–3 s + typing | Excellent | Medium | In-tool | Low–medium | Viewer stays read-only; link hands off |
| 3 | **Global hotkey quick-capture** (Raycast / tray panel) | 5–10 s | Poor → `@` picker | Poor → `#` picker | Anywhere on machine | Low (Raycast) | The ambient channel |
| 4 | CLI `ledger decide "…"` | 5–10 s | `--on` flag | `--because` | Terminal | Very low | Core for #3; scriptable |
| 5 | **MCP tool: AI partner proposes the entry** | ~2 s (confirm) | Good (it read the records) | **Excellent** (it read the evidence) | AI dialogue | Medium; rides MCP M4 | Agent-as-author, person endorses |
| 6 | Meeting-transcript mining (VTT → proposed decisions) | 0 at moment | Medium | Medium | Meetings | Medium | Batch; precision risk; only as proposals |
| 7 | Live sheet sync (§4.4) | Same as today | Poor | Poor | Shared artifact | Low (falls out of import) | Best for existing LEED teams |
| 8 | Chat-ops: Slack `/decide`, Telegram via Guppy | 5–10 s | Poor | Poor | Mobile, team chat | Medium; loopback problem | Workspace hub is on the Mac; needs a relay inbox |
| 9 | Obsidian inline `decision::` lines, watched | 3–5 s inside notes | Poor | Medium (note links) | Note-taking | Medium | Parsing fragility; vault-specific |
| 10 | Voice memo → transcript → draft | 5 s, hands-free | Poor | Poor | Mobile | Medium | Rare need; transcription noise |
| 11 | Browser bookmarklet, page as evidence | 5 s | Poor | Good for web sources | Browser | Low | Narrow |
| 12 | Email-in | 30 s+ | Poor | Medium (attachments) | Anywhere | Medium | Too slow; no |

### 5.2 Why these three

The pick is **#1+#2 (in-flow), #3+#4 (ambient), #5 (AI partner)**. Together they cover three of the four places decisions happen, each with a different strength, and they share one write path:

- **In-flow** gives the best anchoring for the least effort, but only for decisions made while editing.
- **Ambient** reaches everything else on the machine, at the cost of poor anchoring, which triage (§5.4) repairs later.
- **AI partner** is the only channel that solves the evidence-linking problem at the moment of decision. It's also Armature's core thesis in miniature: the structure gives the AI the context to be a design partner, and what the AI writes goes through the same review as a person's.

The fourth place, the shared team sheet, is covered by #7, which falls out of the importer at no extra cost.

**Not chosen, and why:**

- **#6 (transcripts)** is a batch extension of #5: same proposal path, later milestone.
- **#8 (chat-ops)** fails the identity rules today. Agent writes reach a remote only via a workspace hub's push (ADR-0067 decision 10), and Guppy on the Pi can't reach the Mac's loopback hub. It works only through a relay into the CLI's spool (§7.4), so it can be a stretch on top of #4.
- **#9–12** are narrow or slow.

### 5.3 One contract underneath

All channels produce the same `DecisionDraft`, and only `text` is required at capture time:

```ts
type DecisionDraft = {
  text: string;                 // required, one line is fine
  why?: string;
  influences?: LeedInfluence[];
  subjects?: string[];          // DesignRecord ids; empty → Course fallback
  evidence?: string[];          // record ids or URLs
  decidedAt?: string;           // ISO; default now
  supersedes?: string;          // DesignNote id
  alternatives?: string;
  category?: DesignNoteCategory;
  capturedVia: CaptureChannel;
  enacts?: { commitMessage: string }; // in-flow only → Decision: trailer
};
```

`@armature/ledger-core` owns: validation, trailer encoding/decoding, `Course` fallback, id minting, the offline spool, and the write through `@armature/client` with `Armature-Local-Token`. Every front end is thin.

### 5.4 Triage: capture fast, enrich later

The single biggest friction lever is **not asking for anchor, influence and evidence at the moment of decision**. Ledger's triage queue lists decisions carrying `Decision-Needs`, and offers one-keystroke fixes:

- `anchor`: fuzzy candidates from the decision text, plus "same as previous"
- `why`: a one-line prompt
- `evidence`: candidates from evidence written in the last N days, and anything the trace of the anchor reaches

Triage is also where the AI partner helps without being in the room at decision time: "suggest anchors/influences for these 6" is a Formalizer-shaped job, so it ships as proposals the person accepts, not as writes. This is the research doc's "capture by someone other than the designer" recommendation, made concrete.

---

## 6. Option A: In-flow capture (Armature tools)

**Where:** Quiver, CoQui, and any future tool with a commit dialog; the viewer and graph viewer by deep link.

### 6.1 Commit toggle

- A shared React component, `<DecisionToggle/>`, in `@armature/ledger-ui` (Quiver and CoQui are both React + Tailwind, so it travels). It renders under the commit-message field: `☐ This was a decision  ⌘D`.
- When checked:
  - the commit message becomes the decision `text` (first line) and `why` (body);
  - the records the commit writes become `subjects`: **anchoring is free**;
  - an influence chip row appears (keys 1–7); optional, skippable with Enter.
- On save, the tool mints the note's id client-side, writes the design change with a `Decision: DesignNote/<id>` trailer in its commit message, and writes the note (in the same batch if Q7's spike allows, otherwise immediately after). Minting first means the trailer never has to wait for the hub to assign anything.
- **Cost:** one keystroke plus whatever the person already typed for the commit.

**Edge cases**
- Commits that touch 40 records (bulk re-align): cap auto-subjects at the records the person *selected*, if the tool knows; otherwise the module(s) they belong to, plus `Decision-Needs: anchor`.
- A commit that reverses a prior decision: offer "Supersedes…" with the most recent decisions on the same subjects.

### 6.2 Contextual "Decide…" by deep link

The viewer only reads, by design. So it offers a link, not a write:

```text
armature://decide?subject=LearningObjective/x&ref=<commit>
```

The desktop program already registers `armature://` for `connect`. It routes `decide` to Ledger's capture panel (§7) with the subject pre-filled. The program itself still writes nothing; Ledger does. Needs a small desktop-program change and a dated note on its plan (§11).

### 6.3 Pros and cons

| For | Against |
|---|---|
| Best anchoring of any channel | Covers only decisions made while editing |
| Rides an action the person already takes | Each tool must adopt the component |
| Produces the `Decision:` trailer, so "resulted in change" becomes a precise read | Commit messages are often terse; `why` may be thin |

---

## 7. Option B: Ambient quick-capture (hotkey, Raycast, CLI)

**Where:** anywhere on the person's machine: after a meeting, mid-email, while sketching.

### 7.1 The interaction

A global hotkey (`⌥⌘D` suggested) opens a single-line panel:

```text
┌─────────────────────────────────────────────────────────────┐
│ Decide: Drop the pre-test for M2; SME time is the bottleneck│
│   why: (optional, Tab)                                      │
│   @ Module/m2 ×        # (evidence)      1 2 3 4 5 6 7      │
│                                     ⏎ save   ⇧⏎ save+next   │
└─────────────────────────────────────────────────────────────┘
```

- Type the decision → **Enter**. That's the whole required interaction (~5 s).
- `Tab` for why; `@` opens a fuzzy record picker (labels at the workspace head, recent-first); `#` opens evidence (recent evidence, or paste a URL); number keys toggle influence codes.
- `⇧⏎` saves and clears for the next (meetings produce decisions in runs).
- Defaults remembered per session: last `@` subject stays selected (most consecutive decisions share a module).

### 7.2 Front ends, in order

1. **CLI** (`ledger decide "…" --why "…" --on Module/m2 --because <url> --influence Requirements`). The reference implementation; scriptable; how tests drive capture.
2. **Raycast extension.** Amos's daily driver; React in TypeScript like the rest of the stack; preferences hold hub URL, `ARMATURE_USER`, and the pairing value. Commands: *Decide*, *Decision Triage*, *Decisions Needing Revisit*.
3. **Tray panel** (Tauri, small). Only when a non-Raycast user exists (Windows, Linux).

**Why not in the desktop program?** Its plan rules it out explicitly: "The program is not a tool… nothing a plugin would build" (Development Principle 5). The hotkey belongs to Ledger.

### 7.3 Identity and pairing

Writes go to the workspace hub on `localhost:3101` as the person (`Armature-User`), with `Armature-Local-Token` from the pairing screen. The value is kept across starts in the keychain (desktop plan §7, decided), so Raycast's stored value survives restarts.

### 7.4 Never lose a capture

If the hub isn't answering (program quit, laptop just woke), the draft goes to `~/.armature/ledger/spool.jsonl` with its original `decidedAt`. It's flushed on the next successful contact, oldest first, and the panel says "saved locally, will sync." The spool is also the relay point for stretch channels (#8 Telegram/Slack): anything that can append a line to a synced file can feed it.

### 7.5 Pros and cons

| For | Against |
|---|---|
| Reaches decisions made away from the graph: most of them | Poor anchoring at capture; relies on triage |
| Cheapest real-time channel to build | Mac-first until the tray panel exists |
| Daily use by Amos = the usage evidence ADR-0010 is waiting for | A hotkey only helps if the person remembers it's there (§10 measures this) |

---

## 8. Option C: AI-partner capture (MCP)

**Where:** any conversation with an assistant that has the Armature MCP server attached (Claude Desktop, Claude Code, claude.ai via the desktop bridge).

### 8.1 Interaction

Two triggers:

- **Explicit:** the person says "log that" / "record this decision."
- **Detected:** the assistant notices decision language ("let's go with", "we'll drop", "decided") and asks *once*: "Log 'Drop the M2 pre-test' as a decision?" It does not ask again in the same thread for the same decision, and never logs without the person's yes. The host's own approval of the write tool (MCP plan §7, Q6 recommendation) is the confirmation.

The assistant then drafts the full entry: text, why, influences, subjects found through intelligence reads it already made, and **the evidence it actually read in this conversation**. It shows the draft and writes on confirmation.

### 8.2 Tool

Added to the MCP server's write toolset (milestone 4, off by default, `ARMATURE_WRITES=on`):

```text
propose_decision(
  text, why?, influences?, subjects?, evidence?, decided_at?,
  supersedes?, alternatives?, category?, branch
) → { id, commit, status: "Proposed" }
```

It's a `DesignNote` write, so it sits inside the MCP plan's recommended write scope for Q4 ("notes and findings only, behind a switch") with no expansion. It writes as the agent acting for the person (ADR-0067 decision 3): agent as author, `Armature-On-Behalf-Of` trailer, landing in the person's workspace. Status derives as **Proposed** until the person endorses it (§3.3). Ledger's triage view lists Proposed decisions first, with an Accept key that writes the person's claimless attestation.

Plus one MCP **prompt**, `decision-log`, that tells the model the detection and confirmation rules above, for clients that support prompts.

### 8.3 Batch variant (later)

`ledger mine <transcript.vtt>` runs the same drafting over a meeting transcript and writes every candidate as Proposed. LLM-drafted rationale has low precision (Zhao et al. 2024; Zhou et al. 2025 in `further-reading.md`), so nothing here is ever auto-accepted; the person's endorsement is the gate.

### 8.4 Risks

- **Over-capture.** The ask-once rule and Proposed status contain it; §10 tracks the Proposed→Accepted rate. If it falls below ~50%, detection is too eager.
- **Sycophantic logging** (the model logs what the person seems to want to hear as "decided"). The draft is shown verbatim before writing; the person edits or declines.
- **Prompt injection** via record text. Same structural defenses as the MCP plan: writes off by default, non-`main` only, notes only, a person merges.

### 8.5 Pros and cons

| For | Against |
|---|---|
| The only channel that links evidence at decision time: directly attacks the 8-of-25 finding | Depends on MCP server M4 (unbuilt) |
| Best demo of agent provenance + endorsement | Covers only decisions made in AI dialogue |
| Captures alternatives considered, which people almost never write down | Model-quality-dependent; needs the eval set (§10) |

---

## 9. The payoff reads

Without these, Ledger is a better spreadsheet and will fade like one. All are computed in Ledger from hub reads; none is stored.

| Read | Question it answers | Built from |
|---|---|---|
| **Decision log** | "What did we decide on M3, and why?" LEED-shaped table per course/module, filterable by influence and category | Notes + trailers at a ref |
| **Revisit queue: changed** | "Which decisions are about things that have changed since?" | `changes?since=<note's commit>` on each subject |
| **Revisit queue: data arrived** | "Which decisions does new outcome data bear on?" | `LearningDataset`/`LearningMetric` with `asOf` after `decidedAt`, reached by `trace` from the decision's subjects |
| **Evidence gap** | "Which decisions claim Research/Data influence but link nothing?" | Influence ∋ {Research, …} ∧ no `Decision-Evidence`. The 8-of-25 problem, made visible |
| **Enacted by** | "Did this decision result in a change?" | Commits with `Decision:` trailer |
| **Triage** | "What needs anchoring, a why, or my endorsement?" | `Decision-Needs`, Proposed status |

The two revisit queues are the payoff. They turn the log from a record into a prompt: the moment outcome data lands on an objective, the decisions that shaped it surface with their reasons. That's Armature's Narrative 1 (close the loop) with the *why* attached.

Surfaces: Raycast commands, `ledger revisit` in the CLI, an MCP read tool (`decisions_needing_revisit`), and a small Ledger page. The viewer stays the hub's.

---

## 10. Evaluation

Ledger is also a study. Each metric is computed from the data Ledger already writes; `Decision-Captured-Via` is what makes it possible.

| Metric | Target | Baseline |
|---|---|---|
| Median time to capture | In-flow < 2 s extra; ambient < 10 s | LEED sheet: switch apps, find row, fill 4 cells |
| Decisions/week, sustained weeks 1–8 | No more than 30% decay from weeks 1–2 to weeks 7–8 | "Tracking fades" (Totino & Kessler 2025) |
| Anchored within 7 days | ≥ 80% | n/a |
| Data/Research-influenced decisions with linked evidence | ≥ 70% | 8 of 25 = 32% |
| Proposed → Accepted (MCP) | ≥ 50% | n/a |
| Revisit-queue items acted on (attested or superseded) | Track; no target yet | n/a |
| Share by channel | Track | n/a |

Run on Amos's own work first (n = 1, honest about it), then any pilot (Rae's interest in an Armature pilot is the natural second site). Comparing the evidence-link rate against the published 32% is the headline result, and fits an ICICLE short paper or the Design SIG (§12 Q10).

---

## 11. What Armature's repository is asked for

Nothing in the hub is required for Phase 1. Asked for, each by its own rule:

1. **A dated note on ADR-0025** defining the `Decision:` commit trailer (§3.4).
2. **ADR-0049 (candidate) promoted to Proposed**, with Ledger as its first client: trailer convention, influence codes as an optional facet, supersede-don't-edit, stale rationale as a read.
3. **`DesignDecision` ADR**, drafted after ≥ 50 real Ledger decisions exist. Two clients for the two-client rule: Ledger, and the MCP server's `propose_decision`. Proposed shape, migrated from the trailers one-to-one:
   - `DesignDecision` (artifact): `label`, `rationale`, `decidedAt: xsd:dateTime`, `influences: Set<DecisionInfluence>`, `category: Optional<DesignNoteCategory>`, `concerns: Set<DesignRecord>` (min 1), `supersedes: Optional<DesignDecision>`, `alternatives: Optional<xsd:string>`
   - `DecisionEvidenceLink` (junction over `(decision, evidence)`, optional `confidence`), mirroring `NeedEvidenceLink`, per ADR-0003's set-vs-junction rule
   - No status field (§3.3 stays derived)
   - `DesignNote.relatesToDecision` activated, as ADR-0012 reserved
4. **`ExternalSystem`**: stay on `Other` until a second client names LEED rows (§12 Q4).
5. **Desktop program:** route `armature://decide` to a paired tool (§6.2); a dated note on its plan.
6. **Documents.** *Updated with this plan, 2026-11-12:* `demo-coverage.md` (the LEED importer renamed Ledger, its capture capabilities added, the totals recounted), the development plan's needs-analysis-intake row and §6 deferral line, the README's plan table and docs list, `PROJECT_CONTEXT.md`'s row and `CLAUDE.md`'s map. When the plan is accepted: `SESSION.md`.

---

## 12. Questions to settle

1. **Name.** *Recommendation:* Ledger (a decision ledger; nods to LEED without borrowing its mark). Repo `mossglenn/armature-ledger`, packages `@armature/ledger-core`, `@armature/ledger-ui`.
2. **Phase 1 encoding.** (a) Trailers in `rationale`; (b) wait for `DesignDecision`. *Recommendation: (a).* ADR-0010 asks for usage before structure, and (b) blocks the usage.
3. **Unanchored decisions.** (a) `Course` fallback in the graph; (b) local inbox. *Recommendation: (a)*, §3.2.
4. **`ExternalSystem` value.** (a) `Other`; (b) add `LEED`. *Recommendation: (a)* until a second client.
5. **Influence vocabulary.** (a) LEED's seven verbatim; (b) Armature's own. *Recommendation: (a)*, for corpus comparability. **Action before M0:** copy the three unconfirmed codes and their definitions from Totino & Kessler (2025).
6. **Ambient front end first.** (a) Raycast + CLI; (b) Tauri tray panel. *Recommendation: (a)*; (b) when a non-Mac user appears.
7. **Write timing for in-flow capture.** (a) Two requests, id minted first; (b) one batch with the note and the design change. *Recommendation:* (b) if the batch route accepts a note whose subject is created in the same batch; otherwise (a). M0 spike settles it.
8. **AI detection default.** (a) Explicit "log that" only; (b) detect and ask once. *Recommendation: (b)*, with (a) as a setting; revisit if Proposed→Accepted < 50%.
9. **Import of "revisited, kept."** (a) Import-report line only; (b) a `DesignNote` saying so. *Recommendation: (b)*, as a note with `Decision-Supersedes` absent and a `Reaffirmed-At` trailer, since a back-dated attestation is impossible (rule 15).
10. **MIT involvement.** Aaron Kessler co-created LEED and offered to read the Armature paper for Design SIG fit. *Recommendation:* show him the importer + export round trip before building capture. Ask two things: is verbatim use of the seven codes welcome, and would the Design SIG pilot sheet-sync mode (§4.4)?

---

## 13. Implementation plan

Milestones in `mossglenn/armature-ledger`, each a pull request with tests against a seeded hub in CI (the MCP plan's pattern).

**M0 · Core and spike.** `ledger-core`: `DecisionDraft`, trailer codec (round-trip property tests), id minting, `Course` fallback, spool, writer on `@armature/client`. Spike Q7. Lock the seven codes (Q5). *Acceptance:* a draft round-trips through the hub and back to an identical draft; spool survives a hub restart.

**M1 · Import.** CLI `import` with the `mit-2024` profile, dry run, anchoring prompts, evidence, revision chains, co-authors, idempotent re-import. Fixture: the public MIT template's example rows plus a messy synthetic sheet. *Acceptance:* importing twice changes nothing; a re-sorted sheet re-imports cleanly with `LEED-ID`.

**M2 · Ambient capture.** `ledger decide`, Raycast extension (Decide, Triage), pairing. *Acceptance:* hotkey → Enter → note on the workspace in < 10 s; offline capture flushes on reconnect. **Dogfooding starts here.**

**M3 · Payoff reads.** Decision log, both revisit queues, evidence gap, enacted-by; `ledger export --format leed`. *Acceptance:* on the seed plus a fixture dataset, a decision about *Distinguish Bias Types* surfaces in "data arrived" once the dataset is written.

**M4 · AI partner.** `propose_decision` and the `decision-log` prompt in the MCP server's write toolset (coordinated with MCP M4); endorsement in triage. Eval: 10 scripted design conversations, scored on whether the logged evidence is what was actually discussed. *Acceptance:* the eval passes; no write without confirmation in any transcript.

**M5 · In-flow.** `<DecisionToggle/>` in `ledger-ui`; adopted in CoQui first (built, active), then Quiver when it resumes; `armature://decide` with the desktop program. *Acceptance:* a CoQui revision committed with ⌘D yields a note anchored to the item and a commit with the `Decision:` trailer.

**M6 · Structure.** With ≥ 50 real decisions: draft the `DesignDecision` ADR (§11.3) from the trailer data actually used; a migration that rewrites trailer notes into decisions with `relatesToDecision` back-links. *Acceptance:* ADR proposed with usage statistics as its evidence.

**Stretch.** Transcript mining (§8.3); Telegram/Slack relay into the spool; Google Sheets write-back of `LEED-ID`; tray panel.

**Order rationale.** Import first, because it proves the mapping on real LEED data and is the most direct line to the MIT relationship. Ambient second, because it's cheap and starts the usage clock ADR-0010 needs. Payoff reads before the AI channel, because without them nothing keeps any channel alive. In-flow last, because it depends on other tools' release cycles, despite being the cheapest at the moment of capture.

---

## Sources

- Totino, L. & Kessler, A. (2024). "Why did we do that?" A systematic approach to tracking decisions in the design and iteration of learning experiences. *JAID* 13(2). doi:10.59668/1269.15630
- Totino, L. & Kessler, A. (2025). Exploring learning engineering design decision tracking: Emergent themes from practitioners' work. *TechTrends* 69, 816–831. doi:10.1007/s11528-025-01076-y
- Totino, Kessler & Fruchtman (2024). LEED Tracker template, ICICLE 2024 exploration session (Google Sheet).
- Ali, Lis et al. (2024). Using the LEED tracker in a pK-12 context. *ICICLE 2024 Proceedings*.
- Armature repository: ADR-0003, 0010, 0012, 0025, 0028, 0056, 0065, 0067, 0068; `docs/schema-guide.md`; `docs/mcp-server-plan.md`; `docs/desktop-program-plan.md`; `docs/demo-coverage.md`; `docs/research/learning-data-standards-precedents.md`; `docs/research/adr-candidates.md`.
