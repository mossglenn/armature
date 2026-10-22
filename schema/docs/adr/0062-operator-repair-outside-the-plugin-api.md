# ADR-0062: Operator Repair Is a Commit Outside the Plugin API

> **In brief.** This decision answers: when something goes wrong in the graph that the rules of the
> application programming interface (API) will not let a tool put right, how is it fixed? The API
> deliberately refuses some operations (deleting a record, editing a person's entry, writing a
> record that breaks a rule), and a few states can be reached through it that cannot be left
> through it. The answer is an operator's surface that sits outside the plugin API, runs with the
> database's own credentials, and repairs by making new commits, each with an author and a reason,
> never by rewriting history. Its first three tools are a check that reports every rule the data
> currently breaks, a delete, and a replace that can be told to skip the hub's rules. It was
> accepted and built on 22 October 2026.

## Status

Accepted and implemented (2026-10-22); proposed 2026-10-20. It gives ADR-0024 decision 5 ("deletion
is an administrative operation outside the plugin API") its concrete meaning and leaves ADR-0025
decision 6 (shared history is never rewritten) intact, including for operators. Both ADRs carry a
dated note pointing here. Platform check AC (added 2026-10-20 on the `phase-6/external-references`
branch, results in §Verification) confirms the store behaviors this relies on.

**Note 2026-10-22, built.** The three tools of decision 5 are `check`, `delete` and `put` in
`app/lib/operator/`, with a command-line entry in `app/operator.ts`, tested in
`app/lib/operator/operator.test.ts`. Three things differ from the text below, which is left as
written:

- **Where they live and how they run (decision 2).** Not `scripts/`: Node cannot import the API's
  modules as they are, since their relative imports carry no extension and `errors.ts` uses a
  parameter property, which Node's type stripping refuses. The tools are bundled with esbuild into
  one `app/dist/operator.mjs` exactly as `build:hub` bundles the hub, from the same source, so they
  still reuse the adapter, the engine and the pipeline rather than reimplement them. The hub's image
  carries the bundle beside `server.mjs`, so on a server the tools run in the hub's container, where
  the store's credentials already are: `docker compose exec hub node operator.mjs check`. Locally,
  `npm run operator --workspace app -- <command>` builds and runs it with `.env.local`.
- **How `put --unchecked` skips the rules (decision 5.3).** The pipeline takes
  `invariants: 'skip'`, which leaves out its fourth step and nothing else (shape, identity,
  `createdBy`, `asOf` and the store's checks all apply). No route passes it; a test reads every
  module under `app/lib/api/` to keep it so. The commit message ends with
  `[operator: the hub's rules were skipped]` (decision 4).
- **A deleted document reads as absent (check AC4).** Building `delete` showed that the adapter took
  the store's answer to a GET of a deleted document, HTTP 200 with the 404 as text in the body, for
  the document itself, so a write reusing the deleted id was refused as a `type_conflict`. The
  adapter's `request()` now reads the embedded status and raises the 404, and the test writes a
  deleted id again.

`check` skips the two write-only rules by their codes (`attester_not_caller`,
`subject_in_same_write`) after the engine reports them, so no rule carries a mode. Run over the seed
on `main` the day it was built, it found no violation in 53 documents. `delete` refuses an operator
who is not a registered `User` and a repair without a reason; branch deletion takes
`--scratch-branch` and a name starting `test-`, `warmup-`, `anon-` or `future-` (decision 7).
The open items below remain open.

**Note 2026-10-22, the marker and the seed check.** Two of the open items are closed the same day:

- **Every operator commit is marked** in its metadata as
  `{ "armature": { "operator": { "tool": "put" | "delete", "rulesSkipped": true | false } } }`, beside
  the merge route's `mergeSource`. Since the document API drops commit metadata (V4), a repair is
  made on a transient branch (`operator-…`) cut at the target's head and applied onto the target as
  one commit carrying the marker, authored by the operator with the reason as the message; the
  transient branch is deleted when the repair ends. A target that moved meanwhile is refused, not
  merged, because a checked write was checked against the head it started from. Check AF
  (2026-10-22) confirms that `apply` carries an insert and a delete this way, that the transient
  commit stays readable by id on no branch, and that an empty diff makes no commit. The marker is
  in the branch log and on a branch's head (`GET /api/v1/branches/:name`); `/api/history` entries
  carry no metadata (V3c), so a document's history shows the operator's message, which keeps the
  `[operator: the hub's rules were skipped]` note for that reason. `operator-` joins the scratch
  prefixes, so a transient branch a crash left behind can be deleted.
- **`check` runs in CI** after the seed is loaded, in the contract job, before the tests. The seed
  is written outside the API, so nothing else would notice a seed that breaks a rule.

## Context

The hub's write path applies seventeen rules to every write (CLAUDE.md, "Critical API constraints")
and refuses a few operations outright: there is no route that deletes a document (ADR-0024 decision
5), no route that edits or deletes a `User` (ADR-0032), no force on branch deletion (ADR-0025
decision 6), and no reset, squash or rebase anywhere. These refusals are what make the graph
trustworthy: a commit id stays valid forever, a record that names a person was written by that
person, and a derived value is never stale because none is stored.

The same refusals leave a short list of states that can be reached through `/api/v1` and cannot be
left through it:

- **An identifier written under the wrong type.** Every later write of the right type under that
  id is 409 `type_conflict`, for the life of the database (constraint 12). Only deletion clears it.
- **A `User` with a typo.** Users live on `main` and have no edit or delete route. The integration
  tests already repair their own test users by hand, through the adapter's `deleteDocument`, which
  no route calls.
- **A junction with the wrong key fields.** A Hash-keyed record is found for replace by its key
  fields (ADR-0024), so a record keyed on the wrong pair is never replaced, only joined by a
  correct sibling.
- **Records that predate a rule.** A constraint added after a document was written may now be
  violated by it. Most such states are repairable through the API, because a batch write is
  validated against the branch as it will look after the whole write (`siblings` in the invariants
  engine), so mutually constrained records can be fixed in one commit. A state whose repair needs
  an intermediate write the engine refuses cannot be.
- **A scratch branch a crashed test left behind.** It has commits no other branch holds, so
  `DELETE /api/v1/branches/:name` answers 409 `unmerged_branch` forever.
- **Schema changes that existing data no longer fits.** Already an operator task; today the only
  tool is `load_schema.js --clear-instances`, which is destructive, while the store's migration
  endpoint is the real path (ADR-0022).

A discussion on 2026-10-20 about an Armature "dashboard" (a graph visualizer, a query runner and a
raw editor) made the boundary question explicit. The project already treats its own pages as
clients of the API, never of the store (`app/README.md`), and the Phase 7 plan makes the Next.js
app "the demo UI only". A dashboard is therefore a client. What remained undesigned was the surface
for actions performed *as the operator* rather than *as a `User`*: with store credentials, no
commit author of record, and the ability to do what the plugin API refuses. That surface exists
today only as `scripts/` and the TerminusDB console, with no documented repair procedure and no way
to learn whether a hand repair left the graph consistent.

## Decision

### 1. A repair is a commit

An operator repair is a new commit on the branch it repairs, with an author and a reason, exactly
like a plugin's write. The store's own document delete is such a commit (check AC2), and the
deleted document stays readable at the commit before (AC3, T2). So repair never requires rewriting
history: ADR-0025 decision 6 holds for operators as it does for plugins. Nobody resets, squashes or
rebases. The operator surface differs from the plugin API in *which* commits it may make, not in
whether history is kept.

### 2. The operator surface is outside `/api/v1`, not a mode of it

No superuser header, bypass flag or elevated identity is added to the plugin API. Every constraint
on `/api/v1` stays unconditional, which is what lets a reader of the graph trust it, and the
`header` resolver already trusts whoever can reach the API (ADR-0032 decision 1), so an elevation
there would be no protection at all.

The surface is operator tooling: scripts under `scripts/` now, the Phase 7 toolkit later. It runs
where the store's credentials are, imports the hub's own modules in-process (`app/lib/api/store.ts`
for the store's vocabulary, `app/lib/api/invariants/` for the rules, `app/lib/api/fragments.ts` for
parts), and never reimplements them, so "consistent" means one thing in the API and at the operator's
desk. Node 24 imports a `.ts` module from a plain script (SESSION.md, Phase 4 facts), so this costs
no build step.

### 3. The store's enforcement is the floor

A hand repair bypasses only the hub's seventeen rules. The store still enforces field types,
required fields, enum values, minimum cardinality and reference existence, and it refuses to delete
a document another document references (AC1). An operator therefore cannot delete a `User` named by
any `createdBy`, or leave a dangling reference anywhere. The worst class of repair mistake is an
error, not a corrupted graph.

### 4. The operator is a `User` and the reason is the message

An operator commit is authored by the operator's own `User` id on `main` (ADR-0025 decision 2), and
its message states the repair and, when the hub's rules were skipped, says so. The operator
registers like anyone else; the same person may be a designer on one commit and an operator on the
next, and the message is what tells a reader which. Whether to mark operator commits in commit
metadata as well is open (§Open): the store ignores a `metadata` parameter on a document write
(check V4), so the marker would need the `apply` path or a store change.

### 5. Three tools, in this order

1. **`check`: the invariants engine over a whole branch, read-only.** It reads every document on a
   branch at a ref, builds the engine's write context with the whole branch as the batch and every
   id as "replacing" (so a document is not its own sibling), runs every rule, and prints the
   violations in the same `{ code, id, field, message }` shape a 422 carries. Rules that are about
   the *write* rather than the *state* are skipped and named: constraint 15 (the attester is the
   caller; there is no caller) and constraint 13's same-request clause. This is how an operator
   learns what broke, and how they confirm a hand repair worked. It needs no new rule code: the
   validators that gate a write lint a branch.
2. **`delete`: one document, as a commit.** Over the adapter's existing `deleteDocument`, on a named
   branch (including `main`, where users live), with the operator's `User` and a reason. Refuses
   what the store refuses (AC1) and prints the head commit before the delete so the state remains
   addressable (AC3).
3. **`put`: one document or a batch, through the same pipeline.** By default the shape check and
   every rule run, exactly as on `/api/v1`, so the common repair (a `User`'s email, a record's
   missing field) is the ordinary write with operator credentials. A `--unchecked` flag skips the
   hub's rules, never the store's, and the message must say the rules were skipped. It exists for
   the repair that needs an intermediate state the engine refuses, and `check` is run afterward.

A tool that reads the whole graph (the visualizer) or edits a document as a `User` (the raw editor)
is a client of `/api/v1` and not part of this surface. An ad-hoc query runner for *operators* is
the TerminusDB console with store credentials, which is not a boundary violation because the
operator is not a plugin.

### 6. No raw query route on `/api/v1`

A `POST /api/v1/query` taking the store's query language is declined, and `docs/development-plan.md`
§8 records it. It would couple every client to TerminusDB's query language, against ADR-0055's
principle that the store is a backend and not a schema fact, and it would make ADR-0021's
non-aggregation guard unenforceable, since any per-person tally is one query away. Questions users
ask ad hoc are the intelligence reads, the list route's filters and, after ADR-0031, declared
slices.

### 7. Scratch branches

The adapter's `deleteBranch` has no holder rule; the tests use it to remove their scratch branches.
The operator `delete` tool extends to a branch only when the caller names it as scratch (a flag,
and a name matching the test and probe conventions), and it prints the head so the commits remain
readable by id (T2). For a branch holding design work, ADR-0025's reasoning applies to operators as
to plugins: an abandoned exploration is process data; name it, do not delete it.

### 8. `User` edits stay an operator task until a client needs them

A `User` with a wrong email is repaired with `put` on `main`. A `PUT /api/v1/users/:id` route is
added when a client needs it (carried in SESSION.md), not before; the operator path keeps the
registry correct meanwhile.

## Alternatives considered

- **A superuser mode on `/api/v1`** (a header or a role that skips the rules). Rejected: every
  constraint becomes conditional, which is the end of "a reader can trust the graph"; and the
  `header` resolver makes any elevation a matter of knowing the header's name.
- **A raw query route.** Rejected (decision 6).
- **The TerminusDB console alone.** It can do every repair but cannot say whether the result obeys
  the hub's rules, which is the one thing an operator needs to know afterward. It remains the
  operator's query tool; `check` is what it lacks.
- **An admin UI inside the Next.js app with store access.** Rejected: it would be the first page in
  the app to touch the store, ending the rule that pages are clients, and it would ship store
  credentials to wherever the demo UI is deployed. An admin tab over the three tools, deployed
  only where store credentials are, is compatible with this ADR.
- **Allowing operators to rewrite history** (reset a branch, squash a mistaken run). Rejected:
  every `asOf` and every `mergeSource` names a commit; a rewrite would make stored data point at
  states no branch contains (ADR-0025 decision 6, ADR-0028, ADR-0057). Repair by a new commit
  loses nothing and needs no exception.

## Verification

`scripts/platform_checks.js` check AC, added 2026-10-20 on the `phase-6/external-references`
branch and run against `terminusdb/terminusdb-server:v12.0.7` the same day, together with the
earlier check T2:

| Check | Result | Evidence |
|---|---|---|
| AC1 | PASS | DELETE of a document while another document references it is refused: 400 `api:SchemaCheckFailure` |
| AC2 | PASS | DELETE of an unreferenced document answers 204 and is a commit carrying the given author and message |
| AC3 | PASS | After the delete the document is gone from the branch and still readable at the commit before |
| AC4 | INFO | A GET of the deleted document answers HTTP 200 with a 404 envelope in the body (`api:DocumentNotFound`); the adapter reads the body, not the status |
| T2 (2026-10-08) | PASS | A deleted branch's commits remain readable at their ids |
| V4 (2026-10-08) | INFO | A `metadata` parameter on a document write is ignored, which is why an operator marker is open |

## Consequences

**Positive**

- Every state the API can reach has a documented way out, and none of them rewrites history.
- `check` turns the invariants engine into a lint for a whole branch at no new rule code, which
  also gives the seed and any imported graph a consistency report.
- The plugin API stays uniform: no conditional constraints, no elevated identity, nothing a client
  must know about operators.
- The store's own enforcement protects the graph from the worst repair mistakes without the hub
  doing anything.

**Negative**

- A second surface to document and keep in step with the API, even though it shares the code.
- `--unchecked` is a sharp tool. Its commit message is the only record that the rules were skipped
  until a metadata marker exists (§Open).
- Operators need store credentials and a shell; there is no browser surface for repair, by design,
  until a deployment with an authenticated identity resolver exists.

**Neutral**

- The dashboard discussed on 2026-10-20 splits cleanly: the visualizer and the editor are clients
  of `/api/v1` (the visualizer's whole-graph read is ADR-0031's export route); only an admin tab,
  if one is wanted, sits over these tools.
- The tests' use of `deleteDocument` and `deleteBranch` through the adapter is the first instance
  of this surface, and stays as it is.

## Open

- **A marker for operator commits** in commit metadata, so a reader of the log can filter them
  without parsing messages. The document API ignores a `metadata` parameter (V4); `apply` accepts
  one (V2). Decide when `check` or `put` first needs to find earlier repairs. *Done 2026-10-22,
  before any tool needed it: see the second note under Status.*
- **`check` as a scheduled job** over `main`, or as a CI step after the seed, once the tests run in
  CI (Phase 7). *The CI step is done 2026-10-22 (second note under Status); a scheduled job over
  a deployed instance's `main` is still open, and waits for an instance that is kept.*
- **Whether the three tools ship in the Phase 7 toolkit** as a command of the client package or
  stay scripts in this repository. *Decided 2026-10-22: neither. They ship in the hub's image,
  beside the hub, and not in `@armature/client`. The client package is a plugin's view of the
  API, over HTTP and without store credentials; tools that write outside `/api/v1` with the
  store's credentials do not belong in every plugin's dependencies. They reuse the hub's adapter,
  rules and pipeline, so they are correct only at the hub's own version, which the image
  guarantees and a separately released package would not. And they work only where the store's
  credentials are, which on a server is the hub's container. If operators need them without a
  checkout, a published hub image (plan, Phase 7 follow-ups) delivers them; if they ever need a
  package of their own, it is a separate one versioned with the hub, never the client.*

## Related

- ADR-0024 — decision 5, deletion is administrative; this ADR says what that means
- ADR-0025 — decision 6, history is never rewritten; holds for operators; branch deletion rules
- ADR-0021 — no per-person aggregation; why a raw query route is declined
- ADR-0032 — the operator is a `User`; the `header` resolver's trust
- ADR-0055 — the adapter is the one store vocabulary, reused in-process
- ADR-0022 — schema migration is the store's, not a reload, for real data
- `docs/development-plan.md` §8 (declined: a raw query route), Phase 7 (the toolkit)
- `app/README.md` — pages are clients of the API, never of the store
