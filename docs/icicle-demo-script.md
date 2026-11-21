# Demo script: the inherited module

Nov 20, 2026 · Amos Glenn · *revised 2026-11-21: verified against TerminusDB; the desktop app taken out of beat 1, which now uses the viewer's History page; the agent seeded rather than registered; beat 4's close in the viewer*

Five minutes, four beats, recorded ahead and narrated live, for the ICICLE Design SIG. You inherit a course, ask why an item exists, raise one objective, and the system turns up the Module 2 design that the change quietly breaks.

The seed is `scripts/seed_icicle_demo.js` (the course "First-Year Information Literacy", sample data); `app/lib/api/icicleDemo.test.ts` holds it to every read this script relies on, and runs in CI.

## Setup before the talk

The demo runs on a dedicated instance seeded with `scripts/seed_icicle_demo.js`. Like `seed_data.js`, that script replaces every record in the database, so never point it at an instance that holds real work. The instance runs under the default `header` identity, so it stays on loopback (`docs/deployment.md`).

1. **Reset and seed** (in `docker/`):
   - `docker compose run --rm operator node load_schema.js --recreate`
   - `docker compose run --rm operator node seed_icicle_demo.js`
2. **Check:** `docker compose exec hub node operator.mjs check`. It should report no violations across the 50 records.
3. **Have open, in this order:**
   - the viewer on `main`, on the History page, with the Design Graph one click away;
   - an AI client with the Armature MCP server attached: `ARMATURE_USER=demo-designer@example.edu`, `ARMATURE_AGENT=agent:armature-mcp`, `ARMATURE_WRITES=on`. The agent is in the seed (*Design assistant (AI)*), so nothing needs registering.
4. **Record each beat as its own clip.** Narrate over the clips live, and keep the live system open in another window in case someone asks to see something.
5. **Reset again after each rehearsal.** The record IDs stay the same after a reset, but the commit IDs change.

