# Changes for client tools

What changed in the Armature API (application programming interface) and schema that a client
tool must know about, newest first. Each entry says what changed, what a client does differently,
and where the detail lives. Entries are tool-neutral; where CoQui, the first plugin, has to map
something at its boundary, a **CoQui** note says how.

This file starts where CoQui's handoff stops: [`armature-asks-from-Coqui.md`](armature-asks-from-Coqui.md)
records what CoQui asked for on 2026-10-05, reading the repository at commit `3f00f40`. A client
that last synchronized with Armature at a given date reads every entry above that date.

The contract itself is the [API reference](api.md); the reasons are the
[Architecture Decision Records](../schema/docs/adr/README.md) (ADRs). This file never restates
them in full. It is updated whenever a change reaches `main` that a client would act on.

---

## 2026-11-12 · A workspace whose commits will never be pushed can be discarded: `DELETE /workspace/:name?discard=<n>`

**What changed.** A workspace hub's removal takes `discard=<n>`, the number of local commits the
caller gives up (ADR-0065 decision 6, later change of this date). Until now a workspace with
anything unpushed could not leave the machine (409 `unpushed_commits`), so one whose commits could
never reach the remote, a grant revoked, a branch deleted there, a remote that is gone, stayed for
good. A discard is this machine's alone: the remote is not asked, the answer's `remote` is
`untouched`, and `discarded` carries the commits given up and `setAside`, where the workspace's
files were copied in the hub's folder before its branch was deleted (`_discarded/<branch>.<time>`).
A number that is not the count of unpushed commits is **409** `discard_mismatch` with `unpushed`
and `stated`, and nothing is removed. It is a program action like the removal itself: a route only
where the host asks for the action routes. `@armature/client`: `workspace.remove(name, { discard })`,
and `RemoveResult` gains `untouched` and `discarded`.

**What a client does.** Nothing, unless it drives a workspace hub's actions: then it offers the
discard only behind a confirmation that names the number, sends that number, and on
`discard_mismatch` reads the status again and asks again. A client that reads a removal's `remote`
handles `untouched`. **CoQui** needs nothing: it talks to a remote hub.

## 2026-11-12 · Under `oidc`: services are listed, a domain admits only a verified email, a provider's outage is 503

**What changed.** Four things on a hub under `oidc`, from the code review of 2026-11-09 (ADR-0067
decisions 1, 4 and 5, notes of this date). No request or answer changes shape.

- **A service's client is listed.** A token is a service's only when the instance lists its client
  id (`azp`, else `client_id`) in `ARMATURE_OIDC_SERVICES` and the token carries no `name`. Until
  now any token without `name` that named a client was that client's service. A program whose client
  is not listed is refused as an unregistered person: **403** `not_registered` (or **401**
  `unknown_user` when its token is admitted), with a message naming the setting. A person's token
  without `name` is no longer taken for a service: it resolves to a person an administrator
  registered, and is otherwise refused the same way.
- **Admission by domain needs `email_verified: true`.** A token that leaves the claim out no longer
  registers a person on first sign-in by its email's domain; it is **403** `not_registered` until an
  administrator registers them, or the instance admits the provider by its issuer.
- **A provider's outage is 503, never 401.** When the identity provider's keys or metadata cannot be
  read, or answer an error, the hub answers **503** `issuer_unreachable`. A key set answering an
  error used to be **401** `invalid_token` with `reason: malformed`, and unreadable metadata a 500.
- **A relay's full export carries the users its records name,** whoever the relay names
  (`armature.users: "referenced"`); a relay naming an administrator used to receive everyone.

Also: under `oidc`, `POST /users` records the hub's issuer for a person registered without one, and
a hub refuses to start with plain `http` for its issuer, its keys or its public address outside a
rehearsal (`docs/deployment.md`, "An instance under `oidc`").

**What a client does.** A service (the viewer, a relay) asks its instance's administrator to list
its client id before the instance is updated; the compose file lists the viewer's by default. A
client that discards its token on a 401 keeps it on a 503 and tries again: the token was not judged.
A client that reads a relayed full export expects only the users the records name. A workspace hub
at this revision speaks it to its remote, so the remote is updated first.
**CoQui:** its outbox relays under its own client, so that client id goes in
`ARMATURE_OIDC_SERVICES` beside the viewer's (`ARMATURE_OIDC_SERVICES=armature-viewer,<the outbox's client>`)
on any instance it relays to; nothing changes in its requests.

## 2026-11-07 · A workspace can be removed: `DELETE /workspace/:name`

**What changed.** A workspace hub removes a workspace with `DELETE /workspace/:name`, a program action
like push, bring in and deliver: served as a route only where the host asks for the action routes
(`ARMATURE_WORKSPACE_ACTIONS=routes`), 403 `forbidden` with `reason: program_action` otherwise, and the
workspace's owner's alone. With anything left to push it is 409 `unpushed_commits`; otherwise the
workspace goes from this machine, and the hub asks the remote to delete the branch, which the remote
does when another branch holds its head, as `main` does after a delivery, and keeps otherwise as the
record of that work (ADR-0025 decision 6). The answer, `{ workspace, remote, reason? }`, says which:
`remote` is `deleted`, `kept` or `absent`, and a kept branch's `reason` is `unmerged`, `forbidden` or
`unreachable`. Until now a workspace left the machine only in a delivery with `deleteWorkspace`, so one
delivered without it, or abandoned, stayed. `@armature/client` has `workspace.remove` and the type,
`RemoveResult`. A workspace hub at this revision speaks it to its remote too, so the remote is updated
first.

**What a client does.** Nothing, unless it drives a workspace hub's actions where the host serves them
as routes: then it may remove a workspace, and reads `remote` to say whether the branch is still on the
remote. **CoQui** needs nothing: it talks to a remote hub.

## 2026-11-06 · The connection profile: `instance` in `GET /discover`; one `User` per person at first sign-in

**What changed.** `GET /discover` carries `instance`, what a person confirms before connecting: `name`
(`ARMATURE_INSTANCE_NAME`, else the host of the hub's public address, else the host the request
called it by), `api` (`ARMATURE_PUBLIC_URL`, the address a client beyond the server reaches the hub
at; read only under `oidc`, since a hub under `header` is never published, and absent otherwise) and
`program.releases`, where the desktop program comes from. Like the rest of the route it is open
without a token and holds no secret; the issuer, the audience and the client id stay in `identity`. A
workspace hub's entry is its remote's, kept at the clone in the workspace's record (`instance`, also
in `POST /workspace`'s answer), so it answers offline; it has none before its first clone, or when the
remote published none. `@armature/client` has the type, `InstanceProfile`. The viewer has a new page,
`/connect`, offering `armature://connect?remote=<address>`. Also this day, a fix: under `oidc`,
requests sent at once by a person new to the hub each registered a `User`, because the store lets
concurrent writers land at one data version (check AO). A first encounter now registers under an id
derived from `(issuer, sub)`, so they settle on one, and the insert no longer carries `If-Match`
(ADR-0032 decision 3, note of 2026-11-06).

**What a client does.** A tool that shows the person where it is connecting reads `instance.name`, and
uses `instance.api` when it has one, keeping the address it was given when it has none. Treat the
entry as optional: a hub older than this revision has none. A `User` id stays opaque. **CoQui** needs
nothing: it knows its hub's address from its own configuration.

## 2026-11-05 · A workspace hub reaches a remote under `oidc` with the owner's token; the user list by the generic route

