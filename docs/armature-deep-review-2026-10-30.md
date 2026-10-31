# Armature repository: deep code, documentation, and architecture review

> **Status since this review (2026-10-30).** This is an outside agent's review of the repository at `e3c0396`, kept as written. It worked from an extracted archive rather than the checkout, so its test count and the vendored page it names include local state. A session the same day checked every line reference it cites for the code findings and the documentation facts and found them accurate; that session's assessment of priority is recorded in `.claude/SESSION.md`. Since then:
>
> - **The documentation facts (§ "Concrete inconsistencies") are fixed** (the documentation pull request of 2026-10-30): the explainer's counts (31 classes, 15 enums, the rules numbered 0 to 20, the fifteen vocabularies listed in its Appendix B); the appendix generator no longer states an invariant count, so that sentence cannot drift again; ADR-0005's index summary says `Lesson`; a dated note under ADR-0067's and ADR-0068's Verification says what "before acceptance" means now that they are accepted. The same counts were stale in ADR-0006's and ADR-0008's status notes, corrected at the same time. The fifth item, the broken links in `docs/vendor/terminusdb/_all/render-as.md`, needs no fix: `_all/` is gitignored and holds nothing the repository tracks; the file was the sync script's local output, present in the archive.
> - **B1 and B2 are confirmed** against `intelligence/graph.ts`, `routes/export.ts` and `write.ts`, and proposed for the adapter-interface step (workspace hub plan §14, step 1), where a read pinned to one commit is a method of the interface. **B3** was already recorded (`docs/api.md`, plan §14 step 4); the review's argument that the check belongs on the remote, before the merge commits, rather than on the workspace hub afterward (ADR-0065 decision 6), is put to Amos. **B4 and B5** are confirmed as gaps in plan §10 and ADR-0065 decision 5 (a commit file named by its content hash cannot also hold `pushedAs`; a `@capture` cannot cross an `Armature-Workspace-Part` boundary) and belong before step 3. **B6, B7 and H1 to H8** are assessed as items before step 7, the release, with two disagreements noted: the commit trailers, not a separate journal, are the project's chosen recovery key (ADR-0025 decision 2, check AJ, the planned log route), and the diff format was decided with a named trigger (ADR-0066 decision 5). The review's advice to pause is not taken: step 1 changes no behavior and is where B1 and B2 land.
> - **Nothing else in it has been decided.** Open for Amos: B3's placement, B5's approach, B7's read policy, and `(iss, sub)` from the start (H4). Record each here as it lands.
>
> The review's own identifiers (B1 to B7, H1 to H8) are the names to cite its findings by.

**Review date:** 2026-10-30  
**Reviewed revision:** `e3c0396` on `main`  
**Repository reviewed:** extracted `armature.zip`  
**Review posture:** static review of the code, schema, tests, deployment files, plans, and every ADR; dynamic validation against an isolated TerminusDB instance

## Executive assessment

Armature is a thoughtful, disciplined project with a substantially better foundation than most repositories at this stage. Its strongest qualities are the explicit architecture record, schema-generated types and validators, host-neutral API boundary, centralized write pipeline, stable error contract, commit-aware API, and unusually comprehensive contract tests. The current implementation is coherent at demo scale, and the existing test suite is healthy.

I would nevertheless **pause the next workspace-hub/public-remote development phase long enough to resolve seven architectural blockers**:

1. Multi-read requests against a branch are not actually pinned to one commit, despite the API promising one coherent ref and ETag.
2. The write pipeline can validate one branch state and commit onto a newer state when the caller omits `If-Match`, allowing concurrent writes to violate invariants.
3. Branch merges bypass the invariant engine; checking after the merge is too late because the invalid shared commit already exists.
4. The planned file store and push protocol do not yet have a sound immutability, crash-recovery, idempotency, split-commit, or provisional-identifier story.
5. Provisional Hash identifiers cannot safely cross batch/split boundaries under the replay design as written.
6. `Host`/`Origin` checks protect a workspace hub from malicious web pages, but do not authenticate local native processes that can use the hub owner's remote credential.
7. The planned public remote lets every resolved identity read every branch and select a full export, including user data; export profiles do not constitute access control.

These are not reasons to replace the overall architecture. The central shape—remote authority backed by TerminusDB, a host-neutral Hono API, typed clients, a local workspace hub behind the same API, and tools that never reach the store directly—is a good fit for Armature. The next phase should strengthen the transactional and trust boundaries within that shape.

### Overall scorecard

| Area | Assessment | Why |
|---|---:|---|
| Architecture | **B+ foundation / C+ planned local-first path** | Boundaries and responsibilities are strong; workspace replay and public trust boundaries need amendment before implementation. |
| Correctness | **B-** | Strong validation and tests, but branch reads/writes can span multiple heads and merges can commit invalid graphs. |
| Security | **B for current loopback demo / C- for planned public release** | The current private boundary is explicit; public read authorization, relay scope, local process authentication, secrets, and network segmentation remain unresolved. |
| Reliability | **B-** | Commit history and optimistic concurrency are good primitives; timeouts, size limits, readiness, backup/restore validation, and replay recovery need work. |
| Performance/scalability | **C+** | The code is honest about demo-scale scans, but export and intelligence reads are unbounded and several routes perform whole-type or whole-graph work. |
| Maintainability | **A-** | Clear modules, generated contracts, ADRs, and tests. Duplication across explanatory documents is beginning to drift. |
| Documentation | **A- breadth / B consistency** | Excellent rationale and operational detail; a few generated/current-state facts are stale, and accepted-but-unverified ADR wording is inconsistent. |
| Testing | **A-** | 296 tests pass, with real-store contract coverage. Concurrency, crash/recovery, authorization, load, and fault-injection tests are the important missing layers. |

