# ADR-0072: Workspaces Linked to One Computer, and Merge Requests

> **In brief.** This decision answers two questions that arose together on 18 November 2026.
> First: what keeps a workspace safe to push to, when a workspace is also a branch on the shared
> hub that its owner could write from anywhere? Second: how does someone who may not merge into
> a branch, `main` included, ask for their work to be merged? The answers are two records on
> `main`. A *workspace record* links each workspace to one installation of the desktop program;
> the shared hub refuses writes to that workspace's branch from anywhere else. To work on it from
> another computer, the owner unlinks it from the first computer and links it from the second, two
> deliberate steps. A *merge request* records that someone asked for one branch to be merged into
> another. Whether it would merge cleanly (conflicts, broken rules, required checks) is worked out
> each time someone looks, never stored. Whoever may merge into the target merges it or closes it.
> Accepted on 19 November 2026, its five open questions decided as recommended, and built on
> 20 November 2026 (the Status says what was chosen in building).

## Status

Accepted (2026-11-19, Amos). Proposed 2026-11-18, drafted that day from Amos's choices in discussion: option 1 of three
for keeping a workspace's branch safe (a workspace linked to one computer), with his change that
moving a workspace is two steps, unlinking from one computer and linking from another, rather than
one move; and option 1 of three for asking for a merge (a request recorded on `main`, its health
computed on read). The vocabulary is `docs/naming-vocabulary.md`. Amos decided the five open
questions on 2026-11-19, one by one and each as recommended (decisions 2, 5 and 7), before accepting
the record. Not built.