**What changed.** A workspace hub whose remote runs under `oidc` now reaches it with the owner's
bearer token, supplied by its host (`ARMATURE_REMOTE_TOKEN` for the hub's own process, the desktop
program's sign-in later; ADR-0067 decision 2, note), and sends no `Armature-User` to the remote.
Before a workspace is made, pushed, brought in or delivered, the remote's `GET /users/me` must
resolve that token to the workspace's owner; otherwise **403** `forbidden` with `reason:
remote_identity`, `owner` and `credential`. A read a workspace hub forwards to the remote goes
through the token too. The remote's own refusals of the token (`invalid_token`, `not_registered`)
are answered as it gave them, with `remote: true`. Also this day, settling what the registry's
gate means for a clone (ADR-0068 decision 4, note of 2026-11-05; Amos): `GET /documents/User`
under `oidc` is the same read as `GET /users` and is kept the same way, for maintainers of `main`
and administrators; `GET /users?kind=agent` lists the agents, which anyone may read, and
`kind=person` the persons, kept like the whole; and `GET /export?profile=full` is served to anyone
under `oidc`, carrying every `User` for a maintainer of `main` or an administrator
(`armature.users: "all"`) and for anyone else only the users its records name, themselves and the
agents (`"referenced"`), since those are readable one by one already. A workspace hub's mirror of
`main` therefore holds the owner and the agents, no longer every person, under either resolver.
Also this day: two health probes, `GET /health/live` and `GET /health/ready` (**503** `not_ready`
with `Retry-After` while the store does not answer), open without a token under `oidc`; and an
instance under `oidc` publishes its hub beside the viewer at `api.<site>` by default
([deployment](deployment.md), "An instance under `oidc`"), so a client elsewhere reaches it with a
token. Later this day, from the Droplet run: a workspace hub refuses to clone a workspace whose base,
the remote's `ETag`, is not a bare commit identifier (**502** `remote_error`, `reason: etag_altered`,
`commit`), because a proxy in front of the remote can alter a strong `ETag` (Caddy's `encode` appends
`-gzip`), and such a base would be refused at every push; the hub's own Caddy snippet no longer
compresses. Rides this day's revision.

**What a client does.** A tool of a workspace hub sends what it always did: `Armature-User` naming
the owner and `Armature-Local-Token`; under a remote under `oidc` the owner's external identifier
is the token's `sub`. A tool that drives push treats `reason: remote_identity` as "sign in to the
remote as the owner". A tool that reads `GET /users` on a workspace hub sees the owner and the
agents. A tool that takes a full export reads `armature.users` to know whether it holds the
registry. **CoQui** is a client of a remote hub only; its reviewers' names reach it as the authors
of the records it reads, and the registry only if its service holds a maintainer's or an
administrator's grant.

## 2026-11-05 · Relays: a service delivers a person's earlier work under a `Relay` grant; the viewer holds its own credential

**What changed.** Under `oidc`, a service whose agent `User` holds an active `Relay` grant may send
`Armature-User: <person externalId>` beside its own token (ADR-0067 decision 5; ADR-0068 decision
5). The person is the author, the `createdBy` and the `attestedBy` of what is written, exactly as
if they had sent it, and the hub appends `Armature-Relayed-By: <agent externalId>` to the commit
message, a trailer it writes itself and refuses from clients. The grant bounds the relay: the
people it names in `relayedUsers` (anyone registered when absent), the branch it names (every
branch when absent), until `expires`; and a relay delivers documents only, never a branch, a
merge or a grant. Every refusal is **403** `forbidden` with `reason: relay` and `relayed` naming the
person; a person the relay names who is not registered is **401** `unknown_user`. `GET /users/me`
under a relay answers the person with `relayedBy`. Rides this day's revision. On the viewer's side,
the pages now hold a credential of their own for a hub under `oidc` (decision 4): a token as issued
in `ARMATURE_HUB_TOKEN`, or the client credentials grant from `ARMATURE_HUB_CLIENT_ID` and
`ARMATURE_HUB_CLIENT_SECRET` against the issuer `GET /discover` names, renewed before it expires.

**What a client does.** A client with an outbox registers one agent `User` for the service, asks
an administrator for a `Relay` grant naming the reviewers it drains for and the branch, and drains
with `createClient({ token: serviceToken, user: reviewerExternalId })`, one client per reviewer;
nothing changes in the writes themselves. A program with no person present and no grant reads
with its token alone. **CoQui**'s outbox is the case this was built for: its server holds the
service credential, the grant names its reviewers, and each queued decision is written with that
reviewer in `Armature-User`.

## 2026-11-05 · The `oidc` resolver: a signed token on every request, and `GET /discover` says how to sign in

**What changed.** A hub may now run under `ARMATURE_IDENTITY=oidc` (OpenID Connect; ADR-0067
decision 1 with its note of 2026-10-30, decisions 4 and 9). Under it every request but
`GET /discover` carries `Authorization: Bearer <token>`, a JSON Web Token the identity provider
signed, which the hub verifies against the provider's published keys, checking the issuer, the
audience, the expiry and the algorithm (`RS256`, `ES256` or `EdDSA`). No token is **401**
`identity_required` and a token the hub refuses is **401** `invalid_token` with `reason`
(`expired`, `audience`, `issuer`, `signature`, `algorithm`, `unknown_key`, `malformed`), both with
`WWW-Authenticate: Bearer`. A person's token resolves by `(issuer, sub)`: `sub` is the
`externalId`, and a `User` registered under `oidc` carries the new `issuer` field. First sign-in
registers a person only when the instance admits their issuer or email domain
(`ARMATURE_OIDC_ADMIT`); otherwise a valid token is **403** `not_registered` until an administrator
registers them with `POST /users`, naming `issuer`. A service's token, one issued to a program with
no person present (no `name` claim, the client in `azp` or `client_id`), resolves to the agent
`User` whose `externalId` is `agent:<client id>`, registered by a person as any agent is; it reads
and never writes (decision 10). `Armature-Agent` works beside a person's token as under `header`.
`Armature-User` beside a token is a relay's claim (decision 5) and is **403** `forbidden` with
`reason: relay` until relays are built. Two reads change under `oidc` only (ADR-0068 decision 4,
note): `GET /users` needs a maintainer of `main` or an administrator, **403** `forbidden` with
`permission: "list_users"` otherwise, and the export's default profile is `pseudonymous` (what
`profile=full` carries for anyone else is in this day's third entry, which settled it). Under `header` nothing changes. `GET /discover` gains a top-level
`identity` entry on every hub: the resolver, the headers a client may send with what each names,
and under `oidc` the `issuer`, the `audience` and the `clientId` a native program signs in with.
The hub's `OPTIONS` preflight allows `Authorization`. An issuer whose keys cannot be read is
**503** `issuer_unreachable`.

**What a client does.** Reads `GET /discover` first: `identity.resolver` says whether to send
`Armature-User` (`header`) or a bearer token (`oidc`), and under `oidc` the `issuer`, `audience`
and `clientId` to sign in with. A client of an `oidc` hub sends the token on every call and leaves
`Armature-User` unset (`createClient({ token })`, a string or a function returning the current
one), asks for `profile=full` only when it holds the grant, and treats **403** `not_registered` as
"ask an administrator". A program with no person present holds its own credential and reads.
**CoQui** sends nothing new until its hub runs under `oidc`; then its server-side client holds a
token for the reviewer who signed in, and its outbox waits for relays (decision 5).

## 2026-11-03 · A write to a workspace hub carries its local token; push, bring in and deliver are the program's

**What changed.** A workspace hub, the hub on a person's own machine (ADR-0065), now requires its
per-launch secret on every request that is not a read: `Armature-Local-Token: <value>`, checked
before identity, and a write without it or with another value is **403** `forbidden` with
`reason: local_token` (ADR-0065 decision 7, the note of 2026-10-30, built on the hub's side this
day). The desktop program, when it exists, draws the value at each start and hands it to the tools
it launches as `ARMATURE_LOCAL_TOKEN`; until then the hub's own process draws and prints it at
start, or takes `ARMATURE_LOCAL_TOKEN`. Reads need nothing, and a remote hub neither requires nor
reads the header. `GET /discover` says `localToken: required` under `armature/workspace`. The three
action routes, `POST /workspace/:name/push`, `/bring-in` and `/deliver`, are the desktop program's
own actions: a workspace hub serves them only when started with `ARMATURE_WORKSPACE_ACTIONS=routes`
(the `workspace` compose profile does) and otherwise answers **403** `forbidden` with `reason:
program_action`; `GET /discover` says which under `actions` (`routes` or `program`). Rides this
day's revision, since a workspace hub had no client at a distance yet; the first client to send the
header is `@armature/client`'s `localToken` option.

**What a client does.** A tool that writes to a workspace hub reads `ARMATURE_LOCAL_TOKEN` from its
environment when the program launched it, or asks the person to paste the value the program shows,
and sends it as `Armature-Local-Token` on every request (`createClient({ localToken })` does). It
does not push: that is the person's action in the program. **CoQui** is a client of a remote hub
only and sends nothing new.

## 2026-11-03 · A workspace hub names a file it cannot read: 503 `store_unreadable`

**What changed.** A workspace hub whose folder holds a file the operating system refuses to read,
such as a commit file a sync service (OneDrive with Files On-Demand) has made cloud-only while the
service is stopped or the machine offline, answered **500** `internal_error` on every request until
it was restarted. It now answers **503** `store_unreadable` with `path` naming the file and
`Retry-After`, and reads its folder again on the next request, so a request after the file is back
on disk succeeds without a restart. Found by ADR-0066's rehearsal on a Windows PC (its
Verification, note of 2026-11-03); [the deployment guide](deployment.md) says to keep the folder
outside a synced directory. Also since that day, a temporary file a process killed mid-write left
behind is removed when the next hub takes the folder's lock.

*Also that day (the same revision):* inside a synced folder, Windows refuses a rename over a file
the sync client is holding for the moment it takes to upload what it was just handed; a push's
rewrite of its table after each commit met it twice and failed as **500**. A workspace hub now tries
such a rename again with a short backoff, about 2.5 seconds in all (the rehearsal's measurement:
one refusal in 280 renames, cleared 15 ms later), and only then answers **503** `store_unwritable`
with `path` and `Retry-After`; the old file stands and nothing is lost.

**What a client does.** Treats 503 `store_unreadable` and 503 `store_unwritable` as retryable and
shows the person `path`, so they can bring the file back or wait for the sync client: start the
client, go online, or mark the folder "always keep on this device". A push refused `store_unwritable`
is sent again and resumes where it stopped. **CoQui** is a client of a remote hub only and sees
none of this.

## 2026-11-02 · A workspace hub answers remote commit identifiers: snapshots, forwarding, the log past the clone

**What changed.** On a workspace hub (ADR-0065; [the reference](api.md), Workspace) a commit
identifier of the remote now works wherever a commit works. A clone holds, beyond the base, the
remote's state at each older commit a cloned record names in `asOf` (a snapshot: the remote's
full export at that commit, loaded into the hub's own store; most-referenced first within
`ARMATURE_SNAPSHOTS`, 20 by default) and the remote branch's log back to its beginning. A read
at `?ref=` naming the base, a pushed or brought-in commit, or a held snapshot is served here under
that identifier (`ETag` is the identifier asked for); one naming a commit this hub does not hold
is forwarded to the remote when it can be reached, read-only and as the caller, and is **404**
`unknown_ref` with `remote_needed: true` when it cannot. `If-Match` may name the remote identifier
of the head's counterpart. Constraints 13 and 16 and the attestation staleness read therefore
work offline against the snapshots, and `GET /branches/:name/log` on a workspace continues past the
clone with the remote's entries. `POST /workspace` answers `snapshots` and `GET
/workspace/:name/status` adds `snapshots: { budget, held, declined }`. The clone's snapshot
branches, `at.<commit>`, are left out of `GET /branches` and refuse writes (`remote_only`).
Nothing changes on a remote hub.

**What a client does differently.** A tool beside a workspace hub may keep using the commit
identifiers it read from the remote, or that a push answered, without translating; offline it
expects `remote_needed` on a read at a commit the clone does not hold, and `unknown_commit` on a
write whose `asOf` names one. **CoQui:** nothing; CoQui talks to a remote hub.

## 2026-11-01 · Authorization: grants on `main`, branch ownership, 403 `forbidden`; agents acting for people

**What changed.** A remote hub now decides what a resolved identity may do (ADR-0068, built in
full under `header`; [the reference](api.md), Grants). Authority is a new document class, `Grant`
(`user`, `role`: `Owner`, `Maintainer`, `Administrator` or `Relay`, `branch`, `status`,
`rationale`, and for a relay `relayedUsers` and `expires`), written through the document routes on
`main` only (**400** `grants_live_on_main` elsewhere, rule 21; rule 22 holds the holder's kind to
the role) and never deleted: a revocation is the same key with `status: "Revoked"`. **Whoever
creates a branch owns it:** `POST /branches` now needs an identity and writes the caller's `Owner`
grant on `main` as a commit of its own before the branch exists, and `DELETE /branches/:name`
revokes every grant naming the branch before it goes. **The check:** writing to or merging into a
branch needs its owner or a maintainer of it or of every branch; into `main`, a maintainer of
`main` or of every branch; deleting, the owner or a maintainer; granting `Maintainer` on a branch,
its owner or an administrator; any other grant, an administrator; registering a person, an
administrator, and an agent, any person. A refusal is **403** `forbidden` with `permission`
(`write`, `merge`, `delete`, `grant`, `register`) and `branch`, `role` or `agent`. A branch with no
owner stays open to every registered user while the migration window is open, which `GET
/discover` reports under the new capability `armature/authorization` as `ownerlessBranches:
"writable"`; a workspace hub does not authorize and lists no such capability. `GET /users/me`
carries the caller's `grants` in force. `Grant` may be listed by `user`; design records still never
by a person (`person_filter_refused`). The seed grants the designer `Administrator` and
`Maintainer` of every branch, so a demonstration runs as before; the reviewer holds nothing.

**Agents acting for people** (ADR-0067 decisions 3, 6 and 8). A request may carry
`Armature-Agent: <agent externalId>` beside the person's `Armature-User`: the agent is the commit's
author and `createdBy`, the person's grants decide the request, the person owns a branch the agent
creates, and the hub appends `Armature-On-Behalf-Of: <person externalId>` to the message, which
history returns byte for byte. An unregistered agent is **401** `unknown_agent`; a person named as
the agent **400** `not_an_agent`; an agent's identifier as the credential **400** `not_a_person`. A
message carrying a line that begins with `Armature-On-Behalf-Of` or `Armature-Relayed-By` is
**400** `reserved_trailer`, on every write. Naming an agent directly in `Armature-User` still works
under `header`, with no trailer, until push exists. `@armature/client` has an `agent` option, and
`users.me()` returns the grants. The pseudonymous export rewrites `Grant.user`, `relayedUsers` and a
handle prefix in `Grant.branch`. Riding today's revision.

**A branch's commit log** (same day, later): `GET /branches/:name/log?start=&count=` lists a
branch's commits newest first, paged by 20 up to 100, each in the head's form, read at the head
`ETag` names, messages as stored with their trailers ([the reference](api.md), Branches). The
workspace hub plan's §12 asked for it: a clone's history list, the research path's process reads,
and push recovery after a crash. `@armature/client` has `branches.log()`. Riding today's revision.

**Push, the workspace hub's step 3** (same day, evening): `POST /workspace/:name/push` replays a
workspace's local commits on its remote as the owner, through the remote's own `POST /documents`
with `If-Match`, each message ending in `Armature-Workspace-Commit` and `Armature-Authored-At`
(and `Armature-Workspace-Part` when a commit was split across requests), every `asOf` rewritten
from the local commit to the remote one, a commit by an agent sent as the agent acting for the
owner; it stops with the remote's **403**, **412** or **422**, carrying `pushed` and `at`, and a
412 says what `moved`. `POST /workspace` with `existing` adds a `warning` when the remote would
refuse the owner's push (ADR-0068 decision 9), and status carries `pushed` and `unpushed`. On a
workspace hub a workspace is written and pushed by its owner alone (**403** `forbidden` with
`owner`). **On a remote hub an agent as the credential itself no longer writes** (**403**
`forbidden` with `credential`; ADR-0067 decision 10, now built): it reads, and its own work
arrives as a workspace hub's push. **A write without `If-Match` that loses its race to a commit
changing a document it replaces is now 409 `document_moved`**, with the documents, rather than a
rerun that overwrites them (ADR-0025 decision 7, note). `@armature/client` has `workspace.push()`
and `branches.log()`. Riding today's revision ([the reference](api.md), Workspace and Optimistic
concurrency; `docs/workspace-hub-plan.md` §5).

**Bring in and deliver, the workspace hub's step 4, and the merge checked before it commits**
(same day, night): `POST /branches/:name/merge` now applies the source onto a transient branch
cut at the target's head and runs every rule over the result before anything lands, so a merge
whose result would break a rule is **422** `invariant_violation` with `violations`, the target
unchanged (ADR-0025 decision 5, note; the gap of 2026-10-26 is closed); `dryRun: true` answers
**200** with `conflicts` and `violations` and commits nothing; `If-Match` pins the target head
(**412**); a target that moved during the check is **409** `branch_moved`. On a workspace hub,
`POST /workspace/:name/bring-in` is the remote's merge of `main` into the workspace, read back as
one local commit (**409** `unpushed_commits` first; the remote's conflict as given), and
`POST /workspace/:name/deliver` the remote's merge of the workspace into `main` after `main` was
brought in cleanly (**409** `bring_in_first`), with `deleteWorkspace` to remove it there and here.
`@armature/client`: `branches.merge()` takes `dryRun` and `ifMatch`, `MergeResult` gains the
dry-run fields, `workspace.bringIn()` and `workspace.deliver()`. Riding today's revision ([the
reference](api.md), Branches and Workspace; `docs/workspace-hub-plan.md` §4 and §6).

**What a client does.** Send `Armature-User` on `POST /branches`. Expect **403** `forbidden` on a
write, merge, delete, grant or registration the caller may not make, and show who holds the grant
rather than retrying as someone else; read `users.me().grants` to hide what would be refused. A
tool that lets one person write to another's branch has that person's owner, or an administrator,
write a `Maintainer` grant first. A tool with an AI agent moves it from `Armature-User` to the
`agent` option, with the person in `user`. **CoQui:** its round coordinator owns the round's branch
(the creator of `coqui-<roundId>`) and grants each reviewer `Maintainer` on it before the round
opens; `main` takes a maintainer's merge; its outbox becomes a `Relay` grant when relays are built.
A tool that named an agent directly in `Armature-User` to write now sends the `agent` option with
a person in `user`, or writes through a workspace hub. A tool that replaces documents without
`If-Match` handles **409** `document_moved` as it would a 412: read the document again, then write
with `If-Match`; one that sends `If-Match` never sees it. A tool that merges expects **422** from
the merge route as it does from a write, and may preview with `dryRun`. **CoQui:** its outbox
replaces items by id; where it sends no `If-Match`, a `document_moved` means another reviewer's
edit to the same item landed first, to be shown, not overwritten; a round's merge into `main` may
now be refused for a rule the round's items break together, which the dry run shows before the
round closes.
**Quiver:** its drafter and lint agents send the owner in `Armature-User` and the agent in
`Armature-Agent`; a workspace's owner is whoever created it on the remote.

## 2026-11-01 · Workspaces: create, clone, status

**What changed.** A workspace hub serves three routes under a new capability,
`armature/workspace`, which only a workspace hub lists and accepts (a remote hub answers the routes
with **400** `workspace_only` and refuses the capability by name). `POST /workspace` with
`{ name, from? }` creates the branch `<handle>_<name>` on the remote from `from` (`main` by
default; `<handle>` is the caller's external identifier before the `@`) and clones it; with
`{ existing }` it clones a branch the remote already has. Either way the workspace hub first
mirrors the remote's `main` (its schema and its `User` documents), then loads the branch's export
at its head, the *base*, and answers **201** with the workspace's record: `branch`, `remote`,
`owner`, `ownerExternalId`, `from` (when it created the branch), `base`, `local` (the local commit
holding the clone) and `clonedAt`. `GET /workspace` lists the records. `GET
/workspace/:name/status` answers the record, the local `head`, `localCommits` since the clone, and
the remote branch's head with `moved`, or `{ reachable: false }` when the remote cannot be reached.
A refusal from the remote comes back with the remote's own status and code and `remote: true`; a
remote that cannot be reached is **502** `remote_unreachable`. A second workspace of the same
branch is **409** `workspace_exists`. `@armature/client` has `workspace.list`, `create` and
`status`. Riding today's revision.

**What a client does.** Nothing, against a remote hub. A tool that offers workspaces checks for
`armature/workspace` in `GET /discover`, creates or lists them here, and writes to the workspace's
branch as to any branch; `main` stays read-only. Push, bring in and deliver are not routes a tool
calls (ADR-0065 decision 7, note). **CoQui:** nothing. **Quiver:** the routes its workspace
manager will call, once resumed.

> **Note (2026-11-08):** `<handle>` is now the local part of the caller's email as the remote
> records it, and the external identifier's only when the record has no email; under `oidc` the
> external identifier is the provider's `sub`, which made branch names unreadable (ADR-0065, note
> of that date). Not a revision: a client reads the branch from the reply and never derives it, and
> under `header`, where the email is the identifier, no name changes. **CoQui:** nothing.
> **Quiver:** take the branch from the reply, as its plan already does.

## 2026-11-01 · A hub's role in discovery; `remote_only`

**What changed.** A hub now has a role, `remote` (every hub so far) or `workspace`: the same
API in workspace mode on one person's machine (ADR-0065; [workspace hub plan](workspace-hub-plan.md)
§9, step 2). `GET /discover` names it in a new top-level `role`, and says what the role refuses:
`armature/branches` and `armature/users` carry `remoteOnly`, the routes the hub answers with
**400** `remote_only` (on a workspace hub: creating, merging and deleting a branch, and
registering a user), and `armature/documents` carries `readOnlyBranches`, the branches it serves
only for reading (on a workspace hub, `main`, the remote's mirrored; a write there is also
`remote_only`). On a remote hub both lists are empty and nothing else changes. A workspace hub
never registers a person: an unknown identity is **401** `unknown_user`, to be registered on the
remote. `@armature/client`'s `Discovery` type has `role`, and `CLIENT_REVISION` is this revision.
The workspace routes themselves (create, clone, status) come next; until then a workspace hub
exists only in the tests.

**What a client does.** Nothing, against a remote hub. A tool that may meet a workspace hub reads
`role` and the two lists from `GET /discover` rather than assuming a route is served, and treats
`remote_only` as "do this on the remote", never as a failure to retry. **CoQui:** nothing; it
talks to a remote hub. **Quiver:** the code its workspace manager will branch on.

## 2026-10-31 · Stricter requests, deadlines and ancestry

**What changed.** The deep review's confirmed small fixes (SESSION What's Next item 28), riding
today's revision. `If-Match: *` is refused with **400** `bad_if_match` instead of being read as no
condition. Numeric and boolean query values must be in their exact forms (digits, an optional
sign and fraction, `true` or `false`); `?sequence=1e1`, `?randomize=yes`, `?count=1e1` and
`?diff=maybe` are now **400** `bad_query` rather than coerced. A request body over 10 MiB is
**413** `body_too_large`. `GET /branches/:name/changes?since=` requires `since` to be in the
branch's history, its log or a merge into it followed back, else **400** `not_an_ancestor`. A
history longer than the 5,000 commits the hub walks is **500** `history_too_long` (the changes
route, a merge, a branch delete) instead of being read as a shorter one, which made a merge
report `no_common_ancestor`. The hub gives up on the database after 30 seconds with **504**
`store_timeout`. `@armature/client` takes `signal` and `timeout` options that apply to every call
(no default deadline, no retry).

**What a client does.** Send a commit in `If-Match`, or none. Send query values in their exact
forms. Treat `store_timeout` on a write like a dropped connection: re-read before retrying, since
the write may have landed. A changes read since a commit from another branch now fails rather
than returning a diff between unrelated states. **CoQui:** nothing it sends today is refused;
consider `timeout` on its client. **Quiver:** its bring-in reads changes since its base, which is
on the workspace branch's log, so nothing changes.

## 2026-10-31 · Reads and writes at one commit

**What changed.** A write is checked and committed at one commit (the deep review's B2). The
hub captures the branch head when the write begins, checks the write's rules against the branch
at that commit, and sends that commit to the store as the write's condition, so two writers who
each pass a rule alone (two placements at one `sequence`) can no longer land together. A write
**without** `If-Match` that loses a race to another commit is run again, whole, on the new head,
up to three runs; if the branch moves under every run the answer is **409** `branch_moved` and
nothing is written. A write **with** `If-Match` that is not the head is now refused with **412**
before its rules are checked, so a stale `If-Match` outranks `type_conflict` and
`invariant_violation`. A read that reads the store more than once (every intelligence read, the
export) resolves a branch to its head once and reads everything at that commit, its `ETag` (B1).
`GET /documents/:type/:id/history` serves only an answer read with the head standing still around
it, and answers **503** `branch_busy` with `Retry-After: 1` if the head moved around three reads
in a row. Also a fix with no revision of its own: `POST /branches` from a `from` branch that does
not exist answers **404** `unknown_ref`, as the error table promised, not **409**
`branch_exists`. `@armature/client`'s `CLIENT_REVISION` is this revision.

**What a client does.** Treat `branch_moved` on a write like a 412: re-read and decide again;
it is rare, since the hub has already retried. Back off on `branch_busy` for the `Retry-After`
seconds. A client that shows several responses together (a page reading the export, then the
coverage, then the trace) reads the later ones at the first one's `ETag` with `?ref=` so they
describe one commit; the viewer now does. **CoQui:** its writes send no `If-Match`, so they are
the ones the hub retries; map `branch_moved` onto its existing retry for a 412. **Quiver:**
nothing until it resumes; its push already sends `If-Match`.

## 2026-10-30 · The hub refuses hosts and web origins it does not serve

**What changed.** Every hub checks two request headers before anything else runs (ADR-0067
decision 7). A request whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or a name under
`.localhost` (any port), or a name listed in `ARMATURE_ALLOWED_HOSTS`, is refused with **403**
`host_not_allowed`. A request carrying an `Origin` header is refused with **403**
`origin_not_allowed` when the origin is a remote web origin (`http` or `https` on a name other
than a loopback one) that `ARMATURE_ALLOWED_ORIGINS` does not list, or `null`. A loopback origin
and a non-web scheme (`tauri://localhost`, which Tauri's HTTP plugin sends on every request) are
served. Only a listed origin gets CORS (cross-origin resource sharing) answers: a preflight, and
`Access-Control-Allow-Origin` with `ETag` and `Armature-Version` exposed on every response,
refusals included. This closes DNS rebinding, a web page reaching a hub on its reader's machine
under the trusted `header` resolver. `@armature/client`'s `CLIENT_REVISION` is this revision.

**What a client does.** A tool outside a browser, calling a hub by a loopback name, does
nothing: it sends no `Origin`, or a desktop shell's. One that calls a hub by another name (the
compose network's `hub`, a server's own name) needs that name in the hub's
`ARMATURE_ALLOWED_HOSTS`; the compose file sets `hub`. A page in a browser that calls a hub
directly needs its origin in `ARMATURE_ALLOWED_ORIGINS`. **CoQui:** nothing, since its server
calls `http://hub:3100` with no `Origin` and the compose file allows `hub`. **Quiver:** nothing;
its Tauri origin is served.