## What was verified

The review did not rely only on reading files. The following checks were run against the extracted repository:

| Check | Result |
|---|---|
| Repository status | Clean `main` at `e3c0396` before and after review |
| Lint | Passed |
| Type-check, all workspaces | Passed |
| Generated schema/type drift check | Passed |
| Hub production bundle | Passed |
| Operator production bundle | Passed |
| Schema load and seed into an isolated TerminusDB v12.0.7 | Passed |
| Operator whole-graph integrity check | Passed: 69 documents, no violations |
| Contract/unit suite | Passed: 22 files, **296 tests** |
| Viewer production build in a network-restricted environment | Failed because `next/font/google` downloads Geist fonts at build time |
| Markdown relative-link scan | 325 files checked; 5 broken links, all in one vendored TerminusDB document |
| Dependency advisory scan | No conclusion: the registry audit call did not complete in the review environment |

The viewer failure is actionable even if hosted CI currently has network access: a local-first project should not require Google to be reachable during a reproducible production build. `app/app/layout.tsx:2,9-17` should use vendored/local fonts or a system font stack.

## Architecture as implemented and planned

```text
                         PUBLIC / SHARED AUTHORITY

 browser viewer ─┐
 typed clients ──┼── HTTPS/OIDC ──> remote Hono hub ──> TerminusDB
 services ───────┘                    │
                                      ├─ identity + authorization
                                      ├─ shape/provenance/invariants
                                      ├─ history/branch/merge API
                                      └─ design-intelligence reads

                         LOCAL / SINGLE-OWNER WORKSPACE

 local tools ── scoped local credential ──> workspace Hono hub
                                             │
                                             ├─ same document API/rules
                                             ├─ immutable local commit objects
                                             ├─ rebuildable index + push journal
                                             └─ authenticated/idempotent replay
                                                        │
                                                        └──> remote hub (authority)
```

The significant amendments from the present plans are:

- resolve a branch to an immutable commit at the beginning of every multi-read or validation operation;
- make the remote merge route validate the prospective merged state before committing it;
- keep local commit objects immutable and store replay metadata separately;
- give replay an idempotency protocol owned by the remote API;
- authenticate local clients with scoped capabilities, not only network location and web-origin checks;
- authorize reads and exports on the remote, not just writes;
- use two container networks so plugins/viewers cannot directly reach TerminusDB;
- define an Armature-owned diff contract instead of making a second store emulate a private store format forever.

## Prioritized findings

### Release blockers

| ID | Finding | Impact | Required before |
|---|---|---|---|
| B1 | Branch reads are not pinned to one commit | Mixed-state responses and incorrect ETags | Further intelligence/viewer work |
| B2 | Validation and commit are not one optimistic transaction | Concurrent writes can create invariant-invalid state | Multi-user remote or workspace replay |
| B3 | Merges bypass invariants | A clean pair of branches can produce an invalid shared graph | Workspace delivery/review rounds |
| B4 | Workspace commit/replay design is not crash-safe or immutable | Lost mappings, duplicate replay, changing commit IDs, partial logical commits | Workspace push implementation |
| B5 | Provisional junction IDs and split commits lack an atomic transform | References can point at IDs the remote never creates | File-store push implementation |
| B6 | Workspace hub does not authenticate local native callers | Any local process can act as the owner and use the remote credential | Desktop/workspace release |
| B7 | Public remote read policy exposes the full graph and people data | Any accepted identity can export all branches and user records | OIDC/public remote release |

### High-priority findings

| ID | Finding | Primary area |
|---|---|---|
| H1 | Relay grants are too broad to safely impersonate prior authors | Authorization |
| H2 | Branch ownership/grant creation and revocation are non-atomic and branch names are reusable | Authorization/data integrity |
| H3 | Merge heads are not preconditioned and ancestry traversal silently caps at 5,000 commits | Branch correctness |
| H4 | OIDC assumes JWT access tokens and unqualified `sub` identifiers | Authentication/interoperability |
| H5 | Public reverse-proxy/API topology is not yet specified | Deployment/security |
| H6 | Request bodies, exports, graph reads, and reverse lookups are unbounded | Availability/performance |
| H7 | Store and client requests have no deadlines or cancellation | Reliability |
| H8 | A shared Docker network exposes TerminusDB to every colocated plugin | Deployment/security |

### Medium and documentation findings

These include incorrect `If-Match: *` semantics, permissive query parsing, external-ID uniqueness outside the operator check, weak numeric domain constraints, missing cycle semantics for prerequisites, offline font downloads, missing dependency/security automation, stale schema counts, a stale generated-invariant count, an outdated ADR index summary, accepted ADR verification wording, duplicate API prose, and broken links in vendored documentation.

