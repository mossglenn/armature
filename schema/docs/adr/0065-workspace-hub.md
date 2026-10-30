# ADR-0065: The Workspace Hub, a Local Hub Bound to a Remote by Workspaces

> **In brief.** This decision answers: how does a person work on the design graph on their own
> machine, offline if need be, with several tools at once, and bring the work back? The answer is
> a second role for the same hub. A *workspace hub* runs on the person's machine and serves the
> same application programming interface (API) to the tools there. It holds *workspaces*: each is
> a branch created on the shared hub (the *remote*), copied to the machine at its latest commit,
> written to locally, and sent back by replaying its local commits through the remote's own API,
> so every rule and every identity check runs there as for any other write. What makes history
> shared stays on the remote: the workspace hub refuses to create branches, merge or register
> people. Accepted on 2026-10-30 and not yet built; `docs/workspace-hub-plan.md` is the plan.

## Status

Accepted (2026-10-30, with ADR-0067 and ADR-0068; Amos's decision after the alignment review of
that day). Proposed 2026-10-28; verified 2026-10-30 (§Verification). Nothing of the workspace hub
is built yet: implementation follows `docs/workspace-hub-plan.md` §14, step 1 (the adapter
interface) first. ADR-0066, its store, stays Proposed until check AI runs. The dated notes this
Status promised are on ADR-0025, ADR-0026, ADR-0032, ADR-0055, ADR-0059 and ADR-0062 (2026-10-30),
and plan §2's terms are in CLAUDE.md's table.

**Note 2026-10-29:** the store decision 8 leaves open is ADR-0066 (Proposed): a folder of files
behind an adapter interface, with TerminusDB as the test bed while steps 2 to 5 are built.

**Note 2026-10-29, decided before acceptance:** one remote per workspace hub, as decision 1 says
(plan §16 question 5). Decision 5's trailers were renamed from the first draft's
`Armature-Committed-At` to `Armature-Authored-At`, following Git's author date, and gained
`Armature-Workspace-Part` for a split commit (plan §16 question 10).

**Note 2026-10-29, identity:** identity moved to two records of its own: ADR-0067 (Proposed) for authentication, agents acting for people and the
loopback boundary, and ADR-0068 (Proposed) for authorization, which enforces decision 2's
ownership and replaces decision 7's refusal of agent writes.

**Note 2026-10-30, decided before acceptance:** the workspace hub passes the two-client test,
with the need documented in Context. Quiver pauses its development until the workspace hub is
built, is its first real-world test, and its code (`sync/`, `workspace/`, `merge/`, `rules/`,
`coverage/`) may be the basis of the workspace hub's. ADR-0067's `oidc` resolver is a
prerequisite of the workspace hub, built before its release; ADR-0068 is a prerequisite too,
built before push with the parts of ADR-0067 that shape what a push sends (plan §14). The
plan's §16 records the rest: a desktop program for the
first release candidate (question 1), a clone holding as much as is reasonable (question 3), the
clone's slice to be determined (question 4), pseudonymous clones deferred (question 8).

**Note 2026-10-30, decided before acceptance, authorization and agents:** a workspace hub does
not authorize; the remote is the authority and refuses a push it would not allow, and the
workspace hub warns at creation when the owner may not write the branch (decision 4's note,
ADR-0068 decision 9). An agent's own work reaches a remote only through a workspace hub's push,
acting for the workspace's owner (decision 7's note, ADR-0067 decision 10).

On acceptance it would annotate, not amend in substance:

- **ADR-0025 decision 2**, which reserves git-style trailers in the commit message and defines
  none; decision 5 below defines the first two.
- **ADR-0032 decision 1**, whose `header` resolver keeps mutating routes local; a workspace hub
  is that case by design, and its push is the first writing client that runs elsewhere, the
  trigger for the `oidc` resolver.
- **ADR-0055 decision 1** ("one HTTP adapter"), if the workspace hub's store is not TerminusDB
  (decision 8): the adapter would become an interface with two implementations.
- **ADR-0059 decision 4**, which gains one capability, `armature/workspace`, and settings on
  `armature/branches` and `armature/users` saying which of their routes a hub serves.
- *Added 2026-10-30 by the alignment review:* **ADR-0026 decision 4**, whose "second host" the
  workspace hub is; **ADR-0032 decision 2**, since a workspace hub's `main` is a read-only mirror
  of the registry and registration is refused there (decision 3); **ADR-0025 decision 6**, since
  branch deletion is refused on a workspace hub; **ADR-0062**, whose operator tools are not
  shipped on a workspace hub (plan §9 and §15).