## 2026-10-22 · `ActivityGroup` is `Lesson`

**What changed.** The ordered set of activities a module schedules is the class `Lesson`
(ADR-0064), the peer of an `Assessment`; it was `ActivityGroup`. Its two links are renamed
with it: `LessonActivityLink` (fields `lesson`, `activity`, `sequence`; Hash key over
`(lesson, activity)`) replaces `ActivityGroupMember`, and `ModuleLessonLink` (fields `module`,
`lesson`, `sequence`; Hash key over `(module, lesson)`) replaces `ModuleActivityGroupLink`.
Constraints 3, 4 and 6 keep their numbers and meaning. The module-content read says
`kind: "lesson"`, names the record in `lesson` and counts `summary.lessons`; `@armature/client`'s
`ModuleContentEntry` and `ModuleContentReport` follow. Same revision as the entries below.

**What a client does.** One that writes or reads activities in sequence uses the new class
and field names; a document naming the old classes is refused as an unknown type. One that
reads the module-content view reads `kind === 'lesson'` and `entry.lesson`. At demonstration
scale the store is reloaded (`load_schema.js --clear-instances`, then the seed); for real data
the rename is operator work (ADR-0064 § Platform checks). **CoQui:** nothing; it never writes
activities or lessons.

## 2026-10-22 · A module's content in teaching order

