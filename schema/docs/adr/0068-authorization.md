# ADR-0068: Authorization: Who May Write, Merge and Grant, Recorded on `main`

> **In brief.** This decision answers: once the hub knows who is asking, what may they do? Today
> anyone the hub recognizes may do anything. The proposal is a small set of permissions, kept as
> records on the shared `main` branch so that every change of authority is itself a commit with an
> author and a reason: the person who creates a branch owns it and decides who else may write to
> it; only a maintainer may merge into `main`; an administrator grants the rest. Separately, it
> fixes who may be named as the author of a change: the person asking, or an AI tool working for
> them, never another person. Accepted on 2026-10-30 and not yet built.

## Status

Accepted (2026-10-30, with ADR-0065 and ADR-0067; Amos's decision after the alignment review of
that day). Proposed 2026-10-29. Nothing is built yet: it is implemented whole before the workspace
hub's push (`docs/workspace-hub-plan.md` §14), with the `Grant` class, the generated types, the
appendix and `User`'s corrected schema documentation in one commit, and the tests §Verification
names. The two open questions below stand with their recommendations. The dated notes this Status
promised are on ADR-0015, ADR-0021, ADR-0025, ADR-0032 and ADR-0065 (2026-10-30).

**Note 2026-10-30:** a prerequisite of the workspace hub (ADR-0065), built whole before its push
(`docs/workspace-hub-plan.md` §14), since push's failures depend on ownership.

**Note 2026-10-30, decided:** the check runs on a remote hub only. A workspace hub does not
authorize; it warns at workspace creation when the owner may not write the branch and leaves the
refusal to the remote's push (decision 9). An agent's own work reaches a remote only through a
workspace hub's push (decision 4's table, ADR-0067 decision 10).

Written with ADR-0067 (authentication), which says how an identity is established; this record
says what it may do. Raised by ADR-0065 (the workspace hub), whose decision 2 left branch
ownership to convention, and by the question of who may be a commit's author (discussed
2026-10-29). It changes the schema, adding one class, so on acceptance it is implemented with the
schema change, the generated types and the appendix in one commit. On acceptance it would amend or
annotate:

- **ADR-0015**, whose boundary model gives authentication to an external system and database
  access to TerminusDB, and says nothing of what a resolved identity may do through the API; it
  gains a fourth responsibility (decision 1). `User`'s schema documentation, which says Armature
  "does not manage authentication or access control", is corrected in the same commit.
- **ADR-0032 decision 4**, whose "never from the body" rule is restated for agents and relays
  (decision 5).
- **ADR-0065 decision 2**, whose ownership by convention becomes a rule the remote enforces.
- **ADR-0021**, whose non-aggregation guard is restated as applying to classes under
  `DesignRecord` (decision 8); what it protects, a person's design work, is unchanged.
- *Added 2026-10-30 by the alignment review:* **ADR-0025 decisions 4, 5 and 6**: branch creation
  gains a commit on `main` (the `Owner` grant, decision 3), "who may merge" is answered (decision
  4), and deletion is the owner's or a maintainer's and revokes the branch's grants; **ADR-0032
  decisions 3 and 6**: the first `Administrator` grant arrives as the first `User` does
  (decision 6), registering a person needs an administrator, and `GET /users/me` returns grants
  (decisions 4 and 7).

## Context

ADR-0032 decision 1 has the hub resolve identity and never authenticate; ADR-0015 leaves database
access to TerminusDB, where only the hub's own service account connects. Nothing between them
decides whether a resolved identity may do what it asks. Under the `header` resolver that gap was
harmless, because the network was the gate. Under `oidc` (ADR-0067) the hub is reachable by anyone
the identity provider knows, and "we know who you are" would mean "you may do anything".

Three clients need the same generic answer, which passes the two-client test (Development
Principle 6):

- **The workspace hub** (ADR-0065): a workspace is a branch on the remote with one owner; a write
  to it by anyone else is today discovered by a 412 on the owner's next push, not prevented.
- **The MCP server** (`docs/mcp-server-plan.md`, principle 3): agent work "lands on a branch, and
  reaches `main` only when a person merges it", which nothing enforces.
- **CoQui's review rounds**: a round is a branch; who may write to a round and who may merge it
  are questions CoQui answers in its own interface, with no rule behind it in the hub. Its outbox
  delivers a reviewer's queued decisions with no reviewer present (ADR-0067 decision 5).

