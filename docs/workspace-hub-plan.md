# The workspace hub: plan

*Status: draft 2026-10-28, for review, with ADR-0065 (accepted 2026-10-30); its store, questions 2 and 11, is ADR-0066 (Proposed, 2026-10-29); identity is ADR-0067 and ADR-0068 (accepted 2026-10-30). Nothing is built yet; §14 is the build order. Questions 1, 3, 5, 8, 10, 13 and 14 were decided on 2026-10-29 and 2026-10-30 and are marked (13 and 14, authorization on a workspace hub and agents' writes, were raised by the alignment review of 2026-10-30); the others are open, each with a recommendation the plan is written to. Part of this repository if built: the workspace hub is the hub's own code in a second mode, not a separate client.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CI (continuous integration), HTTP (Hypertext Transfer Protocol), JSON (JavaScript Object Notation), MiB (mebibyte), OIDC (OpenID Connect), UI (user interface), VM (virtual machine), WSL (Windows Subsystem for Linux).

---

## 1. Purpose

A person who works on the design graph from their own machine should be able to work offline, use several tools at once on the same work, and bring it back, without each tool building that for itself. Quiver's plan (`mossglenn/quiver`, `docs/plan.md` §3 and §5) builds it inside one tool. This plan moves it under the tools:

- **One workspace, several tools.** Quiver and CoQui on one laptop write to the same workspace and see each other's changes at once.
- **The hub's own rules and reads, offline.** Every write is checked by the invariants engine as it is made; coverage, trace and alignment are answered by the same code as on the remote. No tool keeps a copy of the rules.
- **One credential.** Only the workspace hub talks to the remote, so only it needs the `oidc` resolver's token; the tools use the `header` resolver on loopback, the case that resolver was made for (ADR-0032 decision 1).
- **History stays honest.** Branches, merges into `main` and `User` registrations happen on the remote, through its API, as today. The workspace hub adds no second place where shared history is made.

## 2. Terms

Added to CLAUDE.md's table on acceptance; every other term there holds unchanged.

| Term | Meaning |
|---|---|
| **Remote hub**, the remote | A hub as built: where workspaces are created, merged and deleted, and `User` documents registered |
| **Workspace hub** | The same API, from the same code, in workspace mode, on one person's machine; serves tools on loopback; holds workspaces from one remote |
| **Workspace** | A branch on the remote, created there, owned by one person, cloned to their workspace hub |
| **Base** | The remote commit a workspace was cloned at, or last brought up to date with |
| **Local commit** | A commit made on the workspace hub; its identifier is provisional until pushed |
| **Push** | Replaying local commits onto the workspace's branch on the remote, through `/api/v1` |
| **Bring in `main`** | The remote's merge of `main` into the workspace, then the result copied down |
| **Deliver** | The remote's merge of the workspace into `main` |

## 3. Shape

```
Quiver ──┐                                              ┌──▶ remote hub ──▶ TerminusDB
CoQui  ──┼──▶ workspace hub  (loopback, header resolver) │     (oidc resolver)
viewer ──┘     same /api/v1; workspaces; the push table ─┘
               store: TerminusDB or files (§10)
```

Tools are written against `/api/v1` and nothing else, as now. A tool learns it is talking to a workspace hub from `GET /discover`: the capability `armature/workspace` is present, and `armature/branches` and `armature/users` say in their settings which routes this hub serves (ADR-0059 decision 4). A tool that only reads and writes documents need not know at all.

## 4. The workspace cycle

| Step | On the workspace hub | On the remote |
|---|---|---|
| Create | `POST /workspace` with a name and a starting branch (`main` by default); or with an existing branch to clone. *Decided 2026-10-30:* the workspace hub asks the remote whether the owner may write the branch and **warns** when they may not, but creates the workspace anyway; the refusal, if any, is the remote's at push (ADR-0068 decision 9) | `POST /branches` (`<user>_<name>`, the spelling Quiver settled, since branch names match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$`; a naming convention, not ownership, which is a `Grant` (ADR-0068), so `<user>` is a short handle rather than an `externalId`); for the warning, `GET /users/me` and the branch's `Grant` documents on `main` |
| Clone | Load the export as the workspace's first state; record the base; mirror `main`'s `User` documents | `GET /export?ref=<head>&slice=<slice>`, `GET /schema?ref=<head>`, `GET /users?branch=main` |
| Work | Tools write; every write is a local commit with its message; the whole pipeline runs | Nothing |
| Push | Replay each unpushed local commit (§5) | One `POST /documents` per local commit, with `If-Match` |
| Bring in `main` | With nothing unpushed: ask for the merge; on success read what changed and record it as a local commit mapped to the merge commit; on conflict, the review (§6) | `POST /branches/<ws>/merge` with `from: main`; `GET /branches/<ws>/changes?since=` |
| Deliver | After bringing in `main` cleanly, ask for the merge with the person's message; offer to delete the workspace or keep it | `POST /branches/main/merge` with `from: <ws>`; `DELETE /branches/<ws>` (allowed, since `main` holds its head) |

A workspace hub may hold several workspaces from one remote; each is a branch locally too. The workspace routes (`/workspace`, `/workspace/:name/status`, `/push`, `/bring-in`, `/deliver`) are the only routes a workspace hub adds, under the `armature/workspace` capability; the workspace manager's own UI uses them, and a tool may, to offer a Sync button.

## 5. Push

Each local commit since the last push becomes one batch write on the remote: the documents the commit wrote, in one `POST /documents` (500 documents a request, so a larger local commit is split and the split recorded in the trailer; *decided 2026-10-30:* the split keeps each document after what it names and documents that name each other together, a provisional id resolved within a part by `@capture` and between parts from the remote's answer, and a group one request cannot hold is a push error: ADR-0065 decision 5, note; platform check AL measures what one request holds). In order, each with `If-Match` naming the remote commit the previous replay produced, or the base.

**The commit table.** The workspace hub records local commit → remote commit as each replay succeeds. Before replaying a commit, every `asOf` in its documents that names a local commit is rewritten to the remote one. The rewrite is exact because the workspace has one writer and replay starts from the base: each remote commit holds the same documents as its local original. An `asOf` the local pipeline filled from the local head is the previous local commit, which maps to the remote commit named in `If-Match`, the value the remote would fill itself. An `asOf` naming the base or an older remote commit passes unchanged. After a push, reads on the workspace hub at a pushed commit accept either identifier.

**Trailers.** ADR-0025 decision 2 reserves git-style trailers in the commit message for facts the store will not keep as metadata (the document API ignores commit metadata, check V4). Each replayed message ends with a blank line and:

```
Armature-Workspace-Commit: <local commit id>
Armature-Authored-At: <ISO 8601 time of the local commit>
```

so the time the work was done survives the push; the remote's own timestamp is the time it arrived. The names follow Git's two dates: the author date is when the work was done, the committer date when it was applied. A local commit split across several requests carries `Armature-Workspace-Part: <n>/<total>` on each. These are the pusher's claims, recorded as sent; the trailers the remote writes itself (`Armature-On-Behalf-Of` and `Armature-Relayed-By`, ADR-0067 decisions 3, 5 and 6) are the only ones it vouches for. *Renamed 2026-10-29 from the first draft's `Armature-Committed-At` (§16, question 10).* A research reading of design process (`docs/research-path.md`) reads the trailer when present.

**Failures.** A local commit is replayed whole or not at all, so a push interrupted by the network resumes from the table. A **403** `forbidden` (ADR-0068; *added 2026-10-30*) means the owner may not write the branch on the remote, which the warning at workspace creation (§4, §7) will usually have said already; the push stops before its first commit, and the workspace hub shows who holds `Maintainer` of the branch. A **412** means the workspace's branch moved on the remote: someone else with a grant wrote it, or the same person pushed from another machine. The push stops and the workspace hub shows what moved (`GET /branches/<ws>/changes?since=`). A **422** stops the push at the commit the remote refused and shows the remote's violations; since the local pipeline ran the same rules, this means the local engine was older than the remote's or a rule depends on state the workspace hub lacked (§8), and either is reported as such.

## 6. Conflicts and the rules after a merge

Bringing in `main` is the only step that conflicts: a push to a branch with one writer cannot. The remote reports a conflict per field with base, target and source values, or `InsertConflict`, and leaves the branch unchanged (`docs/api.md`, Branches). The review is Quiver's §3.1, made generic over the schema: an item's parts compared by `fragmentId`, so an option changed on one side only is taken; every other document by field; "keep mine", "take theirs", "edit", and both for everything. The resolution rides on check Z, as Quiver planned: the conflicting documents restored to base in one commit, the merge retried clean, the resolution written as a third. All three are local commits, pushed like any other.

~~The remote's merge route applies the store's merge without running the invariants engine over the result, so two clean branches can merge into a `duplicate_sequence` or an approved placement of a retired item (Quiver's plan §8, its first ask of the hub). The workspace hub runs the engine over the merged state after every merge in either direction and reports what it finds before offering to deliver. If the remote gains that check (the ask passes the two-client test with CoQui and the outcomes importer), the workspace hub's copy becomes a preview of it.~~ *Decided 2026-10-30 (review B3):* the remote's merge route checks the merged state before it commits, on a transient branch, and refuses with 422, the target unchanged; a dry run returns conflicts and violations without a commit (ADR-0025 decision 5, note; built at step 4). The workspace hub shows the refusal, and may run the engine over the local result first as a preview, since the remote's answer is the one that counts.

## 7. Identity and security

- **Tools on loopback.** The workspace hub binds to loopback and uses the `header` resolver, limited to the owner's `externalId`; any other identity is 403 `forbidden` (ADR-0068's code for a refusal of authority; *named 2026-10-30*, the first draft said 401 `identity_required`, which means no identity was sent). Any process on the machine can therefore write as the owner, which is the trust a personal machine already extends to its programs. A per-session token the workspace hub hands to each tool it launches is the next step if that is not enough (§16, question 6).
- **The remote credential.** Held by the workspace hub alone, in the operating system's keychain. Pushes, merges and reads on the remote are made as the owner.
- **Agents.** An agent is a `User` registered by a person (ADR-0032 decision 7). On push, the remote credits the credential's holder, so an agent's local commit would arrive as the person's and its `createdBy` would name the person. Until the remote can authenticate an agent pushed by its registrar, the workspace hub refuses writes by agent identities rather than re-credit them. ADR-0025 decision 2 left delegation trailers waiting for a trigger; this is a candidate.
- *Later (2026-10-29; both records accepted 2026-10-30):* ADR-0067 (Proposed) adds a `Host` check and an allow-list of web origins to every hub, and lets an agent write locally and push as the agent acting for the owner; ADR-0068 (Proposed) enforces branch ownership on the remote. The two bullets above on tools and agents are superseded by them if accepted (the agents bullet wholly: its refusal is replaced, and "pushes are made as the owner" becomes "as the owner, or as an agent acting for the owner").
- **Authorization** (*decided 2026-10-30*). A workspace hub does not run ADR-0068's permission check: it holds one owner and no `Grant` documents, and every operation the check governs is either refused here as `remote_only` or concerns the owner's own workspaces. The remote is the authority and refuses at push (403 `forbidden`). What the workspace hub does is warn early: at workspace creation it asks the remote whether the owner may write the branch and says so when they may not, without preventing the workspace (ADR-0068 decision 9; §4). A clone of a branch the owner cannot write is still useful: to read offline, to work on while asking for a grant, or to carry content into a workspace of one's own.
- **Agents write here, never to the remote directly** (*decided 2026-10-30*). An agent's own work reaches a remote only as this workspace hub's push, acting for the owner (ADR-0067 decision 10, with the reasons and what would reopen it). A tool on this machine that writes as an agent, Quiver's drafter or the MCP server, sends the owner in `Armature-User` and the agent in `Armature-Agent`; the push carries the commit with the owner's credential and the remote writes `Armature-On-Behalf-Of`.
- **What sits on the machine.** The clone is one branch, in one slice, in one profile. For a study's instance the profile can be `pseudonymous` (ADR-0031), so the machine holds no names; the workspace hub then writes as a pseudonymous `User` the remote resolves, which needs checking against how the remote resolves identity before it is offered.

## 8. What a clone holds, and what it lacks

A clone is the export at the base. That is enough for every write and every read at the workspace's head. It lacks state older than the base, and three things read it:

- **Constraint 13** checks that a record's subjects exist at its `asOf`, and **constraint 16** that a fragment exists there. A metric written offline whose `asOf` names an older remote commit cannot be checked locally.
- **The attestation staleness read** compares a subject at the attestation's `asOf` with now. Every attestation cloned from the remote has an older `asOf`.
- **Reads at an older ref** (coverage at a dataset's `asOf`, the Walkthrough's "at asOf and now", history before the base).

Three options:

| Option | For | Against |
|---|---|---|
| **The subjects at each referenced `asOf`** (recommended): the clone also reads each distinct `asOf` named by a cloned record and fetches the subjects' states at it | Constraints 13 and 16 and staleness work offline; bounded by the records, not by history | Coverage at an old commit still needs the remote; a second read per distinct commit at clone time |
| A full export at each referenced `asOf` | Every read works offline | Size grows with the number of administrations and attestation rounds |
| Nothing older than the base | Simplest | Staleness and the outcome walk wrong or unavailable offline |

With the recommended option, a read at a ref the workspace hub does not hold is forwarded to the remote when online, read-only and as the owner, and answered with 404 `unknown_ref` and a `remote_needed` detail when offline.

*Decided 2026-10-30 (§16, question 3):* the clone holds as much as is reasonable, so that as many of the hub's reads as possible work offline. The recommendation above was the minimum; the decision asks for more, within what a person's disk and the clone's time allow. §16 question 3 proposes how.

## 9. What runs where

| Capability | Remote hub | Workspace hub |
|---|---|---|
| `armature/documents` | Served | Served on workspaces; `main` read-only |
| `armature/branches` | Served | Reads served; create, merge, delete refused (400 `remote_only`) |
| `armature/users` | Served | `GET /users` and `/me` from the mirror; `POST /users` refused (400 `remote_only`) |
| `armature/intelligence.*` | Served | Served at refs the clone holds (§8) |
| `armature/export` | Served | Served at refs the clone holds |
| `armature/discover` | Served | Served, with `armature/workspace` and the role |
| `armature/workspace` | Absent | Create, status, push, bring in, deliver |
| Authorization (ADR-0068; *decided 2026-10-30*) | Checked on every write, merge and delete; 403 `forbidden` | Not checked (§7); a warning at workspace creation when the owner may not write the branch; the remote refuses at push |
| An agent's own writes (ADR-0067 decision 10; *decided 2026-10-30*) | Refused unless arriving as a workspace hub's push acting for the owner; a service credential reads | Served, as the agent acting for the owner, pushed with the owner's credential |
| Operator tools (ADR-0062) | In the hub's container | Not shipped; a workspace that needs repair is repaired on the remote and cloned again |

## 10. The store underneath

ADR-0065 decision 8 leaves the store open; ADR-0066 (Proposed, 2026-10-29) chooses the file-backed store, with TerminusDB as the test bed for steps 2 to 5. What it must do is limited by decisions 3 and 6: documents at a head, a log of local commits, reads at those commits, at the base and at the subject snapshots of §8. It never merges, never creates a branch from another's history, and never deletes.

**What the hub asks of a store** (checked 2026-10-28). Nothing under `app/lib/api/` sends a graph query: no WOQL (TerminusDB's query language) is used, and coverage, trace, alignment, impact and module content are TypeScript in the hub, walking the graph by reading documents by id and by field templates (`intelligence/graph.ts`). The store serves as a **versioned document store**: get, put and match on fields at a named commit, with commits, history, diff, branches and merge. It also mints the identifiers of the nine Hash-keyed classes (every junction and `Attestation`) from their key fields. Field types, enums and required fields are checked first by the generated Zod schemas, and a reference's existence by constraint 0, which reads every target. So a graph database adds nothing the hub uses, and what any other store must supply is versioning and TerminusDB's formats.

| Option | For | Against |
|---|---|---|
| **TerminusDB beside the hub** | The adapter as written; history, diff and template queries exactly as on the remote; measured footprint 292 MiB for the store and 38 MiB for the hub with the seed (`docs/deployment.md`) | A container runtime to install and keep running, or a native build not yet proven to ship (below); none on Windows outside WSL (Windows Subsystem for Linux) or a container. Its version need not match the remote's pinned v12.0.7, since a push goes through the remote's API and never reaches the remote's store; it must be a version the platform checks pass on |
| **A file-backed store** (recommended to try first) | One process and nothing else to install; a folder the person owns, readable with any editor, diffable in git, Quiver's decision 4 kept; a few MiB of memory at this scale | A second adapter to write and keep faithful: template queries, history and diff over a commit log, and TerminusDB's Hash identifiers and diff format reproduced (below); tested against the TerminusDB adapter on the seed, and wrong where they differ |
| Dolt (Git's model over SQL tables) | Commits, branches, merge, diff and reads at a commit (`AS OF`) native; one executable for Windows, macOS and Linux; Apache-2.0 | A process to ship and run; documents as JSON columns behind a third adapter; Hash identifiers and the diff format still reproduced. Worth it only if workspace hubs ever need real local branching. ADR-0066 names its two triggers: real local branching (peers passing workspace branches, scratch branches for an importer), or a workspace measured in use that outgrows memory |
| A graph database (Neo4j) | Native on Windows (Java); fast traversals | Its traversals go unused, since the hub walks the graph itself; no versioning at all, so commits, history and reads at a commit built by hand, the file store's work again on a heavier base; a Java runtime of hundreds of MiB; the Community edition is GPLv3, to be checked before bundling. Not recommended |

**The seam.** The adapter (`app/lib/api/store.ts`) is a concrete class, imported by 26 modules outside the tests (counted 2026-10-30; 15 of them take a value, the rest only types). The invariants engine and the intelligence reads use six of its methods (`getDocument`, `getDocuments`, `queryDocuments`, `allDocuments`, `getCommit`, `at`); the routes use more (`history`, `diff`, `log`, `head`, `listBranches`, `createBranch`, `apply`, the operator methods). The first piece of work is an interface extracted from the class, with the TerminusDB adapter its one implementation and every module typed against the interface: no behavior change, and the separation Quiver's `@armature/rules` ask also needs. The file-backed store then implements the subset a workspace hub uses, and a contract test runs the engine and the reads over both stores on the seed and requires the same answers.

**The file-backed store's layout.** The remote's side is snapshots, not commits: rebuilding the remote's history would mean reading every changed document at every past commit, and a workspace needs only the base and the older states of §8. The local side is commits, one file each.

```
<workspace>/
  workspace.json        remote URL, branch, owner, base commit, the push table
  schema.json           GET /schema at the base
  users.json            main's User documents, for identity resolution
  remote/
    base.jsonld         GET /export at the base, as the remote returned it
    at/<commit>.json    the subjects at each older asOf a cloned record names (§8)
  commits/
    000001.json         { id, parent, author, message, time, documents, deleted, origin, pushedAs }
```

- **A commit file holds the full state of every document the commit wrote,** not a patch. It is then already the body of one `POST /documents`: a push sends the documents and the message with `If-Match` set to the previous commit's `pushedAs`, rewriting only the `asOf` values that name local commits (§5), and records the remote commit in `pushedAs`. The push table of §5 is these fields.
- **The state at a commit** is the base with the commit files up to it applied in order, indexed in memory when the workspace opens; milliseconds at a few thousand documents. Reads at the base and at the snapshots of `remote/at/` are served from those files.
- **Local commit identifiers have the remote's form.** The hub tests an `asOf` against `^[a-z0-9]+$` before it looks the commit up (`intelligence/graph.ts`); a hash of the commit file's content, as Git names commits, meets it.
- **Bringing in `main` arrives as a commit too:** the documents `GET /branches/<ws>/changes?since=` reports, read at the merge commit, in a commit file with `origin: "remote"` and `pushedAs` set to the merge commit. `deleted` lists documents the changes report as `delete`: the API never deletes, but an operator's repair on the remote can (ADR-0062).
- **One writer.** Only the workspace hub writes the folder; tools reach it through the API. A lock file refuses a second process, and every file is written under a temporary name and renamed into place, so a crash leaves it whole or absent (Quiver's §5.2).

**What a store other than TerminusDB must reproduce.** Two of TerminusDB's formats cross the API:

- **Hash identifiers.** The store mints the `@id` of the nine Hash-keyed classes from their key fields (check X1c), and a local record refers to a junction by that id (a note about a `ModuleObjective`, a finding about an `ItemInstance`). An id minted differently locally would name nothing on the remote. Either the adapter reproduces TerminusDB's Hash algorithm exactly, pinned by a lettered platform check (AI) and a contract test comparing ids on the seed, or the push table maps identifiers as it maps commits. Reproducing it is simpler and keeps every id the same on both hubs. *Later (2026-10-29):* Quiver found the ids not reproducible from the key fields and maps them already (provisional `local-` ids renamed from the push response, its `src/lib/workspace/junctions.ts`); ADR-0066 decision 6 makes check AI choose between the two. Random-keyed records need nothing, provided a push always sends their `@id` (ADR-0024).
- **The diff format.** `GET /documents/:type/:id/diff` and the history route's `diff` option return the store's own JSON patch (`docs/vendor/terminusdb/json-diff-and-patch.md`), and `docs/api.md` names no format beyond "the structural difference". A workspace hub on another store must produce the same patch, or the API must define its own (§16, question 11).

**What TerminusDB ships** (checked 2026-10-28). The documented routes are Docker, Kubernetes and a build from source on Linux or macOS; Windows only through WSL or Docker (`docs/vendor/terminusdb/_all/terminusdb-install-options.md`, `install-terminusdb-from-source-code.md`). The GitHub releases v12.0.6 to v12.1.0-rc1 carry no binaries. Linux has a Snap package, v12.0.8 on 12 October 2026; there is no Homebrew formula. The build already makes one executable (`src/bootstrap.pl` calls SWI-Prolog's `qsave_program` with `stand_alone(true)` and `foreign(save)`, saving the program and the Rust storage library into it), which on macOS probably still links the Homebrew copies of SWI-Prolog and GMP (the GNU arithmetic library). That is read from the build files, not tested; platform check AH would build it on macOS, list what it links, run it on a clean machine and measure it.

**Windows was done once, and may be again** (asked on TerminusDB's Discord, 2026-10-28). A maintainer answered that an installable Windows version is feasible but not on the immediate roadmap, and invited a conversation to explore it. They mentioned an early Electron version, no longer maintained: [terminusdb-labs/terminusdb-desktop](https://github.com/terminusdb-labs/terminusdb-desktop), last updated September 2020 at version 3.0.0, whose CI downloaded a Windows server binary as a tarball and a Linux AppImage, placed them inside the Electron app, and built a Windows `Setup.exe` and a Linux AppImage; it had no macOS build. So a native Windows TerminusDB existed and was bundled as a sidecar, and was later dropped rather than ruled out. What would serve this plan best is a portable Windows build (the executable and its DLLs, which the workspace hub's installer carries), or failing that an installer that runs silently from the workspace hub's, so the person still installs one thing. The conversation settled it (2026-10-28): native Windows support has been investigated and is doable, but may need fixes upstreamed to SWI-Prolog; signed Windows and macOS builds are deferred on TerminusDB's side for at least the next couple of months; and desktop builds are not on the roadmap, since none of TerminusDB's own users need them. Bringing it forward would need funding, which this project does not have, so the file-backed store remains required for a designer release. For any later conversation: an app that bundles TerminusDB signs everything inside its own bundle, so an unsigned portable build would be enough.

**Three ways onto a person's machine:**

| Path | For | Cost |
|---|---|---|
| **A `workspace` compose profile**: the store and the hub in workspace mode, on loopback, beside the existing `hub` profile | Developers and researchers, any operating system, from step 2 | A container runtime (below); little new work, since the `hub` profile does most of it; a rehearsal on a fresh VM before it is documented (CLAUDE.md, Branches item 5) |
| **A desktop program with sidecars**: a Tauri program that starts and stops TerminusDB's executable and the hub as programs beside it | Designers on macOS and Linux | Bundling SWI-Prolog's and GMP's libraries, signing and notarizing on macOS, and Node for the hub (Node's single-executable feature, or a bundled runtime); check AH first |
| **A desktop program over the file-backed store**: the hub alone, no TerminusDB | Everyone, Windows included | The second adapter (above) and its contract test |

**Container runtimes for the compose profile.** Each is a Linux virtual machine and a container engine; they differ in license and weight, not in kind. Licenses as of 2026-10-28:

| Runtime | Operating systems | License | Notes |
|---|---|---|---|
| Docker Desktop | macOS, Windows, Linux | Paid at organizations of 250 or more employees or $10 million or more revenue; the August 2026 terms exclude use connected to a university or research institution from the free personal tier ([license](https://docs.docker.com/subscription/desktop-license/)) | Fixed VM memory, 2 GB by default on Windows, several times the 375 MiB the store, hub and viewer used on the Droplet |
| OrbStack | macOS | Free for personal, non-commercial use only; business, nonprofit and freelance use paid; educational licenses on request ([FAQ](https://orbstack.dev/docs/faq)) | The lightest on a Mac: memory grows and shrinks with use |
| **Colima** | macOS, Linux | Open source, free for everyone | The Docker Engine itself, so the compose file works unchanged; command line only |
| **Podman Desktop** | macOS, Windows, Linux | Open source, free for everyone | The one free graphical choice on all three; compose through a compatibility layer, and containers do not come back after a reboot without further setup, where the compose file assumes every service restarts; to be rehearsed |

None of them changes the shape: a second install before Armature's, a background service, WSL2 on Windows whichever is chosen, and nothing the workspace hub can start on its own across all four. The free defaults to document are Colima on macOS and Podman Desktop on Windows, with OrbStack for those who hold a license. A designer's install is the third path: the file-backed store is the only one in which installing Armature is the whole install, and the only one at all on Windows without WSL.

## 11. Quiver

What moves: Quiver's `sync/` (check out, push with `If-Match`, bring in, deliver), `workspace/` (the folder, atomic writes, the lock), `merge/` (the three-way merge by `fragmentId`, the hold, merge, resolve sequence), `rules/` and `coverage/`. What stays: the bank, the item editor, the formats, the tags and saved filters and everything else its §7 keeps out of the hub, and the Changes drawer, which becomes a view of the workspace hub's unpushed commits.

Quiver's folder layout (its §5.2) is close to the file-backed store's (§10). `base.jsonld` is the clone and `commits/` the log in both. Three differences: the log becomes the store's history rather than a list of pending writes; the working state is derived from the base and the commits rather than kept as `documents/<Type>/<id>.json`, so it cannot disagree with them (a readable copy of it can be written out for a person to browse, and is never read back); and `local/` stays Quiver's, outside the workspace hub's folder.

*Decided 2026-10-30:* Quiver pauses its development until the workspace hub is built, and is the workspace hub's first real-world test. The workspace hub may be built from Quiver's code: its `sync/`, `workspace/`, `merge/`, `rules/` and `coverage/` modules are the starting point of steps 2 to 4 (§14), adapted to the hub's adapter interface and pipeline rather than rewritten. Quiver's own plan records the pause.

Quiver's plan changes on acceptance: its §3 and §5 describe a client of a workspace hub, and its milestones that build sync and merge become this plan's milestones (§14), built here.

## 12. What it asks of the remote

Each tested against a second client before it enters the remote (Development Principle 6).

| Ask | Second client | Verdict |
|---|---|---|
| The `oidc` resolver, and a `token` option on `@armature/client` | Any writing client elsewhere (What's Next item 3; Quiver's two machines; the MCP server over HTTP) | Passes; a prerequisite of the workspace hub (decided 2026-10-30), specified in ADR-0067 |
| The merge route runs the invariants engine over the merged state | CoQui's round merge; the outcomes importer | Passes (Quiver's first ask, unchanged); *decided 2026-10-30:* checked before the merge commits, 422 (ADR-0025 decision 5, note) |
| A dry-run merge returning the conflict report without a commit | CoQui | Passes; lets "bring in" preview before it writes; *decided 2026-10-30* with the check above, returning violations too |
| The workspace trailers (§5) documented in `docs/api.md` and read by the history route | The research path's reading of process data | Passes; no code on the remote beyond returning the message as stored |
| An owned branch: the remote refuses writes to a workspace by anyone but its owner | The MCP server (agent work reaches `main` only when a person merges it) and CoQui's review rounds (who may merge a round), recognized 2026-10-29 | Passes; proposed generally in ADR-0068 (branch ownership and who may merge into `main`) |
| An authoring slice in `slices.json` | Quiver; the curriculum mapper | Passes; configuration |
| A branch's commit log, `GET /branches/:name/log` (identifiers, authors, messages, times; added 2026-10-30 for §16 question 3) | The research path's reading of design process, which reads commits rather than documents | Likely passes; to be tested when the clone's contents are built |
| Whether a caller may write a given branch, readable before the attempt: the caller's grants from `GET /users/me` and a branch's `Grant` documents on `main` filtered by `branch` (for the warning at workspace creation, §4, §7; added 2026-10-30) | CoQui, showing a reviewer whether they may write to or merge a round; the MCP server, hiding a write it would be refused (ADR-0068 decision 7's purpose) | Passes; both reads are ADR-0068 decisions 7 and 8 as proposed, no new route |

## 13. Testing

- **The adapter interface:** the existing suite unchanged, typed against the interface; a test that no module under `app/lib/api/` imports the class except the factory.
- **The two stores:** the engine and every intelligence read over both on the seed, at the head and at the seed's earlier commits, with the same answers; the file store's template queries against the TerminusDB adapter's on every class; every Hash-keyed document of the seed given the same `@id` by both; the diff and history routes' patches identical for the seed's revised documents; a crash between writing a commit file and renaming it leaving the workspace as it was.
- **The cycle:** a contract test that runs a remote hub and a workspace hub in one process (`startHub` with port 0, twice): create, clone, write, push, bring in, deliver, with two workspaces and two users meeting on `main`; Quiver's ten scenarios (its §6) are the cases. The `asOf` rewrite on a dataset, a metric and an attestation written offline; a push interrupted after one commit and resumed; a 412 from a write on the remote branch; a 422 from a rule the remote has and the local copy lacks.
- **The refusals:** every route in §9 marked refused answers `remote_only` on a workspace hub, and `/discover` says so.
- **CI:** the cycle test in the contract job, against the TerminusDB service container as the remote.
- *Added 2026-10-30 (the four decisions after the deep review):* a merge whose result breaks a rule refused with 422 by the remote, the target head unchanged, and its dry run; a local commit split into two parts with a provisional id minted in the first and named in the second; under `oidc`, a valid token the admission list does not cover answered `not_registered`, and `profile=full` refused to a non-maintainer.
- **Already on `main` (2026-10-30, PR #70):** ADR-0065's two checks before acceptance, platform check AJ (messages with trailers round trip through the store, CRLF and trailing newlines kept) and two contract tests in `app/lib/api/write.test.ts` (an earlier commit of the same branch accepted as `asOf`; trailers returned by the history route). ADR-0065's Verification records the results.

## 14. Implementation plan

1. **The adapter interface** (§10): a refactor with no behavior change; its own pull request.
2. **Workspace mode** with TerminusDB as the local store, because the adapter exists: the role in `/discover`, the refusals, the mirror of `main`, the workspace routes for create and clone. Tested in one process against a remote. The `workspace` compose profile for developers and researchers (§10), rehearsed with Colima and Podman Desktop before it is documented.
3. **Push** with the commit table and the trailers; the failures of §5; the split rule (ADR-0065 decision 5, note of 2026-10-30), with platform check AL first.
4. **Bring in, review and deliver** (§6), with the remote's merge route checking the merged state before it commits and the dry run (ADR-0025 decision 5, note of 2026-10-30; platform check AK first).
5. **The clone's subject snapshots and forwarding** (§8).
6. **The file-backed store** behind the interface, in the layout of §10: platform check AI first (TerminusDB's Hash algorithm), then the commit files, the in-memory index, the Hash identifiers and the diff format, held to the same answers as the TerminusDB adapter; the workspace hub's default from here. Then the decision ADR-0066 decision 4 defers: whether TerminusDB stays a second local store for developers and researchers, judged on whether offline history at every commit has mattered to them and on the cost of keeping the compose profile rehearsed and the contract test double.
7. **Packaging:** the workspace hub over the file-backed store as one desktop program a person installs, on macOS, Windows and Linux (§16, question 1), and Quiver moved onto it.

~~Steps 1 to 4 need nothing from the remote except what exists; step 7's pushes from another machine wait for OIDC.~~ *Superseded 2026-10-30 by the order below: ADR-0068 and parts of ADR-0067 are remote changes built before step 3.*

*Decided 2026-10-30:* ADR-0067 (authentication) and ADR-0068 (authorization) are prerequisites of the workspace hub. The `oidc` resolver is built before a workspace hub is released or pushes to a remote on another machine; until then development and the tests run against a remote on the same machine under `header`, as the contract suite does. Building all of OIDC earlier adds no safety, since a same-machine remote under `header` with ADR-0067's `Host` and `Origin` checks exposes nothing OIDC would close sooner. What does pay to build earlier is what decides the shape of a push, so that step 3 is written once. The order:

- **First, on its own:** ADR-0067 decision 7, the `Host` and `Origin` checks, with the fresh-VM rehearsal (it changes the compose file). It closes an exposure present today.
- **Before step 3 (push):** ADR-0068 whole (the `Grant` class with its schema change, branch ownership, the permission checks, the authorship rule, the guard's scope), and ADR-0067 decisions 3, 6 and 8 with the client's `agent` option (an agent acting for a person with `Armature-On-Behalf-Of`, hub-written trailers refused from clients, `header` reading `Armature-Agent`). All of these work under `header` and need no identity provider. Push then sends agent commits in their final form, and its failures include 403 from the start.
- **Before step 7 (release):** the rest of ADR-0067: the `oidc` resolver (decision 1, with its admission list `ARMATURE_OIDC_ADMIT` and `User.issuer`, and ADR-0068 decision 4's reads under `oidc`: a full export and the user list for maintainers and administrators; both decided 2026-10-30), native sign-in (2), services' credentials (4), relaying (5), and discovery's issuer, audience and client id (9), which the connection profile needs (§16, question 12).

Step 1, the adapter interface, depends on none of them. Steps 2 to 4 start from Quiver's modules (§11). Step 7's desktop program is the first release candidate (§16, question 1); a compose profile or a command-line build serve during development.

## 15. What this plan declines to do

- **Merge into `main`, create branches or register people on a workspace hub.** Shared history is made in one place.
- **Use the store's clone and push between hubs.** It would skip the remote's pipeline (ADR-0065, Alternatives).
- **Workspace hubs talking to each other.** Two people meet on the remote's `main`, never directly; one person's two machines meet on the workspace's branch on the remote.
- **A workspace hub with several people.** It is one person's; a shared machine runs one per account.
- **Run the operator tools locally.** Repairs are made on the remote, where the registry and the rules of record are.

## 16. Questions to settle

1. **How it reaches a person's machine** (§10's three paths). *Decided 2026-10-30:* the first release candidate is a desktop program; other forms (the compose profile, a command-line build) are acceptable during development. How a person gets the workspace hub and connects it to the right remote securely is question 12. *As first written:* A workspace hub installed on its own, which tools find on a known port, or one bundled inside Quiver and shared from there; and a compose profile, a desktop program with TerminusDB beside it, or a desktop program over files. *Recommendation:* built as a package from step 2 so the packaging is a build choice. For developers and researchers, the `workspace` compose profile from step 2, with Colima on macOS and Podman Desktop on Windows documented as the free runtimes after a rehearsal. For designers, from step 7, one desktop program carrying the hub over the file-backed store; Quiver bundles it until a second local tool exists, then it is installed on its own.
2. **Which store first?** *Proposed in ADR-0066 (2026-10-29):* the file-backed store as the workspace hub's store, built at step 6 with TerminusDB as the test bed for steps 2 to 5, and whether TerminusDB stays for developers decided after step 6. *Recommendation as first written:* TerminusDB for steps 2 to 5, since the adapter exists, the tests run against it and developers run it in the compose profile; the file-backed store at step 6, required rather than optional for a designer release, because TerminusDB has no native Windows build and every macOS path to it needs either a container runtime or an unproven bundle. The desktop program with TerminusDB beside it (check AH) is pursued only if offline history at every commit proves to matter more than Windows. This reopens if a portable Windows build returns (§10, the conversation with TerminusDB's maintainers): with one, and check AH passing on macOS, the sidecar path covers all three operating systems and the file-backed store becomes a choice rather than a requirement.
3. **What a clone holds** (§8). *Decided 2026-10-30:* as much as is reasonable, so that as many of the hub's reads as possible work offline, within the limits of a person's machine. *Proposed reading:* (a) the export at the base; (b) a full export at each distinct `asOf` a cloned record names, so coverage at a dataset's `asOf`, the Walkthrough's "at asOf and now", staleness and constraints 13 and 16 all work offline, while the clone stays within a size budget the person can change, with subject snapshots for the commits beyond it; (c) the branch's commit log back to its creation (identifiers, authors, messages, times), so history lists and the research path's process reads work offline even where the states before the base do not; the API serves a document's history but no branch's log, so this needs a `GET /branches/:name/log` on the remote, an ask for §12 to test against a second client (the research path's reading of process data is the likely one); (d) forwarding to the remote when online for anything else. The budget's default is set from a measurement of the seed and of the largest real bank (ADR-0066, Verification). *As first written:* the subjects at each referenced `asOf`, and forwarding when online.
4. **The clone's slice.** *Open (2026-10-30), to be determined.* *Recommendation as first written:* `full` until an authoring slice exists; then the slice a tool asks for when creating the workspace, with references leaving it kept as `unresolved` (ADR-0031) and writes that need them refused locally with a clear message.
5. **Several remotes on one workspace hub.** *Decided 2026-10-29:* one remote per workspace hub, as recommended. *Recommendation:* one remote per workspace hub; a person with two instances runs two, on two ports.
6. **The loopback trust** (§7). *Proposed in ADR-0067 (2026-10-29), accepted 2026-10-30:* the owner-only `header` resolver, plus a `Host` check and an allow-list of web origins, empty by default, that the workspace manager edits. *Recommendation as first written:* the `header` resolver limited to the owner, now; a per-session token for launched tools when a workspace hub runs on a machine with other accounts.
7. **Agents on a workspace hub** (§7). *Proposed in ADR-0067 and ADR-0068 (2026-10-29), accepted 2026-10-30:* agent writes allowed locally and pushed as the agent acting for the owner, recorded in an `Armature-On-Behalf-Of` trailer the remote writes; Quiver's drafter and lint agent depend on it. *Recommendation as first written:* refused until the remote can authenticate an agent pushed by its registrar; then a delegation trailer, which ADR-0025 decision 2 already anticipates.
8. **Pseudonymous clones** (§7). *Deferred 2026-10-30 until needed.* *Recommendation as first written:* not offered until a study asks; check first how the remote would resolve a pseudonymous writer.
9. **Owned workspace branches** (§12). *Proposed in ADR-0068 (2026-10-29), accepted 2026-10-30:* ownership enforced by the remote, since the MCP server and CoQui's rounds are second clients. *Recommendation as first written:* the convention and the 412, until a second client shows a need for the remote to refuse.
10. **The trailers' names.** *Decided 2026-10-29:* `Armature-Workspace-Commit`, `Armature-Authored-At` (Git's author date) and `Armature-Workspace-Part` for a split commit (§5, ADR-0065 decision 5). As first written: `Armature-Workspace-Commit` and `Armature-Committed-At` were proposed. *Recommendation:* settle them with the research path's reader before the first push is built, since they are a format other programs will read.
11. **The diff format** (§10). *Proposed in ADR-0066 decision 5 (2026-10-29):* the recommendation below. The diff route passes TerminusDB's JSON patch through, unnamed in `docs/api.md`, so a client already depends on it. Either a file-backed store reproduces that patch, or the API defines a format of its own and both stores produce it. *Recommendation:* reproduce TerminusDB's patch, and name it in `docs/api.md` now as the route's format, so the dependency is written down; an API-defined format waits for a client that needs something the patch cannot say.
12. **Getting the workspace hub and connecting it to the right remote** (raised 2026-10-30 with question 1). A person needs the program, and needs it pointed at the right remote with the right sign-in, without typing an issuer and an audience. *Recommendation:* a **connection profile** the remote publishes in `GET /discover`, a `workspace` entry with the remote's public address, the instance's name, the issuer, the audience and the client id for native programs (ADR-0067 decisions 1, 2 and 9), and where the workspace hub is released, with the version that matches the remote's revision. The profile holds no secret. A person connects by entering the remote's address in the desktop program, or by opening a link (`armature://connect?remote=https://...`) the remote's viewer offers; the program reads the profile over HTTPS, shows the instance's name and the issuer for the person to confirm, and then signs in. The program itself comes from a signed release channel the profile names, not as bytes served by the remote: signing and notarizing are the release's job, and a remote that served executables would be a target. `GET /discover` stays open without a token so the profile can be read before sign-in (ADR-0067 decision 1).
13. **Authorization on a workspace hub** (raised by the alignment review of 2026-10-30, which found that the clone holds `User` documents but no `Grant` documents, so ADR-0068's per-write check could not run locally as written). *Decided 2026-10-30:* a workspace hub does not authorize; the remote is the authority and refuses at push with 403 `forbidden`; the workspace hub warns at workspace creation when the owner may not write the branch, and does not prevent creating the workspace (ADR-0068 decision 9; §4, §7, §9). The alternative, mirroring grants into the clone and checking locally, was declined: a second copy of authority that can go stale, guarding history a workspace hub never makes.
14. **Agents and the remote** (raised the same day: the MCP server's remote mode could not record whom an agent worked for, since a server must not pass the assistant user's token through, and a `Relay` grant writes the person as author, the wrong record for an agent's proposal). *Decided 2026-10-30:* an agent's own work reaches a remote only through a workspace hub's push, acting for the workspace's owner; a service credential grants reads; the MCP server's remote mode is read-only (ADR-0067 decision 10, which also says what would reopen it: a demonstrated need, and a way for the hub to verify whom the agent works for).