**What changed.** `GET /api/v1/intelligence/module-content/:moduleId` returns a module's
activities and groups merged by `sequence`, each group's members in their order, and each
activity's formative items (`ActivityItemLink`) in theirs, at any ref (ADR-0005). Each entry has
`kind` (`activity` or `group`) and the `link` that placed it; an entry without a `sequence` comes
last. An activity placed more than once in the module appears at every placement and is named in
`repeated`. Capability `armature/intelligence.module-content`; `@armature/client` adds
`intelligence.moduleContent()`. Same revision as the entry below: the capability is what a client
declares to find out whether a hub has the read.

**What a client does.** Nothing unless it shows or exports a module's activities. One that does
reads this instead of listing `ModuleActivityLink`, `ModuleActivityGroupLink`,
`ActivityGroupMember` and `ActivityItemLink` and sorting them itself. A client that assumed one
node per activity keys its nodes by `link` instead.

**CoQui.** Nothing: CoQui reviews items, not module content. An item's formative uses remain in
the trace and impact reads.

## 2026-10-22 · Item statistics in one read

**What changed.** `GET /api/v1/intelligence/item-statistics` returns the item statistics in the
bank, or with `?module=` in a module's assessments: each item with every `LearningMetric` whose
`subject` is that item, newest administration first, each with its value, unit, `asOf` and the
dataset it came from (cohort, administration date). `?unit=` keeps one unit; `units` lists those
in scope; items with no statistic are listed apart. It summarizes nothing: which figure counts as
an item's difficulty (latest, one cohort, across cohorts) is the client's choice (ADR-0058,
decision 3, whose form the viewer's Coverage View decided). Capability
`armature/intelligence.item-statistics`; `@armature/client` adds `intelligence.itemStatistics()`
and sends this revision.

**What a client does.** Nothing unless it shows item performance. One that does reads this
instead of listing `LearningMetric?subject=` once per item, and takes the first statistic for "the
latest administration" or filters by `dataset` for one cohort.

**CoQui.** An item's performance beside its findings is
`itemStatistics({ module })` filtered to the item under review, or the per-item list route as
before.

## 2026-10-21 · The hub runs as its own process and container

**What changed.** Nothing in the contract. The API is served by a standalone Node process
(`npm run build:hub && npm run start:hub` in `app/`, port 3100) and by a container
(`docker compose --profile hub up` in `docker/`, port 3100); a running API in front of a store is
a hub. The Next.js app on port 3000 no longer serves the API: it is the viewer, a client of a hub
through `@armature/client` like any plugin, and has its own container. A hosted instance is the
compose file's three containers with only the viewer public (`deployment.md`).

**What a client does.** Point at the hub, port 3100 locally, not at the Next.js address; make the
base address configuration if it was not already. `@armature/client` takes it as `baseUrl`.

**CoQui.** When an instance is hosted, its address replaces the recorded hub, which becomes the
fallback; until then nothing changes.

## 2026-10-21 · The version contract: `Armature-Version`, `Armature-Capabilities`, `GET /discover`, `GET /schema` (ADR-0059)

**What changed.** The contract has dated revisions: every dated entry of this file is one, and
this hub serves all of them (they are additive). A request may name the revision it was written
against in `Armature-Version`; a revision the hub does not serve is refused with 400
`unsupported_version` listing `supported`, except that a *newer* revision is served on a read and
refused on a write (so a client ahead of a hub can still look, and stops before its first commit).
Every response carries `Armature-Version` saying which revision served it. A request may declare
the capabilities it relies on in `Armature-Capabilities` (`armature/documents`,
`armature/intelligence.coverage`, …); one the hub lacks is 400 `unsupported_capability` naming it.
`GET /discover` lists the revisions, the capabilities with their settings (the coverage
thresholds, the batch limit) and where the schema is; `GET /schema?branch=|ref=` returns the
schema graph at a ref in the form the store reloads, the route ADR-0027 scheduled in Phase 1.
Both headers are optional: a client that sends neither is served as before.

**What a client does.** Nothing, to keep working. To fail early and by name, send
`Armature-Version` with the date of the entry it last read here, and `Armature-Capabilities` with
what it relies on; or call `GET /discover` first. Read `Armature-Version` from responses to know
which revision a hub is at. Discover types from `GET /schema` instead of a copy of `schema.json`.

**CoQui.** `@armature/client` sends `Armature-Version` on every call (`CLIENT_REVISION`) and
returns the response header as `version`; CoQui's own version check can read that, or go.

---

## 2026-10-21 · A typed client over every route (`@armature/client`)

**What changed.** `packages/client` is a workspace package, `@armature/client`, with one function
per `/api/v1` route in the reference's five groups (`documents`, `branches`, `users`,
`intelligence`, `export`). Every call returns `{ data, commit }`, the commit read from the
`ETag`; a read takes `{ branch }` or `{ ref }`; a write takes `message`, `branch` and an optional
`ifMatch` that becomes `If-Match`; the `user` given to `createClient` is sent as `Armature-User`;
a non-2xx answer throws `HubError` with the hub's `status`, stable `code`, `message` and the
body's other fields as `details`. Reads are typed by class name through `ClassMap`, new in
`@armature/types`. The client takes a `fetch`, so a plugin's tests can run it over a Hono app
in-process; the hub's own contract test does (`app/lib/api/client.test.ts`). No route changed.