---

## Detailed findings and recommendations

### B1. Multi-read branch requests can combine different commits

**Evidence**

- `app/lib/api/intelligence/graph.ts:7-12,31-35,101-113` records the commit from the first read and assumes every later read uses the same ref. A branch ref is mutable; every store call can observe a newer head.
- `app/lib/api/routes/export.ts:36-45` fetches all documents and the schema in separate branch-bound calls, while returning only the documents call's commit as the ETag.
- `app/lib/api/routes/documents.ts:191-205` reads a head, history, and the head again. Avoiding the cache when the head moved does not make the returned history belong to the original ETag.
- `app/app/graph/page.tsx:33-43` gets a commit from export, then performs selection/lens reads against the original branch rather than that commit.
- `app/app/graph/[type]/[id]/page.tsx:57-60,77-80` starts export and trace concurrently against a moving branch and repeats the branch ref for later reads.
- `app/app/coverage/[moduleId]/page.tsx:215-227` is a positive counterexample: after the initial response, companion reads use the returned commit.

**Why it matters**

The API documentation promises that every read happens “at a ref” and that the ETag is the commit served. Under concurrent activity, an intelligence response can contain nodes from different commits, an export can pair one document graph with a different schema, and a viewer can render an internally inconsistent set of panels. This is a correctness problem, not merely a cache problem.

**Recommendation**

Resolve `branch` to its current head exactly once at the start of a multi-read request, verify that commit exists, and construct a commit-bound `Store`/`Graph` for every subsequent read. The ETag is then that resolved commit. Apply the same pattern to export, schema-plus-data operations, history, and viewer companion requests. Prefer a helper such as `resolveReadSnapshot(ref): { storeAtCommit, commit }` so routes cannot accidentally reintroduce mutable branch reads.

Add a deterministic test hook that advances the branch between the first and second store call. Assert that the response remains entirely at the original commit.

### B2. The write pipeline can validate one state and commit onto another

**Evidence**

- `app/lib/api/write.ts:123-159` finds replacements, copies provenance, fills `asOf`, and evaluates invariants through the mutable branch store.
- `app/lib/api/write.ts:165-170` passes only the caller's optional `If-Match` to the final write.
- `app/lib/api/store.ts:327-335` therefore supplies no data-version guard when the caller omits the header.
- `docs/api.md` explicitly says a missing `If-Match` is an unconditional write.

**Failure mode**

Two writers can both read the same old state, both pass a uniqueness invariant such as `duplicate_sequence`, and then commit sequentially without either seeing the other's change. The resulting branch violates a rule that “every write” supposedly enforces. The validation reads themselves can also span more than one branch head.

**Recommendation**

At the beginning of every write:

1. capture the current branch head;
2. if the caller supplied `If-Match`, require it to equal that head;
3. perform all lookup, provenance, `asOf`, reference, and invariant reads through a store pinned to that captured commit;
4. always send the captured commit as the store's data-version precondition;
5. on mismatch, return 412 or perform a small bounded retry that repeats the **entire** validation pipeline on the new snapshot.

For replacing an existing artifact, strongly consider requiring a caller-visible `If-Match` in remote/multi-user mode. Even with internal snapshot guarding, an unconditional replacement otherwise intentionally overwrites intervening edits after a retry.

Add race tests for two distinct writes that collide on every cross-document uniqueness rule, plus replacement-vs-replacement tests. This is the most important correctness change in the current code.

### B3. The merge route commits before invariants are checked

**Evidence**

- `app/lib/api/routes/branches.ts:206-239` calls the store's merge/apply operation directly.
- `docs/api.md` documents that the merged state is not checked.
- ADR-0068 acknowledges the gap at `schema/docs/adr/0068-authorization.md:70-73`.
- ADR-0065 proposes checking from the workspace hub **after** each remote merge at `schema/docs/adr/0065-workspace-hub.md:171-177`.
- `docs/workspace-hub-plan.md:205-206` already identifies prospective invariant checking and dry-run merge as asks.

**Why the current plan is insufficient**

Running the operator or workspace invariant engine after a successful remote merge only detects that the authoritative branch is already invalid. It also makes enforcement depend on a particular client even though the remote is explicitly the authority.

**Recommendation**

Make prospective merge validation a remote-hub responsibility and a prerequisite for workspace delivery:

- calculate or materialize the tentative merge on a temporary/private ref;
- run the whole-state invariant engine over it;
- atomically apply it to the target only if both source and target heads still equal the heads used to evaluate it;
- return 422 with invariant violations without changing the target;
- provide a dry-run mode that returns conflicts and violations without committing.

If TerminusDB cannot expose a transaction spanning those steps, use a temporary branch plus final head guards and delete/garbage-collect it on all outcomes. Document the residual race and test it. Merge-time rules must include both API invariants and operator-only global checks.

### B4. Local commit objects and push state are conflated

**Evidence**

