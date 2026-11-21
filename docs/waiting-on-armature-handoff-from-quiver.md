# What Quiver is waiting on from Armature

> **Status (2026-11-20, later): taken up into the documents; nothing built.** This is the note as Quiver's session wrote it; the body stays as it is. §1 to §3 and §6 are [`workspace-hub-plan.md`](workspace-hub-plan.md) §12.1, the working list of what Quiver asks of the desktop hub and the app, in today's names. §4 is four rows of that plan's §12. §5 is a dated note on [ADR-0072](../schema/docs/adr/0072-linked-workspaces-and-merge-requests.md), which decides nothing. §7 is that plan's §11 and [`desktop-program-plan.md`](desktop-program-plan.md) §14 step 6, with the issues of §3 that concern the app also noted in that plan's §7. Quiver's status, resumed on 2026-11-17 where Armature's documents still said paused, is corrected in the README, [`development-plan.md`](development-plan.md) §2, [`demo-coverage.md`](demo-coverage.md) (no mark changed) and the explainer's Sections 24.5 and 29. Which ask to build, and when, is still Amos's call. The issues on GitHub were retitled the same day in today's names, close to §6's (#170 as "name the parent's latest commit in a workspace's status", since the vocabulary gives people "latest commit" for "head"), and #169 and #176 carry a comment on what 0.2.0 changed. Two items from the sources this note cites are not in it, and were added the same day from those sources: `quiver/docs/asks.md` §1's related finding (whether constraint 10 should cover a `Retired` item under an `Approved` placement), which that file's note of 2026-11-19 lists as still open, as a row of the plan's §12; and `quiver/docs/program-notes.md` entry 7 (the app not knowing that a tool holds unsaved edits when the person updates from the parent) on #176's row of §12.1.