**What a client does.** Install by git reference (pnpm:
`github:mossglenn/armature#path:packages/client`) and call the functions instead of building
URLs, headers and envelopes by hand. The client sends no `Armature-Version` header yet; ADR-0059
(Proposed) is the next unit, and the hub serves its current revision to a request without one.

**CoQui.** `httpHub` becomes a consumer of this package rather than a reimplementation of the
routes (plan Phase 7); its own version check can read `Armature-Version` from responses once
ADR-0059 lands, or be replaced by the client's.

---

## 2026-10-21 · The schema's types are an installable package (`@armature/types`)

**What changed.** The generated TypeScript interfaces, the schema as data (`CLASS_FIELDS`,
`CLASS_KEY`, `CLASS_ANCESTORS`, `CLASS_CATEGORY`) and the Zod request schemas moved from
`app/lib/` into `packages/types`, a workspace package named `@armature/types`, exporting `.`
(types and schema data) and `./schemas` (the request schemas the write routes check a body
with). It ships TypeScript source and no build, so a bundler compiles it with the code that
imports it. Nothing in the API or the schema changed; the 145-test contract suite now also runs
in CI against a TerminusDB service container on every change.

**What a client does.** Install the package by git reference instead of copying `types.ts`
(pnpm: `github:mossglenn/armature#path:packages/types`), and validate a body with the same Zod
schema the hub will apply before sending it. A client that copied the file keeps working; the
copy just no longer tracks the schema.