Each of those ADRs gets a dated note pointing here when this one is accepted.

## Context

Every client today is a client of one hub, over the network. Quiver, the local-first item manager
(`mossglenn/quiver`, `docs/plan.md` §3 and §5 there), plans its own answer to working away from
the hub: a workspace bound to a branch, checked out from `GET /export`, local commits with
reasons, push as batch writes with `If-Match`, the hub's merge in each direction, and a
fragment-by-fragment conflict review. Its plan also records what that costs a tool that builds it
alone: a copy of the hub's rules that can drift from the engine (its §5.4, and its ask for an
`@armature/rules` package), its own coverage computation, and a workspace no other tool on the
machine can see.

A second local-first client would build the same thing again. CoQui's offline authoring is what
made client-supplied identifiers necessary (ADR-0024), and an importer or a bridge (the Storyline
bridge plan) wants a scratch space it can write to before anyone sees the result. Two tools on one
machine, an item manager and a review tool, should see the same workspace without a round trip.

> **The two-client test (decided 2026-10-30).** The need is in three clients' own plans. Quiver
> built its workspace, push, merge review and rules alone (its milestones 1 to 8, 2026-10-26 to
> 2026-10-28) and asks for its rules as a package. The Storyline bridge must run on the designer's
> machine beside Storyline, since it reads the project and package files there, and its plan
> notes that under the `header` resolver it "writes only from the hub's own machine"
> (`docs/storyline-bridge-plan.md`, "Reaching the hub"). The MCP server runs on the person's
> machine as a stdio server and reads `ARMATURE_HUB_URL`, `http://localhost:3100` by default
> (`docs/mcp-server-plan.md`), where a workspace hub would answer with the person's own work.
> All three want a hub on the person's machine; Quiver and the bridge also want to write there
> before anyone else sees the result.

Three facts constrain the answer:

1. **The API is the boundary** (Development Principle 1). The remote must not take writes that
   skipped its pipeline: shape, identity, `createdBy`, `asOf`, the invariants.
2. **`asOf` names a commit the store holds** (ADR-0057, constraint 13). A local copy that makes
   its own commits makes commit identifiers the remote has never seen.
