# Armature: code review of 2026-11-05 to 2026-11-08

> **Status since this review (2026-11-09).** This is the review as written; when a finding is fixed, decided or set aside, this banner says so with the date, and the body stays as it is.
>
> - *2026-11-09 (Amos):* **D5** decided as recommended, the card now, the resource indicator noted in `docs/desktop-program-plan.md` §8 as the direction; **D7** decided as recommended, two jobs and a dedicated feed. **R1, R2, R3, C1 and C2** fixed on `phase-8/desktop-release` (commits `1c7298b`, `4a71f28`, `bb25ba5`; not yet merged): the release built without secrets and signed under the `release` or `rehearsal` GitHub environment, the feed the fixed `desktop-channel` release moved by `desktop-channel.yml`, an answer without a release told from the latest version, the Connect card showing the address dialed with a warning for a hub that declares another, `connect` carrying the profile confirmed and 409 `profile_changed` when the re-read differs. The repository-level signing secrets were moved into the environments the same day. Everything else stands as written. The review's own identifiers (A1, Q1, E1, W1, C1, V1, S1, R1, P1, T1, D1) are the names to cite its findings by, as "the 2026-11-09 review's W1", since the deep review of 2026-10-30 already uses B and H.
> - *2026-11-09 night:* **PRs #122 and #123 merged** into `main` by rebase, so the release branch's commits above have new identifiers there: `73966cb` (R2), `606c1a5` (C1, C2) and `5b6902b` (R1, R3); the acceptance on a Droplet is `576ab48`. "Not yet merged" above is now merged.
> - *2026-11-09 night:* **S1 and S6** fixed (`phase-8/sidecar-environment`): the shell clears the sidecar's environment and passes `KEPT_ENVIRONMENT` alone, `NODE_EXTRA_CA_CERTS` kept as the one Node setting since it adds a certificate authority rather than removing a check (the direction S7 points); the six Node checksums pinned in `prepare.mjs`.
> - *2026-11-09 night:* **R4, R5, R7, R8, R9 and S11** fixed (`phase-8/release-hardening`): a check waits thirty seconds and a download is given up after a minute without data; a `.deb` install is not checked; the restart after an update drops `--hidden`; the login entry is made again at every start while wanted; the release workflow restores no cache, runs Cargo `--locked` and refuses a `desktop-v*` tag off `main`; the shell's workflow pins its actions and reads only. **R6** was fixed by the two-job workflow of 2026-11-09 (one job creates the draft, `latest-json.mjs` refuses a manifest missing a platform) and is recorded here. Open on the release path: R10, and S2, S3 and S7.
> - *2026-11-11:* **R10, S2, S3 and S7** fixed (`phase-8/desktop-0.1.1`, the program's 0.1.1): the shell counts the core's long actions in flight (`ACTIONS` in `core.rs`, in the state as `actions`); an install is refused while one runs and waits up to thirty seconds for one begun during the download, giving up otherwise, and quitting waits the same (S3); the pages hold **Install and restart** meanwhile and say for what, the start-at-login box shows the setting with the system's refusal beside it (`LoginEntry` in the state), and only the notice's sentence is a live region, the download a progress bar (R10); macOS's own quit writes `stop`, waits for its reply, then ends the process (S2); Node runs with `--use-system-ca`, which the carried 22.23.4 has (S7). The release path's findings are closed.
> - *2026-11-11 night:* **W1, W2, W3 and W4** fixed and **T9**'s test written (`phase-8/workspace-queue`), each on the option Amos took that evening. W1: the file store runs every change to its folder in one line for the whole store, so a branch's deletion never sweeps beside a write (ADR-0066 decision 2, note). W2: a removal is finished by asking again, a local branch already gone having nothing unpushed and nothing to delete, and the folder's removals are retried as its renames are. W3 and W4: bring-in, deliver and remove hold the workspace's write queue from their unpushed check to their last local write, the remote's calls included, the fix's first alternative; the head check was declined because the remote has merged or deleted by then (ADR-0025 decision 7, note). W4's "related": a marker in `push.json` settled by the next bring-in or push (ADR-0065 decision 6, note); the review understated it, since a dropped connection after the remote's merge is enough and no crash is needed. One case stays stuck and is now told as such, a commit made since that changed a document the merge changed (409 `unpushed_commits` with `overlapping`), which is **D6**'s to open. T9: `queue.test.ts` lists every module that commits with its number of calls and where its queue is taken; it found the clone, the mirror of `main` and the snapshots outside the queue too, which the review did not list, and they joined it. From T3: the delete racing a file-store write, the removal retried after a failure and the write during a bring-in now have tests; the removal under each remote refusal, the redirect and the unbounded log do not. **W5 to W10 stand as written.**
> - *2026-11-11 night:* **PR #133 merged**, so the fixes above are on `main` (`70f7a05` to `914f90a`), and released in the program's **0.1.2** (PR #135, `desktop-v0.1.2`, published 04:10 UTC on 2026-11-12). The same release carries a fix found outside the review: a logoff or shutdown on Windows ended the core with exit code 1073807364 and was logged as its failure; it is now logged as the system's end (`ended_by_the_system` in `core.rs`).
> - *2026-11-12:* the authentication group, in one change (`phase-8/authentication-review`), with **D1** and **D2** decided by Amos as recommended, and A5's and A6's choices likewise. **A1:** a key set that answers an error or something that is no key set is 503 `issuer_unreachable`; the same for metadata that cannot be read, which the review did not list and which answered 500; a token marking a header critical is refused as `malformed` before any key is read, so the class `jose` shares between that and an unreadable key no longer decides. **A2:** `mayListUsers` answers no under a relay. **A3 and D1:** `ARMATURE_OIDC_SERVICES`, the explicit list; a token is a service's only when its client is listed and it has no `name`, the narrower of the two readings of "listed", and a person's token without a name is refused with a message naming the claim (ADR-0067 decision 4, note). **A4 and D2:** a domain admits only `email_verified: true` (decision 1, note). **A5:** plain `http` for the issuer, its keys and the public address only on loopback or under `ARMATURE_REHEARSAL=1`, the compose guard likewise for `ARMATURE_API_SCHEME`, and an `https` issuer may not name an `http` key set. **A6:** under `oidc` a person registered without `issuer` gets the hub's. **A9:** its sentence is in `docs/deployment.md`. The changes are client revision 2026-11-12 (`docs/client-changes.md`), as the review's closing paragraph asked for D1; the refusals' codes are unchanged, with the reason in their messages. **A7 and A8 stand as written.**
> - *2026-11-12 (later):* **D6** decided by Amos, the discard, and **W8** fixed with it (`phase-8/discard-workspace`): `DELETE /workspace/:name?discard=<n>`, the removal giving up n local commits. The review recommended the discard "in the program only (not a route)"; it is on the removal's own program action, a route only where the host asks for the action routes, chosen over a request only the core could make so that it keeps the route's owner check and the route suites. Where the review's option said only "a second confirmation that names the number of local commits to be lost", three things were decided beyond it: the hub checks the number (409 `discard_mismatch`), nothing is asked of the remote, and the workspace's files are copied aside in the hub's folder before the branch is deleted (ADR-0065 decision 6, later change of that day; ADR-0025 decision 6, note).

**Review date:** 2026-11-09
**Reviewed:** `55af9d3..da09c9d` on `main` (76 commits, about 9,500 changed lines outside the documents), and the unmerged branch `phase-8/desktop-release` at `7063b4a` (8 commits). Line numbers are at those two commits.
**Asked for:** ways to improve, security risks, viable alternatives that were not considered, and general improvements.
**Kept here:** the findings someone can act on. What was checked and found correct is in § "Found sound", so a later review knows what it need not repeat.

Abbreviations: ADR (Architecture Decision Record), CI (continuous integration), CSP (Content Security Policy), JWKS (JSON Web Key Set), OIDC (OpenID Connect), PKCE (Proof Key for Code Exchange), TLS (Transport Layer Security).

---

## In brief

The hub's `oidc` resolver, the per-branch write queue and the desktop shell's security boundary are sound. The problems are at the edges:

1. **The desktop program's confirmation step can be made to show a hostile hub as the real one** (C1, C2). High. Fix before the program is released.
2. **On a workspace hub, a branch delete during a write can leave the file store unable to open** (W1). Rare, but it takes every workspace on the machine offline. Three more workspace actions run outside the write queue (W2 to W4).
3. **The release branch signs with a key that every build dependency can read, and its update check reports every server error as "latest version"** (R1 to R3). Fix before the branch merges.
4. **A brief outage at the identity provider is treated as a refusal in three places**: the hub answers 401 for a good token (A1), the desktop program signs the person out (C4), and the updater says there is no update (R2).
5. **Sign-out does not reliably stick** (C5, S4).

Eight questions are Amos's to decide rather than bugs to fix; they are in § "Decisions".

## How this review was done

A lead read the hub's authentication, authorization, registry gate, export, health routes, configuration reader and the deployment files. Four parallel readers took disjoint groups against one written brief: the write queue with the stores and the workspace hub; the desktop core with the viewer's credential; the Rust shell with the build scripts, the workflows and the release branch; the pages. The lead then read the code behind every high finding and a selection of the medium ones.

Each finding carries one of three marks:

- **Reproduced**: shown by running the repository's own modules in a throwaway script outside the repository (never against TerminusDB, and no suite was run).
- **Traced**: followed through the code; the lead read the cited lines.
- **Reported**: traced by one reader; the lead did not re-read it.

Severity is high, medium or low. A finding that needs a decision first points at § "Decisions".

---

## A. The hub: authentication, authorization and the registry

### A1. An identity provider whose key endpoint answers an error is reported as the caller's bad token (medium, bug, reproduced)

- **Where:** `app/lib/api/oidc.ts:62-72` (`reasonOf`), used at `:108-111`.
- **What:** `jose` 6.2.13 raises a plain `JOSEError` (code `ERR_JOSE_GENERIC`, "Expected 200 OK from the JSON Web Key Set HTTP response") when the key set answers anything but 200. `reasonOf` classifies every `JOSEError` that is not a `JWKSTimeout` as `malformed`, so the hub answers 401 `invalid_token` where the contract says 503 `issuer_unreachable`.
- **Scenario:** the provider restarts behind its proxy and answers 502 or 503 while the hub has no keys yet (a hub restart) or meets an unknown key id. Every request is told its token is invalid. The viewer discards its token and asks for another; a client that does not retry a 401 stops.
- **Reproduction:** a local server answering 503, 502 and 404 for the key set, `createRemoteJWKSet`, then `jwtVerify` with a well-formed token: each gives `JOSEError` with `ERR_JOSE_GENERIC`.
- **Fix:** name the token's own faults (`JWTInvalid`, `JWSInvalid`, and the classes already listed) as `malformed`; treat a generic `JOSEError` and `JWKSInvalid` as the issuer's, 503. A test with a key endpoint that answers 503. This restores a status the contract already promises, so it is a fix, not a revision.

### A2. A relay can read the whole registry through the export (medium, security, traced)

- **Where:** `app/lib/api/authorization.ts:132-137` (`mayListUsers`); `app/lib/api/routes/export.ts` (`everyUser`).
- **What:** `requirePermission` refuses a relayed request anything but a document write, so `GET /users` under a relay is 403. `mayListUsers` has no such check: under a relay `who` is the person, so the person's grants decide.
- **Scenario:** a service holding a `Relay` grant that names an administrator, or names no one (`relayedUsers` absent), sends `Armature-User: <the administrator>` with `GET /export?profile=full` and receives every `User`. ADR-0067 decision 5 bounds a relay to "documents only, to a branch its grant covers".
- **Fix:** `mayListUsers` answers false when `who.relayedBy` is set; a test beside "exports pseudonymously by default and keeps the full profile for an administrator".

### A3. A person's token without a `name` claim is silently taken for a service (medium, design, traced)

- **Where:** `app/lib/api/oidc.ts:86-88` (`if (!name && clientId) return { externalId: 'agent:<clientId>', service: true }`).
- **What:** the rule is recorded (ADR-0067 decision 4, note of 2026-11-05; `docs/deployment.md` § "An instance under oidc"), but not what happens when a provider leaves `name` out of a person's access token. Several do by default; the rehearsal's Keycloak realm includes it only because the `profile` scope is a default scope of the client.
- **Scenarios:**
  - Every person signing in through one client resolves to the same `agent:<client id>`, 401 `unknown_user` with a message about registering an agent, and nothing says the token lacks a name.
  - If a client that holds a `Relay` grant also offers a sign-in flow to people, a person who obtains a token through it without `name` is that service, with its grant.
- **Fix:** a decision, D1. Whatever is chosen, a person-shaped token that is refused should say why, and `docs/deployment.md` should say that a client holding a `Relay` grant offers no sign-in flow to people.

### A4. A missing `email_verified` claim counts as verified (medium, security, traced)

- **Where:** `app/lib/api/oidc.ts:90-92` (`payload.email_verified !== false`).
- **What:** domain admission refuses only an explicit `false`. A provider that omits the claim, or lets a person set their own email without verifying it, admits anyone who writes an address at an admitted domain. Admission registers a `User`, who may then read everything and create and write their own branches.
- **Fix:** a decision, D2: require `email_verified === true` for a domain entry, with the issuer entry remaining the way to admit a provider that does not send the claim.

### A5 to A9, lower

| Id | Where | What | Fix |
|---|---|---|---|
| A5 | `app/lib/api/config.ts:161-172` (`httpUrl`) | `ARMATURE_OIDC_ISSUER` and `ARMATURE_OIDC_JWKS_URL` may be `http://` on any host, so a deployment can fetch its signing keys in the clear. Traced. | Refuse `http` unless the host is a loopback name or a rehearsal setting says so; the compose guard likewise for `ARMATURE_API_SCHEME=http` with a domain. See C7 for the program's side. |
| A6 | `app/lib/api/routes/users.ts:76-79` | Under `oidc`, a person registered by `POST /users` without `issuer` is matched by no token. If their token is admitted, first encounter then registers a second `User` with the same `externalId`. Traced. | Under `oidc`, default a person's `issuer` to the hub's, or refuse the registration without one. |
| A7 | `app/lib/api/routes/health.ts`; `docker/caddy/oidc.caddy` | `GET /health/ready` is public through Caddy and reads the store on every call, with no token. Traced. | Keep the answer for a second or two, or leave only `/health/live` reachable from outside. |
| A8 | `app/lib/api/oidc.ts:105` | `jwtVerify` runs with no clock tolerance, so a few seconds of skew between the provider and the hub refuses fresh tokens as `not_yet_valid` or just-expired ones early. Reasoned from `jose`'s default, not run. | `clockTolerance` of 30 seconds or so. |
| A9 | `docs/deployment.md` § "An instance under oidc" | Nothing tells an administrator not to set `ARMATURE_OIDC_AUDIENCE` to a client id; an ID token for that client would then pass as an access token. Traced. | One sentence in the guide; optionally refuse a token whose `typ` is not an access token's when the provider sets it. |

---

## Q. The write queue and the operator tools

The queue itself is correct (§ "Found sound"). These are its edges.

| Id | Sev. | Where | What | Fix |
|---|---|---|---|---|
| Q1 | medium | `app/lib/api/store.ts:434`; `app/server.ts`; `docs/deployment.md` | The queue is in-process. One hub per store is stated in ADR-0025's notes and in comments, but not in the deployment guide, and nothing checks it at start. The operator tools run beside a live hub and are that second process. A second writer gets the conditional write that platform check AO shows does not hold, with no warning. Reported. | A decision, D3. At the least, say it in `docs/deployment.md`. Also: checks AO1 and AO2 record `INFO`, so the store upgrade ADR-0025's note of 2026-11-07 waits for will not show as a changed verdict; make them a verdict. |
| Q2 | low | `app/lib/api/store.ts:484` with `app/lib/api/write.ts:157-174` | A commit that times out (30 seconds) frees the branch's turn while the store may still land it; the next writer and the late one were then in flight together. Reported, plausible. | After a write times out, hold the turn until the head is seen to move or a grace period passes. |
| Q3 | low | `app/lib/api/write.ts:156`; `app/lib/api/routes/documents.ts:163-165` | The "arrived" head for 409 `document_moved` is read after identity and authorization. Two unconditional replaces sent together are both 200 when the first commits during the second's preamble. Authorization is likewise judged before the wait. Reported. | Read the head first thing in the route and pass it down. |
| Q4 | medium | `app/lib/api/classes.ts:32,40`; `app/lib/api/write.ts:138-145` (commit `cfd9956`) | The operator's `put` may now replace a `User` on `main`. A branch that holds the old copy then conflicts at merge in both directions, and no route or operator action can write the copy on the branch (`grants_live_on_main`). ADR-0032 decision 6 foresaw the re-carry; it was not built. `put` also accepts a second `User` with an existing `(issuer, externalId)`, and `check.ts` has no rule for it. Reported, not run against a store. | Build the re-carry into the operator's edit, or refuse the edit while any branch holds a differing copy; add the uniqueness rule to `check`. |

---

## E. The export and the handle

### E1. The pseudonymous export rewrites a handle only when it matches a current `User` (medium, privacy, reproduced)

- **Where:** `app/lib/api/export/exporter.ts:162-172` (`handles.find(({ handle }) => branch.startsWith(handle + '_'))`).
- **Scenarios:**
  - A person's email is corrected after their branch was made: `Grant.branch` leaves the pseudonymous export with the old email's local part in clear.
  - Two people share a local part (`alice@a.edu`, `alice@b.edu`): the second person's branch is rewritten with the first person's token, linking one person's branch to another.
- **Fix:** resolve the owner from the `Owner` grant that names the branch rather than by prefix, and rewrite an unresolved `<x>_<name>` prefix to an opaque value. A dated note on ADR-0031.

### E2. The email handle puts part of an address where any token holder reads it (low, design, reported)

- **Where:** `app/lib/api/routes/workspace.ts:141`; `handleFor` in `app/lib/api/identity.ts:84`.
- **What:** on 2026-11-05 the registry was closed to all but maintainers of `main` and administrators under `oidc`. Since 2026-11-08 every workspace branch's name begins with its owner's email local part, and `GET /branches` is open to any token, services included. ADR-0065's note argues for readable names and does not weigh this.
- **Fix:** a decision, D4.

---

## W. The workspace hub and the file store

### W1. A branch delete during a write deletes the write's commit file, and the store then fails to open (high consequence, rare; reproduced)

- **Where:** `app/lib/api/filestore/store.ts:316-320` (the write) against `:336-358` (`deleteBranch`).
- **What:** a write stores its commit file and registers the commit in memory, then moves the head in a second flushed write. `deleteBranch` runs in neither the store's commit queue nor `exclusive`, and removes every commit file no head reaches.
- **Scenario:** a tool writes to workspace A while the person removes workspace B, delivers B with deletion, or re-clones over an unfinished clone. The write is answered with a commit; every later read of A is 404 `unknown_ref`; a reopened store throws "which no commit file holds: the store is damaged", which takes every workspace on the machine offline, unpushed work included. Deleting the branch being written resurrects it with a head whose parents are gone.
- **Fix:** run `createBranch` and `deleteBranch` through the store's own queue, and sweep only commits that no head reaches and no write in flight has made (or move the head before registering the commit). A test with a delete racing a write.

### W2. Remove cannot be retried after failing halfway (medium, bug, reproduced)

- **Where:** `app/lib/api/workspace/bringIn.ts:177-194`; the same steps in `deliver` at `:168-170`.
- **What:** the order is the unpushed check, the remote delete, the local `deleteBranch`, `records.remove`. `deleteBranch` removes `head.json` first; if a later removal throws (a sync client holding a file is enough, since removals get no retry), the record stays and the branch is gone. Every later `DELETE` answers 404 `unknown_ref`, because the unpushed check reads the missing branch's log.
- **Result:** a workspace that cannot be removed, pushed, or cloned again (`workspace_exists`).
- **Fix:** treat a missing local branch as nothing unpushed, or remove the record first and make each step tolerate "already gone".

### W3. Remove and deliver-with-delete can drop a write that was answered 200 (medium, bug, traced)

- **Where:** `app/lib/api/workspace/bringIn.ts:177` then `:193`; `deliver` `:151` then `:169`.
- **What:** between the unpushed check and `deleteBranch` there are up to two remote calls of 60 seconds each, and nothing holds the branch's queue. A tool's write that lands in between is deleted with the branch. This is the defect ADR-0025's note of 2026-11-06 closed for the remote's `DELETE /branches/:name`.
- **Fix:** inside `exclusive`, compare the head with the one the unpushed check saw, then delete the branch and the record.

### W4. Bring-in commits outside `Store.exclusive` and never checks the local head (medium, bug, traced)

- **Where:** `app/lib/api/workspace/bringIn.ts:109-131` (`local.putDocuments(documents, { author, message, create: true })`, no queue, no `ifMatch`).
- **Scenario:** an agent writes local commit L1 touching document D between the unpushed check and this commit, and the merge also changed D. Locally the bring-in overwrites L1's D with nothing said. On the remote the next push replays L1 after the merge commit, so the two heads disagree on D, and a later delivery carries L1's D into `main` without the conflict the merge would have reported.
- **Fix:** hold the branch's queue for the whole bring-in, or refuse when the local head moved since the check. A dated note on ADR-0025 decision 7, since "every write to a branch joins its queue" is the rule this breaks.
- **Related, older than the range:** a crash between the remote merge and `putPush` leaves the workspace at 412 on every later bring-in and push; there is no marker like push's `inFlight`.

### W5 to W10, lower

| Id | Where | What | Fix |
|---|---|---|---|
| W5 | `app/lib/api/workspace/remote.ts:34-39`; `packages/client/src/index.ts:557,585`; `app/lib/api/config.ts:126-139,234` | The hub's client of its remote follows redirects: across origins `Authorization` is dropped but the body, `Armature-User` and `If-Match` are re-sent; within the origin the token is kept. `ARMATURE_REMOTE_TOKEN` is attached to a plain `http` remote on any host. Reported (redirect behavior run on Node 24, not CI's 22). | `redirect: 'error'` for the remote client; refuse a token with a non-loopback `http` remote. |
| W6 | `app/lib/api/workspace/snapshots.ts:141-149` | `fetchRemoteLog` has no page cap; a remote or a proxy that ignores `start` loops forever inside `POST /workspace`. When the base is absent from what came back, the whole log is kept under `head: base`, the opposite of the comment. Reported. | The 50-page cap `fullLog` and `landedCommit` use; refuse a log that lacks the base. |
| W7 | `app/lib/api/workspace/bringIn.ts:129`; `push.ts:261`; `routes/workspace.ts:151,162`; `clone.ts:61-71`; `snapshots.ts:93-94` | Only the clone's ETag is validated among what the remote supplies. `merged.commit`, each batch's `result.commit` and the `instance` profile are stored unchecked; `mirrorMain` writes the remote's user list without checking `@type`; an `asOf` longer than 97 characters surfaces as a raw `StoreError` after the record is written. None writes outside the folder. Reported. | Pass each through `remoteCommit` or the matching shape check before it is stored. |
| W8 | `app/lib/api/workspace/bringIn.ts:177` | A workspace whose commits can never be pushed (a revoked grant, a deleted remote branch, a standing 422, W4's stuck 412, a remote that is gone) is `unpushed_commits` forever. ADR-0065's change of 2026-11-07 did not weigh it. Reported. | A decision, D6. |
| W9 | `app/lib/api/routes/workspace.ts:122-130` | `existing` is checked against `BRANCH_NAME` only: a remote branch named `at.<hex>` clones into a workspace that `isSnapshotBranch` hides; `lock` and `store.json` collide with the store's own files (500); `main` is refused only by the wording of the mirror's commit messages. Reported. | Refuse the reserved names by name. |
| W10 | `app/lib/desktop/core.ts:189-197,352-371`; `app/lib/desktop/settings.ts:188-198` | "The remote changes only while no workspace exists" holds only for the current folder: point the folder at an empty one, connect elsewhere, point it back, and the hub runs against remote B over remote A's workspaces. Nothing in the routes compares `record.remote` with `hub.remote`. The bypass is traced; what a push then does is not. Reported. | Refuse in the routes when a record's `remote` differs from the hub's. |

---

## C. The desktop program's core

### C1. The confirmation shows the hub's self-declared address (high, security, traced)

- **Where:** `app/lib/desktop/core.ts:271-302` (`readProfile` returns `instance: discovery.instance` unchecked); `desktop/src/pages/Connect.tsx:118-123,139` (`{profile.instance?.api ?? profile.remote}` as "Address", and the button's label from `instance.name`).
- **Scenario:** `armature://connect?remote=https://armature-x.attacker.net` reaches a person with no workspaces. That hub's `/discover` declares the real instance's name, the real `api` address, and the real provider's issuer and client id. The card shows all three as real. The person signs in at the genuine provider, and `whoAmI` sends the bearer token to the attacker's address. The token carries the real hub's audience, so it can be replayed there, and a fresh one arrives on every later call.
- **Limits:** the dialed address shows only in the editable field above the card, which no longer matches the card once edited. A person who already has workspaces is protected by `workspaces_exist`. Whether the token replays depends on the provider issuing it for the real hub's audience, which is the configuration `docs/deployment.md` asks for.
- **Fix:** always show `profile.remote`, the address dialed, as the address; show a declared `api` on another origin as a labeled claim with a warning, or refuse it; clear the card when the field changes. A test with a hostile profile. D5 is the longer-term question. Two readers found this independently.

### C2. `connect` stores a second read of the profile, not the one confirmed (medium, security, traced)

- **Where:** `app/lib/desktop/core.ts:334-339`; `desktop/src/pages/Connect.tsx:55-59`.
- **Scenario:** a hub answers the first read with the real issuer and the second with a look-alike. The settings keep the look-alike, the Sign in page never shows the issuer, and the browser opens there.
- **Fix:** `connect` takes the confirmed issuer and client id and answers 409 `profile_changed` when the re-read differs; show the issuer on Sign in.

### C3. The core does not stop when its input closes while a sign-in waits (medium, bug, reproduced)

- **Where:** `app/lib/desktop/core.ts:461-463`; `app/lib/desktop/protocol.ts:170-174`.
- **What:** on the input's end the core waits for every request in flight before `stopHub()`, and `stopHub()` is the only thing that aborts a waiting sign-in. ADR-0069 decision 4 relies on this exit.
- **Scenario:** a sign-in is open in the browser and the person quits with Cmd-Q, or the shell crashes. The core keeps the port, the lock and the loopback listener for up to five minutes; a relaunch gets 409 `folder_locked`. Eight seconds after the input ended the process was alive and the hub answering.
- **Fix:** abort the sign-in first, then wait for requests in flight with a bound. See S2 for the shell's half.

### C4. Any non-2xx answer to a refresh signs the person out and deletes the kept token (medium, bug, reproduced)

- **Where:** `app/lib/desktop/signIn.ts:102-108` (`tokensFrom` turns every `!res.ok` into `sign_in_refused`); `app/lib/desktop/credential.ts:88-93`.
- **Scenario:** the provider's proxy answers 502 during a restart, or 429. The core drops the refresh token and emits `signedOut`; the shell deletes the keychain entry.
- **Fix:** only a 400 or 401 carrying an OAuth `error` is a refusal; 5xx and 429 are 503 `issuer_unreachable` and clear nothing.

### C5. Sign-out is undone by a refresh in flight (medium, bug and security, reproduced)

- **Where:** `app/lib/desktop/credential.ts:96-100,111-116`; `app/lib/desktop/core.ts:144-153,421-428`.
- **What:** `clear()` does not invalidate a refresh already running. When it lands it restores the access token, and if the provider rotated the refresh token it calls `onRotated`, which sets `keptRefresh` and emits `credential`; the shell stores it again.
- **Related:** the same stale callback after `connect` to another remote stores remote A's token under remote B's keychain key.
- **Fix:** a generation or cleared flag in `credential()`, checked before any state change or callback; `connect` calls `held?.clear()` too.

### C6. The kept refresh token is bound to the remote's address only, not to its issuer (medium, security, traced)

- **Where:** `app/lib/desktop/core.ts:405-419,131-137,342-346`; `desktop/src-tauri/src/core.rs:294-296`.
- **Scenarios:** a same-user process that cannot read the keychain edits `identity.issuer` in `settings.json`, a plain file, and at the next launch the core posts the offline refresh token to that issuer's token endpoint. Or a hub changes the issuer in its profile and the person reconnects: the shell forgets nothing, so the old provider's token goes to the new one.
- **Fix:** key the keychain entry by remote, issuer and client id, or have the shell send the issuer the token was issued by and refuse a mismatch.

### C7. Nothing requires `https` for the issuer or its endpoints (medium, security, reproduced)

- **Where:** `app/lib/desktop/signIn.ts:78-97,176,208-218`; `app/lib/desktop/settings.ts:106`; `app/lib/desktop/credential.ts:74`.
- **What:** `insecure_remote` covers the remote only. The issuer may be `http://` on any host, and `authorization_endpoint` and `token_endpoint` are taken as any string: the core emitted an `open` event for a `file:` address, which only `relay.rs:47` stops. Token posts follow redirects, so a 307 re-posts the code or the refresh token elsewhere.
- **Fix:** `https` or loopback for the issuer and both endpoints, in `issuerMetadata`; `redirect: 'error'` on the token posts. Endpoints on another origin than the issuer's are legitimate and should stay allowed.

### C8. A local token drawn before a failed start is never reported (medium, bug, reproduced)

- **Where:** `app/lib/desktop/core.ts:202-203,252`.
- **Scenario:** first launch with the port taken: 409 `port_in_use`. The person changes the port and starts again: `started: true` with no `localToken`. The hub enforces a value the shell never saw, so the keychain and the Pairing page have none.
- **Fix:** return the token whenever the request carried none, or draw it after the hub is listening.

### C9. A cancel during the issuer's metadata read is lost, and the issuer fetches have no timeout (medium, bug, reproduced)

- **Where:** `app/lib/desktop/signIn.ts:130,204-205,176`; `app/lib/desktop/core.ts:134,389`; `app/lib/desktop/credential.ts:74`.
- **Scenario:** the person cancels while the metadata is read. The browser opens anyway, and a new `signIn` answers 409 `sign_in_in_progress` for five minutes. A silent issuer holds each fetch for the runtime's 300-second default.
- **Fix:** check `signal.aborted` after the metadata read; `AbortSignal.timeout` on all three fetches.

### C10 to C18, lower

| Id | Where | What | Fix |
|---|---|---|---|
| C10 | `app/lib/desktop/core.ts:459` | A request type naming an `Object.prototype` member is not `unknown_request`: `constructor` is answered with no status, `__proto__` is a 500. The relay's allowlist keeps pages from sending these. Reproduced. | `Object.hasOwn(handlers, type)` or a `Map`. |
| C11 | `app/lib/desktop/core.ts:257-268,305-328`; `app/lib/workspaceFolder.ts:263-266` | A `start` during a slow `stop` retakes the lock, and the old stop's `unlock()` then deletes the new lock file. Needs the tray and a page together. Reported, plausible. | Keep `running` set until the close has finished. |
| C12 | `app/lib/desktop/settings.ts:155-176`; `app/lib/workspaceFolder.ts:106-107` | A settings file that is not JSON, or holds a key this version does not know (after a downgrade), fails `start` with 400 and the person must delete it by hand. Two writes at once share one temporary name, so one rename fails. The data folder is created 0755. Reported. | Move a bad file aside and start from the defaults with a warning; serialize the writes; 0700 for the data folder. |
| C13 | `app/lib/desktop/settings.ts:136-140` | `folder` accepts any absolute path, and every start sweeps it for files matching `/\.\d+\.tmp$/`, there and in first-level subfolders whose names fit a branch name. Choosing `~/Documents` deletes other programs' temporaries. Reported. | Require an empty folder or one carrying the store's marker, or use a subfolder of the chosen one. |
| C14 | `app/lib/desktop/folder.ts:63-77` | The synced-folder warning misses iCloud "Desktop & Documents" (`folder.test.ts:29` asserts no warning for `~/Documents`), Google Drive's shared drives, Box, Nextcloud, and a symbolic link into a synced folder. The header says it is a help, not a guard. Reported. | A file-system probe for iCloud; `realpath` before the checks. |
| C15 | `app/lib/desktop/credential.ts:46-47,110` | `Credential.forget` is never called outside its test. When the issuer's keys rotate, the program keeps sending a refused access token until 30 seconds before its expiry. The viewer got a retry for this; the program did not. Reported. | Call it on the remote's 401 `invalid_token` and send once more, as `viewerToken.ts` does. |
| C16 | `app/lib/desktop/core.ts:389-396` | `signIn` can answer an error while leaving the person signed in: the credential is held and stored before `whoAmI()`, so a 403 `not_registered` answers an error and the next start says `signedIn: true`. Reported. | Decide whether a failed `whoAmI` keeps the credential, and say so in the reply. |
| C17 | `app/lib/desktop/protocol.ts:132-134,156` | No maximum line length, `write`'s return value ignored, and a reused request id answered twice. The shell is trusted, so this is hardening. Reported. | A line cap; honor back-pressure. |
| C18 | `app/lib/desktop/core.ts:421-428` | Sign-out forgets the offline refresh token locally and leaves it valid at the provider. ADR-0067's open question 3 covers a revoked person, not the program revoking its own token. Reported. | A best-effort post to the metadata's `revocation_endpoint` where the provider names one. |

---

## V. The viewer's credential

| Id | Sev. | Where | What | Fix |
|---|---|---|---|---|
| V1 | low | `app/lib/viewerToken.ts:69-70,76-87,95-103` | The viewer learns the issuer from the hub's `/discover` and the token endpoint from that issuer's metadata, without comparing the metadata's `issuer` or requiring `https`, then sends `Authorization: Basic <id:secret>` there. `ARMATURE_HUB_TOKEN_ENDPOINT` is used as given. No fetch has a timeout, and one stalled request stalls every page. Reported. | Give the viewer `ARMATURE_OIDC_ISSUER`, already in the same `docker/.env`, so the hub is not in the secret's trust chain; timeouts. |
| V2 | low | `app/lib/viewerToken.ts:108,119-121,140` | A late 401 forgets a token that was just renewed, so N parallel refusals can cost N token requests. A lifetime of 30 seconds or less is never kept. Reported, plausible. | Forget only when the held token is the one refused. |

---

## S. The desktop shell (on `main`)

### S1. The sidecar inherits the person's whole environment (medium, security, traced)

- **Where:** `desktop/src-tauri/src/core.rs:149-155` (no `env_clear`, no override).
- **What:** the plan says the core "reads no environment variable the shell does not pass it", which is true of the core's code and not of Node. `NODE_TLS_REJECT_UNAUTHORIZED=0`, common on developer machines behind a proxy, turns off certificate checks for the remote and the identity provider. `NODE_OPTIONS=--inspect` opens a debugger in the process that holds the tokens. `bundle.test.ts` launches with an empty environment, which is not how the shell launches it.
- **Fix:** clear the environment and pass a short list (home, temporary folder, `SystemRoot`, the `OneDrive*` variables `folder.ts` reads), or at least blank `NODE_OPTIONS` and `NODE_TLS_REJECT_UNAUTHORIZED`.

### S2. An ordinary quit on macOS can leave the core alive (medium, bug, traced)

- **Where:** `desktop/src-tauri/src/core.rs:414-425`. The shell's half of C3: it drops the child's input and waits five seconds, then only logs. The tray's Quit sends `stop` first and does not have this.
- **Fix:** write a `stop` line before dropping the child, and keep the process id to end it after the deadline.

### S3. Quit and "Install and restart" end the core during a push, bring-in or deliver (medium, bug, traced)

- **Where:** `desktop/src-tauri/src/core.rs:436-445` on `main`; `core.rs:462-475` and `update.rs:200-203` on the release branch.
- **What:** the core's `stop` closes the listener and releases the lock at once without waiting for the program's own actions, and the shell ends the process as soon as `stop` answers. `update.rs`'s header says "no write is cut off", which does not hold for the actions. Push's marker recovers it; nothing warns.
- **Fix:** `Core.pending` already says whether a page request is in flight; wait or refuse in `install` and `quit` while it is non-empty.

### S4. A keychain deletion that fails at sign-out is only a log line (medium, security, traced; the trigger is plausible)

- **Where:** `desktop/src-tauri/src/core.rs:297-303,357-360`; `desktop/src-tauri/src/lib.rs:27-29`.
- **What:** the page says signed out, and the next start sends whatever the keychain still holds. On macOS the delete needs the same authorization as the documented post-update prompt, so a Deny there is this case. `connect` to another remote (`:294-296`) never removes the old remote's entry.
- **Fix:** put the failure into the reply so the page can say so; forget the old remote's entry when `connect` changes the remote.

### S5. A keychain read error is handled like "no entry" (medium, bug, traced; the trigger is plausible)

- **Where:** `desktop/src-tauri/src/core.rs:215-222,233-238,304-311`.
- **Scenarios:** the read fails once (a keyring not yet unlocked when the program starts hidden at login), a new pairing value is drawn and written, and every paired tool stops working with only a log line. Or Reset draws a new value, the write fails, and the next start puts the old value, the one reset because it leaked, back in force.
- **Fix:** after a read error keep the drawn value in memory only; after a failed write on reset, tell the page.

### S6. The carried Node is checked against a checksum fetched from the same origin (medium, security, traced)

- **Where:** `desktop/scripts/prepare.mjs:64-74`.
- **What:** the version is pinned and the address is `https`, but `SHASUMS256.txt` comes from the same server and its signature is not verified. This catches corruption, not a compromised origin, and the binary ships inside a program the release then signs.
- **Fix:** put the six expected hashes in the script beside `NODE`, so a change is a reviewed diff.

### S7 to S11, lower

| Id | Where | What | Fix |
|---|---|---|---|
| S7 | `desktop/src-tauri/src/core.rs:153` | The core trusts Node's bundled certificate list, not the system's. Behind an institution's TLS inspection the browser reaches the instance and the program answers `remote_unreachable`. Not in ADR-0069 or the plan. Reported, plausible. | Try Node 22's `--use-system-ca` on the carried version. |
| S8 | `desktop/src-tauri/src/relay.rs:84`; `core.rs:114` | `connect_remote` validates the parsed address but returns the raw string, with no length limit; an encoded newline in the path writes a forged line to the log file. Reported, plausible. | Return the parsed address; cap the length. |
| S9 | `desktop/src-tauri/src/lib.rs:89` | The single-instance plugin on macOS uses a socket in `/tmp`; on a shared Mac another account listening there first keeps the program from starting. Upstream; denial of service only. Reported. | Note it in the program's guide; watch the plugin. |
| S10 | `desktop/src-tauri/src/core.rs:343-349,198-201,395-397`; `logs.rs:27-40` | The keychain write for a rotated token runs inside the reader task, so a system prompt stalls every reply. `child.write` blocks under the `child` mutex. A day's log file has no size limit. A crashed core is never restarted. Reported. | Move the keychain write off the reader; a size cap; a "Start again" control (see P4). |
| S11 | `.github/workflows/desktop.yml:55,58,114,115` | `dtolnay/rust-toolchain@stable` and `Swatinem/rust-cache@v2` are unpinned here while the release workflow pins them, and there is no `permissions:` block (the repository's default is read). Reported. | Pin both; state `permissions: contents: read`. |

---

## R. The release branch (`phase-8/desktop-release`, unmerged)

### R1. The signing key and a write token are in the environment of the whole build (medium, security, traced)

- **Where:** `.github/workflows/desktop-release.yml:43-44,125-130`.
- **What:** the one `tauri-action` step holds `TAURI_SIGNING_PRIVATE_KEY`, its password and a `contents: write` token while it runs `prepare.mjs`, esbuild, Vite and its plugins, and every crate's build script and procedural macro. The workflow's header weighed this for actions and not for the build's own dependencies. The secrets are repository-level with no release environment, so a `desktop-rehearsal-*` tag on an unmerged branch is signed with the production key.
- **Scenario:** one compromised dependency at release time reads the key, and with the same token replaces `latest.json` and the assets of the published release, which every installed program then offers as a validly signed update.
- **Fix:** build with no secrets and `contents: read`, upload the bundles as artifacts, then sign (`tauri signer sign`) and publish in a second job that runs no dependency code. Put the key in an environment with a required reviewer, and sign rehearsals with a scratch key. D7.

### R2. Every error status from the feed is "no update", and the next check waits a day (medium, bug, traced against the plugin's source)

- **Where:** `desktop/src-tauri/src/update.rs:133-143` (commit `43b1c8a`).
- **What:** in the updater plugin 2.14.1 a non-2xx answer becomes `ReleaseNotFound`: 404, and also 403, 429, 5xx and a proxy's 407 or 502. The arm sets `last_check`, logs only on the first check of a run, and overwrites `pending` with nothing.
- **Scenario:** the feed answers 503 at the daily check. Settings says "This is the latest version", the next try is a day away, and a notice already on screen disappears.
- **Fix:** on this path keep the pending update, do not advance `last_check`, and say "no release found" rather than "latest".

### R3. The feed is the repository-wide "latest release" (medium, traced; the scenarios are plausible, since the repository has no releases yet)

- **Where:** `desktop/src-tauri/tauri.conf.json:62-64`; `.github/workflows/desktop-release.yml:140` (`prerelease: false`).
- **Scenarios:** any later release that is not the program's (a hub, a schema, a client) becomes latest, the feed is 404, and by R2 every installed program reports "latest version" for good. Or a rehearsal draft published by mistake is a full release and becomes everyone's feed.
- **Fix:** mark rehearsal tags as prereleases, and use a feed only the program's releases move: a fixed channel release whose `latest.json` is replaced, or the repository's Pages site. D7.

### R4 to R10, lower

| Id | Where | What | Fix |
|---|---|---|---|
| R4 | `desktop/src-tauri/src/update.rs:124-128,185` | The update check and the download have no timeout. A socket that dies while the lid is closed leaves the watcher never checking again; a stalled download leaves the notice at "downloading". Reported. | `.timeout()` on the builder. |
| R5 | `desktop/src-tauri/src/update.rs:203`; `.github/workflows/desktop-release.yml:22` | A `.deb` install is offered updates, contrary to the documents: the plugin runs `dpkg -i` through `pkexec` for a Deb bundle. Unrehearsed either way. Reported. | Skip the check for a Deb bundle, or correct the guide. |
| R6 | `.github/workflows/desktop-release.yml:53-74,125-143` | Four matrix jobs each create or find the draft and merge `latest.json`; the known failure is two drafts for one tag or a `latest.json` missing a platform. Reported, plausible. | A first job that creates the draft and passes its id; check that `latest.json` names all four platforms before publishing. |
| R7 | `desktop/src-tauri/src/lib.rs:130`; `update.rs:209` | After "Install and restart" in a session that began at login, `--hidden` survives the restart and the program comes back with no window. Reported. | Drop `--hidden` on a restart the person asked for. |
| R8 | `desktop/src-tauri/src/login.rs:34-35` | The start-at-login entry is compared by existence only, and on macOS it holds the executable's path at the time it was made; a program moved to Applications afterward keeps the old path. Removing the program leaves the entry on macOS and Linux, which the guide does not say. Reported. | Call `enable()` at every start when wanted; a line in "Removing the program". |
| R9 | `.github/workflows/desktop-release.yml:101,113` | The caches cannot be shared between tags and add a restore path into a signed build; nothing checks that the tagged commit is on `main`; Cargo is not run `--locked`. Reported. | Drop the caches; check ancestry; `--locked`. |
| R10 | `desktop/src/components/UpdateNotice.tsx:13-23,47`; `desktop/src/pages/Settings.tsx` | "Install and restart" is not held back while a page action runs (S3). The Start at login box shows ticked once the setting is saved even when the system entry could not be made. Download progress inside `role="status"` announces every percent. Reported. | Disable the button while an action runs; report the entry's real state. |

---

## P. The desktop pages

### P1. With no status, the page states "Everything here is on the remote" (medium, bug, traced)

- **Where:** `desktop/src/pages/Workspace.tsx:73,82`; `desktop/src/pages/Workspaces.tsx:46-48`; `app/lib/api/routes/workspace.ts:198-200`.
- **What:** `unpushed` is empty whenever `status` is undefined, and the route maps only `remote_unreachable` to `{ reachable: false }`. Under `oidc` offline the token source throws 503 `issuer_unreachable` or 401 `signed_out`, which pass through as failures.
- **Scenario:** a signed-in person on a plane with three unpushed commits opens a workspace and reads "Everything here is on the remote" under an alert. The same sentence shows during any slow status read.
- **Fix:** say nothing about the remote until the status is read; map the token source's failures to `{ reachable: false }` in the route, as the plan's §4 promises.

### P2. A non-numeric port or snapshot count silently saves the default (medium, bug, traced)

- **Where:** `desktop/src/pages/Settings.tsx:51-55`; `app/lib/desktop/settings.ts:126-128`.
- **What:** `Number('31o1')` is `NaN`, which serializes to `null`, which the core reads as "restore the default". The page says "Saved." The fake core receives the `NaN` unserialized and answers 400, so no browser test can see this.
- **Fix:** validate in the page before sending; have the core refuse `null` for a key the page did not mean to clear, or send a distinct value for "restore".

### P3 to P8, medium

| Id | Where | What | Fix |
|---|---|---|---|
| P3 | `desktop/src/lib/useShell.ts:36-46` | `busy` is one slot that any finishing request clears. On the Workspace page the status read returning re-enables Deliver, Remove and Bring in during a push; a second Deliver or Create is not caught locally. The sidebar's Pause and Resume, "Restart the hub" and Connect's restart have no guard at all. Traced. | A counter or a key per action, and one in-flight flag for the hub's start and stop. |
| P4 | `desktop/src/App.tsx:88`; `desktop/src/pages/Settings.tsx:64-68`; `desktop/src-tauri/src/core.rs:231` | After a start fails (a port in use), the window offers no way to start the hub again: the sidebar button disappears, the tray item is disabled, and saving a corrected port offers no restart because the hub is not running. Recovery is quitting. Reported. | Show a start control in the `failed` state; offer the restart whenever the hub is not running. |
| P5 | `desktop/src/App.tsx:17-22,41-43` | The opening page is decided once from the first snapshot of the shell's state, which may predate the core's `start` reply (14 seconds on a cold first launch): a connected person opens on an empty Connect page, or a signed-in person on Sign in. Reported, plausible; the fake never reports `starting`. | Decide once the state is settled, or decide again when it changes before the person acts. |
| P6 | `desktop/src/components/RefusalNotice.tsx:21-33` | No mapping of codes to messages, and only `conflicts` among the details is rendered: a 422's `violations` (which the plan's §4 promises), a 412's `moved`, push progress and a forbidden's `holders` are dropped. Text written for the shell reaches the person ("The hub is not running; send start"). Reported. | Render the details the plan names; a sentence per code the pages can meet. |
| P7 | `desktop/src/pages/Workspace.tsx:63-71,145,177` | A refused action does not reload: a push that lands three of five commits then gets 412 still shows five unpushed, and a deliver whose merge landed but whose remote delete failed shows only the refusal. After a successful Remove the page asks for the status of a workspace that is gone and flashes a 404 alert before navigating. Reported. | Reload after a refusal; navigate before reloading after a removal. |
| P8 | `desktop/src/pages/SignIn.tsx:31-38,61-69` | A waiting sign-in cannot be cancelled from its page, and its outcome lives only in the component: leaving and returning offers "Sign in" again, which answers 409 `sign_in_in_progress`. The page never shows who is signed in. Reported. | A cancel control; keep the sign-in's state in the shell's state. |

### P9 to P14, lower

| Id | Where | What | Fix |
|---|---|---|---|
| P9 | `desktop/src/pages/Settings.tsx:137-144` | Changing the folder says only "The hub uses these from its next start"; the plan's §9 promises "deliver or delete them first, or move the folder and point at it". After the restart the list is empty and unpushed commits sit in the old folder. Reported. | The plan's sentence, shown when workspaces exist. |
| P10 | `desktop/src/pages/Workspace.tsx:142-143` | Deliver ignores `delivered.upToDate`: delivering twice says "Delivered into main as <main's head>". Reported. | Say there was nothing to deliver. |
| P11 | `desktop/src/pages/Workspaces.tsx:51`; `Workspace.tsx:61`; `App.tsx:59-62` | Nothing refreshes a page: a tool's new commits or a returned network show only after leaving and returning. `unpushed` is the first N of a fixed 50-commit read, so 73 unpushed shows "50 commits" beside a "73 unpushed" badge. Reported. | Reload on the hub's events or on focus; read as many commits as the status counts. |
| P12 | `desktop/src/App.tsx:44-46`; `desktop/src/lib/useShell.ts:18`; `Connect.tsx:24,114` | The same link opened twice does nothing the second time; a handled link stays in state and prefills every later visit to Connect; any link navigates the window away from a running action and drops its outcome. Reported. | Clear the link once handled; do not navigate while an action runs. |
| P13 | `desktop/src/` | No focus handling on page change (only one `autoFocus`), `role="status"` notices mount already filled, busy labels are not announced, and `aria-label`s sit on role-less elements where they name nothing. Inputs are labeled and state is never color-only. Reported; the announcements were not checked with a screen reader. | Move focus to the page's heading on change; give the labeled regions a role. |
| P14 | `desktop/src/pages/Pairing.tsx:25-43,60` | The pairing value is shown unmasked whenever the page is open and never cleared from the clipboard; a null value never refreshes while the page stays open; the tool identifier is hidden without explanation when `toolIdentity` fails. Reported. | Mask until asked; refresh on the hub's start. |

### P15. The contract is restated by hand in three places, and nothing fails when they drift (medium, alternative not considered, reported)

- **Where:** `desktop/src/lib/types.ts`, `desktop/src/lib/fakeCore.ts`, against `app/lib/desktop/core.ts` and `@armature/client`.
- **What has already drifted:**
  - The pages re-declare `WorkspaceRecord`, `WorkspaceStatus`, `PushResult`, `BringInResult`, `DeliverResult`, `RemoveResult`, `LogResult`, `MergeConflict` and `Violation`, all of which `@armature/client` exports; the client's `WorkspaceStatus` lacks `snapshots` and its `WorkspaceRecord` lacks `instance`, which the route returns.
  - The fake's `REVISION` is `2026-11-06`; the hub is at `2026-11-07`, and the browser test asserts the stale one.
  - The fake's name rule, its settings rules, its answer to a malformed address and its `start` and `stop` answers differ from the core's and the shell's.
  - The fake never produces `forbidden`, `precondition_failed`, `invariant_violation`, `push_in_progress`, `issuer_unreachable`, `port_in_use`, `folder_locked` and about fifteen more codes, nor the states `starting`, `failed` and `{ reachable: false }`.
- **Fix:** a decision, D8.

---

## T. Tests

Each confirmed defect above has no test; a fix brings its own. Beyond those:

| Id | Suite | Gap |
|---|---|---|
| T1 | `app/lib/api/oidc.test.ts` | No person's token without `name`; no token without `email_verified`; no key endpoint answering an error; no relayed export. |
| T2 | `app/lib/api/writeQueue.test.ts` | "refuses rather than overwrites a document changed since it arrived" holds the queue by hand, so it shows the rule only for writes that provably waited. Nothing sends a create, a delete, a grant write and a merge into `main` together (the lock order), and nothing times a store call out inside the queue. |
| T3 | `app/lib/api/workspace.test.ts`, `cycle.test.ts` | No delete racing a file-store write; no Remove retried after failure, nor under `unreachable`, `forbidden`, `absent` or `remote_identity`; no write during bring-in; no redirect; no unbounded remote log. The `etag_altered` test uses a stub client, and the commit's other half, status reading the head from the body, has no test. |
| T4 | `app/lib/api/handle.test.ts` | One person, current email. Nothing exports after an email change or with a shared local part. |
| T5 | `app/lib/desktop/core.test.ts` | Nothing reaches `insecure_remote`, `no_client_id`, `not_a_remote`, `unknown_resolver`, `sign_in_in_progress`, `port_in_use` or `folder_locked`. The `oidc` remote is on loopback, so the `https` rule is never exercised. No hostile profile. |
| T6 | `app/lib/desktop/signIn.test.ts`, `credential.test.ts`, `protocol.test.ts` | The cancel test cancels after the listener is registered. A refusal is only a 400 `invalid_grant`. "closes when the input ends, after every request in flight is answered" asserts the behavior behind C3. |
| T7 | `app/lib/desktop/bundle.test.ts` | It proves the bundle loads on the runner's Node with an empty environment under `header`. It does not prove the exit with a request in flight, anything under `oidc`, or the shipped Node, and it repeats the build's options without `--sourcemap` rather than reading them from `package.json`. |
| T8 | `desktop/e2e/pages.spec.ts` | "a link … connects nothing until the person reads and confirms" proves only that the field is filled and that the seeded workspaces refuse the connection. No test for sign out, any offline action, a non-maintainer's Deliver (the common case under ADR-0068), 412 and 422, "Not compatible", non-numeric settings, or double submission. Nothing exercises `backend.ts`'s real branch, so the command names and the event name are matched to Rust by hand. |
| T9 | (none) | The rule "don't commit to a branch outside `Store.exclusive`" has no test that reads the modules for it, as the rule against `invariants: 'skip'` has. W3 and W4 would have failed one. |

---

## D. Decisions

Each is Amos's to make. Options with their costs, then a recommendation.

**D1. How the hub tells a service's token from a person's (A3).**
- *Keep the `name` rule and refuse clearly.* A token with no `name` but with an `email` or `preferred_username` that is not a service account's is refused 401 with a reason that names the missing claim. Smallest change; still a guess about the provider.
- *An explicit list,* `ARMATURE_OIDC_SERVICES`, of client ids that are services; any other token is a person's. Fails closed, one more setting, and a person's token without `name` then resolves by `sub` and registers only when an administrator has registered them.
- *A configurable claim,* such as `gty=client-credentials` or `idtyp=app`. Fits each provider; the administrator must know their provider's claim.
- **Recommended:** the explicit list. It is the only option that does not depend on what a provider happens to send, and the instance already names its viewer's client. A dated note on ADR-0067 decision 4.

**D2. Whether domain admission needs `email_verified: true` (A4).**
- *Require it.* Closes the gap; a provider that omits the claim then admits no one by domain, and its administrator lists the issuer instead.
- *Keep it and document it.* No behavior change; the gap stays for such providers.
- **Recommended:** require it. Admission by issuer already covers the provider that vouches for all its people. A dated note on ADR-0067 decision 1.

**D3. Whether one hub per store is enforced, or only stated (Q1).**
- *State it* in `docs/deployment.md` and at the operator tools' start. Free.
- *A start marker in the store:* the hub writes a lease on start and refuses, or warns, when a live one exists. Catches a second hub; needs a place for the lease that is not the commit graph, and a rule for a hub that died.
- *Wait for the store's fix* (terminusdb/terminusdb#2637), after which the conditional write holds across processes.
- **Recommended:** state it now, and make checks AO1 and AO2 a verdict so the fix is noticed when it ships. The marker is worth building only if a second hub becomes a planned arrangement.

**D4. The email handle against the registry gate (E2).**
- *Keep the email's local part.* Readable names; any token holder learns part of each workspace owner's address.
- *A handle the person chooses,* kept on the `User`, defaulting to the email's local part. Readable and theirs to change; one more field (a schema change, so an ADR).
- *An opaque handle under `oidc`.* Nothing leaks; names are unreadable again, which is why the email was chosen on 2026-11-08.
- **Recommended:** keep it, and record the tension as a dated note on ADR-0065 and ADR-0068 decision 4, since a branch list that names owners is what a maintainer reads to do their work. Fix E1 regardless.

**D5. Whether the program binds a token to the hub it was issued for (C1).**
- *Fix the card only* (C1, C2): show the dialed address, refuse a changed profile.
- *Also check the audience:* the program reads the access token's `aud` and refuses to send it to a hub whose `/discover` names a different audience, and the hub's audience is shown on the card. Small; a hostile hub can still declare the real audience.
- *A resource indicator per hub* (RFC 8707), where the provider supports it, so a token names the address it is for. Closes the class; depends on the provider.
- **Recommended:** the card now. Note the resource indicator in the plan as the direction, and take it up when a second instance shares a provider.

**D6. A way out for a workspace that can never be pushed (W8).**
- *An explicit discard:* a second confirmation that names the number of local commits to be lost.
- *Keep refusing* and document removing the folder by hand.
- **Recommended:** the discard, in the program only (not a route), with W2 fixed first so a failed removal can be retried.

**D7. The release's signing and its feed (R1, R3).**
- *Two jobs,* build without secrets then sign and publish, with the key in a reviewed environment and a scratch key for rehearsals; and a feed only the program's releases move.
- *Keep one job* and pin the lockfiles harder.
- **Recommended:** two jobs and a dedicated feed, before the branch merges. The workflow already has rehearsal tags, so the cost is one more rehearsal run.

**D8. One contract for the pages, the fake and the core (P15).**
- *Import the workspace types from `@armature/client`.* Minutes; removes nine hand copies.
- *One contract module* (request name to fields and reply) used by `core.ts`, `backend.request` and the fake's handler table. About a day; a renamed request becomes a compile error.
- *A both-answer-alike test:* replay one script through `core.test.ts`'s `drive()` harness and through `fakeCore()` and compare status, code and body keys, as `filestore/contract.test.ts` does for the two stores. Catches every rule difference listed in P15.
- *The browser tests against the real core.* Heavy: a Node bridge and the store container.
- **Recommended:** the import and the both-answer-alike test. The contract module can follow if the test keeps finding drift.

---

## A suggested order

1. **Before `phase-8/desktop-release` merges:** R1, R2, R3 (with D7), then C1 and C2, since that release is what puts the program in people's hands; S1 and S6 ride the same rehearsal.
2. **Before real work is kept in a workspace hub:** W1 to W4, with T9's test so the rule holds afterward.
3. **In one authentication change,** since workflow rule 5 asks for a Droplet run whenever authentication changes: A1, A2, A4 (D2), A5, A6 and D1.
4. **Sign-in's rough edges:** C3 to C9, S2 to S5.
5. **The pages:** P1 to P8, then D8.
6. **The rest** as the files are next touched.

A fix that adds a refusal code or changes what a client receives (W4's refusal, a `profile_changed` on `connect`, D1's new reason) needs its dated entry in `docs/client-changes.md`; A1 restores a status the contract already promises and does not.

---

## Found sound

Checked and found correct, so a later review need not repeat it:

- **The write queue.** A rejected task does not poison the chain; the map of keys does not grow; no deadlock or re-entry is reachable through any two-key path (`POST /branches`, `DELETE /branches/:name`, merges, grant writes, first-encounter registration). The `document_moved` comparison is right: an unrelated commit cannot trigger it.
- **The `oidc` resolver.** Asymmetric algorithms only; issuer, audience, expiry and not-before checked; the metadata's `issuer` compared before its `jwks_uri` is trusted; concurrent first sign-ins settle on one `User`; a `User` registered without an issuer is not matched by a token; a relay cannot create a branch, merge, grant or register; `Grant` ids are a hash of their contents, so one grant cannot overwrite another.
- **The boundary.** `requireIdentity` and the router read the same path, so the open routes under `oidc` cannot be widened by path tricks; `User` has no ancestor class, so no list of a parent type returns the registry.
- **Sign-in.** PKCE with S256, a 32-byte verifier and a 16-byte state used once; the listener on `127.0.0.1` at an ephemeral port, closed on every path; only escaped text on the callback page.
- **The shell.** The CSP allows no remote script or connection; the one capability is `core:default`; the relay is an exact allowlist that refuses `start`, `stop` and `credential`; the deep link only fills the address field; both tokens reach the sidecar over its input, never in arguments or the environment; no token or pairing value is written to a log.
- **The updater's trust.** A public key is configured and `requireSignedVersion` is on; downgrades are refused; a hub's `program.releases` is shown as text and cannot move the feed.
- **The workspace hub.** Name and path handling in Remove and in `workspaceFolder.ts`; the local token's constant-time comparison; `requireRemoteIdentity` before every action; the clone's base checked as a bare commit identifier.
- **Deployment.** The hub is proxied only under `oidc` and only at its own host name; the guard refuses `oidc` without an issuer, an audience or a bare API host; no `encode` on the hub's site.

## Limits

- Nothing was run against TerminusDB and no suite was run, so the hub's findings are traced, not exercised, apart from A1. Q4 follows from platform checks W2c and W2d and was not run.
- `split.ts`, `patch.ts`, `ids.ts` and `trailers.ts` were not read.
- `Cargo.lock` was not audited, and `tauri-action`'s source at the pinned commit was not read, so R5 and R6 rest on the plugin's side only.
- Windows behavior of the core's pipes was reasoned about, not run. W5's redirect behavior was run on Node 24, not CI's Node 22.
- P5 and P13 need a run in the real shell, and with a screen reader, to confirm.
- The documents changed in the range were read only where a finding turned on what they promise.