**CoQui.** CoQui's `types.ts` ("the target schema", its PR 3) can become an import of
`@armature/types`; the typed client over the routes (the next Phase 7 piece) will depend on it.

---

## 2026-10-20 · Outcome records name their source (ADR-0063)

**What changed.** A `LearningDataset` must carry `producedBy` (the `Assessment` whose
administration produced it) or at least one `externalRef`; a `LearningMetric` must carry
`derivedFrom` or at least one `externalRef`. Neither: 422 `dataset_without_source` or
`metric_without_source` (rule 20). This replaces the rule the schema documentation had carried as
"planned" since Phase 1. The seed now holds one administration (a dataset and three metrics), so
Narrative 1 runs on `main`.

**What a client does.**

- **An importer names the source of every dataset and metric it writes.** Results of an Armature
  assessment: `producedBy`. Results from elsewhere: an `ExternalRef` (`system: "xAPI"` or
  `"Other"`, the identifier the source uses). A metric derived from a dataset needs nothing more.
- **A benchmark or third-party figure** is a metric with an `externalRef` and no `derivedFrom`.

**CoQui:** no change. **Outcomes importer** (planned): maps the LMS activity or export id onto the
dataset's `externalRefs` beside `producedBy`.

Detail: ADR-0063; the API reference's rules table (rule 20).

---

## 2026-10-20 · Export profiles and schema slices (ADR-0031)

