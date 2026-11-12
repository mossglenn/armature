# ADR-0066: The Workspace Hub's Store Is a Folder of Files, Behind an Adapter Interface

> **In brief.** This decision answers: what holds the data when the hub runs on a person's own
> machine as a workspace hub (ADR-0065)? The answer is a folder of plain files that the
> hub itself reads and writes, so that installing Armature on a designer's computer, Windows
> included, is one install with nothing running beside it. The database the shared hub uses,
> TerminusDB, serves first as the test bed while the workspace hub is built. Once the folder works,
> a second decision settles whether developers and researchers keep TerminusDB as their local store.
> It was proposed on 29 October 2026 and accepted on 2 November 2026, once platform check AI showed
> that the store's identifiers can be computed; the interface and the test bed are built, the
> folder itself is not.

## Status

Accepted (2026-11-02, Amos's decision once check AI ran; proposed 2026-10-29). Built in part:
decision 1, the interface (2026-10-31); decision 3 in force, steps 2 to 5 built on TerminusDB;
decision 2's `push.json` (2026-11-01) and, since the evening of 2026-11-02, the folder itself:
the commit files, the head, the lock, the in-memory index (`app/lib/api/filestore/`, its note),
decision 5's patch and decision 6's ids minted by check AI's formula, held to the adapter's
answers by the two-store contract test (Verification). Opt-in by `ARMATURE_STORE=files` on a
workspace hub; it becomes the default, and decision 4 is taken, once the plan's step 6 closes.

> **Note (2026-11-02, night):** the default is flipped: a workspace hub with no `ARMATURE_STORE`
> runs over the folder (`app/lib/api/config.ts`), and `files` stays refused on a remote hub. The
> `workspace` compose profile names `ARMATURE_STORE=terminusdb` explicitly, so developers keep
> their workspaces in the store server until decision 4 is taken; rehearsed on a fresh VM
> (`docs/deployment.md`, "A workspace hub on this machine"). Of step 6, the Windows rehearsal in
> Verification and decision 4 remain.
>
> **Later change (2026-11-02, night, Amos's decision):** decision 4 is taken: the folder is the one
> local store (its note). `ARMATURE_STORE` is retired, and the `workspace` compose profile runs
> the image over the folder in a volume with no store server. Step 6 is closed but for the
> Windows rehearsal.

It depends on ADR-0065: a store for the workspace hub matters only if there is a workspace hub. It
answers ADR-0065 decision 8, which leaves the store open, and `docs/workspace-hub-plan.md` §16
questions 2 and 11. It amends:

- **ADR-0055 decision 1** ("one HTTP adapter"): the adapter becomes an interface with one
  implementation per store. The TerminusDB adapter stays the only module that talks to TerminusDB,
  and ADR-0055's decisions 2 to 7 hold for it unchanged.

ADR-0055 decision 1 and ADR-0065 decision 8 carry dated notes pointing here (2026-11-02).

## Context

ADR-0065 decision 8 admits two stores under a workspace hub, TerminusDB beside it or a file-backed
store, and leaves the choice to its plan. Four facts bear on it.

1. **The hub uses its store as a versioned document store.** Nothing under `app/lib/api/` sends
   WOQL (TerminusDB's query language). Coverage, trace, alignment, impact and module content are
   TypeScript walking documents read by id and by field templates (`intelligence/graph.ts`). The
   invariants engine and the intelligence reads use six of the adapter's methods (`getDocument`,
   `getDocuments`, `queryDocuments`, `allDocuments`, `getCommit`, `at`). A workspace hub never
   merges, creates a branch or deletes (ADR-0065 decisions 3 and 6), so what its store must do is
   narrower still: documents at the head, a log of local commits, and reads at those commits, at
   the base and at the subject snapshots of plan §8. The adapter (`app/lib/api/store.ts`) is a
   concrete class imported by 26 modules outside the tests (counted 2026-10-30: 24 under
   `app/lib/api/`, the two operator modules; 15 of them take the class, `createStore` or
   `StoreError` as values, the rest only types). ADR-0055 decision 2's request-scoped
   construction stays the interface's contract (`createStore(ref)` per request); a file store may
   keep the workspace's in-memory index behind it.

   > **Note (2026-10-31):** the interface is extracted (plan §14 step 1; ADR-0055, note of that
   > date): `DocumentReader` is what the engine and the reads need, `Store` adds what the routes
   > need, and `OperatorStore` what only the operator tools reach. A file store reports its
   > refusals as a `StoreError` with the same store-neutral `kind`s, so no caller changes for it.

2. **TerminusDB is hard to put on a person's machine** (checked 2026-10-28, plan §10). Its GitHub
   releases v12.0.6 to v12.1.0-rc1 carry no binaries; Linux has a Snap package; there is no
   Homebrew formula; Windows is supported only through WSL (Windows Subsystem for Linux) or a
   container. Its build makes one executable, whose macOS library links are untested (check AH,
   not yet written). A TerminusDB maintainer said on 2026-10-28 that a native Windows build is
   doable but may need fixes upstreamed to SWI-Prolog, that desktop builds are not on their
   roadmap, and that bringing them forward would need funding, which this project does not have.

3. **A container runtime is a second install with its own terms** (plan §10). Docker Desktop's
   August 2026 terms exclude use connected to a university or research institution from its free
   personal tier; OrbStack is free for personal, non-commercial use only; Colima and Podman Desktop
   are free for everyone. Each runs a Linux virtual machine as a background service, and on
   Windows each needs WSL2. Developers and researchers can be asked to install one; a designer, for
   whom the workspace hub is a way to use Quiver or CoQui offline, should not be.

4. **Two of TerminusDB's formats cross the API** (plan §10). The store mints the `@id` of the nine
   Hash-keyed classes, every junction and `Attestation`, from their key fields (check X1c), and a
   local record can name a junction by that id. The diff route returns the store's own JSON patch,
   which `docs/api.md` describes only as "the structural difference". Any second store must
   produce both or translate them. Quiver, which has kept a workspace in a folder since its
   milestone 3 (2026-10-26), found the hub's Hash identifiers not reproducible from the key fields
   and gives each junction it creates offline a provisional `local-` id, renamed from the push
   response (Quiver's `src/lib/workspace/junctions.ts`). It chose a folder of JSON files over
   SQLite because the folder is what local-first promises: the person owns it, reads it with any
   editor and diffs it in Git (Quiver's `docs/plan.md` §11, decision 4).

## Decision

1. **The store adapter becomes an interface.** Every module under `app/lib/api/` and
   `app/lib/operator/` is typed against an interface extracted from the class; the TerminusDB
   adapter is its first implementation, with no change in behavior. This is the plan's step 1, in
   a pull request of its own, and is the separation Quiver's ask for the rules as a package also
   needs. A store implements the methods its role uses: a workspace hub's store need not implement
   merge, branch creation, deletion or the operator methods, which ADR-0065 decision 3 refuses
   before they reach it.

2. **The workspace hub's store is a folder of files.** The layout is the plan's §10: the export,
   the schema and `main`'s `User` documents at the base; the subjects at each older `asOf` a cloned
   record names; and one file per local commit holding the full state of every document the commit
   wrote, so that each is already the body of one push. The state at any local commit is the base
   with the commit files up to it applied in order, held in memory while the workspace is open.
   Only the workspace hub writes the folder: a lock file refuses a second process, and every file
   is written under a temporary name and renamed into place.

   > **Note (2026-10-30):** ADR-0065's clone now holds as much as is reasonable (plan §16,
   > question 3): `remote/at/` may hold a full export at each referenced `asOf` within a size
   > budget, not only the subjects, and the folder may hold the branch's commit log. The layout's
   > shape is unchanged; the budget's default comes from the measurement in Verification.
   >
   > **Later change (2026-10-30, decided):** a commit file is immutable, and the push state lives
   > beside the commits, not in them. The plan's first layout wrote `pushedAs` into each commit
   > file after the push, which a file named by a hash of its content cannot carry. Instead a
   > `push.json` holds, per local commit, the remote commit it became, the parts sent so far and
   > an in-flight marker written before each request, so that after a crash the hub knows which
   > request may have landed and reads the remote branch's log for its own
   > `Armature-Workspace-Commit` trailers to settle it (the log route, plan §12). Durability is
   > stated: a file is written under a temporary name, flushed, renamed into place, and its
   > directory flushed; the branch head advances only after the commit file is durable. The
   > review's alternative, a SQLite journal, was declined as more machinery than one writer and
   > one folder need. Review B4 (`docs/armature-deep-review-2026-10-30.md`).
   >
   > **Note (2026-11-01), built in part:** `push.json` as the note above says, written whole
   > under a temporary name, flushed and renamed (`app/lib/workspaceFolder.ts`), with the
   > in-flight marker and the recovery from the remote log's trailers (`workspace/push.ts`,
   > `GET /branches/:name/log`), over TerminusDB as the test bed (decision 3); the commit files
   > and the lock wait for step 6.
   >
   > **Note (2026-11-02), built in part:** the layout's `remote/at/<commit>`, the subjects at each
   > older `asOf`, is built as full exports (plan §16 question 3's reading), in the test bed as
   > branches `at.<commit>` of the workspace hub's store, recorded in `snapshots.json` beside
   > `push.json`; the branch's log in `log.json`. Step 6 moves the snapshots and the log into the
   > folder as files; their records and the resolution of a remote identifier
   > (`app/lib/api/workspace/store.ts`) stay as they are.
   >
   > **Note (2026-11-02, evening), built:** the folder is `app/lib/api/filestore/store.ts` over
   > the `StoreFiles` interface (`files.ts`; the host's folder and lock in
   > `app/lib/workspaceFolder.ts`, memory in the tests). The layout as built keeps the plan's
   > shape as *branch folders*, so that the clone, the snapshots and the bring-in (`workspace/`)
   > run unchanged over either store: one folder per branch holding `head.json` and
   > `commits/<id>.json`; a workspace's branch folder is its workspace folder, its records beside
   > `commits/`; the remote's `main` (`users.json` in the plan) and each snapshot (`remote/at/`)
   > are branch folders of their own, `main/` and `at.<commit>/`, a snapshot shared by every
   > workspace that names its commit; `base.jsonld` is the clone's own commit file, which holds
   > every document of the export; a commit that replaced the schema carries `schema` in place of
   > `documents`. A commit file carries no `origin`: which commits came from the remote is
   > `push.json`'s `broughtIn`, beside the commits as the note above decided. The commit id is
   > the SHA-256 of the file's body, verified when the folder is opened; the head file is written
   > only after the commit file is durable; a branch made from another's commit shares its
   > ancestry by parent links and copies nothing, and deleting a branch removes only the commit
   > files no branch reaches. `store.json` marks the folder with a format number.

   > **Note (2026-11-11):** one line of writes for the whole store, not one per branch (the code
   > review of 2026-11-09, its W1, reproduced as two tests before the change; decided by Amos on
   > that review's options). Commits were ordered per branch, and a branch's creation and deletion
   > by nothing. A deletion removes the commit files no branch reaches from every branch's folder,
   > so beside a write in flight on another branch it removed that write's commit, written and not
   > yet under a head: the write was answered with a commit the store no longer held, every later
   > read of that branch was 404 `unknown_ref`, and the folder would not open again ("the store is
   > damaged"), which takes every workspace on the machine with it. A deletion of the branch being
   > written brought it back with a head whose history was gone. Now every change to the folder (a
   > commit, a branch made or deleted, the store marked or removed) runs one at a time within the
   > process, whatever branch it is for. Weighed against it: keeping the per-branch order and
   > having the sweep skip the commits of writes in flight, which keeps writes to two workspaces
   > side by side at the cost of more state, and still leaves a branch made from a commit being
   > swept to guard; on one person's machine the writes are milliseconds apart either way. The
   > hub's write queue (`exclusive`) is still per branch and still a separate line, which work
   > holding it commits through. The folder's removals are tried again while another program holds
   > a file, as its renames are (`REMOVAL` in `app/lib/workspaceFolder.ts`; the review's W2, with
   > ADR-0065 decision 6's note of this day). `filestore/store.test.ts`.

3. **TerminusDB is the test bed first.** The plan's steps 2 to 5 (workspace mode, push, bring in
   and deliver, the subject snapshots) are built with TerminusDB as the local store, since its
   adapter exists and the contract suite already runs against it; a fault found then is in the
   workspace hub, not in a new store. The file-backed store comes at step 6 and becomes the
   workspace hub's default. A contract test runs the invariants engine and the intelligence reads
   over both stores on the seed and requires the same answers.

4. **Whether TerminusDB stays a local store is decided after step 6.** Two audiences could keep
   two stores: designers on the folder, developers and researchers on TerminusDB in a `workspace`
   compose profile, where history and diff are exactly the remote's. The question is settled once
   the folder exists, on two counts: whether offline history at every commit has proved to matter
   to the second audience, and what keeping the compose profile rehearsed and the contract test
   double costs. Until then the compose profile is a development tool, not a documented install.

   > **Later change (2026-11-02, night, decided by Amos):** the folder is the one local store;
   > TerminusDB is a remote hub's store only. On the first count there was no evidence: no
   > developer or researcher had used the compose profile beyond its rehearsals, Quiver was
   > paused, and the advantage expected was smaller than it looked, since a clone is the remote's
   > export at the base plus the snapshots and the local commits in either store, so both held
   > the same history; what TerminusDB alone offered a developer was its dashboard and WOQL over
   > a workspace, which no one had asked for. On the second count the cost was real: the
   > workspace and cycle suites ran twice (64 of the contract job's 229 seconds), every compose
   > change rehearsed the profile over TerminusDB on a fresh VM, the Colima and Podman Desktop
   > rehearsals waited for a configuration no designer would run, and the host kept two paths.
   > So: `ARMATURE_STORE`, the setting that chose between the stores while TerminusDB was the
   > test bed (added and made role-dependent the same day), is retired and refused if set; the
   > role names the store (`app/lib/api/config.ts`, `app/server.ts`); the `workspace` compose
   > profile runs the hub's image over the folder in the volume `workspace-folder`, reads no
   > `TERMINUS_*` variable and leaves the store network; the workspace and cycle suites run over
   > the file store alone (`filestore/testing.ts`), the two-store contract test staying as the
   > guard that holds the folder to the remote's store. The test bed served its purpose: steps 2
   > to 5 were built on it, and both suites were green over both stores before it was retired. It
   > reopens on the triggers in Alternatives: a portable Windows build of TerminusDB and check AH
   > passing on macOS, with which TerminusDB beside the hub would be a choice again.

5. **The diff format is TerminusDB's JSON patch.** `docs/api.md` names it as the diff route's
   format (`docs/vendor/terminusdb/json-diff-and-patch.md`), so the dependency clients already have
   is written down, and the file-backed store produces it. A format of the API's own waits for a
   client that needs something the patch cannot say.

   > **Note (2026-11-02, evening), built:** `app/lib/api/filestore/patch.ts` emits the patch's
   > operations (`SwapValue`, a nested patch for a subdocument, `CopyList`, `PatchList`,
   > `SwapList` and `KeepList` for a list, `Insert` and `Delete` over a branch) and applies them
   > back (`applyPatch`, which the tests use to hold every diff to its after state). Where several
   > chains describe one change to a list, the file store's segmentation may differ from
   > TerminusDB's; the operations and their meaning do not, which is what a client reads.

6. **Hash identifiers are reproduced if a check shows how, and mapped otherwise.** Platform check
   AI tries to reproduce TerminusDB's Hash algorithm from the key fields and compares the result
   with the ids the store minted on the seed. If it succeeds, the file-backed store mints the same
   ids and every junction has one name on both hubs. If it fails, as Quiver's attempt did, a
   junction created offline gets a provisional id, and the push maps it to the id the remote
   returns, rewriting every local record that names it, as it rewrites `asOf` values that name
   local commits (ADR-0065 decision 5). Junctions cloned from the remote keep the remote's ids
   either way.

   > **Note (2026-10-30):** how the mapping crosses a split push is ADR-0065 decision 5's note of
   > the same day: a provisional id and its referrers travel in one request as `@capture` and
   > `@ref`, or the remote's id is written into the next part before it is sent. Review B5.

   > **Note (2026-11-02):** check AI ran and the first branch holds: the id is computable. The
   > store builds the Lexical string of the key, each value as a full IRI for a reference (under
   > the context's `@base`) or an enum value (under `@schema`, as `GrantRole/Owner`), a string or
   > an integer as itself, an absent `Optional` as the literal `+none+`, joined with `+` and
   > percent-encoded except for the unreserved characters and `!$&'()*,;=@` (UTF-8 bytes,
   > upper-case hexadecimal); the Hash id is the class name, `/`, and the lower-case hexadecimal
   > SHA-256 of that string (AI1 to AI3: an absent field in the middle and at the end, an empty
   > string, every ASCII punctuation character, non-ASCII text, a negative integer, two
   > references). The same formula reproduced the seed's ids by hand the same day for
   > `ModuleObjective`, `ItemInstance`, `Attestation` and both forms of `Grant`, with and without a
   > `branch`; the two-store contract test (Verification) is where that comparison lives in code.
   > So the file-backed store mints the same ids as the remote and a push maps nothing but
   > commits; Quiver's provisional ids become unnecessary when it moves onto that store. The
   > mapping in ADR-0065 decision 5's note stays written down as the fallback for a key form the
   > check did not cover: a Set in a key is order-independent and, empty, hashes as `+none+`
   > (AI4); no Armature key holds one.
   >
   > **Note (2026-11-02, evening), built:** `app/lib/api/filestore/ids.ts` mints by that formula,
   > reading each key field's kind (a reference, an enum, a primitive) from the store's own
   > schema entries rather than the generated types, so a folder holding another schema version
   > mints by that schema. The contract test reproduces every Hash id in the seed, all ten
   > classes, from the key fields, and the write pipeline run over both stores returns the same
   > ids for a junction and an attestation. A Random id is sixteen characters of the URL-safe
   > base64 alphabet, and a part's nested id has the store's form and is regenerated on every
   > write of its parent, as checks J4 and AB4 found the store does.

## Alternatives considered

- **TerminusDB beside the hub, for everyone** (a container, or its executable as a sidecar of a
  desktop program). The adapter as written, and history at every commit offline exactly as on the
  remote. Rejected as the designer's store: no Windows build outside WSL or a container, a macOS
  bundle unproven (check AH), and a container runtime as a second install with its own terms. It
  reopens if a portable Windows build appears and check AH passes on macOS; the sidecar path would
  then cover all three operating systems, and the folder would become a choice, not a requirement.
- **TerminusDB in a container only, with no designer release.** Rejected: it leaves out the people
  for whom offline work matters most, the designers Quiver and CoQui serve (`.claude/
  PROJECT_CONTEXT.md`, the tertiary audience).
- **Dolt** (Git's model of commits, branches and merge over SQL tables). Versioning native, one
  executable for Windows, macOS and Linux, Apache-2.0. Not chosen: its branches and merges are
  what ADR-0065 decisions 3 and 6 keep off a workspace hub; its diff is per table cell, so a
  document held in a JSON column still needs TerminusDB's patch produced by hand; the Hash
  identifiers are the same problem; and it is a second process to ship, start and recover.
  Documents would also need mapping onto tables, either one table of JSON documents or one per
  class, which makes every schema change a SQL migration. It reopens on either of two triggers:
  workspace hubs need real local branching (peers passing workspace branches directly, or scratch
  branches for an importer), or a workspace measured in use outgrows memory.
- **A single SQLite file.** One file, transactional, indexed. Not chosen for Quiver's reason: the
  folder is readable, diffable and the person's own, and versioning would still be built by hand
  on either.
- **A graph database (Neo4j).** Rejected: the hub walks the graph itself, so fast traversals go
  unused; it has no versioning; it needs a Java runtime of hundreds of MiB; and the Community
  edition's GPLv3 license would need checking before bundling.

## Verification

Check AI and the contract test are done (2026-11-02); the other two run before step 6 closes:

- **Check AI** in `scripts/platform_checks.js`: whether TerminusDB's Hash identifiers can be
  computed from the key fields, compared against the ids the store minted on the seed. Its result
  chooses between decision 6's two branches. *Done 2026-11-02: computable (AI1 to AI4); the first
  branch holds; decision 6, note.*
- **The two-store contract test** on the seed: the invariants engine and every intelligence read
  over the TerminusDB adapter and the file-backed store, with the same answers, at the base and at
  each local commit. *Done 2026-11-02 (evening): `app/lib/api/filestore/contract.test.ts` loads
  the seed's export into a file store in memory and asks both hubs every read route (the schema,
  the users, every type listed, every document, coverage, alignment, item statistics, module
  content, the trace, attestations, impact, the export) with the same answers up to the commit
  ids and the store-minted ids of parts; writes a junction and an attestation through the
  pipeline on both with the same ids, replaces the junction by its key, meets the same 422; and
  runs the operator's `check` over both.*
- *Measured 2026-11-02, for the snapshot budget:* the seed's `main` names two older commits, each
  snapshot 63 and 68 documents, about 90 KB apiece in the store's form; the budget's default is
  20 commits per workspace (`ARMATURE_SNAPSHOTS`), to be revisited against the largest real bank.
- **A measurement of opening a large workspace:** the time and memory to rebuild the state from the
  base and the commit files for the largest bank a real import produces, which is Dolt's second
  trigger. *Measured 2026-11-02 (evening), on a synthetic bank of `LearningNeed` records with a
  200-word rationale each, inserted over half the commits and revised one per commit over the
  rest, on this machine (an Apple laptop):* 5,000 documents over 1,000 commits open in about 40
  ms from memory and 180 ms from disk (2.8 MB of commit files); 20,000 over 2,000 in about 100 ms
  and 500 ms (10 MB). A document's history answers in milliseconds. Opening costs the branch's
  writes, not its length times its size, since a chain is replayed into one working map
  (`stateAt`). Heap growth was under 50 MB in every run, measured without a forced collection,
  so indicative only. No real import is near these sizes; Dolt's second trigger is far.
- **Atomic replacement on Windows:** the write-then-rename sequence under the conditions a
  designer's machine has (antivirus scanners holding files open, a folder inside a synced
  directory), since rename semantics differ from macOS and Linux. *Run in part 2026-11-02
  (night) on GitHub's Windows runner (CI's `files` job, `app/vitest.files.config.mts`), with
  Defender's real-time scanning on: the file flush, the rename over an existing file, 300
  replacements of one file in a row, a store written over 40 commits and reopened from disk,
  stray temporary files ignored, and the lock taken by exclusive create and taken over from a
  dead process all pass; the one difference found is that Windows refuses to flush a directory
  handle (`EPERM` on every write), so the folder flush after the rename is skipped there
  (`app/lib/workspaceFolder.ts`, `syncFolder`), NTFS journaling the rename itself. Still for a
  real machine: a folder inside a synced directory (OneDrive, Files On-Demand) and a process
  killed between the temporary write and the rename.* *Run on a real machine 2026-11-03 (a
  Windows 11 PC, NTFS, Defender on, OneDrive signed in with Files On-Demand; the harness a
  child bundled over the real `folderFiles` and file store, terminated by `TerminateProcess` at
  the moment `rename` is about to move the temporary file into place): killed before the rename
  of a commit file and before the rename of `head.json`, on NTFS and inside OneDrive alike, the
  folder holds the old file whole with a complete `<name>.<pid>.tmp` beside it, and the store
  reopens at the old head and takes the next write. Two things such a kill leaves for good: the
  temporary file, which opening ignores and nothing removes, and, at the head seam, a commit file
  no branch references, which opening reads and keeps. A killed hub leaves `lock`, and the next
  hub takes it over. Inside OneDrive the suites pass (30 tests, 4.2 s against 2.6 s outside),
  every file written is claimed by the cloud filter within seconds, and a commit file made
  cloud-only (`attrib +U -P`) is read and rehydrated transparently while the sync client runs.
  With the client stopped, the offline case of a folder "freed up", the first read of a cloud-only
  commit file fails with Node's `UNKNOWN` (errno -4094, "unknown error, read"), so opening the
  store fails: the hub starts and names its store as usual, then answers every request 500
  `internal_error` with the path only on its stderr, and keeps failing after the client returns,
  since `load()` keeps its first promise; a restarted hub recovers. The hub detects no synced
  folder and the plan says nothing about one (the Consequences' claim is corrected by its note).
  Open, for a decision: (a) refusing or warning on a folder inside a known synced root; (b) a
  clear error for a cloud-only file and a load retried rather than kept; (c) pinning the folder
  "always keep on this device"; (d) removing stray temporary files on open. Not rehearsed, one
  machine only: the lock file synced to a second machine, where its process id means nothing.*
  *Decided 2026-11-03 (Amos, on the session's recommendation), built the same day: (b) and (d).
  A read the operating system refuses although the file is there (`UNKNOWN`, `EIO`) is 503
  `store_unreadable` naming the file, with `Retry-After`, and the store reads its folder again on
  the next request rather than keeping the failed open (`lib/workspaceFolder.ts`, `unreadable`;
  `filestore/store.ts`, `load`; revision 2026-11-03 of `docs/client-changes.md`); taking the lock
  removes the temporary files a dead process left (`sweepTemporaries`). The kill is kept as a
  test, a child built from the real modules with esbuild and terminated at each seam
  (`lib/workspaceFolder.test.ts`). (a) and (c) wait for the desktop program of plan §14 step 7,
  which chooses the folder.*
  > **Note (2026-11-03, night):** the rehearsal's push inside the synced folder (its record,
  > `docs/windows-rehearsal-2026-11-03.md` §5) failed twice on the rename of `push.json` over
  > its previous version, refused by Windows with `EPERM` while the sync client held the file it
  > had just been handed; a loop reproduced it once in 280 renames with the client kept busy,
  > cleared by a second attempt 15 ms later, and never on plain NTFS. Decided the same night
  > (Amos, on the session's recommendation; the record's §6 option 1): `writeWhole` tries a rename
  > refused with `EPERM`, `EACCES` or `EBUSY` again with a backoff from 10 ms to 1.28 s, about
  > 2.5 seconds in all (`RENAME_WAITS`, graceful-fs's practice on Windows), then reports it as the
  > kind `unwritable`, 503 `store_unwritable` naming the file with `Retry-After`, the temporary
  > removed and the old file standing (`lib/workspaceFolder.ts`, `renameInto`; riding revision
  > 2026-11-03). The two tests are the kill test's child with its `rename` refusing the next head
  > twice, then every time. Documenting only, and rewriting the push table less often, were the
  > alternatives; the second weakens the recovery that worked twice in the rehearsal.

## Consequences

- A designer installs the workspace hub alone, on macOS, Windows or Linux, with no container
  runtime and no second process.
- The hub has two adapters to keep faithful. The two-store contract test is the guard, and the
  file-backed store reproduces TerminusDB's observable behavior where clients see it (an empty set
  returned as no field, the JSON patch), not its internals.
- A future WOQL query inside the TerminusDB adapter, such as the history query over a long log
  (What's Next item 4), stays an optimization behind the interface; the file-backed store answers
  the same method its own way. ADR-0055 decision 5's re-admission path is unchanged.
- The workspace's data is a folder the person can read, back up and diff. A folder inside a
  cloud-synced directory can be rewritten under the workspace hub by the sync service, so the
  workspace hub's default location is outside such directories and the plan says what it does when
  it finds itself inside one.
  > **Note (2026-11-03):** the plan says nothing yet about a folder inside a synced directory,
  > and the hub detects none; neither has a default location, since the desktop program (plan
  > §14 step 7) is what chooses one. The Windows rehearsal (Verification, the note of 2026-11-03)
  > found the offline case failing opaquely; since that day a file the system refuses to read is
  > 503 `store_unreadable` naming it and the open is tried again, and a rename the sync client
  > refuses is tried again for a few seconds before it is 503 `store_unwritable` (Verification,
  > the night's note), while a warning or a refusal on such a folder waits for step 7.
- State lives in memory while a workspace is open, which bounds a workspace's size; the bound is
  measured, not assumed (Verification), and crossing it is a trigger for Dolt.
- Quiver's folder becomes the workspace hub's store with three differences (plan §11); its
  provisional junction ids are decision 6's second branch already built. *Since 2026-11-02 (check
  AI) the first branch holds: the store mints the remote's ids itself, and the provisional ids are
  unnecessary once Quiver runs over it.*
- Nothing changes for a remote hub, which keeps TerminusDB and the adapter as written.
