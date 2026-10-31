# Prompt: Update Session Documentation

Use this workflow at the end of every work session. It keeps `SESSION.md` the state file (what a session needs today, budget 32 KB) and `HISTORY.md` the log (one entry per session, newest first, no budget, read only on demand). The split and its reasons are `docs/context-files-plan.md`.

---

## Step 1: Gather context

```bash
# Recent commits
git log --oneline -20

# Files changed since the last session update commit
git diff --name-only "$(git log -1 --format=%H --grep='update session state')"..HEAD 2>/dev/null || git diff --name-only

# Any uncommitted work
git status
git diff --stat

# The context files' sizes against their budgets (SESSION.md 32 KB, CLAUDE.md 32 KB, PROJECT_CONTEXT.md 20 KB)
wc -c .claude/SESSION.md .claude/CLAUDE.md .claude/PROJECT_CONTEXT.md
```

Also review the current conversation for:
- Decisions made (including rejected alternatives and why), and where each now lives (an ADR or a dated ADR note, a plan section, a document, CLAUDE.md)
- Problems encountered and how they were resolved
- Anything deferred and why
- Facts learned that a later session would otherwise rediscover, and the home each belongs in

---

## Step 2: Present findings for confirmation

Before updating any files, present a summary:

```
## Session summary for review

**Completed:**
- [list what was actually finished]

**Decisions made:**
- [decision]: [brief rationale]; recorded in [its home]

**Deferred:**
- [what]: [why]

**Blockers encountered:**
- [any blockers, or "none"]

**Proposed HISTORY.md entry:** [the heading; the Current Phase paragraph it will carry; 3 to 5 bullets]

**Proposed SESSION.md changes:**
- Current Phase: [the one paragraph, replaced]
- What's Next: [items added, collapsed to their current statement, or marked done with a pointer to HISTORY.md]
- Active Decisions: [added as in flight; moved to an ADR or HISTORY.md as settled]
- Blockers: [update]
- Notes for Next Session: [the hand-off; standing facts added with a home or an expiry, expired ones removed]

**Sizes:** [the three files against their budgets, and what moves if one is over]

Confirm to apply?
```

Wait for explicit confirmation before writing.

---

## Step 3: Write the history entry first

Prepend one entry to `HISTORY.md`, below its introduction and the arc line, above the newest existing entry:

```
## <date>, <part of day if more than one session that day> (<what the session was about>; PRs #…)

**Where things stood at the close.** <the Current Phase paragraph as it will read in SESSION.md>

### Done

- <what was finished, concrete: routes, ADRs, files, tests, with pull request numbers>

### Session notes

- <3 to 5 bullets: how the session went, what was asked, what was found, what was decided>

### Facts from <date> worth keeping

- <facts a later session would rediscover, each with where it now lives if it has a home>

### Decisions taken

- <each decision with its home: the ADR and decision number, the dated note, the plan section, the pull request>
```

Nothing is ever removed from `HISTORY.md`; a correction is a dated note under the entry it corrects.

## Step 4: Rewrite the state in SESSION.md

1. **Current Phase:** replace the paragraph. One paragraph, the present only; the previous one is now the history entry's opening.
2. **What's Next:** move a done item's content to the history entry and leave its number with a one-line pointer (`*Done <date> (PR #…; HISTORY.md, <entry>)*`), since documents cite the numbers; add new items; where an item has gathered "since …" clauses, collapse it to its current statement with one pointer.
3. **Active Decisions:** add decisions still in flight (not yet built, open to overrule, waiting on evidence) and rules of working not yet in CLAUDE.md; move a decision that is settled and homed to the history entry's "Decisions taken".
4. **Blockers:** add new, remove resolved; the resolved one's story goes to the history entry.
5. **Notes for Next Session:** replace the "First" paragraph with the next session's hand-off; add standing facts with the home each waits for or the session it expires in (two sessions without a home); remove facts that landed or expired, noting in the history entry where they went. A fact about how Amos works or about this machine goes to Claude's memory, not here.

Keep entries concrete and specific. "Worked on API" is not useful. "Added the alignment read (`GET /api/v1/intelligence/alignment`), with Bloom's mismatches and objectives without activities; deferred redundancy detection (needs text similarity)" is.

## Step 5: Check the budgets

`wc -c` the three files again. Over budget means move, not shorten: a What's Next item whose detail belongs in a plan, a decision that belongs in an ADR note, a fact that belongs in CLAUDE.md or a document. CI's size check fails the same way, so a session that leaves a file over budget leaves `main` red.

## Step 6: Check CLAUDE.md

Does anything that changed this session require updating CLAUDE.md? New architectural patterns, new constraints, a stack decision finalized, a new "don't do this" pattern, a rule of working that Active Decisions has carried for two sessions. CLAUDE.md states what is true now and where its reasons are; a date belongs there only when it settles a rule a session must follow today. Also check whether `README.md`, `docs/api.md`, `docs/schema-guide.md` or `docs/how-armature-works.md` describe something this session changed, and update them (or list them in What's Next).

## Step 7: Check the client changelog

Did anything that reached `main` this session change what a client tool sends, receives or must do (a route, a field, a rule, an error code, an identity or ordering requirement)? If yes, add a dated entry at the top of `docs/client-changes.md`: what changed, what a client does, a **CoQui** note for anything CoQui maps at its boundary, and links to the ADR and the `docs/api.md` section. Keep entries tool-neutral; say how CoQui maps a change, never shape the change around CoQui.

---

## Commit

After updates are applied, on `main`, the one commit the branch rules allow there:

```
docs(.claude): update session state for [date]
```