**What changed.** A new read, `GET /api/v1/export?branch=|ref=&profile=&slice=`, returns the
graph at a ref as one JSON-LD document: the store's `@context`, the schema as it can be reloaded,
and the documents of the slice under the profile, with the commit in `ETag` and in `armature.ref`.
Profiles: `full`, `pseudonymous` (every `User` a stable token, every reference to one rewritten,
nothing else about the person), `institutional` (the token plus `institution`). Slices are a
configuration (`GET /api/v1/export/slices`): `full`, `outcomes-loop`, `review`. References that
leave a slice are listed in `armature.unresolved`, never dropped from a document.

**What a client does.**

- **An exporter plugin reads the whole graph at a commit in one request**, instead of walking the
  list routes; `armature.ref` is the commit to stamp into whatever it produces (ADR-0057).
- **A research exporter asks for `profile=pseudonymous`** and, where the deployment has set
  `ARMATURE_EXPORT_KEY`, gets tokens that are the same across exports (`pseudonyms: "stable"`).
  It does not scrub free text; that is the exporter's job if it matters to the study.
- **A study declares its slice** as a list of class names in `app/lib/api/export/slices.json`, by
  pull request, not by code.
- **Nothing imports through the API.** Reproducing an export is an operator step: load `schema`,
  post `documents` (ADR-0062).

**CoQui:** no change. **text2qti exporter** (planned, outside this repository): reads
`GET /api/v1/export?ref=<commit>` and emits from `documents`.

Detail: ADR-0031; the API reference's Export section.

---

## 2026-10-20 · External references and attachments (ADR-0030)

**What changed.** Every artifact (every type inheriting `ArmatureDocument`) may carry two new
optional sets of embedded records: `externalRefs`, identifiers in other systems
(`{ "@type": "ExternalRef", "system": "CASE" | "QTI" | "xAPI" | "LTI" | "Other", "identifier", "label"? }`),
and `attachments`, verifiable references to bytes or to a revision of a tree of bytes in a store the
hub may or may not operate (`{ "@type": "Attachment", "store": "S3" | "Lore" | "Git" | "Other",
"storeUri", "contentHash", "hashAlgorithm", "revision"?, "path"?, "container"?, "mediaType"?,
"byteSize"?, "role"?, "label"? }`). Every fragment (a stem, an option, a feedback) may carry
`attachments` too, and `Fragment.text` is now optional. Two rules: an attachment in a `Git` or
`Lore` store names a `revision`, and `contentHash` has the length its `hashAlgorithm` implies
(422 `revision_required`, `hash_malformed`, rule 18); a fragment carries text or at least one
attachment (422 `empty_fragment`, rule 19). Rule 9 now checks option text for uniqueness only where
present. The graph never holds bytes, and the hub does not fetch or verify them.

**What a client does.**

- **Guard `fragment.text`.** It may be absent on a part that is a picture or a clip; render the
  attachment instead. Treat an absent `externalRefs` or `attachments` as empty, as for `assesses`.
- **Send attachments and references inline**, inside the record, with their `@type`. Never store
  their nested `@id`; it regenerates on every replace.
- **Name the hash algorithm as the IANA registry does** (`sha-256`, `sha-1`, `md5`); give a
  `revision` for a versioned store. A store or algorithm the hub does not know is accepted as
  written.
- **Expect staleness.** Writing a new `contentHash` or `revision` on a fragment's attachment is a
  change to that part: attestations on it report `Stale`, as after a text edit.
- **A text-less option that used to be 400 is now 422** `empty_fragment` with the fragment named,
  unless it carries an attachment.

**CoQui:** no change until it shows media options; a CoQui item that imports with a picture choice
maps the picture onto an `Attachment` on the option and leaves `text` out. **Curriculum mappers and
importers:** a CASE competency, a QTI source or an xAPI activity goes in `externalRefs`.

Detail: ADR-0030; the API reference's rules table (rules 9, 18, 19) and its documents section;
`docs/schema-guide.md` §4.12.

---

## 2026-10-20 · Formative use of items inside activities (ADR-0061)

**What changed.** A new relationship record, `ActivityItemLink`, records that a `LearningActivity`
uses an `AssessmentItem` formatively: a poll in a lecture, a question on a content page, a
practice set. Fields: `activity`, `item`, optional `sequence`. The identifier is derived from
`(activity, item)`. It carries no points, no clearance and no verdict, and counts toward no
coverage. The trace read follows an item downstream to the activities that use it, and shows an
activity with the modules it is placed in; the impact read reaches a use through its `item`.

**What a client does.**

- **Write a use through `POST /api/v1/documents` without an `@id`**, as for any Hash-keyed record.
  Writing the same activity and item again replaces the use (for example to reorder it).
- **Give `sequence` only when the activity orders its items.** Within one activity two uses may not
  share a `sequence` (422 `duplicate_sequence`, rule 17). It is independent of every module and
  group sequence.
- **Do not use it for a graded test.** An assessment with points and clearance is an `Assessment`
  with `ItemInstance` placements, as before. Those are what coverage counts.
- **Look in two places for where an item is used:** `ItemInstance` for placements and
  `ActivityItemLink` for formative uses, or read `GET /api/v1/intelligence/impact/AssessmentItem/:id`,
  which lists both.

**CoQui:** no change; CoQui reviews items, not their uses. **QuiQui and Tessera** (mapped in
`docs/research/`): a live poll and a question on a content page map onto this record.

Detail: ADR-0061; the API reference's rules table (rule 17) and trace section.

---

## 2026-10-20 · Items may exist unaligned (ADR-0060)

**What changed.** `AssessmentItem.assesses` no longer needs at least one objective. A write with
`assesses: []`, or with no `assesses` field, is accepted. The alignment read,
`GET /api/v1/intelligence/alignment`, gains `itemsWithoutObjective`: every item that assesses
nothing, or, with `module`, those placed in the module's assessments. `LearningActivity.targets`
still needs at least one objective.

**What a client does.**

- **Import or draft items before aligning them.** An adapter for a bank whose questions are not yet
  aligned writes them as they are; it never mints a placeholder objective.
- **Guard reads of `assesses`.** The database returns no field for an empty set, so an item read
  back may lack `assesses` altogether. Treat an absent field as an empty list.
- **Show the gap.** `itemsWithoutObjective` is the bank's list of unaligned items at any ref; a
  review or mapping tool can surface it as work to do. Nothing in the hub blocks an unaligned item
  from being `Approved` or placed; whether anything should is open (`docs/development-plan.md` §6).

**CoQui:** no change. Its items arrive from Armature already aligned. If it ever reads an item
written by another tool, it treats a missing `assesses` as none.

Detail: ADR-0060; the API reference's rules table (rule 1 retired) and alignment section.

---

## 2026-10-18 · Attestations (ADR-0028; PR #16)

**What changed.** A new record type, `Attestation`: one person's verdict, `Affirmed` or
`Declined`, about a design record or one part of it, as of a commit. A new read,
`GET /api/v1/intelligence/attestations/:type/:id`, reports whether each verdict still holds. An
optional `fragmentId` on `DesignNote` and `DesignFinding` lets notes and findings point at one part.

**What a client does.**

- **Write attestations through `POST /api/v1/documents` without an `@id`.** The hub derives the
  identifier from `subject`, `fragmentId`, `claimRef` and `attestedBy`. Writing the same four again
  replaces the verdict; a supplied `@id` is a 400 `bad_id`.
- **Send a claim whole or not at all.** `claimRef` (an identifier your tool chooses for the claim
  and its lineage, kept when the wording changes) and `claimText` (the wording) come together, or
  neither for a plain endorsement of the record. Half a claim is a 422 `claim_incomplete`.
