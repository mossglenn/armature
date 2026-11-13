# ADR-0070: Checks: An Event Feed, Check Runs and Required Checks, So Plugins Can Gate a Merge

> **In brief.** This decision answers: how can a tool such as a design linter stop a change from
> reaching `main` without the hub itself knowing any design rules? The hub gains four general
> pieces and no rules. Tools *pull* a list of what changed. They *post* a verdict, pass or fail,
> about one commit. Maintainers and branch owners say, as records on `main`, which tools' verdicts
> are *required* before a merge, with settings only the tool reads. The merge route then *refuses*
> a merge whose required verdicts are missing or failing, unless someone with the right to merge
> gives a reason, and the merge commit records what was required, what passed and who overrode
> what. The same pieces run on a person's own machine, where the gate is the push. Accepted on
> 12 November 2026; nothing is built.

## Status

Accepted (2026-11-12, Amos). Proposed the same day, drafted from `docs/lint-plan.md`, whose §17
records Amos's decisions of that day on the plan's six questions. Not built. It changes the schema,
adding one class and one enum, so it is implemented with `schema.json`, the generated types and the
appendix in one commit (CLAUDE.md, "After schema changes"). The two platform checks under
Verification were run on 2026-11-12; both pass, and what they found is recorded there and in open
questions 1 and 5. Amos decided the five open questions the same day, each as recommended
(decisions 2, 3 and 12), before accepting the record.

The dated notes this acceptance promised are on ADR-0021, ADR-0025, ADR-0059, ADR-0062, ADR-0065,
ADR-0066, ADR-0067 and ADR-0068 (2026-11-12). They annotate:

- **ADR-0025 decision 2**, which reserves git-style trailers: two more hub-written trailers,
  `Armature-Check` and `Armature-Check-Override` (decision 7).
- **ADR-0025 decision 5**, whose merge check over the merged state gains a second step for merges
  that have requirements (decision 6).