Two kinds of protection need keeping apart. **Invalid content**, a change that breaks the rules,
is the write pipeline's job, with one known gap: the merge route does not run the invariants over
the merged state (`.claude/SESSION.md`, What's Next item 12). *Decided 2026-10-30: the remote
checks a merge before it commits and refuses with 422 (ADR-0025 decision 5, note).* **Unwanted but valid content**, a
change nobody with authority accepted, is what this record addresses.

On authorship, the hub can verify only the caller's credential (ADR-0067, Context). An author
other than the caller is acceptable for an agent acting for the caller, whose work the caller
answers for, and not for another person, who never consented.

## Decision

1. **The hub authorizes; it still does not authenticate.** After a request's identity is resolved
   and before the write pipeline runs, the hub checks that the identity may perform the operation,
   and answers 403 `forbidden` with the missing permission named (`{ permission: "merge", branch:
   "main" }`) when it may not. The check runs under every resolver on a remote hub; under `header`
   it guards against mistakes rather than against an attacker, and lets the tests and the demo
   exercise it. A workspace hub does not run it (decision 9). TerminusDB's access control stays
   what ADR-0015 says it is, the hub's own connection.

2. **Grants are documents on `main`.** A new infrastructure class, `Grant` (ADR-0027 category
   `infrastructure`), holds `user` (a `User`), `role` (`Owner`, `Maintainer`, `Administrator` or
   `Relay`), `branch` (Optional; absent means every branch), `status` (`Active` or `Revoked`) and
   `rationale` (Optional text). Its key is a Hash over `user`, `role` and `branch`, so there is one
   current grant per person, role and branch (an Optional field in a Hash key, check AA). Grants
   live on `main` only, like `User` documents (ADR-0032 decision 2), and are read there whatever
   branch a request touches. A grant is never deleted: revoking one is a replace with `status:
   Revoked` and a reason, so the history of who held authority, granted by whom and why, is part
   of the graph's own history. `Maintainer` and `Administrator` are held by persons only; `Relay`
   by agents only. `Grant` does not inherit `DesignRecord`, as `User` does not (ADR-0017): a grant
   is not a design decision, and cannot be the subject of a note, a finding or an attestation.

   > **Later change (2026-10-30, decided):** a `Relay` grant is narrowed by two Optional fields
   > on `Grant`, added in the same schema commit: `relayedUsers`, a Set of `User`, the people the
   > service may name as authors, absent meaning any registered person; and `expires`, a
   > dateTime after which the grant is treated as revoked. The hub checks both on a relayed write
   > (ADR-0067 decision 5), refusing with 403 `forbidden`. A compromised relay service is then
   > bounded to the people and the period an administrator named, where before it could write as
   > anyone on its branch; the `Armature-Relayed-By` trailer stays as evidence, not as the limit.
   > Neither field is in the key, so narrowing a grant is a replace. Review H1.

3. **The person who creates a branch owns it.** `POST /branches` writes an `Owner` grant for the
   caller on `main` in the same request, as a commit of its own on `main` (creating a branch makes
   none). An agent acting for a person (ADR-0067 decision 3) creates a branch its person owns; an
   agent acting on its own owns its branch. Deleting a branch revokes its grants. `main` has no
   owner. Branches created before this decision have none; an administrator assigns one, and
   until then they are writable as today.

   > **Later change (2026-10-30, decided):** three bounds, since the branch and its grant are two
   > commits on two branches and cannot be one. **Order.** Creation writes the `Owner` grant on
   > `main` first and creates the branch second; deletion revokes the grants first and deletes
   > second. A crash between the two then leaves a grant for a branch that does not exist, which
   > is harmless, rather than a branch anyone may write. **The check.** The operator's `check`
   > (ADR-0062) gains two whole-graph rules: an active grant naming a branch the store lacks, and
   > a branch with no active `Owner`; the repair is `put` on the grant, as a commit with a reason.
   > **Ownerless branches.** "Writable as today" ends with a migration window the instance's
   > administrator closes: after it, a branch with no owner is writable only by an administrator
   > or a maintainer of every branch, so a partial failure can never widen authority. A branch
   > identity in the grant beyond its name (its first commit) waits for a recreated name that
   > inherits a stale grant to be seen, which the ordering above makes unlikely. Review H2.

4. **What each operation requires.**

   | Operation | Who may |
   |---|---|
   | Read any ref | Any resolved identity (under `oidc` every request needs a token, `GET /discover` excepted: ADR-0067 decision 1) |
   | Create a branch | Any registered `User` |
   | Write to a branch, or merge into it | Its owner, or a maintainer of it or of every branch |
   | Write to `main`, or merge into it | A maintainer of `main` or of every branch |
   | Delete a branch | Its owner, or a maintainer of it |
   | Grant or revoke `Maintainer` on a branch | Its owner, or an administrator |
   | Grant or revoke any other role | An administrator |
   | Register an agent | Any person (ADR-0032 decision 7, unchanged) |
   | Register a person | An administrator; and first encounter under `oidc`, where the identity provider vouches |
   | Write as an agent (the agent the author) | Only as a workspace hub's push, the agent acting for the workspace's owner (ADR-0067 decisions 3 and 10; added 2026-10-30); a service's own credential reads |
   | Relay a person's earlier work | A service holding an active `Relay` grant (ADR-0067 decision 5); the person is the author |
   | Repair outside the rules | The operator tools, outside the API, unchanged (ADR-0062) |

   An agent acting for a person may do what the person may. A workspace's delivery into `main`
   therefore needs a maintainer: a workspace owner who is not one asks someone who is, and how
   that request is made is a client's interface, not the hub's (open question 2). An instance
   with one designer, or a team that wants no gate, grants each person `Maintainer` of `main`, so
   the gate binds only where an instance chooses it.

   > **Later change (2026-10-30, decided):** two rows change under `oidc`; under `header` nothing
   > does, since it trusts the caller and stays on loopback. *Read any ref* stays open to every
   > resolved identity, but a full export (`profile=full`) and the user list (`GET /users`;
   > `/users/me` stays everyone's own) need `Maintainer` of `main` or `Administrator`; anyone else
   > asking for `profile=full` is refused with 403 `forbidden`, and the default profile under
   > `oidc` is `pseudonymous`. Profiles transform the export a caller chooses and were never a
   > gate, which open question 1 had treated them as. *Register a person* on first encounter
   > needs the token admitted by `ARMATURE_OIDC_ADMIT` (ADR-0067 decision 1, note), else 403
   > `not_registered` until an administrator registers them. A branch-scoped `Reader` grant stays
   > deferred to open question 1's trigger. Review B7.

5. **Who may be named as an author.** Each write's author is the caller; or a registered agent
   acting for the caller (ADR-0067 decision 3), any agent whoever registered it, with the caller
   recorded in `Armature-On-Behalf-Of`; or, for a service holding an active `Relay` grant, the
   person whose earlier work it delivers, with the service recorded in `Armature-Relayed-By`
   (ADR-0067 decision 5). No other person is ever written as an author, a `createdBy` or an
   `attestedBy`. Someone who contributed without signing in is credited by the caller's
   `Co-Authored-By` claim, which the hub records as sent and vouches for no further.

6. **The first administrator comes from outside the API.** An instance's first `Administrator`
   grant is written by the seed or by the operator's `put` (ADR-0062), as its first `User` is
   (ADR-0032 decision 3). The seed grants the designer `Administrator` and `Maintainer` of every
   branch, so the demonstration runs as it does now.

7. **A caller can ask what it may do.** `GET /users/me` returns the caller's active grants, and a
   capability, `armature/authorization` (ADR-0059 decision 4; named 2026-10-30), says the hub
   authorizes, so a client can hide an action it would be refused rather than discover the 403.

8. **The non-aggregation guard covers design records, not grants.** The list route refuses a
   filter on a field naming a `User` (ADR-0021, `person_filter_refused`) so that no one lists a
   person's design work. That concern belongs to the classes under `DesignRecord`, which hold
   every such field today (`createdBy` through `ArmatureDocument`, and `Attestation.attestedBy`).
   The guard is restated as applying to classes under `DesignRecord`, and `Grant`, outside it, may
   be filtered by `user`, so an administrator can list every grant one person holds. The scope is
   drawn by inheritance, not by the `infrastructure` category, because `ArmatureDocument` is
   itself categorized `infrastructure` and a category rule would reopen `createdBy` through it. A
   test keeps both halves: a filter on `Grant.user` answers, and one on `createdBy` is still
   refused.

9. **A workspace hub does not authorize; the remote warns at creation and refuses at push**
   (added 2026-10-30). A workspace hub (ADR-0065) holds one owner and clones no `Grant`
   documents, and the operations this record governs are either refused there outright (branch
   creation, merge, deletion, registration: `remote_only`) or concern the owner's own workspaces.
   The one question it could ask locally, whether the owner may write the branch a workspace was
   cloned from, is the remote's to answer, and the remote answers it at push with 403 `forbidden`
   (ADR-0065 decision 5). So that the answer comes before the work rather than after, the
   workspace hub asks the remote at workspace creation, from the owner's grants (`GET /users/me`,
   decision 7) and the branch's (`Grant` documents on `main` filtered by `branch`, decision 8),
   and **warns** the person when they may not write it. It does not prevent the workspace: a
   person may clone a colleague's branch to read it offline, to work on it while asking for a
   `Maintainer` grant, or to carry its content into a workspace of their own. The warning is a
   feature the workspace hub builds with push (plan §14 step 3); until then a person learns at
   push.

## Alternatives considered

- **Convention only** (today). No new concept. Rejected once `oidc` exists: the hub reachable by
  anyone the provider knows, with nothing deciding what they may do.
- **Roles as claims from the identity provider** (groups). Institutions already manage them.
  Rejected as the record: outside the graph and its history, different for every provider. A
  provider's groups could later feed grants, written as commits like any other.
- **A configuration file on the hub.** Simplest. Rejected: authority would change with no author,
  reason or history, which is what Armature exists to keep.
- **TerminusDB's own users and roles, one per person.** Rejected: the store would authenticate
  people, and only the hub talks to the store (ADR-0055); the store's roles also know nothing of
  branches as workspaces or of agents.
- **Ownership by branch name** (`<user>_<name>`, Quiver's spelling). No storage. Rejected: an
  `externalId` such as an email address does not fit the branch name pattern without a mapping,
  ownership could not be transferred, and the name would be a rule nobody granted.
- **Permissions per document.** Rejected: no client needs them, and the branch is already the unit
  of work in every client (rounds, workspaces, proposal branches).
- **Only agents the caller registered may act for the caller; any registered `User` may be an
  author.** The narrow and the wide rule, both rejected (2026-10-29): the first ties an agent's use
  to who registered it, the second lets one credential write in another person's name
  (constraint 15). Decision 5 sits between them.
- **Authorizing on the workspace hub too** (rejected 2026-10-30; decision 9). It would need the
  clone to mirror `Grant` documents and keep them current, and a stale mirror could refuse what
  the remote would accept or accept what it would refuse. The check guards shared history, which
  a workspace hub never makes; the remote is where it belongs. The warning at creation gives the
  person the early answer the local check would have, without a second copy of authority.
- **Preventing a workspace of a branch the owner may not write** (rejected 2026-10-30). Reading
  is allowed to every resolved identity (decision 4), and a workspace is a way of reading offline
  as much as of writing; preventing it would take that away for nothing, since the push is where
  the refusal is enforced.

## Open questions

1. **Read permissions.** Every resolved identity may read every ref. A study's instance may want a
   branch only some may read. *Recommendation:* none until a study asks; the export's profiles and
   slices (ADR-0031) already govern what leaves an instance. *Narrowed 2026-10-30:* profiles are
   not a gate; a full export and the user list need a maintainer of `main` or an administrator,
   and first encounter needs admission (decision 4's note). Branch-scoped reading still waits for
   a study.
2. **A request for delivery.** Decision 4 leaves asking a maintainer to merge to the client. A
   branch is not a record, so no note or finding can be about one, and a "ready to deliver" mark
   stored in the graph would be a new kind of record with one client. *Recommendation:* no hub
   mechanism yet. When delivery is refused, the workspace manager shows who holds `Maintainer` of
   `main` (a read of grants, decision 8) and that the workspace is pushed and has brought in
   `main` cleanly; the owner asks a maintainer by whatever means their team uses, and the
   maintainer merges from any client. A request record enters the hub when a second client builds
   the same one; CoQui's "submit a round for merge" is the likely second.

*Resolved while drafting (2026-10-29):* listing grants by person, which the non-aggregation guard
would have refused, is decision 8.

## Verification

Check AA (an Optional field in a Hash key, verified for ADR-0028) covers `Grant`'s key. Before
acceptance: a test for every row of decision 4, failing and passing; decision 8's two tests; a contract test that a merge
into `main` by a non-maintainer is 403 and by a maintainer succeeds; a test that a client message
cannot name another person as author under any header; and the operator's `check` over a seed
with grants.

> **Note (2026-10-30):** accepted the same day with none of the above run, since nothing of this
> ADR is built. "Before acceptance" reads as "before the build": the workspace hub plan's §14
> places the whole ADR before its step 3, push, and these tests come with it.

## Consequences

- Authority over the graph is itself in the graph: who could merge into `main` at a given commit
  is a read of `Grant` documents at that commit, and every change of authority has an author and a
  reason. Research reading design process can ask who held authority, not only who acted.
- `main` gains a commit for each branch created, and every write gains one read of grants on
  `main`, cached per request.
- A new response, 403 `forbidden`, enters `docs/api.md`, and `docs/schema-guide.md` and
  `docs/client-changes.md` gain the grants and what a client does on a refusal.
- CoQui's round coordinator owns the round's branch and grants its reviewers `Maintainer` on it;
  CoQui's outbox becomes an agent with a `Relay` grant.
- Quiver and the workspace hub are unaffected on the person's machine, where the workspace hub
  holds one owner and runs no permission check (decision 9); on the remote, a workspace's owner
  is whoever created it, and its delivery needs a maintainer. A person who clones a branch they
  may not write is warned when the workspace is created and refused only at push.
- An agent's work enters shared history only through a person's workspace hub, so every agent
  commit on a remote names the person it was done for (ADR-0067 decision 10).
- The pseudonymous export profile rewrites `Grant.user` like any reference to a person
  (ADR-0031); a slice may leave grants out.
