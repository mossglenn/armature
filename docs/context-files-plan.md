# The context files: a plan for `.claude/`

*Written 2026-10-30; Amos decided every question in §7 as recommended the same night, and step 1 was done then (the pull request that adds this file). Steps 2 and 3 are SESSION.md's What's Next item 29.*

## 1. Purpose

Three files are read at the start of every session: `CLAUDE.md`, which Claude Code injects into every turn automatically, and `PROJECT_CONTEXT.md` and `SESSION.md`, which `CLAUDE.md` tells a session to read. They have grown into history books. This plan separates the state a session needs from the history it does not, gives each file one job and a size budget, and makes the session-close workflow keep them that way.

## 2. What the files weigh

Measured on `main` at `a14db1e` (2026-10-30 night). A token is about four bytes.

| File | Size | Tokens | How it reaches the context |
|---|---|---|---|
| `.claude/SESSION.md` | 246 KB | about 63k | Read by instruction; too large for one read, so a session probes it by line range |
| `.claude/CLAUDE.md` | 67 KB | about 17k | Injected into every turn |
| `.claude/PROJECT_CONTEXT.md` | 17 KB | about 4k | Read by instruction |
| `.claude/prompts/update-session.md` | 3 KB | | Read at session close |
| `.claude/prompts/commit-message-guide.md` | 3 KB | | Read before committing |
| `.claude/skills/terminusdb/SKILL.md` | 10 KB | | Loaded when a TerminusDB question arises |

`SESSION.md` by section: What's Done 94 KB (a log back to Phase 0), Recent Sessions 41 KB (a second log of the same sessions), Notes for Next Session 36 KB (fifteen "facts worth carrying forward" blocks, never pruned), Active Decisions 32 KB (mostly settled and recorded in ADRs), Current Phase 23 KB (fifteen stacked paragraphs, one per session), What's Next 18 KB, Blockers 3 KB. About 20 KB of the 246 is state.

`CLAUDE.md` by section: Repository Structure 22 KB (one entry per file, many of them a paragraph with dates and pull request numbers; 21 lines longer than 600 characters, the longest 2,206), ADR Reference 9 KB (the ADR index, again), Stack 6.5 KB, Critical API constraints 6.4 KB, What Not To Do 4 KB, the rest small. The rules are about 20 KB; the narrative is the rest.

The cost is not only tokens. A session that needs the next step spends a round finding it, and a fact stated in four places drifts, which is what the deep review found in the documents and what the alignment review found in `.claude/` the same day.

## 3. Principles

1. **One job per file.** State and history never share a file. State is what changes what a session does today; history is why.
2. **Text loaded on every turn holds rules and the map, not narrative.** A date or a pull request number belongs in `CLAUDE.md` only when it settles a rule a session must follow now.
3. **A fact has one home; everything else points.** The order of homes: the code and its tests, then an ADR, then a plan or a document in `docs/`, then `CLAUDE.md`, then `SESSION.md`, then the history. A fact moves down that list only until it finds a home, and up it never.
4. **A budget per file, checked at session close.** Over budget is a signal to prune or to move, not to shorten words.
5. **Notes expire.** A fact in Notes for Next Session leaves when it lands in a home or after two sessions without one.

## 4. The target shape of each file

**`SESSION.md`, the state file, budget 32 KB.**
- *Current Phase*: one paragraph, the present only.
- *What's Next*: the numbered items, each a current statement with one pointer, the "since …" chains collapsed; an item that is done moves to the history with its pull request.
- *Blockers*: as now.
- *Active Decisions*: only decisions in flight or standing rules of working not yet in `CLAUDE.md`; a decision taken moves to its ADR, or to the history with the pull request.
- *Notes for Next Session*: this session's hand-off and a short list of standing facts, each with the home it is waiting for or the session it expires in.

**`.claude/HISTORY.md`, the log, no budget, never read by default.** One entry per session, newest first, made from the three records each session leaves today: the Current Phase paragraph, the What's Done section and the Recent Sessions bullets, merged, with that session's "facts worth carrying forward" and the decisions taken, each with its ADR or pull request. `CLAUDE.md` says when to read it: when a What's Next item cites a past session, or when a session must reconstruct why something is as it is and no ADR says.