3. **The store's own transport keeps commits but skips the hub.** TerminusDB's clone and push
   move layers between stores: push needs linear history and the remote store's credentials,
   clone copies every branch, and neither runs anything of the hub's (`docs/vendor/terminusdb/
   git-for-data-reference.md`). The document API ignores commit metadata (platform check V4), so
   a write cannot carry a structured fact about the commit it makes.

## Decision

1. **A hub has one of two roles.** A *remote hub* is the hub as built: a host bound to a store,
   where branches are created, merged and deleted and where `User` documents are registered. A
   *workspace hub* is the same API, from the same code, in workspace mode, on one person's machine,
   holding workspaces cloned from one remote. Every other term in CLAUDE.md's table holds for
   both; a client is written against the API and learns a hub's role from `GET /discover`.

2. **A workspace is a branch on the remote, created there.** The workspace hub asks the remote
   for the branch (`POST /branches`), then clones it: the export at its head (`GET /export`), the
   schema at the same commit (`GET /schema`), and `main`'s `User` documents for identity
   resolution. The head it cloned is the workspace's *base*. A workspace has one owner, the person
   whose machine holds it; nothing else writes its branch on the remote by convention, and a push
   detects a breach of the convention (decision 5) rather than the remote preventing it.

   > **Later change (2026-10-29):** ADR-0068 (Proposed) makes ownership a rule the remote
   > enforces: the person who creates a branch owns it, and only its owner, someone the owner
   > grants, or an agent acting for either may write to it.

3. **A workspace hub refuses what makes history shared.** Branch creation, merge, branch deletion
   and user registration are refused with 400 `remote_only`, naming the remote. Branch reads,
   document reads and writes on a workspace, history, diff, every intelligence read and export
   are served as on any hub. `main` on a workspace hub is a read-only mirror of the remote's
   `main` as last seen.

4. **Writes on a workspace hub run the whole pipeline.** The same shape check, identity
   resolution, `createdBy`, `asOf` and invariants run locally on every write, so a tool learns of
   a refusal when it writes, not at the next push. The remote runs them again on push and is the
   authority; a local refusal and a remote one carry the same code.

   > **Later change (2026-10-30):** the whole pipeline, but not authorization. ADR-0068's
   > permission check (who may write a branch, who may merge into `main`) runs on the remote
   > only; a workspace hub holds one owner and no grants, so the question it could ask locally
   > ("may the owner write this workspace?") is answered by the remote at push, with 403
   > `forbidden`. So that a person learns of it before a week's work rather than after, the
   > workspace hub asks the remote at workspace creation whether the owner may write the branch
   > (the owner's grants from `GET /users/me`, the branch's from the `Grant` documents on `main`,
   > ADR-0068 decisions 7 and 8) and **warns** when they may not. It does not prevent the
   > workspace: a person may clone a colleague's branch to read it, work on it and ask for a
   > grant, or copy their work elsewhere; the refusal, if it comes, is the remote's at push.
   > ADR-0068 decision 9 records the same from the remote's side.

5. **Push is replay through the remote's API.** Each local commit since the last push becomes one
   `POST /documents` on the remote, in order, with `If-Match` naming the remote commit the
   previous replay produced (the base, for the first). The workspace hub keeps a table from each
   local commit to the remote commit it became, and before replaying a commit rewrites every
   `asOf` that names a local commit to the remote one; since the workspace has one writer and
   replay starts from the base, each remote commit holds the same documents as its local
   original, so the rewrite is exact. The commit message carries two trailers in the form
   ADR-0025 decision 2 reserves: `Armature-Workspace-Commit: <local commit id>` and
   `Armature-Authored-At: <time of the local commit>`, so the time the work was done survives
   the push. The name follows Git's author date (when the work was done), the remote's own
   timestamp being the committer date (when it arrived). A local commit too large for one request
   is replayed as several, each carrying a third trailer, `Armature-Workspace-Part: <n>/<total>`.
   These trailers are the pusher's claims: the remote records them as sent, and they are as
   trustworthy as the authenticated workspace owner who pushed them. A 412 means the branch
   moved on the remote and the push stops; a 422 stops it at the
   commit the remote refused.

   > **Later change (2026-10-30):** a third failure, 403 `forbidden` (ADR-0068): the owner may
   > not write the branch on the remote, which the warning at workspace creation (decision 4's
   > note) will usually have said already. The push stops before its first commit.

6. **Delivery is the remote's merge, driven from the workspace hub.** With nothing left to push,
   the workspace hub asks the remote to merge `main` into the workspace (`POST /branches/<ws>/
   merge` with `from: main`), presents any conflict for review, writes the resolution as local
   commits, pushes them, and asks the remote to merge the workspace into `main`. The review is
   generic over the schema (by `fragmentId` for an item's parts, by field otherwise). After each
   merge the workspace hub runs the invariants engine over the merged state and reports what it
   finds, since the remote's merge route does not.

   > **Later change (2026-10-30):** the merge into `main` needs a `Maintainer` of `main` on the
   > remote (ADR-0068 decision 4); a workspace owner who is not one asks someone who is, and the
   > workspace hub shows who holds the grant when delivery is refused (ADR-0068, open question 2).

7. **Tools reach a workspace hub on loopback, as its owner.** The `header` resolver serves, and
   resolves only the owner's `externalId`. The workspace hub alone holds the credential for the
   remote. Writes by an agent identity are refused until the remote can tell an agent's push from
   its registrar's, so that no agent's work is silently credited to a person.

   > **Later change (2026-10-29):** ADR-0067 (Proposed) adds a `Host` check and an allow-list of
   > web origins, empty by default, to every hub, so a web page the person never chose cannot
   > write as them. ADR-0067 and ADR-0068 (both Proposed) replace the refusal of agent writes: an
   > agent writes locally, and the push sends its commits as the agent acting for the owner, with
   > the owner recorded in an `Armature-On-Behalf-Of` trailer the remote writes itself. Quiver's
   > drafter and lint agent, already built, are the case.
   >
   > **Later change (2026-10-30):** a request to a workspace hub naming anyone but its owner, or
   > an agent acting for anyone but its owner, is refused with 403 `forbidden` (the code ADR-0068
   > decision 1 gives a refusal of authority), not 401 `identity_required`, which means no
   > identity was sent (ADR-0032 decision 8).
   >
   > **Later change (2026-10-30, decided):** this is the only way an agent's own work reaches a
   > remote. An agent writes on a workspace hub, where the owner is present and recorded, and the
   > push carries its commits as the agent acting for the owner; a remote refuses an agent's own
   > writes made directly (ADR-0067 decision 10, with the reasons and what would reopen it).

8. **The store under a workspace hub is a choice behind the adapter.** TerminusDB as a process
   beside the hub and a file-backed store are both admissible. Decisions 3 and 6 limit what the
   store must do (no merge, no branch creation): documents at the head, a log of local commits,
   reads at those commits and at the base. The plan compares the two; this ADR does not choose.

   > **Later change (2026-10-29):** ADR-0066 (Proposed) makes the choice: the file-backed store,
   > with TerminusDB first as the test bed, and whether TerminusDB stays a second local store
   > decided once the file-backed store exists.

## Alternatives considered

- **The store's own clone and push.** Keeps commit identifiers and times, and every intelligence
  read offline at every commit. Rejected: the pushed layers skip the remote's pipeline, so the
  remote would have to quarantine and re-check every push and verify each commit's author; a
  client would need the store's credentials or a new pack route; and a clone copies every branch
  and every `User`, which is a data-governance question for a study's instance.
- **A workspace library inside each tool** (Quiver's plan as written). No second program to
  install. Rejected as the end state: no sharing between tools on one machine, and the rules
  copied into each tool. It remains the first step if the workspace hub starts inside Quiver.
- **A full peer hub with no restrictions.** Rejected: two places where shared history is made,
  so merges and `User` registrations on a laptop would need reconciling with the remote's.

## Verification

None yet. The design relies on behaviors already verified for ADR-0025 (a batch write is one
commit; `If-Match`; the three-way merge; check Z's base restore). Before acceptance: a contract
test that a write naming an earlier commit of the same branch as `asOf` passes constraint 13 on
the remote, and a test that a message with trailers is returned byte for byte. If the store chosen
under decision 8 is TerminusDB, a lettered check (AH) of a native build that a desktop program can
ship beside itself.

**Results (2026-10-30, TerminusDB v12.0.7, PR #70):** both checks before acceptance hold.

- **An earlier commit as `asOf`.** A finding written with `If-Match` naming the branch head and
  `asOf` naming the commit before it passes constraint 13 and keeps that `asOf`
  (`app/lib/api/write.test.ts`, "accepts an earlier commit of the same branch as asOf"). The
  push's rewrite of an `asOf` naming an older local commit is therefore accepted by the remote.
- **Messages with trailers.** A message ending in `Armature-Workspace-Commit`,
  `Armature-Authored-At` and `Armature-Workspace-Part`, sent as the write's `message` query
  parameter, comes back byte for byte from the store's `/api/log` and `/api/history` (platform
  check AJ1) and from the hub's history route after a `POST /documents` (`write.test.ts`,
  "returns a message ending in trailers byte for byte"). The store also keeps a trailing newline,
  CRLF line endings and non-ASCII text as sent (AJ2 to AJ4), so normalizing line endings, if
  ever wanted, is the hub's choice, not the store's; a reader of trailers accepts both `\n` and
  `\r\n`.
- **Check AH** is no longer needed before acceptance: under ADR-0066 the workspace hub's store of
  record is the file-backed store, and TerminusDB under a workspace hub is a test bed run in a
  container. It returns only if the sidecar path reopens (ADR-0066, Alternatives).

## Consequences

- A local-first tool is a client of a hub like any other; Quiver's `sync/` and `workspace/`
  modules move into the workspace hub, and its folder of files can be the workspace hub's store.
  > **Later change (2026-10-30):** Quiver pauses until the workspace hub is built and is its
  > first real-world test; the workspace hub may be built from Quiver's modules.
- The rules and the intelligence reads run on the person's machine with the hub's own code,
  which requires them to work through an adapter interface rather than the concrete class.
- Local commit identifiers are provisional. Pushed commits get the remote's identifiers and the
  remote's timestamps; the local ones survive only as trailers.
- History offline starts at the base. Reads at older commits, and the subject states that
  constraints 13 and 16 and the attestation staleness read need for records cloned with an older
  `asOf`, need either a larger clone or the remote (plan §8).
  > **Later change (2026-10-30):** the clone holds as much as is reasonable, so that as many of
  > the hub's reads as possible work offline (plan §8 and §16, question 3).
- A store other than TerminusDB under a workspace hub must reproduce two of TerminusDB's formats
  that cross the API: the identifiers it mints for Hash-keyed classes, so a local record names the
  same junction the remote holds, and the JSON patch the diff route returns (plan §10).
  > **Later change (2026-10-29):** ADR-0066 decisions 5 and 6 settle both: the patch is named in
  > `docs/api.md` as the route's format, and Hash identifiers are reproduced if check AI shows
  > how, else mapped at push, since Quiver found them not reproducible from the key fields.
- The remote needs the `oidc` resolver before a workspace hub on another machine can push.
  > **Later change (2026-10-30):** the `oidc` resolver (ADR-0067) is a prerequisite of the
  > workspace hub, not only of a push from another machine.
- Nothing changes for a client that talks to a remote hub directly.