- `docs/workspace-hub-plan.md:151` places `pushedAs` inside each commit JSON file.
- `docs/workspace-hub-plan.md:154` says push records the remote commit in that field.
- The plan describes local identifiers as hashes/content-derived identifiers elsewhere, while ADR-0066 describes one file per local commit and atomic rename (`schema/docs/adr/0066-workspace-hub-store.md:80-86`).
- ADR-0065's protocol records the mapping only after the remote accepts the write (`schema/docs/adr/0065-workspace-hub.md:150-165`).

**Problems**

- Updating `pushedAs` mutates the commit object after creation. If its ID covers the file, the commit ID changes and every descendant parent reference becomes invalid; if the ID excludes the field, the format needs an explicit canonical-hash specification.
- A crash after the remote commits but before the local mapping is durable leaves the local hub unable to distinguish “not sent” from “sent but not recorded.” A retry with the old `If-Match` receives 412 and cannot automatically recover.
- Splitting one local commit into multiple remote commits creates a partial-success state and makes “one local commit becomes one remote commit” false.
- Atomic rename of one file does not make commit object, branch ref, index, and push mapping one durable transaction. `fsync` and recovery semantics are not specified.

**Recommendation**

Make local commit objects immutable. A robust file-store shape is:

```text
objects/<hash>.json        immutable canonical commit/document object
refs/<workspace>/HEAD     small atomic pointer
index.sqlite              rebuildable lookup/index, WAL enabled
push-journal.sqlite       local commit, attempt key, remote result, state
remote/...                immutable cached remote snapshots/log data
```

The SQLite files need not own the user's content; they can be rebuildable metadata and a transaction journal. This hybrid preserves readable/diffable JSON while avoiding fragile multi-file state transitions.

Specify canonical JSON, hash coverage, parent rules, checksums, file and directory `fsync`, lock behavior, cross-platform rename semantics, corruption detection, startup recovery, and backup behavior. The branch HEAD should advance only after the immutable object is durable. Push metadata must never alter a commit object.

On the remote, add an idempotency key or a dedicated replay endpoint. A retry of the same `(workspace, localCommit, part)` must return the original remote result without creating a second commit. Persist a write-ahead attempt locally before the request. Provide reconciliation by idempotency key or by indexed, authenticated workspace metadata—not by scanning human commit messages.

### B5. Provisional IDs cannot safely cross a batch or split boundary as designed

**Evidence**

- ADR-0066 chooses provisional `local-` IDs when TerminusDB's Hash identifiers cannot be reproduced, then rewrites references from the push response (`schema/docs/adr/0066-workspace-hub-store.md:112-119`).
- The batch API already supports `@capture`/`@ref` within one request (`docs/api.md`, `POST /documents`).
- A local commit above 500 documents is split across remote requests (`schema/docs/adr/0065-workspace-hub.md:160-162`; `docs/workspace-hub-plan.md:59`).

**Failure mode**

A local commit can create a Hash-keyed junction and another record that references its provisional ID. The remote must receive both atomically with `@capture`/`@ref`, or the dependent record names a non-existent ID. Once a logical commit is split, captures cannot cross requests, and the first remote part is visible even if a later part fails.

**Recommendation**

Before implementation, specify and test a complete replay transform:

- identify all locally provisional IDs;
- assign captures;
- rewrite same-batch references to `@ref` objects;
- topologically order non-captured dependencies;
- reject cycles the remote API cannot express;
- rewrite remote-issued IDs into the local mapping without mutating prior commits.

Prefer a dedicated remote replay endpoint capable of receiving one logical local commit as a streamed/compressed payload above the generic 500-document plugin limit and applying it atomically. If a hard server limit remains, define a staging protocol whose parts are invisible until a final atomic commit. Do not represent partial parts as ordinary shared commits.

This is also a reason to make the diff and file-store contract Armature-owned rather than an emulation of TerminusDB internals.

### B6. Loopback plus Host/Origin checks are not local authentication

**Evidence**

- ADR-0065 says tools reach the workspace hub on loopback “as its owner” and the hub alone holds the remote credential (`schema/docs/adr/0065-workspace-hub.md:183-203`).
- `app/lib/api/boundary.ts:30-65` validates hostnames and browser origins.
- ADR-0067 correctly frames those checks as protection against hostile web origins (`schema/docs/adr/0067-authentication.md:173-190`).

**Risk**

Any native process running as the user—and on some systems another local user able to connect to the port—can omit `Origin`, send the owner header, modify a workspace, trigger a push, or use the workspace hub's long-lived remote refresh token. DNS-rebinding defense is valuable but solves a different threat.

**Recommendation**

Add local client authentication:

- generate a high-entropy per-install secret in Keychain/DPAPI/libsecret;
- issue short-lived, scoped capability tokens to launched/approved tools (workspace, read/write/push scope, expiration);
- use a Unix-domain socket with filesystem permissions where available, or an equivalent named pipe on Windows, with authenticated HTTP as the portable fallback;
- require the token on all workspace and document routes; do not accept a caller-selected owner identity;
- keep remote refresh tokens only in the OS credential store and never expose them to plugins;
- retain Host/Origin/CORS checks for browser clients.

Document the local threat model explicitly: malicious websites, unapproved local applications, other OS accounts, stolen workspace folders, and stolen OS credentials are distinct cases.

### B7. The planned remote's read model is too broad