**`CLAUDE.md`, the rules and the map, budget 32 KB.**
- *Repository Structure*: one line per entry, what it is and where its rules are, no dates and no pull request numbers; a file whose story matters has an ADR or a document, and the line names it.
- *Stack* and *Accepted, not yet built*: each bullet what is true now in two or three sentences; the build order is plan §14 and the decisions are the ADR notes, both pointed at, not restated.
- *ADR Reference*: the handful to read before touching the API or the schema, one line each; `schema/docs/adr/README.md` is the index and is named as such.
- *Critical API constraints*, *Development Principles*, *Workflow*, *What Not To Do*: kept, since they are the rules; trimmed only where a sentence narrates rather than instructs.
- *Session startup*: gains the rule for `HISTORY.md`.

**`PROJECT_CONTEXT.md`, the problem and the audiences, budget 20 KB.** Within budget today. One pass: its "Technical Decisions Already Made" and "Open Questions" point at the ADR index and plan §6 rather than restate them.

**`prompts/update-session.md`.** Step 1 adds the sizes; step 3 writes the session's entry in `HISTORY.md` first, then rewrites `SESSION.md`'s state sections and prunes Notes by the expiry rule; a new step checks the budgets and says what to move when one is exceeded.

**`prompts/commit-message-guide.md` and `skills/terminusdb/SKILL.md`.** Unchanged; both are already one job each and within size.

**Claude's own memory** (outside the repository, `~/.claude/projects/…/memory/`). Standing facts about how Amos works and about this machine belong there, not in Notes; several Notes facts already are there (`grep` is `ugrep`, `ssh` is a function, merges need an explicit confirm). The pass moves the rest that qualify and removes them from Notes.

## 5. What is not changed

The documents in `docs/` and the ADRs. The deep review's point about facts duplicated across the explainer, the API reference and the plans is real, but it is a documentation question with its own remedy (its "generated facts" idea), not part of this plan. The viewer's and the hub's code are untouched.

## 6. Steps

1. **The split** (one pull request, two commits so the diff reads): `HISTORY.md` written from the three records, mechanically, every session back to Phase 0, with the fifteen Notes blocks and the settled Active Decisions filed under their sessions; then `SESSION.md` reduced to its state sections, What's Next items collapsed to their current statements, Notes pruned. `update-session.md` revised in the same pull request, and `CLAUDE.md`'s Session startup gains the `HISTORY.md` rule. The check: every pull request number, ADR number and date in the old `SESSION.md` appears in `HISTORY.md` or an ADR.
2. **The `CLAUDE.md` pass** (its own pull request): Repository Structure to one line per entry, Stack and the accepted-not-built paragraph to the present tense, ADR Reference to the read-first list, with each removed sentence either already in an ADR, a document or `HISTORY.md`, or added to `HISTORY.md` in the same commit. The check: the file under 32 KB, and a fresh session started on it can name the next step, the test command and the branch rules without another file.
3. **`PROJECT_CONTEXT.md` and the budgets** (small): the pointer pass, and a check of the three sizes that runs where the drift check runs (§7, question 2).

Before plan §14 step 1 of the workspace hub, since step 1's hand-off is the first to benefit; about one session.

## 7. Questions to settle

*All seven decided 2026-10-30 as recommended. One deviation in step 1: the settled Active Decisions were moved into one appendix of `HISTORY.md` in their original order rather than filed under their sessions, since each is dated and homed already and the appendix keeps the running summary readable as it was written.*

1. **Where the history lives.** *Recommendation:* `.claude/HISTORY.md`, since it is the history of AI-assisted sessions and belongs with the files it came from; `docs/` holds documents for people.
2. **Who enforces the budgets.** The session-close prompt alone, or also a check in CI's `app` job beside the generated-types drift check (a few lines of Node reading three file sizes). *Recommendation:* both. The failure mode is drift nobody notices, which is exactly what a prompt alone allows; the check costs nothing.
3. **How much history `CLAUDE.md` keeps.** *Recommendation:* ADR statuses and nothing else dated; "Next.js hosts no API" is a rule, "since 2026-10-21 when the catch-all route went" is history.
4. **Whether the ADR Reference section stays.** *Recommendation:* as a read-first list of about ten, one line each, since a session touching the API should not have to find them in a table of 68.
5. **The expiry rule for Notes.** *Recommendation:* two sessions without a home; a fact that keeps being needed has a home, and the pass finds it.
6. **Whether the repository tree is generated.** A script could print the tree with a one-line description from each file's header comment. *Recommendation:* not now; a hand-kept line per entry under a budget is enough, and the generator is a second thing to keep.
7. **Whether to cut `SESSION.md`'s log by hand or by script.** *Recommendation:* by hand, in one sitting, reading each session's three records together; the merge is a judgment about what each session was, which a script cannot make, and it happens once.
