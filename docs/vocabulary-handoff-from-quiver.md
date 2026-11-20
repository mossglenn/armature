# Shelve: a row for the naming vocabulary's §16, from Quiver

> **Status (2026-11-19, later): taken up.** This is the note as Quiver's session wrote it; the body stays as it is. The row is in [`naming-vocabulary.md`](naming-vocabulary.md) §16 as asked, after *Drafter's output*, with two changes to its cells: the Notes say where the row came from, and the Recommended cell cites JetBrains' "Shelve Changes" as **[S47]**, the page read that day (it reverts pending changes from the working copy and "Unshelve" brings them back), while Perforce's `p4 shelve` is named as not cited, since it keeps the changes on the server, as §3 of this note suspected. Beyond what §3 asked, the package's avoided entry `set aside` gained the forms "set it aside", "set them aside" and "set these aside", so that a label like Quiver's former "Set these aside" is found, and the term `discarded-folder` stopped using "set aside" in its own description (`packages/vocabulary/CHANGES.md`, 2026-11-19). No term for "shelve": §4 of this note holds.

**Date:** 2026-11-19 · **Status: a handoff, for whoever continues Armature's vocabulary.** Nothing in
Armature changes until it is taken up. **Every path written `quiver/…` is a file in the Quiver
repository ([github.com/mossglenn/quiver](https://github.com/mossglenn/quiver)), not this one.**
**As read:** Quiver's `main` at `4e5f091` (its PR #17), and this repository's `main` at `6837bc2`
(`desktop-v0.1.5` is `f0fe560`, the commit Quiver is pinned to).

## 1. What happened

On 2026-11-19 Quiver moved every string a person reads to `@armature/vocabulary` (ADR-0073), §16 of
[`naming-vocabulary.md`](naming-vocabulary.md) included, and added a unit test that checks the
interface with `findAvoided` (`quiver/src/vocabulary.test.ts`). The test flagged one word of Quiver's
own that the document has no row for: **"set aside"**, the name of a step in Quiver's resolution of a
conflict with `main`. The document avoids "set aside" for people, for going past a check (§1,
collision 10; the avoided entry `set aside`, `for: override`), so Quiver could not keep it.

Amos chose **Shelve**, with **Put back** to undo it, on 2026-11-19 (`quiver/docs/plan.md` §11,
decision 18). Quiver's interface and commit messages now say so. This note asks for the row that
records the choice where the other names are argued.

## 2. The step being named

A conflict with `main` runs across the two apps, because the conflict report reaches only Armature
Desktop (Quiver's `docs/program-notes.md` §9, filed as issue #169). The person updates from `main` in
Armature Desktop, which stops and lists the conflicting records. In Quiver they tick those records and
**shelve** them: Quiver writes each record back, as one commit, to its state at the starting point
(Quiver's reckoning of the base, since the report does not reach it), and keeps the person's versions
on this computer (`local/set-aside.json`). The person pushes and updates from `main` again in Armature
Desktop, which now goes through. Back in Quiver, "Main is in: choose" opens the review by part
(**Starting point**, **Keep yours**, **Take main's**, **Edit**, as §7 already names), and the choice is
committed. Before `main` is in, **Put back** writes the person's versions back, as one commit, and
leaves the conflict standing.

It is not an action of Armature's. It is a commit Quiver writes, and Armature Desktop's part is the
push and the update from `main`. That is why it belongs in §16, Quiver's words that meet Armature's,
and not in §7.

What a person reads in Quiver now (`quiver/src/app/ChangesView.tsx`, `quiver/src/lib/sync/conflict.ts`):

- the button **Shelve these**, and the panel **Shelved: <records>**, with the steps "In Armature
  Desktop, push this workspace" and "In Armature Desktop, update from main";
- **Put them back as I had them**;
- the commits **Shelved a record to take main's changes: “<record>”** and **Put back “<record>”,
  shelved earlier**, which stay in the workspace's history and reach the instance with the push;
- the refusals **Some records are already shelved. Resolve them, or put them back, first.** and
  **Nothing is shelved.**

The code keeps its identifiers (`setAside`, `setRecordsAside`, `putBack`, `local/set-aside.json`), as
principle 2 keeps the hub's.

## 3. What is asked: one row in §16

A row for the table in §16, ready to place after *Drafter's output*:

| Concept | What it is | Names in use now (where) | Notes | Recommended | Chosen |
|---|---|---|---|---|---|
| Records written back before an update | Quiver writes the records Armature Desktop listed as conflicting back to their state at the starting point, as one commit, and keeps the person's versions on this computer, so the update from `main` goes through; once `main` is in, the person chooses by part. Undone, before then, by writing the person's versions back | "set aside", "Set these aside", "Set aside: <records>", "Put them back as I had them" (Quiver before 2026-11-19; Quiver plan §3.1, `program-notes.md` §9); `setAside`, `local/set-aside.json` (Quiver's code) | Collides with "set aside", avoided for going past a check (collision 10, §11). Not an Armature action: a commit Quiver writes, with the push and the update from main in Armature Desktop between | **Shelve**, with **Put back** to undo it: "Shelve these", "Shelved: <records>", and the commits "Shelved a record to take main's changes: …" and "Put back …, shelved earlier". Developer tools use "shelve" for putting changes away for a while and taking them back. Also weighed: "Hold back", too near Quiver's "held" for a change a rule holds; "Step aside", awkward as a label and in the past tense | Shelve; Put back |

**Nothing else needs to change for this.** §16 stays out of the package: `vocabulary.json` carries
nothing from it (ADR-0073 decision 8 and the package's `CHANGES.md` entry of 2026-11-19), and
`scripts/check_vocabulary.js` reads Chosen cells only in §§4 to 15 (`SHARED_SECTIONS`). So the row needs
no term, no `CHANGES.md` line and no new `revision`, and `npm run check:vocabulary` passes as it is.

**On the evidence.** The Notes cell's sentence about developer tools is not yet a citation. The
document cites pages it has checked (§3, the [S] list), and the pages were not checked for this note.
The two meant are JetBrains IDEs' "Shelve Changes", which puts local changes away and unshelves them
later, and Perforce's `p4 shelve`, which stores pending changes on the server. Perforce's is a
different mechanism, so only the JetBrains page may be the right one to cite. If the row is to be
argued like the others, check those pages and give them [S] numbers before it lands.

## 4. When "shelve" would become a shared word

Today only Quiver says it. It would need a shared term in §7 and in the package (an id such as
`action.shelve`, with `action.put-back`, beside *Resolve a conflict*) as soon as an Armature surface
names the step. Two ways that could happen:

1. **The refusal notice names it.** `desktop/src/components/RefusalNotice.tsx` (line 151) tells the
   person to "open the tool you edit these records in to review and resolve them, push, then update
   from main again". With Quiver, the person shelves rather than resolves at that point, and comes back
   to Quiver after the update to choose. The sentence does not mislead, because shelving is how the
   update is cleared. If the notice ever spells out the steps, the word is "shelve", and the term
   follows.
2. **The app does the shelving itself.** The third way of closing Quiver's `program-notes.md` §9 (the
   app writes the records back and updates from `main` once a tool has said how each conflict
   resolves) would make shelving Armature Desktop's own action.

Neither is asked here. Issue #169 (the conflict report readable by a tool) is the ask that comes first,
and it would let Quiver shelve exactly the records listed, against the true base, without the person
ticking them by eye.