> **Note (2026-11-20): built**, whole, on `phase-8/adr-0072`: the schema's two classes and two
> enums; constraints 27 to 33 (25 and 26 are held for ADR-0071); the link check; the routes under
> `/workspaces` and `/merge-requests`; `request_required` on the merge route; the trailer; the
> desktop hub's linking, unlinking and merge requests in place of delivery; the desktop app's core,
> pages and stand-in core; the upgrade of workspaces held before; client revision 2026-11-20. The
> tests of §Verification are `workspaces.test.ts` (the remote), `cycle.test.ts` and
> `workspace.test.ts` (the desktop hub), `core.test.ts` (the app's core) and `desktop/e2e` (its
> pages). The twelve names of `@armature/vocabulary` that waited on this lost their `until`.
>
> **Chosen in building, each without a separate decision and open to overrule:**
>
> 1. **An unlinked workspace's branch is deleted without a link**, by whoever may delete it.
>    Decision 3 lists the deletion among the writes that carry the link, and says a write to an
>    unlinked workspace is 409 `not_linked`. Held to the letter, a workspace linked nowhere whose
>    owner is gone could never be removed by anyone: an administrator may unlink but not link. A
>    linked workspace's branch is still deleted only from its own computer.
> 2. **The merge gate's first step ignores commits that changed only the records kept on `main`
>    alone** (ADR-0070's note of this date). Opening a request is a commit on `main`, as is every
>    workspace made, linked or unlinked, so a gated request into `main` was refused
>    `bring_in_first` at the moment it was opened.
> 3. **`POST /workspaces`** records an existing branch as a workspace, for its Owner: the route
>    decision 7's upgrade needs, which the ADR implies and does not name. `GET /workspaces/:branch`
>    is open to any resolved identity, since the record is how a client tells a workspace from a
>    branch; the list is the owner's, or an administrator's, as decision 6 has it, though the
>    records are readable on `main` through the document routes either way.
> 4. **The routes under `/workspaces` sit under `armature/branches`**, with the setting
>    `workspaces: "linked"`, since the ADR adds one capability and it is the merge requests'. The
>    desktop hub's `armature/workspace` gains `link` and `delivery`.
> 5. **Deleting a branch closes the open requests that name it**, as source or target, in the
>    commit that revokes its grants and closes its workspace record: a request about a branch that
>    is gone can be neither merged nor read. A read of one whose branch went some other way says
>    `missing`.
> 6. **A request found merged and still `Open` is recorded from the trailer.** The merge and the
>    record's change are two commits, the merge first; should the hub stop between them, merging
>    the request again finds the merge commit by `Armature-Merge-Request` in the target's newest
>    hundred commits and records it, making no second merge. With no such commit and nothing to
>    merge, 409 `nothing_to_merge`. Decision 5's "in the same marked commit on `main`" is read as
>    the record's own commit, since a merge is the store's and carries no document write.
> 7. **A dry run's conflicts and violations are kept by the two heads**, in memory, since a
>    request's health is read on every look and the check behind it takes seconds; the required
>    checks' verdicts are never kept. A merge that commits checks again.
> 8. **`openedBy` and `decidedBy` are the person** when an agent acts for one, as a grant's owner
>    is; the commit's author is the agent. The record has no time of opening beyond its commit's,
>    since the table of decision 5 has none.
> 9. **Codes added beyond those the ADR names:** 409 `request_decided`, `nothing_to_merge`,
>    `branch_gone`, `target_is_workspace`, `workspace_exists`; 400 `bad_link`; on a desktop hub 409
>    `no_request` and `workspace_here`; and the violation codes of constraints 28 to 33.
> 10. **On the desktop hub**, `POST /workspace` takes `{ link }` where it took `{ existing }`, which
>     is refused; "unlink from the other computer" is `POST /workspace/:name/unlink` with
>     `{ elsewhere: true }`, for a workspace the hub does not hold; a removal that leaves the branch
>     on the remote, and a discard, clear the link only when it is this installation's; the hub's
>     own records are left out of what an update reads back, as no export slice holds them; and a
>     host other than the desktop app keeps its installation's identifier in the hub's folder
>     (`installation.json`) unless `ARMATURE_INSTALLATION` gives one.
> 11. **"Kept current from the event feed"** (decision 7) is the core's `awaitRemoteChange`: a wait
>     on the remote's `GET /events`, after which the page reads the request again when an event
>     names the workspace's branch, its parent or `main`.
> 12. **The computer's name** (`linkLabel`) is the setting `computerName`, read at each link; a
>     workspace already linked keeps the label it was linked with.
>
> **Not done here, and needed before the next release of the desktop app:** an instance's schema
> is loaded before its hub is updated (`load_schema.js`), as for any schema change, and the app at
> this revision reaches only a remote serving it; no version of the app carries this yet.
>
> **Note (2026-11-20, later, from the first rehearsal on two computers; Amos):** the rehearsal found
> that a computer a workspace had just been unlinked from still pushed (nothing, so nothing was
> refused) and merged the request it had opened earlier. The branch was never written, which is
> what decision 3 protects, and the remote is unchanged: a request is merged by whoever may merge
> into its target, from anywhere. Decided the same day:
>
> 13. **The desktop hub refuses its own actions on a workspace not linked to it**: push, the update
>     from the parent, and opening, merging or closing the workspace's request answer 409
>     `held_elsewhere` or `not_linked` from the hub itself, before anything else is judged, and the
>     page does not offer them (`workspace/links.ts`, `requireLinkedHere`).
> 14. **An action is offered only when it has something to do.** Push needs an unpushed commit. The
>     update needs the parent to hold something the workspace lacks, which the status now says
>     (`remote.parent`: `behind`, `documents`, `conflicts`), from the remote's dry run of that
>     merge, whose answer gains `brings`: the documents it would bring, not counting the records
>     kept on `main` alone, since `main` moves by those at every grant and request. The page hears
>     of a change on the instance through the wait of item 11, now kept whether or not a request is
>     open, so an update that became possible is offered without being asked for. This answers
>     the first half of issue #170 for a tool.

It changes the schema, adding two classes and two enums, so when it is built `schema.json`, the
generated types and the appendix go in one commit (CLAUDE.md, "After schema changes"). It relies on no store behavior beyond what grants already rely on, so no platform check
is needed first (§Verification).

It keeps the rule ADR-0065 decision 6's later change of 2026-11-18 states: a workspace's branch on
the remote is written only by the workspace hub that holds it. And it answers ADR-0068's open
question 2, *a request for delivery*, whose trigger was a second client building the same request
(§Context).

It annotates, each by a note of 2026-11-19:

- **ADR-0065 decisions 2, 6 and 7**: a workspace has a record on `main` and a link; delivery becomes
  a merge request; the program gains linking and unlinking among its own actions.
- **ADR-0068 decision 4** gains rows (decision 6 below), and **open question 2** is answered.
- **ADR-0059 decision 4**: one capability, `armature/merge-requests`, and settings on
  `armature/workspace`.
- **ADR-0025 decision 2**: one more hub-written trailer, `Armature-Merge-Request`.
- **ADR-0070 decision 6**: the merge gate runs when a request is merged, as on any merge.

## Context

**A workspace is two things in two places.** ADR-0065 made a workspace a branch on the remote,
copied to one person's machine, written there and pushed back by replaying each local commit. The
copy on the machine is what a person works in, offline if need be. The branch on the remote is
what the push writes to. Amos put the distinction by place, on 2026-11-18: branches are on the
instance, written by anyone with the right from any computer through the API, and need a
connection; that is where collaboration happens. Workspaces are on one computer, reachable through
the desktop program alone, personal, and usable offline. The workspace also exists on the instance
so that the program has something it can push to reliably.

**Reliability is the catch.** A push replays commits onto a branch that must not have moved (ADR-0065
decision 5: each request carries `If-Match` naming the last commit the push put there). Today the
owner holds the right to write their workspace's branch (ADR-0068 decision 4), and nothing stops
them using it from anywhere: through another client with their credential, or from a second desktop
program on another computer. Any such write moves the branch. The next push is refused (412), and
nothing takes the new commits in: bring-in merges only from `main`, and bring-in and delivery both
refuse while anything is unpushed. Discarding the unpushed commits is the only way on. The risk is
accidental, not malicious, since only the owner and maintainers may write the branch at all
(ADR-0068 decision 4).

**Online clients have no such problem.** A client that writes a branch while connected reads it as
it is, and the hub's per-branch write queue orders concurrent writes (ADR-0025 decision 7, notes).
A write that loses a race is refused as 409 `document_moved`, never applied over the other
(ADR-0025 decision 7, note). So the restriction is needed on workspaces alone. Every other branch,
`main` included, keeps taking direct writes as well as merges: grants, check requirements and users
are written on `main`, and CoQui writes its own branches.

**The remote cannot tell a workspace from a branch.** The store's branches carry no metadata. The
desktop hub knows which branches it holds, from its own records (`workspace.json`), but the remote
knows only that a branch exists, who owns it (a `Grant` on `main`) and what is in it. The
convention that a workspace's branch is named `<handle>_<name>` is a convention, not a fact the
remote can rely on. Whatever keeps a workspace's branch to one writer has to live in a record the
remote reads, as grants and check requirements do.

**Asking for a merge has no place in the hub.** Merging into `main` needs a maintainer of `main`;
merging into any branch needs its owner or a maintainer of it (ADR-0068 decision 4). ADR-0068 open
question 2 left the asking to clients: when delivery is refused, the program shows who holds the
grant, and the owner asks by whatever means their team uses. It set a trigger: "A request record
enters the hub when a second client builds the same one; CoQui's 'submit a round for merge' is the
likely second." Three needs now meet it:

- **People who are not maintainers, in the desktop program.** Most designers on a real instance,
  and the seed's reviewer, cannot merge into `main` at all. The program can only tell them whom to
  ask.
- **Several people working toward one branch.** The case that raised this ADR: an A/B test of two
  assessment methods for one module, each method a branch, several people's workspaces under each,
  each person merging into their method's branch, the chosen method merged into `main` and the
  other kept as the record of the road not taken. Without requests, every contributor must be made
  a maintainer of the method's branch.
- **CoQui's submission of a review round**, named by ADR-0068 as the second.

Everything a request needs to *check* already exists: the merge route's dry run reports conflicts
and broken rules without committing (ADR-0025 decision 5, note), the merge gate reports required
checks (ADR-0070 decision 6), and the event feed tells a client when either branch moves
(ADR-0070 decision 2). What is missing is the record that someone asked, and who decided.

## Decision

1. **Two kinds of branch, told apart by a record.** A *branch* is on the remote. Any client with
   the right writes it directly, and it takes merges. A *workspace* is a branch linked to one
   installation of the desktop program. Its branch on the remote is written only by that
   installation's workspace hub: its push, its bring-in, and its removal. A workspace is personal,
   in that only its owner writes it, and readable as every branch is (ADR-0068 open question 1:
   every resolved identity reads every ref). Its work leaves only through a merge request into its
   parent. A workspace's *parent* is the branch it was created from and takes updates from
   (ADR-0065 decision 6's later change); a parent is always a branch, never a workspace, since a
   workspace takes nothing but its own push.

2. **The workspace record.** A `Workspace` document on `main`, category `infrastructure`, outside
   `DesignRecord` as `Grant` is:

   | Field | Type | Meaning |
   |---|---|---|
   | `branch` | `xsd:string` | The workspace's branch on the remote |
   | `owner` | `User` | Who created it; the only person who writes it |
   | `parent` | `xsd:string` | The branch it was created from |
   | `link` | `Optional<xsd:string>` | The installation it is linked to; absent when unlinked |
   | `linkedAt` | `Optional<xsd:dateTime>` | When it was linked there |
   | `linkLabel` | `Optional<xsd:string>` | A name the owner gave that computer in the program's settings, shown when it is linked elsewhere; nothing is sent unless the owner sets one, since `main` is read by everyone the instance serves and a computer's name says more about a person than the program needs (open question 5) |
   | `status` | `WorkspaceStatus` | `Active`, or `Closed` once its branch is deleted |

   `@key` is `Random`, since a branch name may be used again after its branch is deleted. Rules the
   store cannot express, each a validator in `invariants/` with a failing and a passing test: the
   record lives on `main`; it is written only by the hub, never through the document routes
   (refused like a hub-written trailer); at most one `Active` record names a branch; `parent` names
   a branch with no `Active` record (409 `parent_is_workspace`).

   **The installation.** The desktop program draws a random 128-bit identifier at its first start
   and keeps it in its settings. It is not a secret: the record is readable on `main`. It guards
   against mistakes, which is the whole risk, as the `header` resolver trusts a local caller
   (ADR-0032 decision 1). A person who copies it to another computer has only made the first
   computer's pushes fail.

   **Creation.** The workspace hub's create (`POST /workspace` with `name` and `from`) asks the
   remote to create the branch as a workspace: `POST /branches` gains `workspace: { link,
   linkLabel? }`. The remote writes the owner's `Grant` and the `Workspace` record on `main` as one
   marked commit, then creates the branch, in the order grants already follow (ADR-0068 decision 3):
   a failure between the steps leaves a record for a branch that does not exist, never a branch
   without its record. The record is how the remote, and every client, knows the branch is a
   workspace.

3. **Writes to a workspace's branch carry its link.** Every write to a branch that an `Active`
   linked `Workspace` record names (a document write, a merge into it, its deletion) carries
   `Armature-Workspace-Link: <installation>`. A request without it, or with another value, is 409
   `held_elsewhere`, naming the record's `linkLabel` and `linkedAt` and never the identifier. A
   write to an unlinked workspace's branch is 409 `not_linked`. The check runs after identity and
   authorization, since it is a conflict of state, not of authority: the owner has the right, from
   the wrong place. A merge *from* a workspace reads it and needs no link. The workspace hub sends
   the header on its push, its bring-in and its removal. An agent acting for the owner reaches the
   remote only through that push (ADR-0067 decision 10), so it carries the link too.

4. **Moving a workspace is two steps: unlink, then link.**

   - **Unlink from this computer.** From the linked program, once nothing is unpushed (the program
     refuses with `unpushed_commits` otherwise). The record's `link` is cleared, and the local copy
     is removed, since everything in it is on the remote. The workspace stays on the remote,
     unlinked, owned, with its parent.
   - **Unlink from the other computer** (the label `docs/naming-vocabulary.md` chose; drafted here
     as "Unlink from elsewhere"). The owner may clear a link without the linked computer, for one that
     is lost, broken or out of reach: from another signed-in desktop program, or any client
     (`POST /workspaces/:branch/unlink`). The confirmation states the cost: that computer's
     unpushed commits can no longer be pushed. Its next push is refused 409 `not_linked`, and its
     way on is ADR-0065's discard, which sets its files aside first.
   - **Link to this computer.** The signed-in program lists the owner's unlinked workspaces
     (`GET /workspaces?owner=me&linked=false`), each with **Link to this computer**. Linking sets the
     record's `link` to this installation and clones the branch as the clone does now. Linking never
     takes a workspace over: a workspace linked elsewhere is 409 `held_elsewhere`, and the owner
     unlinks it first, from there or from elsewhere.

   No code or web page is needed to link. The program is signed in as the owner, and the remote's
   resolution of that identity is the proof of ownership. The viewer could not list a person's
   workspaces anyway: it reads with its own credential and carries no reader's identity (ADR-0067
   decision 4). If a link from a web page is wanted later, the viewer's `/connect` link into the
   program could carry a workspace's name.

   **Remove from this computer** keeps its meaning (ADR-0065 decision 2, later change of 2026-11-07):
   the local copy goes, and the branch is deleted on the remote when another branch holds its head,
   its record then `Closed`. Otherwise the branch is kept, now as an unlinked workspace that can be
   linked again. **Discard and remove** clears the link as well.

5. **Merge requests.** A `MergeRequest` document on `main`, category `infrastructure`:

   | Field | Type | Meaning |
   |---|---|---|
   | `source` | `xsd:string` | The branch or workspace to merge |
   | `target` | `xsd:string` | The branch to merge it into |
   | `openedBy` | `User` | The resolved identity that opened it, never a body's claim |
   | `message` | `xsd:string` | What it holds and why; the merge commit's message |
   | `status` | `MergeRequestStatus` | `Open`, `Merged` or `Closed` |
   | `decidedBy` | `Optional<User>` | Who merged or closed it |
   | `decidedAt` | `Optional<xsd:dateTime>` | When |
   | `mergeCommit` | `Optional<xsd:string>` | The merge commit, once merged |

   `@key` is `Random`. It lives on `main`, written only by the hub through the routes below, and at
   most one `Open` request names a pair of source and target (409 `request_open`). A target is a
   branch, never a workspace. It is infrastructure, not a design record: no note, finding or
   sign-off can be about one, and it is in no export of the design. That is reconsidered when a
   client wants a note or a sign-off about a request, and moving it is a schema change with its own
   ADR (open question 2).

   **Which merges need one** (open question 1). Every merge *from a workspace*, so the program has
   one way to send work anywhere; and every merge *into `main`*, from anything, since `main` is the
   project's official state and a request records who asked and who decided. The merge route
   refuses either made outside a request (409 `request_required`). Whoever may merge into the
   target opens and merges in one step. Two merges stay direct: between branches other than `main`,
   for online clients (CoQui's rounds), and a workspace's update from its parent, which is a merge
   into the workspace and the owner's own.

   **No review is required before merging** (open question 3): whoever may merge a request may
   merge one they opened. A required check (ADR-0070) can add a review later without a new
   mechanism, and so could sign-offs about a request, were it a design record.

   **Its health is a read.** `GET /merge-requests/:id` answers the record and, computed at both
   heads as they are now, what a merge would meet: `conflicts` and `violations` from the merge
   route's dry run, and `checks` from the merge gate, with `mergeable` true when all three are
   clear. Nothing of it is stored (ADR-0056). A client knows when to look again from the event feed,
   which already reports new commits on the source and the target; a request's own changes are
   commits on `main` and appear there too. Notifying the opener and the source's owner is a
   client's work; the hub sends nothing.

   **Conflicts are resolved in the source.** For a workspace, its owner updates from the parent
   (bring-in), resolves what that reports, and pushes; the request is clean on the next read.
   Whoever may merge into the target only decides.

   **The routes**, under the capability `armature/merge-requests`:

   | Route | What | Who |
   |---|---|---|
   | `POST /merge-requests` `{ source, target, message }` | Opens one | Whoever may write the source; for a workspace, its owner |
   | `GET /merge-requests?target=&source=&status=` | Lists them | Any resolved identity |
   | `GET /merge-requests/:id` | The record and its health | Any resolved identity |
   | `POST /merge-requests/:id/merge` `{ overrides? }` | Merges it: the merge route's work, gated as any merge (ADR-0070 decision 6) | Whoever may merge into the target |
   | `POST /merge-requests/:id/close` | Closes it unmerged | The opener, the source's owner, or whoever may merge into the target |

   The merge commit carries the hub-written trailer `Armature-Merge-Request: <id>`, refused from
   clients as the others are (`trailers.ts`), and the record becomes `Merged` with the commit, in
   the same marked commit on `main`. A workspace's owner who may merge into its parent opens and
   merges in one step from the program; the request is still recorded.

6. **Authorization** (ADR-0068 decision 4, rows added): *open a merge request*, whoever may write
   its source; *merge a request*, whoever may merge into its target; *close a request*, its opener,
   its source's owner, or whoever may merge into its target; *link, unlink, list a workspace*, its
   owner, and an administrator to list and unlink any. A workspace hub authorizes none of these: it
   asks the remote (ADR-0068 decision 9).

7. **The desktop program.** Its own actions (ADR-0065 decision 7) gain **Link to this computer**,
   **Unlink from this computer** and **Unlink from the other computer**, with the lists they need: unlinked
   workspaces, and workspaces linked elsewhere. **Deliver** becomes **Open merge request into
   <parent>**, with the request's health shown and kept current from the event feed. A merge
   request on the remote replaces the workspace hub's dry-run action ("Ask what a delivery would
   find"), since an open request shows the same answer, continuously. The program sends
   `Armature-Workspace-Link` on every request that writes its workspace's branch.

   **Workspaces made before this** (open question 4). At its first contact with the remote after
   the upgrade, the program writes a record for each workspace it holds, linked to itself, with
   `parent` from `workspace.json`'s `from`, or `main`. A branch with no record stays an ordinary
   branch, so a workspace held by a program not yet upgraded keeps working, unprotected, until it
   is.

## Alternatives considered

- **Let both write, and replay unpushed commits onto a moved branch.** A rebase after a 412 would
  make a workspace an ordinary branch with an offline copy, written from anywhere. Rejected for
  now: a push could then conflict, so conflicts would be resolved in two places instead of one
  (bring-in), and the guarantee that a push cannot conflict would go. It remains the answer to the
  412 the rule does not prevent, deferred until a client shows that case (ADR-0065 decision 6, later
  change).
- **Allow both, and document the dead end.** The status quo. Rejected: it leaves the owner's
  ordinary use of their own right as the way to strand their own work.
- **Move a workspace in one step.** First proposed, then changed by Amos. A one-step move needs the
  first computer to hand the workspace over, and that computer may be lost or out of reach;
  otherwise the move silently takes the workspace over. Two steps make the release explicit, and
  unlinking from elsewhere states its cost in the one place it applies.
- **A linking code, or a list on a web page.** Suggested as a possibility while deciding. Not
  needed: the program is signed in as the owner, which proves ownership, and the viewer carries no
  reader's identity to list anyone's workspaces by.
- **Tell a workspace from a branch by its name, or by its grants.** The `<handle>_<name>`
  convention is not enforced, and "a branch with only an owner" conflates who may merge with what
  kind a branch is. Rejected for a record.
- **Link a workspace to a person rather than an installation.** Does not prevent the case that
  matters most: the same person on two computers is two writers.
- **A real secret for the link.** A signed or hashed link would stop a determined owner from
  getting around their own guard, which protects nothing: only the owner may write the branch.
- **A request without a record** (ADR-0068 open question 2's answer). Superseded by the three needs
  in Context: nothing would record who asked, or why a merge happened.
- **A request that stores its health.** Rejected by ADR-0056: stored conflicts go stale when either
  branch moves.

## Open questions

**Amos decided all five on 2026-11-19, one by one, each as recommended.** The decisions are in
decision 2 (question 5), decision 5 (questions 1, 2 and 3) and decision 7 (question 4); the
recommendations are kept here as written, and the options weighed beside each were:

- *Question 1:* every merge through a request (CoQui's direct merges between its own branches would
  break, and requests would pile up for branches nobody reviews); workspaces only (a merge into
  `main` could still happen with no record of who asked); never required (the program keeps two
  ways to send work).
- *Question 2:* a design record now (workflow state in the design graph before a client asks).
- *Question 3:* a review optional per branch (a new kind of requirement); a review always on `main`
  (a project with one maintainer could never merge).
- *Question 4:* an operator's migration (the server cannot know which installation holds a
  workspace, so every record would start unlinked); the owner converting each by hand (most never
  would).
- *Question 5:* the computer's name by default (often a full name or an asset tag, published on
  `main`); asking at the first link (one more question while creating the first workspace).

The code `request_required` (decision 5) was named in writing question 1's decision in, without a
separate decision, and is open to overrule.

1. **Must every merge go through a request?** *Recommendation:* every merge *from a workspace*, so
   the program has one way to send work anywhere; and every merge into `main`, from anything, since
   `main` is the project's official state and a request records who asked and who decided. A
   maintainer opens and merges in one step. Direct merges between other branches stay for online
   clients (CoQui's rounds), and a workspace's update from its parent stays a direct merge into the
   workspace, since it is the owner's own.
2. **Is a merge request a design record?** As one, a design note, a finding or a sign-off could be
   about it, and the decision to merge would sit in the design graph and its exports.
   *Recommendation:* infrastructure first, as here, beside `Grant`; reconsidered when a client wants
   a note or a sign-off about a request. Moving it is a schema change with its own ADR.
3. **Reviews before merging** (an approval by someone other than the merger, as a code host's
   required reviews). *Recommendation:* none now. A required check (ADR-0070) or sign-offs about the
   request (question 2) can add one later without a new mechanism.
4. **Workspaces made before this.** *Recommendation:* the program, at its first contact after the
   upgrade, writes a record for each workspace it holds, linked to itself, with `parent` from
   `workspace.json`'s `from`, or `main`. A branch with no record stays an ordinary branch, so a
   workspace held by a program not yet upgraded keeps working, unprotected, until it is.
5. **The link's label.** *Recommendation:* empty unless the owner names the computer in Settings,
   since `main` is read by everyone the instance serves and a computer's name says more about a
   person than the program needs to.

## Verification

No platform check is needed before acceptance: both records live on `main` and are written by the
hub in marked commits, as `Grant` and `CheckRequirement` already are, and the link is a header the
hub reads. The event feed's report of commits on
any branch is built (ADR-0070, built 2026-11-15). Tests on building, in the contract suite: a write
without the link refused (`held_elsewhere`, `not_linked`), with it served; unlinking from elsewhere,
then the old computer's push refused and its discard; linking an unlinked workspace, and linking one
linked elsewhere refused; a parent that is a workspace refused; a request's health following its
source after a bring-in and a push; one open request per pair; merging and closing by who may, and
refused otherwise; a merge from a workspace, or into `main`, refused outside a request
(`request_required`), and a direct merge between two other branches served; the program's records
for the workspaces it held before the upgrade; the trailer written, and refused from a client; the gate's refusals through a
request; `queue.test.ts` updated for the new commits on `main`.

## Consequences

- **Schema:** `Workspace`, `MergeRequest`, `WorkspaceStatus`, `MergeRequestStatus`, with their
  constraints in `invariants/`, implemented in one commit on acceptance.
- **The remote:** `POST /branches` gains `workspace`; routes under `/workspaces` and
  `/merge-requests`; the link check in the write pipeline; one capability and a trailer. Each change
  a client acts on is an entry in `docs/client-changes.md` and a revision.
- **The desktop program:** an installation identifier; linking, unlinking and the two lists; merge
  requests in place of delivery and its dry run; the link header on its writes; the upgrade of
  existing workspaces (open question 4). Quiver's "where the work is" strip gains a request's
  health to show.
- **Collaboration on one branch works without anyone becoming a maintainer of someone else's
  work.** Each person keeps a workspace, and a branch's maintainers decide what merges into it.
  The A/B case is: a branch per method, workspaces under each, requests into each method, and one
  request from the chosen method into `main`.
- **The design history gains who asked.** Every merge from a workspace, and every merge into `main`
  (decision 5), has a record of who opened it, with what message,
  who decided, and the commit, joined to the merge by its trailer.
- **The guide changes**: "Clone a branch" goes (a workspace is linked, not cloned, and someone
  else's workspace is read on the instance), "Deliver" becomes a merge request, and moving to
  another computer is described as unlinking and linking.
