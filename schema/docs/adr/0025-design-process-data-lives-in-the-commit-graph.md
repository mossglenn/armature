# ADR-0025: Design process data lives in the commit graph

## Status

Accepted (2026-10-08). Verified against TerminusDB v12.0.7 by `scripts/platform_checks.js`
checks M to T, results in §Verification. Makes ADR-0010's versioning deferral a decision; resolves
the data-version token question ADR-0054 left open; absorbs research candidate 0036's no-rewrite
rule. Research candidates 0037 (release pointers), 0046 (change feed) and the delegation trailers
proposed for this ADR are deferred, with the reason for each in §Consequences.

## Context

The position paper's third principle (plan §1 P3) promises version control modeled on Git:
immutable history, branches for parallel work, and merges "inscribed with its author, the time,
and the reason for the change". It also describes a "new version of" relation between artifact
versions. The paper's first principle counts the history of how artifacts and relations changed as
one of the three parts of design data. The schema models the other two and exposes none of the
third: no route returns a commit, a branch, a history or a diff.

The store keeps one document per id and versions it inside a commit graph. ADR-0010 deferred
`version`, `createdAt` and `updatedAt` fields on the grounds that the commit graph might make them
unnecessary; ADR-0015 chose `createdBy` only and left change history to the commit level. Both
were waiting for this decision.

What the store does, reproduced on 2026-10-08 in a scratch database (check letters refer to
`scripts/platform_checks.js`):

- Every write is a commit with `author`, `message`, `timestamp` and an `identifier` (S). The
  author is a free string the store records without checking (plan §9; the vendored
  `commit-message-howto.md` calls it logical responsibility, distinct from the HTTP user).
- **A commit has one parent.** The commit graph (`local/_commits`) is an ordinary document graph
  whose schema, read from the running store, declares `Commit.parent` as `Optional<Commit>`.
  There is no second parent, so no commit can record that it joined two histories. `apply` is
  patch-based: the CLI reference describes it as "apply a diff to path which is obtained from
  the differences between two commits". It adds one commit to the target, authored by whoever
  merged, and does not link the source branch's commits. Its three-way character is the conflict
  check against the target (`@expected` versus `@found`), not the graph shape. The docs'
  "merge" vocabulary describes the conflict check, not a Git merge commit. This is a property of
  the store, the same trade-off rebase-only Git workflows make, and it is why decision 5 records
  the merged source commit itself. The commit schema also carries `metadata: Optional<sys:JSON>`,
  documented as user-supplied JSON. `apply` stores what `commit_info.metadata` carries and the
  log returns it; the history endpoint does not, and a `metadata` query parameter on a document
  write is ignored (V1 to V4). So the merge source has a structured home on exactly the commits
  that need it.
- A document read on a branch returns `TerminusDB-Data-Version: branch:<commit-id>`, where the
  id is the branch head in the log (M1, M2). A read at `local/commit/<id>` returns
  `commit:<id>` (M3) and rejects writes with `api:DocumentAccessImpossible` (O5).
- A write carrying the current `branch:<id>` token succeeds; a stale token is rejected with
  HTTP 400 and `api:DataVersionMismatch`; a bare commit id is rejected with `api:BadDataVersion`
  (M4 to M6).
- `/api/history?id=<doc>&diff=true` returns the commits that touched one document, newest first,
  each with author, message, timestamp, identifier and the structural diff that commit made to
  the document; `start` and `count` page it (N1 to N5).
- A branch created from `local/commit/<id>` starts at that commit with the same identifier, and
  reads on it return the state at that commit (O1 to O4). `/api/db/<org>/<db>?branches=true`
  lists branch names (O6).
- `apply` is a three-way merge. It takes `before_commit` and `after_commit` as bare commit ids
  (commit paths are rejected with `api:NotValidRefError`), applies the diff between them to the
  target branch, and leaves the target's unrelated changes intact (P1, P3b). The merge commit
  carries the `commit_info` author and message (P2). A conflicting field change returns HTTP 409
  with `api:status: api:conflict` and witnesses of the form
  `{ "@id", "<field>": { "@op": "Conflict", "@expected": <base value>, "@found": <target value> } }`
  and leaves the target head unchanged (P4, P5). The vendored docs describe the witness as
  `@before`, `@after_left`, `@after_right`; the store does not return that shape.