**Evidence**

- ADR-0068 allows any resolved identity to read any ref (`schema/docs/adr/0068-authorization.md:108-123`).
- Its open question says export profiles and slices already govern what leaves an instance (`schema/docs/adr/0068-authorization.md:205-209`).
- The actual export route defaults to `profile=full`, accepts the caller's chosen profile, and includes all documents (`app/lib/api/routes/export.ts:27-57`).
- `GET /users` exposes stored user documents, which may include email and institution.
- ADR-0067 auto-registers a person on first accepted OIDC encounter (`schema/docs/adr/0067-authentication.md:114-123`).

**Assessment**

Profiles transform a requested export; they do not prevent a caller from requesting the full profile or using ordinary document routes. “Any resolved identity” may mean every account accepted by the configured identity provider. That is unsafe for study data, review branches, unpublished instructional content, and personal data.

**Recommendation**

Add read authorization before exposing the hub publicly:

- an instance-membership/admission rule rather than automatic access for every issuer subject;
- branch-level reader grants, with `main` policy explicit;
- separate permission for listing users/grants;
- a high-trust permission for `profile=full` export;
- pseudonymous export as the default for broader research/viewer roles;
- least-privilege service credentials for the viewer, ideally scoped to specific branches/routes;
- audit logs for full exports and user-data reads;
- explicit behavior for `GET /discover`, schema discovery, and existence leakage.

The minimum safe initial model could be `Reader`, `Contributor/Owner`, `Maintainer`, and `Administrator`, with branch scope and a separate `ExportPII` permission. It is easier to relax a deny-by-default model than to retract data already exposed.

### H1. Relay is an unbounded delegated-authority role

ADR-0067 permits a service holding `Relay` to name a person as author (`schema/docs/adr/0067-authentication.md:156-162`). ADR-0068's proposed `Grant` has user, role, optional branch, status, and rationale, but no delegated person, document types, actions, job, or expiry (`schema/docs/adr/0068-authorization.md:89-99`). A compromised relay service could therefore submit arbitrary work as any registered person on its authorized branch.

Use narrowly scoped delegation: relayed subject user(s), allowed branch, route/actions, allowed document types, expiration, and preferably a queue/job nonce or signed consent record. Make grants revocable and short-lived by default. The audit trailer is evidence after the fact, not a preventative control.

### H2. Branch ownership is a cross-resource saga without generation identity

ADR-0068 says branch creation writes an Owner grant in a separate main-branch commit and branch deletion revokes grants (`schema/docs/adr/0068-authorization.md:101-106`). A crash can leave an ownerless branch or stale active grants. The policy says legacy ownerless branches remain writable “as today,” which turns a partial failure into an authorization bypass. Reusing a deleted branch name can accidentally reactivate grants scoped only by name.

Use an immutable branch ID/generation in grants, not just the display name. Make ownerless branches default-deny after a migration. Implement create/delete as an idempotent saga with a durable operation record and repair/reconciliation command, or represent the branch registry as authoritative metadata that can be updated atomically with grants. Never let a recreated name inherit an old grant.

### H3. Branch operations need stronger preconditions and ancestry handling

- `app/lib/api/routes/branches.ts:215-239` reads target and source heads, then applies without an explicit target/source precondition. The success response reports the pre-apply target head, and a race may make the result misleading or unsafe depending on store semantics.
- `app/lib/api/routes/branches.ts:85-95` silently stops ancestry traversal after 5,000 commits. Merge-base discovery can report no common ancestor for longer histories. Branch deletion's conservative refusal is safer, but still opaque.
- `app/lib/api/routes/branches.ts:326-336` verifies that `since` exists but not that it is an ancestor of the branch head, so an arbitrary cross-branch diff is labeled “changes since.”

Require source and target head tokens on merge/dry-run, and pass them to the store operation. Paginate ancestry to completion, use a store-native ancestry primitive, or return an explicit limit error rather than a false answer. Validate ancestry for `changes?since=`. Add a paginated `/branches/:name/log` route before workspace cloning relies on it.

### H4. The OIDC profile is narrower than the protocol and stores unstable identifiers

ADR-0067 assumes an access token is a JWT verified by JWKS (`schema/docs/adr/0067-authentication.md:114-123`). OIDC providers may issue opaque access tokens; if Armature intentionally supports only JWT access tokens, discovery and deployment validation must say so. Otherwise support introspection or a provider adapter.

It maps a person to bare `sub` and postpones qualifying it with issuer until multiple issuers are needed (`schema/docs/adr/0067-authentication.md:272-275`). Store `(iss, sub)` from day one. Subject values are issuer-local; adding a second issuer later otherwise requires a risky migration and can collide.

Also specify service-token mapping precisely: providers differ over `sub`, `client_id`, and `azp`. Validate token type/audience, cache JWKS safely, define clock skew and key-rotation behavior, and test algorithm-confusion and malformed-claim cases.

### H5. The public API deployment path is not yet concrete

`docker/Caddyfile:8-15` intentionally proxies only the viewer, while OIDC is unimplemented. Before public auth is built, decide whether the hub uses a dedicated API hostname or an `/api/v1` route, then specify:

- exact allowed hosts and origins;
- TLS and forwarded-header trust;
- request/body/time limits and streaming behavior;
- CORS rules for each native/web client;
- rate limits, abuse controls, and audit logging;
- service-to-service credentials for the viewer;
- liveness versus store-backed readiness;
- how the connection profile advertises the canonical issuer, audience, API base, and native client ID.

Do not widen `ARMATURE_HUB_BIND` or attach the current header resolver to the public proxy as an intermediate deployment.

### H6. Whole-graph and schema-driven scans need explicit service limits

`app/lib/api/store.ts:395-403` loads every document for export. Intelligence reverse lookups scan types based on schema fields; optional and multi-valued filters are frequently implemented by listing a whole type (`app/lib/api/intelligence/graph.ts:101-126`). The viewer loads the full graph. `lensReadsFor` performs one attestation request per selected subject. These choices are reasonable for a demo but become availability risks when public and authenticated.

Add:

- maximum request bytes before JSON parsing and endpoint-specific limits;
- cursor pagination for documents, logs, users, grants, and history;
- streaming/compressed exports with server-enforced maximums;
- bulk intelligence endpoints where the viewer currently creates N+1 calls;
- query/index primitives in the store adapter for reverse references;
- response-cost metrics and structured timing logs;
- rate limits/quotas by identity and route;
- documented tested scale targets, not only “demo scale.”

The generic 500-document batch limit is enforced after parsing, so it does not protect memory from a huge body.

### H7. Network calls have no deadline or caller cancellation

`app/lib/api/store.ts:242-269` calls TerminusDB with `fetch` and one dropped-read retry but no timeout. `packages/client/src/index.ts:391-431` likewise offers no `AbortSignal` or deadline. A stalled store or remote can occupy a request indefinitely; a desktop push may appear frozen and be unsafe to retry.

Add configurable connect/headers/body/overall deadlines to the store adapter, propagate aborts when an inbound request disconnects, and expose `signal` plus optional timeout on every typed-client call. Retry only idempotent reads by default. Writes require the replay idempotency mechanism before automatic retry.

### H8. Container networking bypasses the hub boundary

`docker/docker-compose.yml:13-17,142-145` deliberately places the store, hub, viewer, operator, and colocated plugins on one named network. Any plugin joining that network can reach TerminusDB directly and use the default administrator credential if it is known or left at the development default. This contradicts the architectural rule that plugins use the hub.

Create at least two networks:

- an internal store network shared only by TerminusDB, hub, and explicitly invoked operator jobs;
- a front/client network shared by hub, viewer, Caddy, and approved colocated plugins.

Do not attach plugins to the store network. For public/production profiles, fail startup if the admin password remains the default rather than using `${TERMINUSDB_ADMIN_PASS:-admin}` (`docker/docker-compose.yml:45,61`). Use a less-privileged store account if TerminusDB supports the required operations. Separate `/live` from a store-backed `/ready` endpoint; the current container health check only proves `/discover` responds.

## Additional code and data-model improvements

### HTTP and input semantics

1. `app/lib/api/http.ts:36-42` treats `If-Match: *` as an unconditional write. HTTP defines it as “the resource exists.” Reject it if that semantic cannot be represented, or implement it correctly. Use an Armature-specific option for intentional unconditional writes.
2. Document filters coerce any boolean text other than `true` to `false`, and malformed numeric strings can become `NaN`. Accept only exact lexical forms and return `bad_query` for invalid values. Validate `count`, `skip`, and thresholds for finite safe integers and bounded ranges.
3. `app/lib/api/identity.ts:120-122` reportedly treats any store 400 during user registration as a race. Narrow this to the exact duplicate/version mismatch condition so malformed requests and backend errors are not converted into `registration_conflict`.
4. Add a body-size middleware before `c.req.json()`, content-type checks, and a maximum decompressed size when compression is accepted.

### Global uniqueness and repair safety

The API checks duplicate `User.externalId` during registration, but the schema/store and operator whole-graph check should enforce it too. Operator imports/repairs can otherwise create duplicates, after which identity resolution may pick an arbitrary first result. Add a global uniqueness invariant to operator check and remote write validation, with a deterministic error and a repair procedure.

### Numeric domains need business constraints

Several fields use unconstrained `xsd:integer` or decimal values where negatives are nonsensical: item/lesson/module/activity `sequence`, `ItemInstance.pointValue`, `Assessment.retakes`, and `Attachment.byteSize`. `Assessment.passingScore` does not define whether it is a proportion, percentage, raw points, or another scale.

Use `xsd:nonNegativeInteger`/`positiveInteger` where the store supports it, plus generated validation and invariant fallbacks. Specify the score's unit or model it as value plus unit. Decide whether zero sequence is valid and apply one convention consistently.

### Prerequisite semantics need one explicit decision

The schema supports Hard, Soft, and Corequisite relationships, but does not state whether self-links or cycles are allowed. A hard-prerequisite cycle is generally unusable; a corequisite cycle may be intentional. Add an ADR decision and, if the graph is meant to be acyclic for Hard/Soft edges, a whole-graph cycle invariant and a readable cycle report. At minimum reject `objective === prerequisite` unless a real use case requires it.

