# The Windows rehearsal of 2026-11-03

> **Status (2026-11-03):** a kept record of one day's rehearsal on a real Windows PC, written the same evening. What it found is also recorded as dated notes on ADR-0066 (Architecture Decision Record 0066, `schema/docs/adr/0066-workspace-hub-store.md`, Verification and Consequences) and in `docs/workspace-hub-plan.md` §10; what was built from the morning's findings merged as pull request #101. The afternoon's finding, a rename refused inside a synced folder, is open for a decision (§6). This record is annotated, never rewritten.

The file-backed store (ADR-0066) keeps a workspace hub's data as a folder of files the hub reads and writes itself, so that a designer installs Armature as one program on any operating system, Windows included. Every file is written under a temporary name, flushed and renamed into place, so a crash leaves the old file or the new one, never part of one. The ADR's Verification asked for that sequence to be exercised under the conditions a designer's machine has. GitHub's Windows runner gave most of it on 2026-11-02 (CI's `files` job). Two cases were left for a real machine, `SESSION.md` item 32: a folder inside a synced directory (OneDrive with Files On-Demand), and a process killed between the temporary write and the rename. This is the record of running them.

Abbreviations: ADR (Architecture Decision Record), API (application programming interface), CI (continuous integration), LAN (local area network), NTFS (the Windows file system), PR (pull request).

---

## 1. The machine and the arrangement

| | |
|---|---|
| Machine | A Windows 11 Pro PC, a floor tower (`tec-757`), NTFS, Microsoft Defender's real-time scanning on |
| Runtime | Node.js 26.13.0; the hub run as a plain process, no container |
| Sync client | OneDrive, personal account, signed in, Files On-Demand active (the default); the test folders under `C:\Users\amos\OneDrive\armature-rehearsal` |
| Local folders | `C:\armature-rehearsal\kill` and a scratch folder outside OneDrive, for the cases on plain NTFS |
| Remote hub | The Mac's instance (`m2-mac`, `docker compose --profile hub`), published on its Tailscale address `100.85.125.14:3100` and tailnet name, with `ARMATURE_ALLOWED_HOSTS` naming both; reached from the Windows PC over the tailnet. A rehearsal arrangement: under the `header` resolver the remote trusts whatever identity a request claims, and the tailnet is one person's devices |
| Remote revision | 2026-11-02 (`GET /discover`) |
| Hub bundles | Morning: `app/dist/server.mjs` built here from `main` at `cf295e9`. Afternoon: the bundle the Mac sent with its runbook, byte-identical to that morning build (SHA-256 `598dd9a2…`). A bundle from `main` at `ce957eb`, with the morning's fixes, carries client revision 2026-11-03, which the remote refuses for writes (`unsupported_version`; reads are served), so the afternoon ran the older bundle |
| Where things are | The session's own harness in a scratch folder (not kept; the kill is now a test in `app/lib/workspaceFolder.test.ts`); the Mac's runbook, `rehearse.mjs` and `server.mjs`, in `C:\armature-rehearsal`; the runbook's summaries `rehearsal-kill.json` and `rehearsal-onedrive.json` with their logs in the session's scratch folder |

Before any of it, two things about the machine itself had to be settled, since this was the repository's first checkout on Windows: Git for Windows checks text out with CRLF line endings unless told otherwise, which made `npm run check:types` report the generated types out of sync on a tree where CI was green, so PR #100 added `.gitattributes` with `* text=auto eol=lf`; and the first `npm install` under npm 12 added an `allowScripts` block to `package.json`, which was reverted.

---

## 2. What was run

Four instruments, in order.

1. **The no-store suite inside OneDrive.** `npm run test:files` (the file store's modules and the workspace folder on disk: 300 replacements of one file, a store over 40 commits reopened from disk, stray temporaries, the lock) with Node's temporary folder pointed into OneDrive, so every test's folder was a synced one.
2. **The session's harness.** A child built with esbuild from the real `folderFiles` and file store, which seeds a schema and three versions of one document, then writes a fourth with `fs.promises.rename` hooked to terminate the process (`SIGKILL`, `TerminateProcess` on Windows) the moment the rename of a chosen file is about to happen: the commit file, or `head.json`. A separate `verify` step reopens the folder, reads the document, and writes once more. Run on NTFS and inside OneDrive. The same harness seeded a store inside OneDrive whose commit files were then made cloud-only with `attrib +U -P`, read with the sync client running and with it stopped; and the real hub (`server.mjs`) was started over that folder in each state and queried.
3. **The Mac's runbook, kill mode.** `rehearse.mjs --mode kill --rounds 30`: starts a workspace hub over `C:\armature-rehearsal\kill`, creates a scratch branch `test-rehearsal-kill-tec-757` on the remote from `main`, clones it, and in each round writes ten `LearningNeed` documents per request back to back until it terminates the hub at a random moment 20 to 420 ms in; then inspects the folder (temporary files, whether `head.json` parses and names a present commit file, unparsable commit files, the chain from the head and the commit files outside it), restarts the hub, and reads back every document ever acknowledged. At the end, a push and a read-back from the remote.
4. **The Mac's runbook, OneDrive mode.** `rehearse.mjs --mode onedrive --rounds 10 --dehydrate`: the same hub over a folder inside OneDrive and a scratch branch `test-rehearsal-onedrive-tec-757`; ten rounds of twenty writes with latency measured; then the hub stopped, every commit file made cloud-only with `attrib +U -P`, the hub restarted and every acknowledged document read back; then a push and a read-back.

A fifth, after the fact: a loop replacing one file by write, flush and rename, with content growing each round, inside OneDrive and on NTFS, at the push's pace and at the commit's, with and without the sync client kept busy, to characterize §5's refusal.

---

## 3. Results: the kill

### 3.1 The session's harness

At both seams, on NTFS and inside OneDrive alike, the folder after the kill held the old file whole and a complete temporary file beside it, named `<target>.<pid>.tmp`; `head.json` named the seeded head; the store reopened at that head, read the third version of the document, and took the next write.

| Seam | Where | Left behind after the kill | Reopened | Wrote again |
|---|---|---|---|---|
| Before the rename of the commit file | NTFS | `commits/<id>.json.<pid>.tmp`, 346 bytes, complete | At the seeded head, label `v2` | Yes |
| Before the rename of the commit file | OneDrive | The same | The same | Yes |
| Before the rename of `head.json` | NTFS | The new commit file (448 bytes) and `head.json.<pid>.tmp`, 76 bytes, complete; `head.json` unchanged | At the seeded head, label `v2` | Yes |
| Before the rename of `head.json` | OneDrive | The same | The same | Yes |

Two things such a kill leaves for good with the code of that morning: the temporary file, which opening ignores but nothing removed, and, at the head seam, a commit file no branch references, which opening reads and keeps in memory. Both are now handled on `main` (§6).

### 3.2 The runbook's kill mode

Thirty rounds, no findings. In every round the head parsed and named a present commit file, no commit file was unparsable, nothing unexpected was in the folder, and every acknowledged document was readable after the restart.

| Measure | Value |
|---|---|
| Rounds | 30 |
| Documents acknowledged, all rounds | 5,410 (in 542 local commits) |
| Documents missing after any restart | 0 |
| Requests cut off by the kill | 1 per round; none of their documents counted as in flight, since the request carried no ids |
| Hub restart, from spawn to `GET /discover` answering | 218 to 261 ms |
| Temporary files at the end | 7 (3 beside commit files, 4 beside `head.json`) |
| Commit files at the end | 549, of which 544 in the chain from the head and 5 unreferenced |
| Push | 542 commits in 148 s over the tailnet (about 270 ms a commit), 200 |
| Read back from the remote | 5,422 `LearningNeed` on the branch: the 5,410 acknowledged plus the seed's 12; none missing |

---

## 4. Results: the synced folder

### 4.1 While the sync client runs

- The no-store suite passed inside OneDrive: 30 tests in 4.2 s, against 2.6 s on plain NTFS. It left nothing behind but Node's own compile cache.
- Every file written was claimed by OneDrive's cloud filter within seconds (the `ReparsePoint` attribute appears on a hydrated placeholder). The `.tmp` files were never claimed: OneDrive skips temporaries, so a stray temporary is not uploaded, and only the file renamed over is the sync client's concern.
- A commit file made cloud-only (`attrib +U -P`; attributes then `Offline`, `RecallOnDataAccess`, `Unpinned`) was read by the store without any special handling and came back hydrated.
- The runbook's OneDrive mode: 200 writes of ten documents each, mean latency 11 to 15 ms a request (minimum 10, maximum 21), no errors, no stray files; 202 commit files. After the hub was stopped and 123 of those files made cloud-only, the hub restarted in 244 ms and every acknowledged document read back, in 18.5 s for the reads, about 150 ms a file: the cost of hydration.

### 4.2 With the sync client stopped (the offline case)

A designer who has "freed up space" on the folder and is then offline, or whose client is not running, is this case. The session's harness, with OneDrive's process stopped and one commit file cloud-only:

- The plain read fails with Node's `UNKNOWN: unknown error, read <path>`, errno -4094, since libuv has no mapping for the cloud filter's error.
- Opening the store fails on that read, because opening reads every commit file.
- The real hub started normally and printed its banner naming the store, then answered `GET /api/v1/branches` with **500** `internal_error`, "Internal error", the path only on its stderr.
- With the client started again and the file still cloud-only, the same hub process kept answering 500: the store kept its first failed open. A plain read of the file now succeeded, and a fresh hub over the same folder answered 200, taking over the lock the killed hub had left.

### 4.3 The documentation gap

ADR-0066's Consequences said the workspace hub's default location is outside synced directories "and the plan says what it does when it finds itself inside one". The plan said nothing, and the hub detects no synced folder. Both now carry a dated note (PR #101).

---

## 5. Results: the push inside the synced folder

The runbook's OneDrive mode ended with a push that failed:

| Measure | Value |
|---|---|
| The push's answer | **500** `internal_error` after 1.8 s, 7 of 200 commits sent |
| A push by hand, same folder, a fresh hub | Resumed from commit 7, reached 124 in 29.8 s, then the same 500 |
| The remote's branch after both | Consistent, head at the 124th commit, 82 `LearningNeed` (the seed's 12 plus 70); 76 commits left to push |
| The cause, from the hub's stderr | `EPERM: operation not permitted, rename '…\push.json.20332.tmp' -> '…\push.json'`, errno -4048, in `writeWhole` from `pushWorkspace`'s save of the push table |

The push rewrites `push.json`, its table of which local commit became which remote commit, after every commit sent, so that a push cut off anywhere resumes; and resuming is exactly what happened. What failed is the rename of the new table over the old, refused by Windows while the sync client held the file it had just been handed. The two refusals left `push.json.23948.tmp` (1,702 bytes, after 7 commits) and `push.json.20332.tmp` (26,304 bytes, after 117 more), both complete.

The after-the-fact loop characterized it:

| Loop | Renames | Refused |
|---|---|---|
| Inside OneDrive, 250 ms apart, content growing to about 60 KB | 150 | 0 |
| Inside OneDrive, 12 ms apart | 300 | 0 |
| Plain NTFS, 250 ms apart | 60 | 0 |
| Inside OneDrive, 250 ms apart, while 202 commit files beside it were dehydrated and rehydrated in 12 cycles | 280 | 1: `EPERM` at round 173 (44 KB), cleared by a second attempt 15 ms later |

So the refusal is the intermittent sharing violation any program replacing files under a sync root meets while the client is busy, not a function of pace or size alone. It never appeared on plain NTFS, on the CI runner, or in the 200 replacements of `head.json` at 12 ms. The common remedy on Windows, what graceful-fs does, is to retry a rename refused with `EPERM`, `EACCES` or `EBUSY` with a short backoff; the measurement says one more attempt after tens of milliseconds suffices.

---

## 6. What was decided and built, and what is open

**Built the same day, merged as PR #101 (`main` at `ce957eb`), from §3.1 and §4.2:**

- A read the operating system refuses although the file is there (`UNKNOWN`, `EIO`) is a store error of the new kind `unreadable`, which the hub answers as **503** `store_unreadable` naming the file, with `Retry-After` (`app/lib/workspaceFolder.ts`, `unreadable`; `app/lib/api/app.ts`).
- The file store forgets a failed open and reads its folder again on the next request, so the hub recovers without a restart once the file is back (`app/lib/api/filestore/store.ts`, `load`).
- Taking the folder's lock sweeps the temporary files a killed process left, in the branch folders and their `commits/` (`lockFolder`, `sweepTemporaries`).
- The kill is a kept test: a child built from the real modules with esbuild, terminated at each seam, then the folder, the reopen, a further write and the sweep checked (`app/lib/workspaceFolder.test.ts`). It runs in CI's Windows job.
- Revision 2026-11-03 in `docs/client-changes.md`, `REVISIONS` and `CLIENT_REVISION`; the row in `docs/api.md`; the deployment guide's caution to keep the folder outside OneDrive, iCloud Drive or Dropbox.

**Deferred to the desktop program (plan §14 step 7), which chooses the folder:** a warning or a refusal on a folder inside a known synced root, and pinning the folder "always keep on this device".

**Open, from §5, for a decision:**

1. A bounded retry of the rename in `writeWhole`, backoff from 10 ms to a few seconds, then a clear 503 naming the file, riding revision 2026-11-03. Recommended: the standard remedy, small, and the measurement says a second attempt suffices.
2. Document only: the guide already says to keep the folder out of synced directories.
3. Rewrite the push table less often, which weakens crash recovery. Not recommended.

Verifying a fix end to end against the Mac needs its instance on today's `main`, since a bundle from `main` is refused for writes at the remote's older revision.

**Not rehearsed, needing two machines:** the lock file synced to a second machine, where its process id means nothing. Both machines are on the tailnet, so it can be.

> **Note (2026-11-03, night, from the Mac):** option 1 taken (Amos). `writeWhole` tries a rename refused with `EPERM`, `EACCES` or `EBUSY` again through waits of 10 ms doubling to 1.28 s, about 2.5 seconds in all, then reports 503 `store_unwritable` naming the file, the temporary removed and the old file standing (`app/lib/workspaceFolder.ts`, `renameInto`, `RENAME_WAITS`; ADR-0066 Verification, the night's note; riding revision 2026-11-03). Two kept tests in `app/lib/workspaceFolder.test.ts` drive it with the kill test's child, its `rename` refusing the next head twice and then every time. The end-to-end check against the kept OneDrive folder is still to run from the Windows PC, its hub rebuilt from this change first; the Mac's remote needs no rebuild, since the change is the workspace hub's side and the revision is the same.

---

## 7. Loose ends

- Two scratch branches remain on the Mac's instance, `test-rehearsal-kill-tec-757` and `test-rehearsal-onedrive-tec-757`, for the operator's scratch-branch delete there.
- The workspace folder `C:\Users\amos\OneDrive\armature-rehearsal\test-rehearsal-onedrive-tec-757` is kept, with 76 commits unpushed, so a fix for §5 can be tried against it; the loop's folders beside it and `C:\armature-rehearsal\kill` can go at any time.
- The Mac's runbook is not in the repository. Its kill and OneDrive modes drive the real hub over the API, where the kept test drives the modules; if the runbook is to be kept, `scripts/` is its place, outside the workspace.

> **Note (2026-11-03, evening, from the Mac):** the remote in §1 was the hub's bundle run as a plain process on the Mac, bound to its Tailscale address only with `HOST`, `ARMATURE_TRUST_NETWORK=1` and `ARMATURE_ALLOWED_HOSTS`; only TerminusDB ran under compose. The runbook had been checked on the Mac first (two runs, five kills, the same reading as §3.2 in small) before it was served. That evening the Mac rebuilt the remote from `main` at `931d44c` (revision 2026-11-03), so §6's end-to-end check can run against the kept folder; `test-rehearsal-kill-tec-757` was deleted there by the operator and `test-rehearsal-onedrive-tec-757` kept. The runbook's copies are `~/Dev/armature-handoff/` on the Mac and `C:\armature-rehearsal\` on the Windows PC.
