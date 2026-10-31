# ADR-0066: The Workspace Hub's Store Is a Folder of Files, Behind an Adapter Interface

> **In brief.** This decision answers: what holds the data when the hub runs on a person's own
> machine as a workspace hub (ADR-0065)? The proposed answer is a folder of plain files that the
> hub itself reads and writes, so that installing Armature on a designer's computer, Windows
> included, is one install with nothing running beside it. The database the shared hub uses,
> TerminusDB, serves first as the test bed while the workspace hub is built. Once the folder works,
> a second decision settles whether developers and researchers keep TerminusDB as their local store.
> It is proposed, not built, and takes effect only if ADR-0065 is accepted.

## Status

Proposed (2026-10-29). Nothing is built on it.

It depends on ADR-0065: a store for the workspace hub matters only if there is a workspace hub. It
answers ADR-0065 decision 8, which leaves the store open, and `docs/workspace-hub-plan.md` §16
questions 2 and 11. On acceptance it would amend:

- **ADR-0055 decision 1** ("one HTTP adapter"): the adapter becomes an interface with one
  implementation per store. The TerminusDB adapter stays the only module that talks to TerminusDB,
  and ADR-0055's decisions 2 to 7 hold for it unchanged.

ADR-0055 gets a dated note pointing here when this one is accepted.

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

5. **The diff format is TerminusDB's JSON patch.** `docs/api.md` names it as the diff route's
   format (`docs/vendor/terminusdb/json-diff-and-patch.md`), so the dependency clients already have
   is written down, and the file-backed store produces it. A format of the API's own waits for a
   client that needs something the patch cannot say.

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

None yet. Before acceptance, or before step 6 at the latest:

- **Check AI** in `scripts/platform_checks.js`: whether TerminusDB's Hash identifiers can be
  computed from the key fields, compared against the ids the store minted on the seed. Its result
  chooses between decision 6's two branches.
- **The two-store contract test** on the seed: the invariants engine and every intelligence read
  over the TerminusDB adapter and the file-backed store, with the same answers, at the base and at
  each local commit.
- **A measurement of opening a large workspace:** the time and memory to rebuild the state from the
  base and the commit files for the largest bank a real import produces, which is Dolt's second
  trigger.
- **Atomic replacement on Windows:** the write-then-rename sequence under the conditions a
  designer's machine has (antivirus scanners holding files open, a folder inside a synced
  directory), since rename semantics differ from macOS and Linux.

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
- State lives in memory while a workspace is open, which bounds a workspace's size; the bound is
  measured, not assumed (Verification), and crossing it is a trigger for Dolt.
- Quiver's folder becomes the workspace hub's store with three differences (plan §11); its
  provisional junction ids are decision 6's second branch already built.
- Nothing changes for a remote hub, which keeps TerminusDB and the adapter as written.