**Practicing on this machine.** `npm run demo:reset`, from the repository root, recreates the database `armature_icicle` on the local store and seeds it, in a few seconds, and prints how to start a hub and the viewer over it. It never touches `armature`, the development database on the same store (the compose commands above would replace it, since the compose file's store is the same one). Reset before every full take: beat 1 needs `main` as the seed left it, and the branches beats 3 and 4 create add commits to `main` and are not deleted.

- [ ] The MCP server is built and attached (`docs/mcp-server-plan.md`; not built as of 2026-11-21), writes are on, and `propose_finding` appears in the agent's tool list
- [ ] The tool you'll use to edit the objective is confirmed. The fallback call is in the Rehearsal reference section.
- [ ] Slide 5's figure names the objective as the seed does: *Check a website with lateral reading*

## Beat 1 · Inherit (0:45)

The point of this beat is to show you're starting from someone else's reasoning, not from a blank file.

**On screen:**

1. In the viewer, the History page for `main`: three commits, newest first. *SME review: the .org item's key affirmed*, by Demo Reviewer; *Module 2 sketched: tracing claims, built on Module 1's quick lateral check* and *Module 1 designed: checking sources online*, by Former Designer. (The schema's load below them is shown faded, as set-up.)
2. Open the Design Graph: Module 1 fully built, Module 2 sketched.

**Say:** *"This is a course I've just inherited. Someone else designed it and moved on. Module 1 is finished, Module 2 is sketched, and an expert has already reviewed part of it. About fifty records. I've never seen it before."*

**Leave the Module 2 commit message unremarked.** It reads *built on Module 1's quick lateral check*. Don't point at it now: it pays off in beat 3, and a sharp viewer may catch it on the replay.

## Beat 2 · Ask why (1:00)

In this beat the agent answers the opening question the room couldn't, by reading the design rather than guessing.

**Ask the agent:** *"What does the .org item measure, and why is C the key?"*

**What it reads** (each of these was verified against the hub):

1. The item's record. It assesses *Check a website with lateral reading* (Apply).
2. The item's trace. It carries a note labeled *Why C is the key of the .org item*, the SME's attestation, and the objective's own note, *Apply, not Evaluate, on purpose*.
3. The note's record, for its rationale. The trace gives only the label, so the agent needs this one extra read to quote the reason.

**The answer should say:**

- the item measures lateral reading at Apply;
- C is the key because fact-checkers leave a page to see what others say about it, while novices judge the page itself, and A, B and D are those vertical-reading moves;
- an SME affirmed the key, and the affirmation is still current.

**Say:** *"That's the answer none of you could give five minutes ago. It isn't guessing. It's reading the design."*

**If the agent offers it:** the trace also carries the former designer's note on the objective, *Apply, not Evaluate, on purpose: first-years need a fast habit of leaving the page before they can weigh what they find.* If the agent mentions it, let it land. It is the reason beat 3 overturns.

## Beat 3 · Change (1:30)

This is the moment people remember. You make one change in Module 1, and the system turns up an assumption in Module 2 that it breaks.

**Say:** *"The library liaison asked us to go past the quick check: first-years need to weigh what they find. So I'll raise this objective."*

**Do:** on a branch, revise the lateral-reading objective.

|  | Label | Description | Bloom |
| --- | --- | --- | --- |
| Before | Check a website with lateral reading | Check an unfamiliar website using lateral reading: leave the page and see what other sources say about it. | Apply |
| After | Evaluate a website's credibility | Evaluate an unfamiliar website's credibility by weighing what other sources say about it. | Evaluate |

**The visible ripple:** in the viewer, choose the branch in the branch picker and turn on the alignment lens. It rings two items as below their objective's level: the .org item, and *Before reading a post that cites an unknown institute*. **Say:** *"Those two I'd have caught myself."*

**The hidden ripple:** ask the agent *"What else does this change touch?"*

1. It asks what references the objective and gets six records back: the two items, the lateral-reading activity, the Module 1 declaration, the former designer's level note, and **a prerequisite from Module 2's objective *Trace a viral claim to its source*.**
2. It opens the prerequisite and reads its rationale: *Tracing chains several quick lateral checks in a row. Module 2 allows about two minutes per hop and does not reteach the check.*
3. It names the conflict: the objective now teaches slow, deliberate weighing, while Module 2 was built on a two-minute check it never reteaches. The *Claim tracing sprint* activity is designed around that same assumption.

**Pause, then say:** *"This one isn't even in my module. Module 2 was built on the quick check, and the relationship between them says so in its own words. I'd never have found it."*

**The payoff of beat 1, if there's a beat to spare:** in the Design Graph, select the prerequisite edge and open its History tab. Its one commit is the message you left unremarked: *Module 2 sketched: tracing claims, built on Module 1's quick lateral check.*

## Beat 4 · Review (1:30)

In this beat the AI annotates and you decide. Both end up on the record.

**Ask the agent:** *"File that as a finding for me."*

The agent opens a proposal branch and files a finding on the **prerequisite relationship itself**, not on either objective. Expected wording:

> *Module 2 depends on the quick check this change removes.* Lateral reading is now an Evaluate objective, taught as slow, deliberate weighing. Module 2 tracing chains several quick checks at about two minutes per hop and does not reteach the check, so its prerequisite no longer holds. Consider splitting the objective: keep a quick lateral check at Apply for Module 2, and add the Evaluate objective beside it.

**Show it on the record:** switch the viewer to the proposal branch. The finding appears in the Design Graph's *Notes and findings* column, its line running to the prerequisite between the two objectives (select it to read it; its subject is that relationship), and the History page shows the commit by *Design assistant (AI)*, marked as an agent, *for Demo Designer*: the hub wrote that last part itself, from the request, not from anything the agent said.

**Say:** *"Notice it didn't change anything. Its tools only file notes and findings. Splitting the objective is my call. Keep the quick check for Module 2, add the Evaluate objective beside it."*

**Close:** *"The AI flags and drafts. I change the design. Both are on the record, with their reasons."*

Then go back to the slides, on the status slide.

**Don't carry out the split live.** It means a new objective, two prerequisite records and a re-pointed activity, which is more than this beat has time for. If someone asks, say it's the next commit, and that the finding will be marked Addressed when it lands.

## If something goes wrong

Every beat has a fallback that keeps the point intact. The recording is the first line of defense, and the reads below are the second.

| Beat | Failure | Fallback |
| --- | --- | --- |
| 1 | The History page is slow or empty | Open the Design Graph on `main` and select any Module 1 record: its History tab names the former designer. |
| 2 | The agent quotes the note's label but not its reason | Ask *"What's the rationale in that note?"* It will open the note. |
| 3 | No tool at hand to edit the objective | Use the PUT call in the Rehearsal reference section, run before recording. |
| 3 | The alignment lens doesn't show on the branch | Ask the agent *"Any alignment gaps in Module 1 now?"* The read returns the same two items. |
| 3 | The agent stops at the items and the activity | Ask *"Does anything in another module depend on this objective?"* That points it at the prerequisite without naming it. |
| 4 | Writes are off, or `propose_finding` is missing | The agent states the finding in chat. Say *"In my setup it would file this on a branch; here it just tells me."* The point holds either way. |
| Any | The live system is down | Play the recording and narrate. Don't apologize for it. |

## Rehearsal reference

Verified on 2026-11-21 two ways: the seed's own commits loaded into the hub's in-memory file-backed store and every read called through the hub's routes (`app/lib/api/icicleDemo.test.ts`, 10 of 10), and the seed script run against TerminusDB 12.0.7 with a hub over it, the reads below called by hand.

### What the hub answers

| Read | Expected |
| --- | --- |
| Operator check on `main` | 50 records, no violations |
| `main`'s history | Three commits: two by Former Designer, then the reviewer's (and the schema's load, by the store's own user) |
| Coverage, Module 1 | FullyAssessed on all three objectives |
| Coverage, Module 2 | PartiallyAssessed (one item; it's only sketched) |
| Alignment, Module 1, before the change | No items below their objective |
| Alignment, Module 1, after the change | The .org item and the institute item, each 2 levels below; the raised objective also has no item at its level |
| Impact on the lateral-reading objective | 6 references: 2 items (`assesses`), 1 activity (`targets`), 1 declaration (`references`), 1 note (`subject`), 1 PrerequisiteRecord (`prerequisite`, within *Trace a viral claim to its source*) |
| The PrerequisiteRecord's id | `PrerequisiteRecord/1824bb3bb9adc588a8285ba4ffc7db5f173310210ffd0722411babdccad0152f` (hash-keyed, so it stays the same after a reset) |
| The PrerequisiteRecord's history | One commit: *Module 2 sketched: … built on Module 1's quick lateral check* |
| Impact on the tracing objective | Includes *Claim tracing sprint* |
| A finding on the PrerequisiteRecord, by the agent acting for you, on a proposal branch | Accepted; the commit's author and the finding's `createdBy` are the agent, the hub adds `Armature-On-Behalf-Of: demo-designer@example.edu`, and the operator check stays clean |

### The calls, if you drive beat 3 without a tool

Use the hub on loopback (`http://localhost:3100/api/v1`), with `Armature-User: demo-designer@example.edu` on every request.

```
POST /branches                              {"name":"demo-change","from":{"branch":"main"}}
PUT  /documents/LearningObjective/lateral-reading-check?branch=demo-change
     body = CHANGE, exported by seed_icicle_demo.js
GET  /intelligence/alignment?module=checking-sources&branch=demo-change
GET  /intelligence/impact/LearningObjective/lateral-reading-check?branch=demo-change
```

`CHANGE` carries no `createdBy`: the hub keeps the stored one (the former designer) on a replace, whatever a body says.

### Not verified here

- The MCP server, which is not built yet: how the agent words its answers and which tools it chooses. Rehearse the three questions exactly as written once it is.
- Where the server's writes go. Its plan (`docs/mcp-server-plan.md` §7) has an agent write on a workspace hub and keeps its remote mode read-only. Beat 4 writes on the instance, which the hub accepts under `header` identity from an agent acting for a person; the plan needs that case decided before the server is built for this demo.
- *Checked by eye on 2026-11-21, from screenshots of the viewer over the TerminusDB copy:* the History page on `main` and on the proposal branch, the alignment lens on `demo-change` (both items ringed, the raised objective outlined as having no item at its level), and the finding in the Notes and findings column. Creating the branches adds an "Owner grant" commit to `main` for each, so record beat 1 straight after a reset.