- **Attest as the reviewer.** `attestedBy` is always the identity the request resolved to. A tool
  pushing several reviewers' verdicts sends each reviewer's in a request carrying that reviewer's
  `Armature-User`. A body naming anyone else is a 422 `attester_not_caller`.
- **Write the record first, then attest it, in two requests.** An attestation's subject may not
  be written in the same request (422 `subject_in_same_write`): the commit the verdict names must
  already hold what it judges.
- **Supply `asOf` when re-sending an old verdict.** Every write of an attestation is a new verdict,
  so an omitted `asOf` is filled with the branch head again, also on a replace. A retried push or
  an import of past verdicts sends the commit the verdict was about.
- **Read staleness, do not compute it.** The attestations read compares the judged part at `asOf`
  and now, by `fragmentId`, and reports `Current`, `Stale`, `FragmentRemoved` or `Unanchored`. It
  works after a merge, when the attested commit is on another branch.
- **Name parts on notes and findings** with `fragmentId`. The record then names exactly one
  `subject`, and the part must exist in it (422 `fragment_needs_one_subject`, `unknown_fragment`).
- `attestedBy` cannot be used as a list filter (400 `person_filter_refused`, ADR-0021).

**CoQui.** The type follows the shape CoQui proposed (O-J), with four mappings at its boundary:

| CoQui's proposal | In the hub |
|---|---|
| `Attestation/coqui-<itemId>-<fragmentId or item>-<lineage>-<reviewer>` | No client id. Keep that string as CoQui's own mapping; the same key fields give the same hub id, so a retried push is idempotent |
| `grid`, `claim` (lineage), `claimVersion` | Inside the opaque `claimRef`; the wording in `claimText` |
| `verdict: Cannot` | `Declined` |
| `asOf` (the item version) and `sourceCommit` | `asOf` is the commit; supply the version's `sourceCommit` on every push. CoQui's version row stays in CoQui |

The outbox rows held for this type can now be sent: per reviewer, after the item's own push.
A decline that is not a finding crosses as `Declined` with its `reason`.

Detail: [ADR-0028](../schema/docs/adr/0028-attestation.md); [API reference, attestations
read](api.md#get-intelligenceattestationstypeid); [schema guide §4.11](schema-guide.md).

## 2026-10-18 · Item statistics are metrics about the item (ADR-0058; PR #15)

**What changed.** `AssessmentItem.difficultyIndex` and `discriminationIndex` are removed. An item
statistic is a `LearningMetric` whose new `subject` field names the item, `derivedFrom` the
administration's `LearningDataset`. `ModuleObjective` declarations are written by any client
through the generic document routes (ADR-0007, confirmed).

**What a client does.** Write item statistics as metrics; list an item's metrics with
`GET /api/v1/documents/LearningMetric?subject=<item id>`. Send no statistics fields on an item:
they are unknown keys, a 400.

Detail: [ADR-0058](../schema/docs/adr/0058-item-statistics-are-metrics-about-the-item.md).

## 2026-10-18 · List filters, and no filter by person (ADR-0021; PR #14)

**What changed.** `GET /api/v1/documents/:type?<field>=<value>` filters `Optional` and `Set` fields
correctly (they had answered 500). A filter on any field that names a `User` (`createdBy`, and now
`attestedBy`) is refused.

**What a client does.** Do not list documents by who made them: 400 `person_filter_refused`. The
API offers no enumeration of one person's work.

## 2026-10-18 · Records name the state they refer to: `asOf` (ADR-0057; PR #12)

**What changed.** `LearningDataset`, `LearningMetric` and `DesignFinding` (and since PR #16
`Attestation`) carry `asOf`, a bare commit identifier. The hub fills it with the branch head on
create, keeps it on replace (except for an attestation, above), copies a dataset's onto its
metrics, and checks every value it did not take from the head (422 `unknown_commit`,
`absent_at_commit`, `as_of_disagrees`).

**What a client does.** A finding judged against an earlier version of its subject sends that
version's commit as `asOf`. To re-judge a finding, send a new `asOf`; a replace without one keeps
the old.

**CoQui.** A finding's `asOf` is the `sourceCommit` of the item version the note was about.

Also on 2026-10-18 (PR #13): deleting a branch that is already gone answers 404 `unknown_ref`
(it had answered 500), and `GET /api/v1/branches` no longer fails when a branch is deleted while
it is read.

## 2026-10-08 · Design intelligence reads; coverage is never stored (ADR-0029, ADR-0056; Phase 4)

**What changed.** Four reads under `/api/v1/intelligence/`: coverage, alignment, trace and impact,
each at any `?branch=` or `?ref=`. Coverage is computed on read; `ModuleObjective` has no coverage
field.

**What a client does.** Read coverage from `GET /api/v1/intelligence/coverage/:moduleId`; never
write it. A `ModuleObjective` with a coverage field is a 400.

**CoQui.** Narrative 2 reads both coverage figures: `coverage` counts Approved items in Approved
placements, and `projected` counts everything not Retired, so it shows progress while items are
still in review.

## 2026-10-08 · Generic writes, identity and the invariants engine (ADR-0024, ADR-0032; Phase 3)

**What changed.** Every type is written through `PUT /api/v1/documents/:type/:id` and
`POST /api/v1/documents`; the demo-era routes are retired. `Armature-User` carries an `externalId`,
resolved to a `User` on `main`. Rules the database cannot express are answered 422 with every
violation at once.

**What a client does.**

- Supply your own `@id` on an artifact's first write if you want one; later writes under it
  replace. Never supply one on a relationship (junction) record.
- Send `Armature-User: <externalId>`, not a `User` id. Register users on `main` with
  `POST /api/v1/users`. Never send `createdBy`; the hub sets it.
- Read the `violations` list on a 422 and the `issues` list on a 400; the codes are stable
  ([API reference](api.md#the-write-pipeline)).

## 2026-10-08 · Version control (ADR-0025; Phase 2)

**What changed.** Reads at a branch or a commit, `ETag` and `If-Match` as bare commit identifiers
(412 when the branch moved), branches, a three-way merge with a per-field conflict report,
per-document history and diff, and changes since a commit.

**What a client does.** Pin reads with `?ref=<commit>`; send `If-Match` on writes that must not
overwrite someone else's change. Never expose or rely on history rewriting: there is no reset,
squash or rebase.

**CoQui.** The handoff's statement that TerminusDB "has no three-way merge with markers" (§4) is
wrong for v12: correct it when PR 6 (`feat/armature-merge`) is picked up. Merge *policy*, who may
merge and whether findings and attestations reach `main` without approval (O-P), is still open
([development plan §6](development-plan.md)).

*2026-10-30:* who may merge is proposed in ADR-0068 decision 4 (a maintainer of `main`); what the
merge route checks remains open.

## 2026-10-07 · Schema catch-up (ADR-0017, 0018, 0020, 0022, 0023, 0024; Phase 1)

**What changed.** `DesignRecord` is the root every note and finding can point at; items carry their
own `status` (`ItemStatus`); `DesignFinding` exists; an item's stem, options and feedback are
embedded fragments with client-assigned `fragmentId`s.

**What a client does.** Assign `fragmentId` once per part and never derive it from position;
address parts as `{ item @id, fragmentId }`, never by the database's nested identifiers.

**CoQui.** One divergence is recorded and undecided: CoQui's handoff gives each option's own
feedback a `{ fragmentId, text }` shape, but `ItemOption.feedback` is plain text.