### Own the diff contract

ADR-0066 decision 5 requires the file store to reproduce TerminusDB's JSON patch (`schema/docs/adr/0066-workspace-hub-store.md:107-110`). This exposes a backend-specific format through the public API and makes a second store emulate behavior Armature does not control.

Define a versioned Armature diff format now—document insert/delete and field/fragment changes, with list semantics explicit—and put adapters on both sides. A compatibility field can carry the raw Terminus patch temporarily. This is cheaper before clients and the file store depend on the existing shape.

### Strengthen generated client types

The client is structurally well designed, but several response areas use broad `unknown` values for schema/export/diff/annotation content. Generate or centrally declare versioned response contracts for every route, and consider emitting an OpenAPI/JSON Schema description from the same source. Add compile-time tests that the server response builders satisfy those types.

### Improve operational observability

Add structured request logs with request ID, authenticated subject/service, effective author, branch/ref, resolved commit, route, status, duration, response size, store duration, and error code. Never log bearer tokens or document bodies by default. Add metrics for store latency, retries, invariant time, merge validation, export size, queue/replay state, and OIDC/JWKS failures. The viewer currently swallows several optional-read failures; retain graceful UI behavior but record them server-side.

## Documentation and ADR review

### Concrete inconsistencies

1. `docs/how-armature-works.md:85` says 28 record kinds and 13 vocabularies; `:407-410` says 28 classes and twelve enums. The current schema has **31 classes and 15 enums**. Replace manual counts with generated facts.
2. `docs/SCHEMA_APPENDIX.md:18` says invariants are numbered 0–12, while the API and code have 0–20. The stale sentence is generated by `scripts/generate-schema-appendix.js:281`; fix the generator, then regenerate.
3. `schema/docs/adr/README.md:75` still summarizes ADR-0005 using “activity groups,” although ADR-0064 renamed the concept to Lesson. Mark the summary as amended and use current names.
4. ADR-0067 and ADR-0068 are Accepted, but their Verification sections still say “None yet. Before acceptance” / “Before acceptance” (`schema/docs/adr/0067-authentication.md:283-285`; `schema/docs/adr/0068-authorization.md:222-228`). Say “before implementation/release,” or introduce an explicit “Accepted—unverified/unimplemented” state.
5. Five relative links are broken in `docs/vendor/terminusdb/_all/render-as.md:75`. Because this is vendored/generated material, fix the upstream sync or maintain a vendor manifest/exclusion rather than hand-editing it silently.

### ADR narrative is becoming difficult to reconstruct

The ADR collection is excellent, but late records—especially 0065–0068—contain multiple “Later change” blocks that contradict earlier sentences in the same Decision section. This preserves history but makes the current rule expensive to discover.

Keep the historical addenda, and add a short **Current decision** section at the top of each amended ADR that consolidates the operative behavior. Where a decision has materially changed, prefer a superseding ADR and mark the old decision superseded. The index should be mechanically checked against each file's status.

### Current facts are duplicated too widely

README, `how-armature-works.md`, the schema appendix, API reference, ADR index, plans, and `.claude` notes repeat counts, route status, invariant counts, and implementation status. Drift has already begun.

Generate a small facts artifact during CI containing:

- class and enum counts;
- current API revision and capabilities;
- test count (or omit exact test counts from durable prose);
- current invariant list/count;
- seed document count;
- ADR status/index data.

Have prose include or link to generated facts rather than copy them. Add a Markdown link/anchor checker to CI, with an explicit policy for vendored docs. Also lint that accepted ADRs do not contain “before acceptance” and that every implemented/accepted status has the expected verification wording.

### Plans should distinguish decisions, prerequisites, and explorations

`docs/workspace-hub-plan.md` contains valuable thinking but mixes settled decisions, future asks, implementation steps, and unresolved hazards. Add a one-page gate checklist:

- **Decided and verified**
- **Decided, implementation pending**
- **Must be decided before coding**
- **May be deferred until measured**

The replay protocol, local authentication, merge validation, read authorization, and immutable file format belong in “must be decided before coding,” not later implementation details.

## CI, supply-chain, and deployment improvements

The existing five-job CI is strong: it separately tests contract behavior with a real store, external client installation, browser behavior, and container builds. Preserve that structure and add:

1. concurrency tests for branch reads/writes/merge;
2. fault-injection and process-kill tests for every file-store durability point;
3. replay interruption/reconciliation/idempotency tests;
4. OIDC and authorization matrix tests using a local issuer/JWKS fixture;
5. documentation link/fact/ADR-state checks;
6. dependency review and automated update tooling (Dependabot or Renovate);
7. CodeQL or equivalent static security analysis, secret scanning, `npm audit`/OSV scanning, and container scanning;
8. SBOM generation and provenance/attestation for release images;
9. image bases pinned by digest for releases, with a documented update cadence;
10. a fully offline/restricted-network build job to prevent remote-font and similar dependencies;
11. backup-and-restore rehearsal, not only backup instructions;
12. load tests at declared target sizes for export, graph, history, merge, and reverse references.

The backup documentation should state RPO, RTO, retention, encryption, restore steps, schema compatibility, and a regularly tested restore result. A backup that has not been restored is not yet an operational guarantee.