- `rebase` replays a branch's commits onto another and gives them new identifiers; the original
  commit remains readable at its old id (Q1 to Q4). The request `POST /api/rebase/<X>` with
  `rebase_from: <Y>` rebases X onto Y and leaves Y's head unchanged (Q3); the vendored page reads
  the other way round.
- `/api/diff` between two data versions with no `document_id` returns one entry per changed
  document; inserts and deletes carry the id inside `@insert` or `@delete`, field changes carry
  it as `@id`. It accepts bare commit ids, branch names and `branch:<id>` tokens (R1 to R3).
- Deleting a branch keeps its commits readable at `local/commit/<id>` (T2). The DELETE needs a
  JSON body (`{}`) when it carries a JSON content type; with the content type and no body the
  server returns 500 (T1).
- A commit's existence is checked by reading `ValidCommit/<id>` from the commit graph
  (`local/_commits`), which returns the commit or `api:DocumentNotFound`. A document read at a
  commit path that does not exist is a server 500 with no distinguishing type, so the hub
  validates caller-supplied commit ids first (U1 to U3).

Two downstream facts shape the decision. Attestations and findings will store commit ids
(research candidate 0036; ADR-0028), so the ids must stay valid. And CoQui's `httpHub` will
round-trip whatever concurrency token the API exposes, so the token's shape has to be fixed before
Phase 2's routes land (ADR-0054 consequences).

## Decision

1. **The commit is the unit of design process data.** No `version`, `createdAt`, `updatedAt`,
   `updatedBy` or "new version of" field is added to any type. ADR-0010's deferral of these
   becomes permanent for them. The history of a document is the sequence of commits that touched
   it, and its previous version is the same id read at the previous commit in that sequence.

2. **Every write is a commit with an author and a reason.** The author is the `@id` of the
   Armature `User` the request resolved to (`User/<id>`), set by the hub and never taken from the
   body (ADR-0055 decision 3). The reason is the commit message, required and non-empty; a write
   without one is rejected with 400. The message is free text and is returned as stored.
   Structured facts about a commit go in the commit's JSON `metadata` under an `armature` key,
   the namespace the schema already uses (ADR-0027), where the store lets the hub set it
   (decision 5); where it does not, git-style trailers in the message (a blank line, then
   `Key: value` lines) remain reserved. No trailer is defined in this phase; the delegation
   trailers proposed for this ADR wait for their trigger.

   Until ADR-0032 lands in Phase 3, the hub resolves the author from an `Armature-User` request
   header holding a `User` document id, verifies the document exists and is a `User`, and
   rejects a write without one with 401. This is the interim resolution ADR-0055 anticipated; it
   keeps the route contract stable while the mechanism changes. *Done (2026-10-08):* ADR-0032
   replaced it with a pluggable resolver; the header now carries an `externalId`, resolved to a
   `User` on `main`.

3. **Every read is at a named ref.** Document reads accept `branch` (default `main`) or `ref`
   (a commit id), never both. A read at a commit is read-only by construction. The response
   carries the commit it was served from (decision 7).

4. **Branches are the unit of parallel work.** `main` is the shared branch. A branch is created
   from a branch head or from a commit, and the hub validates the name. Branch creation is not a
   commit and records no author in the store; the hub does not add one. Branch names are a
   plugin's choice and carry no hub meaning.

5. **Merge is the store's three-way `apply`, wrapped.** `apply` takes an explicit `before_commit`
   and does not compute one, and the commit it creates has a single parent, so the store does not
   remember which source commit a merge brought in. The hub therefore does two things. It stores
   `{ "armature": { "mergeSource": "<commit-id>" } }` as the merge commit's metadata, naming the
   source head that was merged; `apply` accepts it in `commit_info` and the log returns it
   (checks V2, V3b). And it computes the merge base by walking the target's log newest first for
   the first commit that is in the source's log, or whose merge metadata names a source commit,
   or that a source commit's merge metadata names. It then applies the diff from base to the
   source head onto the target branch with the resolved author and the caller's reason. A source
   already merged is reported as up to date without a commit. On conflict the hub returns 409
   with the base commit and one entry per
   witness: document id, field, the base value (`@expected`), the target's current value
   (`@found`), and the source branch's value, which the hub reads from the source head because
   the witness does not include it. Nothing is resolved by the hub. Who may merge, per-type
   merge filtering and a fragment-level conflict view remain the open merge-policy question in
   plan §6.

