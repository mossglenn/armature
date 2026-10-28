# ADR-0065: The Workspace Hub, a Local Hub Bound to a Remote by Workspaces

> **In brief.** This decision answers: how does a person work on the design graph on their own
> machine, offline if need be, with several tools at once, and bring the work back? The answer is
> a second role for the same hub. A *workspace hub* runs on the person's machine and serves the
> same application programming interface (API) to the tools there. It holds *workspaces*: each is
> a branch created on the shared hub (the *remote*), copied to the machine at its latest commit,
> written to locally, and sent back by replaying its local commits through the remote's own API,
> so every rule and every identity check runs there as for any other write. What makes history
> shared stays on the remote: the workspace hub refuses to create branches, merge or register
> people. It is proposed, not built; `docs/workspace-hub-plan.md` is the plan.

## Status

Proposed (2026-10-28). Nothing is built on it.

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

3. **A workspace hub refuses what makes history shared.** Branch creation, merge, branch deletion
   and user registration are refused with 400 `remote_only`, naming the remote. Branch reads,
   document reads and writes on a workspace, history, diff, every intelligence read and export
   are served as on any hub. `main` on a workspace hub is a read-only mirror of the remote's
   `main` as last seen.

4. **Writes on a workspace hub run the whole pipeline.** The same shape check, identity
   resolution, `createdBy`, `asOf` and invariants run locally on every write, so a tool learns of
   a refusal when it writes, not at the next push. The remote runs them again on push and is the
   authority; a local refusal and a remote one carry the same code.

5. **Push is replay through the remote's API.** Each local commit since the last push becomes one
   `POST /documents` on the remote, in order, with `If-Match` naming the remote commit the
   previous replay produced (the base, for the first). The workspace hub keeps a table from each
   local commit to the remote commit it became, and before replaying a commit rewrites every
   `asOf` that names a local commit to the remote one; since the workspace has one writer and
   replay starts from the base, each remote commit holds the same documents as its local
   original, so the rewrite is exact. The commit message carries two trailers in the form
   ADR-0025 decision 2 reserves: `Armature-Workspace-Commit: <local commit id>` and
   `Armature-Committed-At: <time of the local commit>`, so the time the work was done survives
   the push. A 412 means the branch moved on the remote and the push stops; a 422 stops it at the
   commit the remote refused.

6. **Delivery is the remote's merge, driven from the workspace hub.** With nothing left to push,
   the workspace hub asks the remote to merge `main` into the workspace (`POST /branches/<ws>/
   merge` with `from: main`), presents any conflict for review, writes the resolution as local
   commits, pushes them, and asks the remote to merge the workspace into `main`. The review is
   generic over the schema (by `fragmentId` for an item's parts, by field otherwise). After each
   merge the workspace hub runs the invariants engine over the merged state and reports what it
   finds, since the remote's merge route does not.

7. **Tools reach a workspace hub on loopback, as its owner.** The `header` resolver serves, and
   resolves only the owner's `externalId`. The workspace hub alone holds the credential for the
   remote. Writes by an agent identity are refused until the remote can tell an agent's push from
   its registrar's, so that no agent's work is silently credited to a person.

8. **The store under a workspace hub is a choice behind the adapter.** TerminusDB as a process
   beside the hub and a file-backed store are both admissible. Decisions 3 and 6 limit what the
   store must do (no merge, no branch creation): documents at the head, a log of local commits,
   reads at those commits and at the base. The plan compares the two; this ADR does not choose.

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

## Consequences

- A local-first tool is a client of a hub like any other; Quiver's `sync/` and `workspace/`
  modules move into the workspace hub, and its folder of files can be the workspace hub's store.
- The rules and the intelligence reads run on the person's machine with the hub's own code,
  which requires them to work through an adapter interface rather than the concrete class.
- Local commit identifiers are provisional. Pushed commits get the remote's identifiers and the
  remote's timestamps; the local ones survive only as trailers.
- History offline starts at the base. Reads at older commits, and the subject states that
  constraints 13 and 16 and the attestation staleness read need for records cloned with an older
  `asOf`, need either a larger clone or the remote (plan §8).
- A store other than TerminusDB under a workspace hub must reproduce two of TerminusDB's formats
  that cross the API: the identifiers it mints for Hash-keyed classes, so a local record names the
  same junction the remote holds, and the JSON patch the diff route returns (plan §10).
- The remote needs the `oidc` resolver before a workspace hub on another machine can push.
- Nothing changes for a client that talks to a remote hub directly.