## Recommended sequence before the next development phase

### Gate 1 — Correct the current remote core

1. Add immutable request snapshots for all multi-read routes.
2. Make every write validate and commit against the same captured head.
3. Add prospective invariant validation and source/target preconditions to merge.
4. Validate ancestry for changes and remove the silent 5,000-commit traversal cap.
5. Add request deadlines, body limits, strict query parsing, and correct `If-Match` semantics.
6. Add the concurrency tests that prove 1–4.

### Gate 2 — Amend the workspace/file-store ADRs before implementation

1. Specify immutable local commit objects and separate replay metadata.
2. Define canonical hashing, durable writes, locking, corruption detection, and recovery.
3. Define a remote idempotent replay protocol and atomic logical-commit behavior.
4. Specify the provisional-ID capture transform.
5. Replace the backend-native diff requirement with an Armature-owned format.
6. Set explicit clone/history size budgets and capability degradation behavior.
7. Decide whether the hybrid JSON-object plus SQLite-index design is accepted.

### Gate 3 — Secure the local workspace boundary

1. Add scoped local credentials and OS-secret storage.
2. Prefer protected sockets/pipes where supported.
3. Threat-model other local processes and users.
4. Test token theft, missing/expired scope, malicious origin, and a second local process.

### Gate 4 — Secure the public remote

1. Add instance membership and read/export authorization.
2. Scope relay grants and branch grants to immutable branch generations.
3. Implement OIDC with `(iss, sub)`, provider validation, JWKS rotation, and explicit token profile.
4. Define the public proxy/API topology and least-privilege viewer credential.
5. Segment Docker networks and require production secrets.
6. Add rate limits, audit logs, readiness, backups, and security automation.

### Gate 5 — Documentation and release readiness

1. Fix the concrete documentation inconsistencies above.
2. Add generated facts and documentation CI.
3. Consolidate the current decisions in ADR-0065 through ADR-0068.
4. Publish tested scale limits and the local/public threat models.
5. Run cross-platform workspace crash/recovery tests on macOS, Windows, and Linux.

## What should not be changed without evidence

Several existing decisions are good and should not be churned merely for architectural novelty:

- Keep Hono as the host-neutral API application. The separation from the server entrypoint is clean.
- Keep TerminusDB behind the store adapter for the remote. Its commit/ref model matches the product, and the code confines the dependency well.
- Keep design intelligence computed at a named commit instead of storing derived coverage/alignment.
- Keep relationship documents for relationships with rationale/status/sequence.
- Keep one typed client as the route contract for viewers and tools.
- Keep operator repair outside the plugin API, but strengthen audit and post-repair global checks.
- Keep branch history immutable and avoid reset/rebase routes on shared history.
- Keep capability/revision negotiation per request.
- Do not add schema features solely because they are theoretically useful; continue the project's two-client/evidence threshold.

## Particularly strong aspects of the repository

The review found many practices worth preserving:

- The API/store/viewer boundaries are unusually clear. The viewer uses the typed client rather than store internals.
- Schema-derived TypeScript types and Zod validators, plus a drift check, sharply reduce contract mismatch.
- The write pipeline centralizes shape, identity, provenance, `asOf`, invariants, and commit behavior.
- Stable machine-readable errors and per-request capability/version negotiation are appropriate for independently released clients.
- The ADR record explains not only choices but rejected alternatives and reopening conditions.
- The operator checker validates seed/import/repair paths that bypass ordinary API invariants.
- Coverage and other intelligence are computed at a named commit, preventing stale derived records.
- The CI suite tests the actual store, external package installation, a browser, and container images—not only isolated units.
- The API deliberately retries dropped reads but not unsafe writes.
- Branch deletion is conservative, and shared history is not rewritten.
- The current hub defaults to loopback and the public Caddy configuration correctly refuses to proxy an unauthenticated header-resolver API.
- Hub/viewer containers use purpose-specific builds, and the project documents deployment assumptions openly.

## Final recommendation

Proceed with Armature's existing overall architecture, but treat the next phase as a **correctness and trust-boundary milestone before a feature milestone**. The current remote hub is a strong prototype. The workspace hub and public OIDC remote introduce concurrency, replay, and authority semantics that are not safely solved by the current ADR text.

The most valuable first pull request is the snapshot/conditional-write refactor with race tests. The second is prospective merge validation. In parallel at the design level—not implementation—amend ADR-0065/0066 around immutable commits and idempotent replay, and ADR-0067/0068 around local authentication and remote read authorization. Once those contracts are settled, the planned remote hub, workspace hub, and clients form a sound and extensible architecture for Armature's purpose.

## Review limitations

- This was a deep static and local dynamic review, not a formal security audit or proof of correctness.
- The OIDC, authorization, workspace hub, and file store are ADRs/plans rather than implemented code; findings there assess design readiness.
- No production traffic profile or real dataset beyond the 69-document seed was available, so performance conclusions are architectural rather than benchmark-based.
- The dependency advisory service did not return during the review, so this report makes no claim that dependencies are vulnerability-free.
- Vendored TerminusDB documentation was inspected for link integrity but not re-reviewed as Armature-authored design.