6. **Shared history is never rewritten.** The hub exposes no reset, squash or rebase, on any
   branch, and does not call them. Rebase changes commit identifiers (Q2), and a pinned id would
   then name a commit no branch reaches. Reads at a commit id still work after a rebase or a
   branch delete (Q4, T2), so an existing pin never dangles on this store; the rule protects the
   meaning of the pin, which is "a state on a shared branch", not its readability. Branch delete
   is reserved for a later phase and is subject to the same rule: a branch whose commits another
   document references is not deleted. Content-hash pins beside commit ids (candidate 0036) are
   ADR-0028's to specify, as an integrity check across stores rather than a reachability check
   within this one.

7. **`/api/v1` exposes the bare commit id, in standard HTTP headers.** Every response that read
   from or wrote to the store carries `ETag: "<commit-id>"`: the commit the read was served from,
   or the commit the write created. Writes accept `If-Match: "<commit-id>"`; the hub forwards it
   to the store as `TerminusDB-Data-Version: branch:<commit-id>` and maps the store's
   `api:DataVersionMismatch` to 412 Precondition Failed with the current head in the body. The
   token is the branch head, so a stale `If-Match` means someone committed to the branch since
   the read, whether or not they touched this document; the client re-reads and retries. The
   store's `TerminusDB-Data-Version` header and its `branch:` and `commit:` prefixes never appear
   in `/api/v1`, which closes the question ADR-0054 raised.

8. **History, changes and diff are read routes over the store's endpoints.** A document's
   history returns the commits that touched it, newest first, each with commit id, author,
   message, timestamp and the structural diff. A branch's changes since a commit are the changed
   document ids with their operation, derived from the store's diff with no document filter. A
   document's diff between two commits is the store's structural diff. List fields diff
   positionally in the store, so fragment-aware diffing stays in the plugin (ADR-0023, CoQui's
   conclusion).

9. **Write requests carry the reason in a JSON envelope.** A `/api/v1` write body is an object
   with a required `message` and the operation's own fields: `{ message, document }` for a
   document write, `{ message, from }` for a merge, `{ name, from }` for a branch (no message,
   since it is not a commit). Phase 3's generic write path extends the envelope; it does not
   replace it.

## Verification

`scripts/platform_checks.js` run on 2026-10-08 against `terminusdb/terminusdb-server:v12.0.7`;
every Phase 1 check still passes.

