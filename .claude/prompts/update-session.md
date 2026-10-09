# Prompt: Update Session Documentation

Use this workflow at the end of every work session to keep SESSION.md current.

---

## Step 1: Gather context

Run these commands to collect what happened this session:

```bash
# Recent commits
git log --oneline -20

# Files changed since the last session update commit
git diff --name-only "$(git log -1 --format=%H --grep='update session state')"..HEAD 2>/dev/null || git diff --name-only

# Any uncommitted work
git status
git diff --stat
```

Also review the current conversation for:
- Decisions made (including rejected alternatives and why)
- Problems encountered and how they were resolved
- Anything deferred and why

---

## Step 2: Present findings for confirmation

Before updating any files, present a summary:

```
## Session summary for review

**Completed:**
- [list what was actually finished]

**Decisions made:**
- [decision]: [brief rationale]

**Deferred:**
- [what]: [why]

**Blockers encountered:**
- [any blockers, or "none"]

**Proposed SESSION.md changes:**
- What's Done: [additions]
- What's Next: [reorder or add items]
- Active Decisions: [add/remove]
- Blockers: [update]
- Recent Sessions: [new entry]
- Notes for Next Session: [replace with current notes]

Confirm to apply?
```

Wait for explicit confirmation before writing.

---

## Step 3: Apply the update

Once confirmed, update SESSION.md:

1. Move completed items from "What's Next" into "What's Done"
2. Add any new next steps surfaced this session
3. Update "Active Decisions" — add in-progress decisions, remove resolved ones
4. Update "Blockers" — add new blockers, remove resolved ones
5. Prepend a new entry to "Recent Sessions" with today's date and a 3–5 bullet summary
6. Replace "Notes for Next Session" with fresh notes

Keep entries concrete and specific. "Worked on API" is not useful. "Added the alignment read (`GET /api/v1/intelligence/alignment`), with Bloom's mismatches and objectives without activities; deferred redundancy detection (needs text similarity)" is.

---

## Step 4: Check CLAUDE.md

Ask: does anything that changed this session require updating CLAUDE.md?

- New architectural patterns introduced?
- New constraints discovered?
- Stack decisions finalized (e.g., Hono chosen as the API framework, ADR-0054)?
- New "don't do this" patterns discovered?

If yes, update CLAUDE.md as well. Also check whether `README.md`, `docs/api.md`, `docs/schema-guide.md` or `docs/how-armature-works.md` describe something this session changed, and update them (or list them in What's Next).

---

## Commit

After updates are applied:

```
docs(.claude): update session state for [date]
```