- **ADR-0059 decision 4**: one capability, `armature/checks` (decision 10).
- **ADR-0062 decision 5**: `check` gains a whole-graph rule for requirements (decision 5).
- **ADR-0065 decision 5**, whose push gains a gate before its first replay on a workspace hub
  (decision 8); and **decision 7**, whose local token stays as it is now but which a later step
  (the plan's §10, step 2) would turn into scoped tokens.
- **ADR-0066 decision 5**, whose file-backed store's patches differ from the store's only in a
  list's segmentation: inside a JSON value their operations may differ too (decision 12).
- **ADR-0067 decision 4**, whose service credential reads only: posting a check run is not a write
  to the graph, so a service may do it under the permission decision 4 below adds.
- **ADR-0068 decision 4**: two rows, *report a required check* and *write a requirement*; and
  **decision 3**, whose revocation of a branch's grants on deletion also revokes its requirements.
- **ADR-0021**: a stated expectation of every plugin that posts runs (decision 11).

> **Note (2026-11-12), built in part:** the schema, `CheckRequirement` and `CheckLevel`, with the
> generator's `sys:JSON` mapped to any JSON value but a top-level `null` (PR #145). Then
> constraints 23 (`requirements_live_on_main`, in the write pipeline beside 21) and 24
> (`reporter_not_agent`, `invariants/checkRequirement.ts`); the operator's `check` rule
> `requirement_without_branch`; and a branch's deletion revoking its requirements in the commit
> that revokes its grants, by the route and by the operator's scratch-branch deletion
> (`revocablesNaming` in `grants.ts`). Decision 5's rows of ADR-0068's table are not built, so
> the document routes do not take the class yet and the operator's `put` alone writes one: who may
> write a requirement turns on whether the record it replaces is `locked`, which the permission
> check must read. Not built: those rows, the feed, the runs, the gate, the trailers, the
> capability, the push gate and decision 12's patcher.
>
> **Note (2026-11-13), built:** decision 5's rows of ADR-0068's table, as `write_requirement` in
> `authorization.ts`: the document routes take `CheckRequirement`, judged by the branch it names
> and by `locked` on the record written and on the one it replaces, which the permission check
> reads by the key before the write's queue. A branch with no owner takes a requirement only from
> a maintainer, migration window or not (chosen in the build, open to overrule: the window opens an
> unclaimed branch to writes, not to gates on what reaches it). The operator's `put` is no longer
> the only write. No client revision for it: decision 10 makes the checks routes one revision, and
> a requirement binds nothing until the gate exists. Found in the build: `branch` in a list query
> is the branch read, so requirements are listed by `reporter` and filtered by `branch` in the
> client until `GET /checks/requirements?target=`. The permission is read before the write's
> queue, as every grant has been since 2026-11-01, so a lock or a revocation landing between the
> read and the commit is unseen; the write pipeline looks the replaced record up again inside the
> queue, and an authorization step there, after that lookup, would close the window and spare the
> second read. Deferred under the evidence rule until the race is seen. Still not built: the feed,
> the runs, `report_check`, the gate, the trailers, the capability, the push gate and decision
> 12's patcher.

It answers `.claude/SESSION.md` What's Next item 18's second half ("reacting to changes ... merge-time
checks an administrator can register") and `docs/demo-coverage.md`'s "a gate has no mechanism in
the hub". It does not touch item 18's first half, the path read.

## Context

Several clients want to stop a change from landing, or to say something about every change:

- **Lint** (`docs/lint-plan.md`; `docs/demo-coverage.md`, "Lint (proposed)"): soft design rules,
  such as an objective no activity targets or an item whose Bloom level is below its objective's,
  which a team may require to pass before merging into `main`, and an individual may run on every
  local change.
- **The Structure analyzer** (proposed): heavier graph algorithms after a merge or a push, whose
  proposals become findings.
- **CoQui**: a review round merged before every item has its affirmations. ADR-0068's open
  question 2 left "a request for delivery" to clients for want of a second one.

`docs/demo-coverage.md` records that "a gate has no mechanism in the hub": `/api/v1` has no events,
no webhooks, and no check the merge route calls. A tool today polls `GET /branches/:name/changes`
or runs in a client before it acts, which nobody can require of anyone else.

The first version of the Lint plan put the rule engine in the hub, as a stage after the invariants
in the write pipeline and the merge route. That works, and the same code would run on a workspace
hub for free, but every rule would ship with the hub's releases and the hub would carry opinions
(how strict is "aligned"?) that Development Principle 5 assigns to tools. Amos asked instead for
the hooks and the gate in the hub and the rules in plugins (2026-11-12). The constraints on that
shape:

1. **The API is the boundary.** A plugin reads the graph through `/api/v1` like any client
   (Development Principle 1); there is no query route (ADR-0062 decision 6), so a plugin computes
   from the export and the intelligence reads.
2. **A verdict must be about a commit that exists.** A plugin can only check a state it can read.
   The merge route's own check runs over a merged state it builds on a transient branch (ADR-0025
   decision 5, note); a plugin cannot see that state before the merge commits.
3. **A result written to the branch it checks moves that branch's head**, so the result would
   always describe the commit before the head.
4. **The hub calls nothing outside itself.** Every hub so far answers requests and talks only to
   its store and, on a workspace hub, its remote. Outbound calls would bring timeouts, retries and
   callback credentials into every merge, and do nothing on a laptop where the service is not
   running.
5. **A workspace hub authorizes nothing** (ADR-0068 decision 9). It may warn; the remote decides.
6. **Authority over the graph is in the graph** (ADR-0068 decision 2): a configuration file was
   rejected for grants because authority would change with no author, reason or history.

The two-client test (Development Principle 6) is met by Lint and CoQui's round check, which need
the same four pieces with different settings, reporters and branches; the Structure analyzer is a
third.

## Decision

1. **The hub hosts checks, never rules.** A *check* is a name a plugin owns (`lint/team`,
   `structure/spof`, `coqui/round-complete`). The hub knows a check by its name, by the agent
   allowed to report it, and by the verdicts reported for each commit. It never evaluates a design
   rule, never reads a requirement's settings, and never calls a plugin. What a plugin thinks of a
   design reaches the graph only as a person's `DesignFinding` or `Attestation`, as today.

2. **An event feed, pulled.** `GET /api/v1/events?since=<cursor>&types=&branch=` returns, in order,
   what changed since the cursor, and holds the request open up to 30 seconds when nothing has
   (long-poll). The types are `commit`, `merge`, `branch.created`, `branch.deleted`,
   `requirement.changed` and `hub.started`. An event names what a plugin needs to decide whether
   to act (the branch, the commit and its parent, the author, `workspaceCommit` when the commit
   is a push's replay, the count of changed documents by class), never the documents; a plugin
   fetches those through the existing reads (`/branches/:name/changes`, `/log`, `/export`).

   **The feed is derived from the store's commit logs, and its cursor holds each branch's head**
   (open question 1, decided 2026-11-12). The hub keeps no event log: every event but
   `hub.started` is a commit the store already holds, or a branch appearing in or vanishing from
   the store's list of branches. The cursor is opaque to clients and encodes the head the client
   last saw on each branch. A request lists the branches and reads each head; a branch whose head
   moved is paged back to the cursor's head for it, a branch missing from the cursor is
   `branch.created` and is paged back to a commit the cursor holds, and a branch missing from the
   list is `branch.deleted`, its commits held by another branch's log (ADR-0025 decision 6, the
   hub's delete rule). Within a branch, events follow its log; across branches they are ordered
   by timestamp, which is advisory, since the file-backed store stamps to the millisecond (check
   AQ). The cursor survives a restart because it names commits, a process-local notifier fed by
   the code paths that commit (those `queue.test.ts` lists) wakes the waiting requests, any
   identity that may read may read the feed, and it takes no filter on an author, so it offers
   nothing ADR-0021 forbids that the log does not already show; an event's author follows the
   log's rule under every profile (open question 4). The transport is long-poll; server-sent
   events wait for a client that needs lower latency (open question 3).

3. **Check runs, kept by the hub outside the design graph.** `POST /api/v1/checks/runs` records a
   verdict: `check`, `commit`, `branch`, `conclusion` (`pass`, `fail`, `neutral` or `error`), a
   `summary`, `counts`, a `paramsHash` and an optional `detailsUrl`. The hub adds the reporter (the
   caller), the time and an identifier. `GET /api/v1/checks?commit=|branch=` reads them. Runs are
   kept by the hub on both roles, bounded (the newest 50 per check and branch), and never written
   to the design graph. They are held in memory (open question 2, decided 2026-11-12): gone after
   a restart, when `hub.started` tells plugins to report again on the heads they care about.
   They are persisted when merges stalled after a restart are seen, in a second database on a
   remote and a file on a workspace hub (that question's options (c) and (b)). `paramsHash` is the SHA-256 of the requirement's `params` the plugin ran with, so a run
   made under other settings does not satisfy the requirement now in force. It is computed over a
   canonical form of the value as the hub reads it (keys sorted at every depth, no whitespace,
   numbers as JSON prints them), and the hub returns it beside `params` so that a plugin copies it
   rather than computing it: the store returns a JSON value's keys in an order of its own and
   `1.0` as `1` (check AP2b), so a hash of the text a client sent would not match.

   A run is not a design record: it is derived, recomputable at any commit, and a plugin's opinion.
   What must outlive it is what a merge relied on, which decision 7 writes into the commit graph.

4. **Who may report.** Any identity that may read a branch may post a run about it, so a person's
   own tools can annotate their work; such a run is *advisory*. A run *counts* toward a requirement
   only when its reporter is the agent the requirement names. On a remote that is a service holding
   its own credential (ADR-0067 decision 4), registered by a person as any agent is. ADR-0068's
   table gains the row **Report a required check: the agent a `CheckRequirement` names**, checked
   as the operation `report_check`. Posting a run is not a write to the graph, so ADR-0067
   decision 10 (an agent's own work reaches a remote only through a workspace hub) is not engaged.

5. **Requirements are records on `main`.** A new infrastructure class, `CheckRequirement`
   (ADR-0027 category `infrastructure`; not under `DesignRecord`, as `Grant` is not):

   | Field | Type | Notes |
   |---|---|---|
   | `check` | `xsd:string` | The check's name |
   | `branch` | `Optional<xsd:string>` | The merge target; absent means `main` |
   | `fromPrefix` | `Optional<xsd:string>` | Binds only merges whose source branch name starts with it (CoQui's `coqui-`) |
   | `reporter` | `User` | The agent whose runs count |
   | `level` | `CheckLevel`: `Required` or `Advisory` | Advisory is shown at merge and push and never refuses |
   | `locked` | `xsd:boolean` | Applies to merges into every branch, not only `branch` |
   | `params` | `sys:JSON` | Opaque to the hub; returned to plugins; hashed into `paramsHash`; any JSON value but `null`, which the store refuses for a required field (check AP2c) |
   | `status` | `GrantStatus`: `Active` or `Revoked` | Never deleted, as `Grant` |
   | `rationale` | `Optional<xsd:string>` | Why the check is required |

   Its key is a Hash over `check`, `branch` and `fromPrefix`, so there is one current requirement
   per check, target and source prefix (two Optional fields in a Hash key: check AA covered one,
   check AP covers two). Two constraints join the invariants engine: **23**, a `CheckRequirement`
   lives on `main` (`requirements_live_on_main`, as constraint 21); **24**, its `reporter` is an
   agent (`reporter_not_agent`, as constraint 22's holder-kind rule).

   **Who may write one**, rows added to ADR-0068 decision 4's table with no new role:

   | Requirement for | May write it |
   |---|---|
   | Merges into `main` | A maintainer of `main` or of every branch |
   | Merges into branch B | B's owner, or a maintainer of B or of every branch |
   | `locked: true` | An administrator |

   A requirement is written through the document routes like any record; the permission check
   judges it by the branch it names, as it judges a `Grant`. Deleting a branch revokes its
   requirements in the same marked commit that revokes its grants (ADR-0068 decision 3, later
   change). The operator's `check` gains a rule: an active requirement naming a branch the store
   lacks, or a `reporter` that is not a registered agent.

   **Layering is the plugin's.** The hub answers one question, which requirements apply to a merge
   from S into T: those naming T, those naming any branch with `locked: true`, filtered by
   `fromPrefix` against S. A plugin that wants an instance default, a branch override and a
   personal layer reads every applicable requirement's `params` (`GET /checks/requirements?target=`)
   and resolves them itself.

6. **The merge gate.** After the merge route's existing check of the merged state (ADR-0025
   decision 5) and before it commits, for every applicable `Required` requirement:

   1. The source must already contain the target's head: the merge's base is the target's head.
      Then the merged state holds the same documents as the source's head, so a verdict on that
      commit is a verdict on what will land. Otherwise 409 `bring_in_first`, the code a workspace
      hub's deliver already answers.
   2. A run by the requirement's reporter must exist at the source's head with the requirement's
      current `paramsHash`. Otherwise 409 `checks_pending`, naming the checks, so a client waits on
      the feed and asks again.
   3. That run's conclusion must be `pass` or `neutral`. Otherwise 422 `checks_failed`, naming the
      runs and their `detailsUrl`, the target unchanged.

   The merge request may carry `overrides: [{ check, reason }]`. Whoever may perform the merge may
   override an unlocked requirement; a locked one needs an administrator; a reason is required. A
   merge with no applicable requirement behaves exactly as today, without step 1. `dryRun` returns
   the same verdicts without merging.

7. **The merge commit records the verdicts.** The hub appends one trailer per applicable
   requirement, and one per override, to the merge commit's message, and refuses both names from
   clients with 400 `reserved_trailer` (ADR-0067 decision 6):

   ```
   Armature-Check: lint/team pass run=<id> params=sha256:<hash>
   Armature-Check: structure/spof fail run=<id> overridden
   Armature-Check-Override: structure/spof reason="<the reason given>"
   ```

   What the gate required when a change landed, what passed and who decided otherwise is then a
   read of the commit graph for as long as the commit exists, whatever became of the runs.

8. **The same pieces on a workspace hub, with push as the gate.** A workspace hub serves the feed
   and the run store on loopback, so a plugin on the person's machine is one more tool there,
   acting as the owner (ADR-0065 decision 7). It holds no `CheckRequirement` of its own: its `main`
   is a read-only mirror (ADR-0065 decision 3). Instead:

   - **Personal requirements** are a file, `<ARMATURE_WORKSPACE_DIR>/checks.json`, in the shape of
     the record without `reporter`, written by the host (the desktop program's Settings), never
     through a route, so a tool on loopback cannot relax its owner's gate.
   - **Push is gated** by them: before the first replay, `POST /workspace/:name/push` (and the
     program's in-process push) applies steps 2 and 3 of decision 6 to the workspace's head against
     the local runs, with the same codes. An override's reason is written as an
     `Armature-Check-Override` trailer on the first replayed commit, which the remote records as
     the pusher's claim, like `Armature-Authored-At` (ADR-0065 decision 5); the remote does not
     enforce it.
   - **Remote requirements are mirrored** with the clone and refreshed before push and deliver,
     and shown, never enforced: a local plugin may run with their `params` and post a local run
     under the same name as a preview, and deliver's existing dry run of the remote merge carries
     the remote's verdicts.

9. **No plugin blocks a single write.** Runs arrive after the commit they describe, so a write is
   never refused by a check, on either role. A rule that must hold on every write is an invariant
   and is proposed for the invariants engine by its own ADR and the two-client test. Synchronous
   checks are declined (Alternatives) and could be added later as a requirement setting without
   changing anything above.

10. **Discovery and revision.** A capability, `armature/checks`, in `GET /discover` (ADR-0059
    decision 4), with settings naming the event types served and the run store's bound. The routes
    and the merge route's new answers are one client revision in `docs/client-changes.md`.

11. **Plugins keep the non-aggregation line.** The hub stores a run's `summary` as text and neither
    indexes nor filters by it, and the feed takes no author filter. A plugin that posts runs is
    expected to report about records, never to summarize a person's work (ADR-0021); a rule such as
    "items attested only by their own author" reports the items.

12. **A diff of `params` is the store's own patch** (open question 5, decided 2026-11-12). The
    history and diff routes keep passing each store's patch through unchanged. Inside a JSON value
    the two stores' operations may differ, as a list's segmentation already may: TerminusDB
    patches a list of objects of equal length as a plain array of positional patches (check AP4).
    The reference patcher, `filestore/patch.ts`'s `applyPatch`, learns that form, a test holds it
    to AP4's patch, and `docs/api.md` says both shapes apply.

## Alternatives considered

- **Rules in the hub** (the plan's first version): a rule pack evaluated in the write pipeline and
  the merge route, over the merged state, on both roles at no extra cost. It could block single
  writes and needed no "up to date" step. Rejected (Amos, 2026-11-12): rules would ship with the
  hub's releases and the hub would carry design opinions a tool should own (Development Principle
  5).
- **Runs as records on the branch they check.** Rejected: writing one moves the head (Context 3).
- **Runs as records on `main`.** History and authorship like any record. Rejected: a commit on
  `main` for every run of every check on every branch, where grant commits already lengthen it
  (SESSION.md item 20), and reporters would need to write `main`.
- **Runs on a dedicated `_checks` branch, or a second database.** Keeps full history. Rejected for
  now: a store commit per run, and a branch or database with special rules every tool would learn
  to ignore, for history no one has asked for that the trailers do not already keep. Open question
  2 weighs a second database again as a place to persist runs, without the history.
- **The hub calls registered checks synchronously** (webhooks with an answer). Restores blocking
  and removes the wait. Declined: outbound calls in every merge (Context 4) and nothing on a laptop.
  A later requirement setting, `mode: sync`, could add it for a check that proves the need.
- **Requirements in a hub configuration file.** Rejected for the reason ADR-0068 rejected one for
  grants: authority would change with no author, reason or history.
- **A Lint-specific `LintPolicy` record holding rule settings.** Rejected by the two-client test:
  CoQui and the Structure analyzer need the same record with other settings.
- **Requirements keyed on the source branch only.** Rejected: the target is what a maintainer
  protects; `fromPrefix` covers the source-side case CoQui has.

## Open questions

Questions 1 and 2 were settled in the first draft of this record without being put to Amos;
question 5 was raised by check AP4. **Amos decided all five on 2026-11-12, each as recommended;**
the decisions are in decisions 2, 3 and 12, and the options are kept here as the record of what
was weighed.

1. **Where the event feed comes from** (decision 2).
   - *(a) Derived from the store's commit logs.* Every event but `hub.started` is a commit the
     store already holds: a branch's creation is its `Owner` grant's commit on `main` (ADR-0068
     decision 3), its deletion the marked commit revoking its grants, a requirement's change a
     commit on `main`. The cursor is a commit's time and identifier. For: nothing persisted,
     nothing to back up or to drift from the store, the same on both roles, since the file-backed
     store keeps logs too. Against: each poll reads every branch's head, which grows with the
     number of branches though not with history; and an event's details, such as the count of
     changed documents, need a diff per commit.

     *Check AQ (2026-11-12) passed on what this option rests on:* the log carries a merge's
     metadata and its one parent (AQ1); commits written in turn on three branches, read from each
     head back to a common base and taken once each, come out in the order written by timestamp
     (AQ2); a quiet poll over 25 branches is the branch listing (7 ms) and a head read per branch
     (70 to 390 ms at once over four runs), whatever the length of the history (AQ6).

     *The cursor, which the first draft left as a time and an identifier, would better be each
     branch's head.* The store stamps a commit as it lands, not as its write begins (AQ5, three
     rounds), so a time cursor did not skip a commit on the store; but the file-backed store
     stamps to the millisecond, and 191 of 200 commits written in turn on two branches of it
     shared the previous commit's stamp, so a time cannot order them. A cursor that records each
     branch's head needs no clock. A branch whose head moved is paged back to the head the cursor
     holds for it. A branch missing from the cursor is new (`branch.created`; it has no commit of
     its own until written, AQ3) and is paged back to a commit the cursor holds. A branch missing
     from the listing is deleted (`branch.deleted`). Its commits are not lost: the hub deletes only
     a branch whose head another branch's log holds, directly or as a merge's source
     (`branchHolding` in `routes/branches.ts`), so they are reached from there, though its own
     log is gone (AQ4). The order within a branch is its log's; across branches it is by
     timestamp, and advisory. The cost is a cursor about 40 bytes longer per branch, which an
     instance with hundreds of branches carries in a request body, or which the hub keeps (state
     again).
   - *(b) An event log the hub keeps.* An append-only log, a file in a workspace hub's folder and a
     volume on a remote. For: the exact order of what the hub did, cheap to read, free to carry
     events no commit records, independent of check AQ. Against: a remote hub gains durable state,
     a change to how an instance runs (a volume, its backup, a fresh-VM rehearsal by workflow rule
     5); and a crash between a commit and its append leaves the log and the store disagreeing,
     which needs a repair path.

   *Recommendation:* (a), with a cursor of branch heads, since check AQ passed; (b) if polling
   cost shows on an instance with many branches. *Decided (Amos, 2026-11-12):* (a), with a cursor
   of branch heads (decision 2).
2. **Where check runs live** (decision 3).
   - *(a) In the hub's memory, on both roles.* For: no state, no deployment change. Against: every
     restart makes plugins report again (`hub.started`), and a reporter that is down when the hub
     restarts stalls gated merges with `checks_pending` until it returns or someone overrides.
   - *(b) Persisted beside the hub:* a file in a workspace hub's folder, a volume on a remote. For:
     runs survive restarts. Against: the remote becomes stateful as in question 1 (b), with a
     retention rule to keep.
   - *(c) A second database in the remote's store server*, a file on a workspace hub. For: backed
     up with the store, no new volume. Against: a store commit per run, a second database
     ADR-0055's one adapter must learn to address, and the two roles keep runs differently.

   *Recommendation:* (a) until merges stalled after restarts are seen, then (c) on a remote and
   (b) on a workspace hub. If question 1 chooses (b), a remote already has a volume, and (b) here
   costs nothing more. *Decided (Amos, 2026-11-12):* (a), then (c) and (b) when stalled merges are
   seen (decision 3).
3. **Long-poll or server-sent events.** *Recommendation:* long-poll first, the simplest thing
   every client and proxy handles; server-sent events when a client needs lower latency.
   *Decided (Amos, 2026-11-12):* as recommended (decision 2).
4. **The feed under the `pseudonymous` profile.** An event names its author as a `User` reference,
   as the log does. *Recommendation:* the same rule the log follows under `oidc`, with no rewriting
   until an export-scoped reader of the feed exists. *Decided (Amos, 2026-11-12):* as
   recommended (decision 2).
5. **How a change to `params` reads in a diff** (raised by check AP4, 2026-11-12). The history
   and diff routes pass the store's patch through unchanged, and `docs/api.md` promises that the
   file-backed store's patches differ from the store's only in a list's segmentation, never in
   their operations (ADR-0066 decision 5). Inside a JSON value the store patches key by key, a
   list of scalars as `CopyList`, `PatchList` and `KeepList`, and a list of objects of equal
   length as a plain array of positional patches (`[{}, {"on": {...}}]`), a form the vendored
   page does not describe and `filestore/patch.ts` neither emits nor applies. No document holds a
   `sys:JSON` field today, so this is latent until `params` exists.
   - *(a) Both stores' patches stay as they are; the reference patcher learns the array form.*
     `applyPatch` applies a positional array, a test holds it to AP4's patch, and `docs/api.md`
     says that inside a JSON value the operations may differ too and both apply. For: small, and
     the hub reads no settings (decision 1). Against: two stores give two shapes for one change.
   - *(b) The file-backed store emits what the store emits inside a JSON value.* For: the
     promise kept whole. Against: an undocumented algorithm learned by probing (growth,
     shrinkage, reordering, mixed lists), and kept in step with the store's releases.
   - *(c) The hub reports a changed `sys:JSON` field as one `SwapValue` of the whole value, on
     both stores.* For: one shape, as opaque as decision 1 makes the settings. Against: the
     routes no longer pass the store's patch through unchanged, and building the swap needs the
     document at both commits, a read per entry of a history.

   *Recommendation:* (a); (b) when a client applies patches of settings. *Decided (Amos,
   2026-11-12):* (a) (decision 12).

## Verification

Before acceptance, two lettered checks in `scripts/platform_checks.js` against
`terminusdb/terminusdb-server:v12.0.7`, and their file-backed-store counterparts in
`filestore/contract.test.ts`:

| Check | Question |
|---|---|
| AP | A class with a `sys:JSON` field and a Hash key over three fields, two of them Optional: insert, replace, read, the JSON patch between two versions, and the export reloaded. The schema has no `sys:JSON` field yet, though the generator maps one (`unknown`, `z.unknown()`). |
| AQ | The logs of every branch read since a commit time, in one order, with merge commits marked and `main`'s grant and requirement commits among them: what open question 1's option (a) relies on, a feed derived from the store alone with a cursor that survives a restart. Run before question 1 is decided. |

**Run on 2026-11-12** (`node scripts/platform_checks.js`; the facts in `docs/development-plan.md`
§9, "Checks for plugins"). **AP passed:** the four key combinations are four ids, each check AI's
formula, so the file-backed store mints them unchanged (AP1); a JSON value with every type reads
back structurally equal (AP2) but not textually (AP2b, decision 3's canonical form); a replace
swaps the value whole (AP3); the class and its records survive an export reloaded (AP5); the
store's patch inside the value raised open question 5 (AP4). **AQ passed** (AQ1 to AQ3, AQ5), with
two facts recorded as information: a deleted branch's log is gone (AQ4) and what a poll costs
(AQ6); open question 1 weighs them. The file-backed store's counterparts are not in
`filestore/contract.test.ts`, whose two stores share the seed's schema, which has no `sys:JSON`
field: AP's ids are check AI's formula, which `filestore/ids.ts` already implements and tests; its
patch is open question 5; and its millisecond stamps were measured by a probe of 200 commits, not
kept. Each becomes a test with the build.

Before the build is accepted as done, the tests the plan's §16 lists, among them: the feed resumes
from a cursor after a restart and matches the logs, a branch created and one deleted between two
requests included, on both stores; `applyPatch` applies AP4's patch (decision 12); a run by the wrong reporter or with a stale
`paramsHash` does not count; every authority row failing and passing; `bring_in_first`,
`checks_pending`, `checks_failed` and an override's trailers; a client-sent `Armature-Check`
refused; a merge with no requirement unchanged; a push stopped by a personal requirement and
overridden; `checks.json` not writable through any route. The hub's tests use a fake reporter of a
few lines, never Lint, so that no hub test depends on a plugin.

## Consequences

- A plugin can stop a change reaching `main` without the hub knowing what it checks, and Lint, the
  Structure analyzer and CoQui's round check ship on their own schedules.
- What a merge relied on is in the commit graph, so the Process miner and any reader can ask which
  checks a change passed and who overrode which, and why.
- The hub gains a route family, one schema class and one enum, two constraints, two trailers, three answers
  (`checks_pending`, `checks_failed`, `bring_in_first` on the remote) and runs held in memory; it
  keeps no event log and no new volume (decisions 2 and 3), so how an instance runs is unchanged.
- Every tool can react to changes by pulling the feed, which SESSION.md item 18 lists as missing
  whether or not a gate is required.
- No check blocks a single write; a rule that must is an invariant by ADR (decision 9).
- A gated merge waits for the reporter to run, and stalls while the reporter is down; overrides
  with reasons, an administrator setting a requirement `Advisory`, or a run posted by hand under the
  reporter's credential are the ways through, each leaving a trail.
- A gated merge needs `main` brought in first. CoQui, which merges rounds directly, gains one
  bring-in before a merge into a branch with requirements.
- The workspace hub warns and the remote decides, as ADR-0068 decision 9 already holds; the
  desktop program gains a `checks.json` editor and, separately, a Tools list for launching local
  plugins (`docs/lint-plan.md` §10), a change to the program and not to this record.