| Check | Result | Finding |
|---|---|---|
| S | PASS | `/api/log` entries carry `author`, `message`, `timestamp`, `identifier`, `parent` |
| M1, M2 | PASS | Branch read token is `branch:<id>` and the id is the log head |
| M3 | PASS | Read at `local/commit/<id>` works; token is `commit:<id>` |
| M4 | PASS | Write with the current token succeeds and returns the new head |
| M5 | PASS | Write with a stale token: HTTP 400, `api:DataVersionMismatch` |
| M6 | INFO | A bare commit id as the token: HTTP 400, `api:BadDataVersion` |
| N1, N2 | PASS | History entries with `diff=true` carry the per-commit diff |
| N3, N4, N5 | PASS/INFO | The insert commit's diff is an `Insert`; newest first; `start`/`count` page; default-branch path works |
| O1, O2 | PASS | Branch from a commit path; head identifier equals the origin commit |
| O3, O4 | PASS | Reads at the commit and on the new branch return the state then |
| O5 | PASS | Write at a commit path rejected, `api:DocumentAccessImpossible` |
| O6 | INFO | `?branches=true` lists names |
| P1 | PASS | `apply` accepts bare commit ids; commit paths are `api:NotValidRefError` |
| P2, P3, P3b | PASS | Merge commit carries `commit_info`; merged document present; target's unrelated change intact (three-way) |
| P4, P5 | PASS | Conflict: HTTP 409, `api:conflict`, witness `@op: Conflict` with `@expected`/`@found`; target head unchanged |
| Q1 to Q4 | PASS | Rebase succeeds, rewrites the replayed commit's id, leaves the base branch's head unchanged, old id still readable |
| R1 to R3 | PASS | Diff with no document id lists changed documents; accepts bare ids, `branch:<id>` and branch names |
| T1, T1b | PASS | Branch delete works with a `{}` body; 500 with a JSON content type and no body |
| T2 | PASS | A deleted branch's commit remains readable at its id |
| U1, U2 | PASS | `ValidCommit/<id>` in `local/_commits` returns the commit, or `api:DocumentNotFound` |
| U3 | INFO | A document read at a non-existent commit path is a 500 `api:InternalServerError` |
| V1 | PASS | Commit schema: `parent` is `Optional<Commit>`, `metadata` is `Optional<sys:JSON>` |
| V2, V3, V3b | PASS | `apply` stores `commit_info.metadata`; the merge commit has one parent; `/api/log` returns the metadata |
| V3c, V4 | INFO | `/api/history` entries carry no metadata; a `metadata` query parameter on a document `PUT` is ignored |

## Consequences

- Phase 2's routes are fixed: read at ref, a provisional document write, branches (create, list,
  head), merge, history, changes since a commit, and diff, all under `/api/v1` and all through
  ADR-0055's adapter. The document write is provisional because the invariants engine arrives in
  Phase 3; until then it checks only that the body's `@type` matches the route, that the id is
  not held by another type (ADR-0024), and that author and reason are present.
- Plan §9 gains the corrections above: the conflict witness shape, the 400 on a stale token, bare
  ids for `apply`, the rebase direction, the DELETE body. The vendored pages for merge and
  Git-for-Data are wrong on two of these; the running store is authoritative (`terminusdb` skill
  trust order).
- The merge base is found by walking two logs and reading merge metadata. Without it, a second
  merge from the same branch would find the original fork as its base and replay an insert the
  target already has, which the store reports as an `@id_already_exists` conflict (found while
  testing the walkthrough). At demo scale the walk is a handful of requests; at larger scale the
  commit graph (`local/_commits`) can be queried directly, which is one of the WOQL cases
  ADR-0055 decision 5 admits. The metadata is hub data in a store field, the same arrangement as
  the author string. It was first implemented as a `Merge-Source` message trailer and moved to
  commit metadata the same day once check V showed the store keeps it.
- `ETag` on a document is the branch head, not a hash of the document, so two reads of an
  unchanged document across commits get different tags. Caches treat that as a changed resource,
  which is harmless. `If-None-Match` is not supported in this phase.
- The interim `Armature-User` header trusts the caller. It is acceptable only because the demo
  has no auth (SESSION.md active decisions) and because ADR-0032 replaces the mechanism without
  changing any route. Two limits apply meanwhile: the provisional write accepts only artifact and
  relationship classes, so a caller cannot mint the `User` it then names as author, and the
  mutating routes must not be exposed beyond the local demo until ADR-0032 lands.
- The hub never offers history rewriting, so a demo cannot "undo" a commit except by a new
  commit that restores the earlier state, which is the Git discipline the paper asks for.
- Deferred, each with its trigger: release pointers (candidate 0037) when the first delivered
  design state needs a stable name; a cursor-based change feed (candidate 0046) when a second
  consumer of `changes?since=` appears, since the commit id already serves as the cursor;
  delegation trailers when an agent user acts on someone's behalf (plan §1 P5); content-hash
  pins with ADR-0028.
- ADR-0010 is amended to record that the versioning deferral is now decided. ADR-0015's
  "change history is tracked at the commit level" is confirmed. ADR-0054's open data-version
  consequence is closed. CLAUDE.md's rule against forwarding store tokens becomes the positive
  rule: `ETag` and `If-Match` carry bare commit ids.