**Date:** 2026-11-20 · **Status: a handoff, for whoever plans Armature's next work on the desktop hub and the desktop app.** Nothing in Armature changes until it is taken up, and which of these to build, and when, is Amos's call. **Every path written `quiver/…` is a file in the Quiver repository ([github.com/mossglenn/quiver](https://github.com/mossglenn/quiver)), not this one.**

**As read:** Quiver's `main` at its PR #23 (milestone 13; first written at `a9fe1e9`, PR #22, and brought up to date the same day), pinned to this repository's `598c83b` (`desktop-v0.2.0`, API revision 2026-11-20) for `@armature/client`, `@armature/types` and `@armature/vocabulary`. This repository's `main` at `1c21644`. Issues 169 to 176 read on GitHub the same day: all eight open, none commented on.

**How far to trust it:** what Quiver does today is from its code and its tests, which pass against the hubs of this repository's compose file at `598c83b` in Quiver's CI. What Quiver "would build" when an ask lands is the writer's reading of Quiver's plan, not a decision. Nothing here was tried beside two installed copies of Armature Desktop.

Abbreviations: ADR (Architecture Decision Record), API (application programming interface), CI (continuous integration).

---

## 1. In short

- **Nothing blocks Quiver.** It works beside Armature Desktop 0.2.0 today: it reads, edits, commits, shows where the work is, and sends the person to the app for push, the update, the merge request and unlinking.
- **One ask removes a step a person does by eye** (§2): the conflict report readable by a tool, issue #169. It is the ask Quiver would take first.
- **Seven more are filed** (§3), each smaller. Issue #170 is half answered by 0.2.0.
- **Four older asks of the hub were never filed as issues** (§4). Armature's `.claude/SESSION.md` item 12 tracks them.
- **One thing Quiver met in milestone 12 is not filed** (§5), because use has not yet shown whether it matters.
- **The issues' titles use the names from before 2026-11-19** ("bring-in", "delivered", "pairing value", "the program"). §6 gives each in today's names, for whoever edits them.

---

## 2. The one that matters most: the conflict report (issue #169)

When a workspace and its parent changed the same record, the instance refuses the update with `merge_conflict` and a list: each record and field, with the base, the workspace's value and the parent's. That answer goes to the desktop app, which asked. No route gives it to a tool.

What a person does today, across the two apps:

| Step | Where | What |
|---|---|---|
| 1 | Armature Desktop | Push, then update from the parent. It stops and lists the records |
| 2 | Quiver | Open Outgoing and **tick the same records by eye**, from the list of what the workspace changed. "Shelve these" |
| 3 | Armature Desktop | Push again |
| 4 | Armature Desktop | Update from the parent again; it goes through |
| 5 | Quiver | Choose by part between the two versions; commit |
| 6 | Armature Desktop | Push, then open the merge request |

Two things go wrong without the report:

- **The list is carried across in the person's head.** A record ticked wrongly is shelved for nothing. One missed, and the update stops again.
- **Quiver reckons the base itself.** The record must be written back as it was at the common ancestor, which the report names field by field. Quiver uses where the workspace was taken, or where it last saw an update. An update that met no conflict leaves that reckoning one update behind, and a record written back to an older state than the true base still conflicts.

**Asked:** the desktop hub keeps the last update's refusal for a workspace and serves it as a read, for example `GET /workspace/:name/conflicts` or a field of the status. It is wanted whether or not the tool was open when the update was refused.

**What 0.2.0 changed:** the status's `remote.parent` now gives a count (`conflicts`) before the person tries. Quiver shows it ("main has updates: 3 records, 1 of which would conflict"). It does not say which records, or the base. An open merge request's `health.conflicts` does carry the list, but only while a request is open, and it is the merge into the parent, not the update from it.

**What Quiver would build when it lands:** step 2 becomes one button with the records already chosen, the base comes from the report, and Quiver can say a conflict stands as soon as the workspace is opened. `quiver/src/lib/sync/conflict.ts` holds the reckoning that would go.

**Evidence:** `quiver/docs/program-notes.md` entry 9; scenario 4 of `quiver/docs/plan.md` §6; `quiver/contract/conflict.contract.test.ts`, where the test reads the record's id out of the refusal in the person's place.

---

## 3. The other filed asks

In the order Quiver would take them. "Today" is what Quiver does without it.

| Issue | Asked | Today | What it would let Quiver do |
|---|---|---|---|
| [#176](https://github.com/mossglenn/armature/issues/176) | A hand-off between the app and a tool, in both directions | Quiver says "do this in Armature Desktop" in words, at each of five switches in §2's table | A button in Quiver that opens the app at Push, Update from <parent> or Open merge request into <parent>; a button in the app that opens the tool at the workspace |
| [#170](https://github.com/mossglenn/armature/issues/170) | Where the parent's head is, and whether the workspace is behind it, in the status | **Half answered in 0.2.0:** `remote.parent` says behind or not, with counts. The parent's head is still absent | "Look back at main now" in Quiver's look-back panel, and a preview of which records an update would change |
| [#171](https://github.com/mossglenn/armature/issues/171) | An event when a workspace is pushed, updated or merged | Quiver follows `GET /events` for local commits, which covers an update from the parent. For a push or a merge it asks the status every 30 seconds and when its window is returned to | The strip and the Outgoing view following the app at once, with no timer |
| [#172](https://github.com/mossglenn/armature/issues/172) | A way for a tool's agent to be registered from a desktop hub, and a mirror refreshed without a new clone | Where the instance does not know `agent:quiver/drafter`, a kept proposal is the person's own commit, with the model named in its note | The drafter authoring its own commits on any instance. It is also what Quiver's lint needs before it can post check runs as an agent |
| [#173](https://github.com/mossglenn/armature/issues/173) | A record's history continuing past the clone | An item's history ends with the record as it was copied to this computer | History back to the item's creation; "when was this recorded" for a record that predates the workspace |
| [#174](https://github.com/mossglenn/armature/issues/174) | A read that says whether the pairing key sent is the hub's | A wrong key is found at the first write, after the connection form looked fine | "Save and connect" saying so at once |
| [#175](https://github.com/mossglenn/armature/issues/175) | The owner named in discovery, or tools launched with their environment | The person pastes their identifier as well as the pairing key | One value to paste, or none |

Two notes on these:

- **#176 changed shape with ADR-0072.** The action a hand-off names is now "Open merge request into <parent>", where it was "Merge into main". `GET /workspace/:name/merge-request` is already any tool's read, and Quiver shows the request's health from it; only the actions are the app's.
- **#172 gates more than the drafter.** Check runs (2026-11-13) are the natural home for Quiver's lint, and a run is posted as an agent. On an instance nobody prepared, Quiver cannot make that agent exist.

Evidence for each is the entry of the same subject in `quiver/docs/program-notes.md` (entries 1 to 4, 6, 8, 9 and 11), whose closing table maps entries to issues.

---

## 4. Older asks of the hub, never filed as issues

From `quiver/docs/asks.md`, written before the pause. This repository's `.claude/SESSION.md` item 12 lists them as still asked. The desktop hub lowered the cost of each without removing it.

| asks.md | Asked | Where it stands for Quiver now |
|---|---|---|
| §3 | Both contents on an `InsertConflict`, and identical inserts not conflicting on `createdBy` alone | Unchanged. Two people importing the same file still conflict on every item, and no way through the API resolves it. Quiver stops and names the two ways out |
| §4 | The rules as a package, `@armature/rules` | Less urgent. The desktop hub runs the whole engine on every write. Quiver's copy (`quiver/src/lib/rules`) remains for checking as the person types, and a contract test holds it equal to the hub's answer |
| §5 | An authoring slice of the export | Unchanged. A workspace is the `full` slice. Not felt at the seed's size |
| §8a | `createdBy` on a replace, or another field for who proposed a part | Not addressed. A proposal that rewrites part of a person's item shows the agent only as the commit's author |

Whether any of these should become an issue is Amos's call. §3 is the only one with a scenario that fails outright.

---

## 5. Met in milestone 12, not filed

**A workspace linked to another computer can still be committed to here.** When a person uses "Unlink from the other computer" and links the workspace elsewhere, the first computer keeps its copy. The desktop hub there still takes commits, since they are local, and none can ever be pushed.

Quiver's strip says so from the status's `link` ("Linked to another computer (Desk), so this one cannot push it"). Since its milestone 13 Quiver also commits nothing to such a workspace: an edit stays uncommitted on Quiver's side, and Quiver keeps the last link it was told, so this holds offline. Two gaps remain that only the hub can close: a commit made before Quiver next asks the status is still taken, and another tool on the computer is not stopped.

What Armature could do, if use shows it matters: the desktop hub refusing a write to a workspace it knows is linked elsewhere, which would stop every tool. `quiver/docs/program-notes.md` entry 10 has it.

---

## 6. The issues in today's names

The eight issues were filed on 2026-11-18, a day before the vocabulary was decided and two before ADR-0072. Their bodies still describe the gap correctly. For whoever retitles them:

| Issue | Title as filed | In today's names |
|---|---|---|
| #169 | let a tool read the last bring-in's conflict report | let a tool read the conflict report of the last update from the parent |
| #170 | say in a workspace's status where main is and whether the workspace is behind it | say in a workspace's status where its parent's head is (whether it is behind is answered) |
| #171 | an event when a workspace is pushed, brought up to date or delivered | an event when a workspace is pushed, updated from its parent, or its merge request is merged |
| #172 | a way for a tool's agent to be registered from a workspace hub | unchanged |
| #173 | a record's history stops at the clone | unchanged |
| #174 | a read that says whether the pairing value sent is the hub's | …the pairing key… |
| #175 | name the owner in discovery, so a tool asks for the pairing value alone | …the pairing key… |
| #176 | Desktop program: a hand-off between the program and a tool | Armature Desktop: a hand-off between the app and a tool |

---

## 7. What Quiver is not waiting on

So that nothing here is read as blocked:

- **What Quiver could build alone is built** (its milestone 13, PR #23): no commit to a workspace linked elsewhere, the offer to remove its own folder when a workspace is removed or unlinked, and the event feed in place of its ten-second check for another tool's commits.
- **Opening, merging or closing a merge request from a tool** is not asked. ADR-0072 leaves it undecided, and Quiver reads the request and sends the person to the app.
- **Serving an older desktop app** is not wanted. Quiver requires 0.2.0 (`quiver/docs/plan.md` §11, decision 19).

---

## 8. Where to read more, in Quiver's repository

| For | Read |
|---|---|
| Each gap as it was met, with what would close it | `quiver/docs/program-notes.md` |
| The older asks, with their scenarios | `quiver/docs/asks.md` |
| The working model beside the desktop app | `quiver/docs/plan.md` §3 and §3.1 |
| What milestone 12 built on ADR-0072 | `quiver/docs/plan.md` §9, item 12; Quiver's PR #22 |
| The conflict flow as tested against real hubs | `quiver/contract/conflict.contract.test.ts` |
