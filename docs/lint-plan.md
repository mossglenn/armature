# Checks and the Lint plugin: plan

*Status: draft 2026-11-12, decisions taken the same day (§17). The hub's half is proposed as ADR-0070 (`schema/docs/adr/0070-checks-hooks-and-gates-for-plugins.md`), not yet accepted; Lint itself is a client of the hub, built outside this repository. Written in a claude.ai session from `main` at `bcbf8ff`, in two versions: v1 put the rule engine in the hub; v2, this one, keeps only hooks and gates in the hub, at Amos's request, so that rules ship with the plugin and not with Armature's releases.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CI (continuous integration), CLI (command-line interface), JSON (JavaScript Object Notation), SSE (server-sent events), WASM (WebAssembly).

---

## 1. In brief

**The hub gets four generic primitives (an event feed, a check-run store, required-check records and a merge gate) and runs no rule code. Lint and the Structure analyzer are outside services that read the graph, post results, and are named as required by branch and graph owners.** This is the GitHub status-check model, adapted to Armature's two hub roles and its grants.

- **What the hub releases:** the feed, the store, `CheckRequirement`, the gate in the merge route, and the same on the workspace hub. Nothing about lint rules, thresholds or Bloom levels.
- **What Lint releases on its own schedule:** the rule engine, the catalog, its config interpretation, a remote service and a local runner.
- **Who decides what is required:** a maintainer of `main` names the checks required to merge into `main`; a branch owner names the checks for their branch. These are records on `main`, authorized by ADR-0068's existing table. A requirement carries opaque `params` the hub stores and never reads, so "which lint rules, how strict" travels with the requirement and is interpreted by the plugin.
- **On the desktop:** the workspace hub serves the same feed and store, so the person runs Lint locally (a CLI in watch mode, or a small app) and sets personal requirements for push.

**What changed from v1, and what it costs.** v1 put the rule pack in the hub so checks could run inside the write and merge paths. Moving it out removes that coupling but gives up two things: a plugin can no longer *block a single write* (only the merge, and a local push), and a merge waits until the check service has reported on the source head. §11 sets out both, and why the first is mostly a feature: a rule that must block every write is an invariant, and belongs in the hub's engine by ADR.

## 2. What the repo already fixes

Read against `main` at `bcbf8ff` (2026-11-12). These are constraints the plan works inside, not choices it makes.

| Source | What it says | What it means for Lint |
| --- | --- | --- |
| `docs/demo-coverage.md`, Lint profile | Gate; acts as nobody; a person keeps a violation as a finding; runs on the designer's machine before a push, and beside the hub as policy "once merge-time checks exist" | The two placements asked for (the remote hub for graph and branch owners, the desktop for individuals) are already the intended ones. The remote placement is blocked on a hub capability. |
| `demo-coverage.md`, dimension 4 | Whose rules configure it: personal, team/project or institutional; "where a rule set lives ... is Lint's question" | Layered policy is the expected answer; storage is open. |
| SESSION.md item 18 | The path read, plus "reacting to changes (events, or merge-time checks an administrator can register)" | Graph-pattern rules want the path read; enforcement wants a registered check stage. |
| ADR-0068 | Grants on `main`: Owner of a branch, Maintainer of a branch or all, Administrator; config files rejected because "authority would change with no author, reason or history" | Policy authority should reuse grants, and policy should be records, not a hub config file. |
| ADR-0068 decision 9, ADR-0065 decision 4 | A workspace hub does not authorize; it warns at creation and the remote refuses at push | Desktop enforcement of remote policy can only be a warning; the remote is the authority. |
| ADR-0065 decision 3 | A workspace hub refuses merge (`remote_only`) | There is no merge event on the desktop. Its events are commit (a local write) and push. |
| ADR-0025 decision 5, `routes/branches.ts` | The merge route checks the merged state before committing (422) and has `dryRun` | The natural home for merge-time lint, and a preview channel that already exists. |
| ADR-0062 `check` | The invariants engine run read-only over a whole branch, same `{code,id,field,message}` shape | Lint's result shape and its "whole branch as the batch" evaluation mode. |
| P2 / P4 | Workflow and UI stay in plugins; structural intelligence is the hub's, exposed as reads | Rule *evaluation* could be read as the hub's, but v2 keeps it in the plugin; what stays hub-side is the reads rules are built on (coverage, alignment, module content) and the gate. Opinionated rules are workflow. |
| ADR-0021 | No per-person aggregates | The independent-review rule reports records, never people. Lint results get no filter by person. |
| Quiver plan | "Lint a hint unless the person records it"; `agent:quiver/lint-1` records findings | Lint results are not stored by default; a finding is a person's (or an agent's) act. |

## 3. The architecture

**Everything in the top box ships with Lint; everything below it ships with Armature and knows nothing about lint rules.**

```
 Lint: its own repository and releases
 ┌───────────────────────────────────────────────────────────────────────┐
 │                     @armature/lint  (rules, effective(), results)     │
 │                    ┌──────────────┴──────────────┐                    │
 │   Lint service (agent:lint/service)     armature-lint watch (local)   │
 └──────────▲────────────┬───────────────────────▲────────────┬──────────┘
      events│            │runs             events│            │runs
 ┌──────────┴────────────▼──────┐     ┌──────────┴────────────▼──────┐
 │ Remote hub                   │     │ Workspace hub                │
 │  event feed + check runs  ◀──┼push─┤  event feed + check runs     │
 │          ▼                   │     │          ▼                   │
 │  MERGE GATE                  │     │  push gate                   │
 │  required checks pass,       │     │  personal requirements only  │
 │  source up to date           │     │          ▲                   │
 │          ▲                   │     │  checks.json + mirror        │
 │  main: CheckRequirement  ────┼mirror──▶ (remote shown as preview) │
 └──────────────────────────────┘     └──────────────────────────────┘
```

On the remote, the gate reads runs from the store and requirements from `main`. On the desktop, the push gate reads local runs and `checks.json`; the remote's requirements arrive as a mirror for preview only. Requirements are written by maintainers and branch owners with the Lint CLI or any client, through the ordinary API.

---

## Part A. The hub: hooks and gates

## 4. What the hub builds, and what it never runs

**Four primitives, each generic enough that Lint, the Structure analyzer and a CoQui "round complete" check all use it unchanged.** They go in one ADR (ADR-0070, "Checks: an event feed, check runs and required checks").

| Primitive | What it is | Route or record | Both roles? |
| --- | --- | --- | --- |
| **Event feed** | An ordered, resumable list of what changed: commits, merges, branch creation and deletion, requirement changes | `GET /api/v1/events?since=<cursor>` (long-poll); SSE as an option | Yes |
| **Check runs** | A plugin's verdict on one commit: `check`, `commit`, `conclusion`, a summary, a count of hits, an optional details URL | `POST /api/v1/checks/runs`, `GET /api/v1/checks?commit=` | Yes |
| **Required checks** | Which checks must pass, by whom reported, for merges into a branch; with opaque `params` | `CheckRequirement` records on `main` | Remote holds them; workspace hub mirrors them and adds personal ones from a file |
| **The gate** | The merge route refuses unless every required check passed at the source head, the source is up to date, or an override with a reason is given | `POST /branches/:name/merge` and its `dryRun`; on a workspace hub, push | Merge on the remote; push on the desktop |

**What the hub never does:** evaluate a rule, interpret `params`, call out to a plugin, or store a plugin's detailed results as design records. It knows a check by name, the agent allowed to report it, and its last conclusion per commit. That boundary is what lets Lint ship weekly without a hub release.

Capability `armature/checks` in `GET /discover` (ADR-0059) announces the four, so a plugin can tell a hub that has them from one that doesn't.

## 5. Events: a pull feed

**Plugins pull events from the hub; the hub never calls a plugin.** That keeps outbound network calls, retries and callback credentials out of the hub, and it works identically on a laptop's loopback, where nothing can call in.

**Shape.** `GET /api/v1/events?since=<cursor>&types=commit,merge&branch=` returns events in order with a next cursor, and holds the request open up to 30 s when there are none (long-poll). Each event names what a plugin needs to decide whether to run, never the documents themselves:

```json
{ "cursor": "e:1842", "type": "commit", "branch": "amos_unit-3",
  "commit": "…", "parent": "…", "author": "User/…",
  "workspaceCommit": "…", "changed": { "LearningObjective": 2, "AssessmentItem": 1 } }
```

Types: `commit`, `merge`, `branch.created`, `branch.deleted`, `requirement.changed`, `hub.started`. A plugin that was down resumes from its cursor, even across a hub restart. The feed is derived from the store's commit logs (every event but `hub.started` is already a commit), with an opaque cursor holding each branch's head, and the hub keeps no event log (ADR-0070 decision 2; its open question 1, decided 2026-11-12 after platform check AQ passed). `GET /branches/:name/changes?since=` and `/log` already exist and stay the way a plugin fetches *what* changed.

**What commit, push and merge mean to a plugin:**

| You named | Desktop (workspace) hub | Remote hub |
| --- | --- | --- |
| **commit** | A `commit` event per local write. Advisory: the plugin's run arrives after the write. | A `commit` event per write, including each replayed commit of a push (`workspaceCommit` set). Advisory. |
| **push** | A gate: `POST /workspace/:name/push` checks personal requirements at the workspace head first. | Not a distinct event. The run of `commit` events with `workspaceCommit` set is a push; a plugin can debounce on it and check only the last. |
| **merge** | Doesn't exist (`remote_only`). | The gate, in the merge route. A `merge` event follows each merge. |

The advisory events still matter: a check run posted seconds after a commit shows up in Quiver, the desktop program and the viewer as a status on that commit, which is most of what "lint as I work" means.

## 6. Check runs: where results live

**Recommended, still open: runs live in the hub's memory, outside the design graph, and the merge commit records the verdicts it relied on as trailers.** The durable facts (what was required, what passed, who overrode what and why) end up in the commit graph; the bulky, recomputable detail doesn't.

| Option | For | Against |
| --- | --- | --- |
| Records on the branch being checked | Travels with the work | Writing the result moves the head, so the run is always about the commit before the head. Unusable for a gate. |
| Records on `main` | History and authorship like any record | A commit on `main` for every run of every check on every branch; `main` already grows from grant commits (SESSION.md item 20); reporters would need write access to `main`. |
| Records on a dedicated `_checks` branch | History kept, nothing else polluted | Still a store commit per run; a branch with special rules every tool must learn to ignore; a workspace hub would need its own. |
| **Hub memory + merge trailers** (recommended) | No commits and no files for runs; same code on both roles; the audit that matters lands in the merge commit; a restart discards runs and `hub.started` asks plugins to report again | Run detail before a merge isn't in the graph's history. That's acceptable: it's derived, and the plugin can recompute it at any commit. |

**The run.** `POST /api/v1/checks/runs`:

```json
{ "check": "lint/team", "commit": "…", "branch": "amos_unit-3",
  "conclusion": "fail", "summary": "2 required, 5 warnings",
  "counts": { "require": 2, "warn": 5, "inform": 11 },
  "paramsHash": "sha256:…", "detailsUrl": "https://lint.example.edu/runs/91" }
```

`conclusion` is `pass`, `fail`, `neutral` or `error`. The hub adds the reporter (the caller), the time and an id. `paramsHash` is the hash of the requirement's `params` the plugin ran with, so a run made under yesterday's stricter or looser settings doesn't satisfy today's requirement. Runs are kept in the hub's memory, the newest 50 per check and branch; the trailer, not the run, is what outlives a merge. Memory was chosen over a file, a volume or a second database (ADR-0070's open question 2, decided 2026-11-12); runs are persisted once merges stalled after restarts are seen. The hub returns `paramsHash` beside `params`, computed over a canonical form of the value, so a plugin copies it rather than hashing its own text (ADR-0070 decision 3, check AP2b).

**The trust rule.** Anyone who may read a branch may post an advisory run on it, so a designer's own tools can annotate their work. A run counts toward a requirement only if its reporter is the agent the requirement names. On the remote that's a service `User` holding its own credential (ADR-0067 decision 4), deployed by whoever runs the Lint service. This is one new permission row for ADR-0068's table: *Report a required check: the agent a `CheckRequirement` names.*

## 7. Requirements: who says which checks must pass

**`CheckRequirement` is a `Grant`-shaped record on `main`; who may write it is exactly who may merge into, or write, the branch it names.** The rule configuration rides along as opaque `params` that only the plugin reads, which is how graph owners and branch owners still "set rules" without the hub knowing what a rule is.

| Field | Type | Notes |
| --- | --- | --- |
| `check` | `xsd:string` | A name the plugin owns, e.g. `lint/team`, `structure/spof` |
| `branch` | `Optional<xsd:string>` | Absent = merges into `main` |
| `fromPrefix` | `Optional<xsd:string>` | Binds only merges from source branches whose names start with it, e.g. `coqui-` (§14, decision 4) |
| `reporter` | `User` | The agent whose runs count (the trust rule) |
| `level` | `Required` \| `Advisory` | Advisory: shown at merge and push, never refuses |
| `params` | `sys:JSON` | Opaque to the hub; passed through `GET /checks/requirements`; hashed into `paramsHash` |
| `locked` | `xsd:boolean` | Applies to every branch's merges, not just `main`'s; a branch owner can't remove it (decision 3: administrators only) |
| `status` | `Active` \| `Revoked` | Never deleted, as `Grant` |
| `rationale` | `Optional<xsd:string>` | Why this check is required |

Key: Hash over `check`, `branch` and `fromPrefix`, an Optional source-branch prefix such as `coqui-` (decision 4). Category `infrastructure`; outside `DesignRecord`, as `Grant` is. Two invariants join the engine: it lives on `main` (as constraint 21), and `reporter` names an agent (as constraint 22's holder-kind rule).

**Authority, from ADR-0068's table with no new roles:**

| Requirement for | May write it |
| --- | --- |
| Merges into `main` | A maintainer of `main` or of every branch |
| Merges into branch B | B's owner, or a maintainer of B |
| `locked: true` | An administrator |
| Personal, on the desktop | The workspace owner, in a local file (§9) |

**Layering moves into the plugin.** The hub only answers "which requirements apply to a merge into B?": B's own, plus `main`'s locked ones. If Lint wants v1's precedence (instance floor, branch override, personal on top), it reads every applicable requirement's `params` and resolves them itself. The `effective()` function from v1 survives, inside `@armature/lint` instead of the hub. A second plugin can choose a different rule, and the hub doesn't care.

Branch deletion revokes the branch's requirements in the same marked commit that revokes its grants. The operator's `check` reports an active requirement naming a branch that's gone, or a reporter that isn't registered.

## 8. The merge gate

**The merge route gains one step after its existing invariant check: every applicable `Required` check must have a passing run, by its reporter, at the source head, with the current `paramsHash`; and the source must already contain the target's head.** Otherwise it refuses, the target unchanged.

**Why "up to date" stands in for "the merged state".** v1 evaluated rules over the merged state, which only works if the hub runs the rules. An outside service can only check commits that exist. If the source already contains the target's head, the merge result has the same documents as the source head, so a pass at the source head is a pass on what will land. Armature already works this way on the desktop: deliver refuses with 409 `bring_in_first` until `main` has been brought in. The gate extends that discipline to every merge that has requirements, and only those. A merge into a branch with none behaves as today.

**Answers:**

| Situation | Answer | Client does |
| --- | --- | --- |
| Source behind target | 409 `bring_in_first` (the existing code) | Bring in, push, wait for checks |
| A required check has no run at the head yet | 409 `checks_pending`, naming the checks | Wait on the event feed, retry |
| A required check's latest run failed or errored | 422 `checks_failed`, naming runs and `detailsUrl` | Fix, or override |
| All pass | Merge, with verdict trailers |  |

`dryRun` returns the same table without merging, so the desktop program and CoQui can show "2 of 3 checks passed" before anyone presses merge.

**Overrides.** The merge envelope takes `overrides: [{ check, reason }]`. Anyone who may perform the merge may override an unlocked requirement; a locked one needs an administrator. Like v1, overrides are commits, not exemptions.

**The trailers.** The hub writes, and refuses from clients (`reserved_trailer`), one line per applicable requirement:

```
Armature-Check: lint/team pass run=c_9f2e params=sha256:4b1…
Armature-Check: structure/spof fail run=c_a011 overridden
Armature-Check-Override: structure/spof reason="Single-item objective is a pilot; second item due in v2"
```

So "what did the gate require when this landed, what passed, and who decided otherwise" is a read of the commit graph forever, even after the run store has rotated. That's the part of v1's "overrides are commits" worth keeping, and it now covers every plugin, not just Lint.

## 9. On the desktop

**The workspace hub serves the same feed and run store on loopback, so a local plugin is just another tool on the machine; the gate there is push, against personal requirements, and remote requirements show as a preview.**

**Running a plugin locally.** Lint ships a runner (`armature-lint watch --hub http://localhost:3101`) that long-polls the local feed, checks each new head, and posts runs to the local store. It's a tool on loopback like Quiver or the MCP server, acting as the owner (ADR-0065 decision 7). The person can start it themselves and pair it, or add it to the desktop program's Tools list, which starts and supervises it (decided: step 1 of §10).

**Personal requirements.** `<ARMATURE_WORKSPACE_DIR>/checks.json`, never in the graph, written by the program's Settings rather than by loopback tools, so an agent can't relax its owner's gate:

```json
{ "requirements": [
  { "check": "lint/personal", "level": "Required", "on": "push",
    "params": { "rules": { "alignment.bloom-gap": "require" } } } ] }
```

The `reporter` is implicitly the owner's own tools; a local run store has one writer's tools in it.

**The push gate.** `POST /workspace/:name/push` first checks personal `Required` requirements against local runs at the workspace head, with `paramsHash` matching. Missing or failing: 409 `checks_pending` or 422 `checks_failed`, the same codes as the remote's merge. `overrides` with a reason go through, and the reason rides as a trailer on the first replayed commit. As with `Armature-Authored-At`, that trailer is the pusher's claim: recorded as sent, not enforced.

**The remote preview.** The workspace hub mirrors the remote's `CheckRequirement` records for its branch and for `main` at clone, and refreshes them before push and deliver. It never enforces them; it can't, since the remote's reporter is a service the laptop doesn't run. What it can do:

- If the person runs the same plugin locally, the runner reads the mirrored `params` and posts a local run under the same check name, so the person sees "lint/team would fail" before pushing. Labeled a preview.
- Deliver already does a dry run of the remote merge; with requirements, that dry run returns the remote's pending, failed and passed checks, so the program can say "waiting for lint/team on the remote" instead of failing.

This keeps ADR-0068 decision 9 intact: the desktop warns, the remote authorizes.

## 10. Local plugins: how far the desktop program goes

**Decided 2026-11-12: the program starts at step 1, a Tools list that supervises commands the person adds, built with Lint's `watch` (build step L2). Steps 2 and 3 wait for their triggers.** This is the desktop plan's §7 option (b) and its §15 question 11, now with a client asking.

| Step | What the program does | What it adds | Trigger |
| --- | --- | --- | --- |
| 0. Pairing (until L2) | Nothing; the person starts `armature-lint watch` and pairs it once with the local token | Nothing |  |
| **1. Tools list (decided)** | The person adds a command; the program starts it once the hub is listening, with `ARMATURE_HUB_URL`, `ARMATURE_USER` and `ARMATURE_LOCAL_TOKEN`; restarts it with backoff on a crash; stops it before the hub stops; shows its output on the Log page | A process supervisor in the core | Lint `watch` exists |
| 2. Plugin manifests | Discovers installed plugins from an `armature-plugin.json`, enables and disables them, knows the check names each reports | Discovery, per-plugin settings, named checks in the `checks.json` editor; **scoped local tokens** on the hub | A second local plugin (the Structure analyzer) |
| 3. Managed install | The remote's connection profile recommends the plugins behind its required checks; the program installs signed bundles and updates them, only on the person's click | A plugin store: signing, supply chain, updates, rollback | Non-technical designers installing Armature for whom a package manager is not acceptable; possibly never |

### Step 1, as decided

- **Children exit when their standard input closes.** The spike's lesson for the core (a shell killed outright can clean up nothing) applies to every launched plugin, or a crash leaves orphans holding ports. A command that doesn't honor it is still started, and its row in the list says so.
- **JavaScript plugins run on the bundled `armature-node`.** One runtime, signed once. Each plugin is still its own process at roughly the core's 60–84 MiB resident, which is fine for two or three plugins on a designer's laptop.
- **Order.** Plugins start after the core reports `started` and stop before `stop` releases the folder lock. A post that fails mid-shutdown is recovered by the plugin's event cursor on the next start.
- **Still not a tool host.** The program supervises and shows logs; a plugin's interface stays the plugin's. A plugin with a local web UI gets an "Open" link, never an embedded view.
- **Same authority as pairing.** A launched command gets the same local token a paired tool would, so step 1 changes convenience, not trust. The person typed the command, as they would in a terminal.

### Preconditions for step 2

- **Scoped local tokens.** Today the local token answers only "is this a tool I started?", so any launched tool can write documents as the owner. A manifest declares `scopes` (`read`, `report_check`, `write`) and the program issues each plugin its own token limited to them, which the hub enforces. This turns ADR-0065 decision 7's token from a yes/no into a set of permissions, so it needs a dated note there. Required before any plugin Amos didn't write runs on someone's machine.
- **Agent identity for writes.** A plugin that writes findings writes as an agent acting for the owner (ADR-0067 decision 3). Agents are registered on the remote only, so first-run setup asks the remote to register, e.g. `agent:lint/local`.

```json
{ "name": "lint", "command": ["armature-node", "dist/watch.mjs"],
  "checks": ["lint/personal", "lint/team"],
  "scopes": ["read", "report_check"],
  "agent": "agent:lint/local" }
```

### For step 3, if it comes

The remote suggests; the person decides. A connection profile may list plugins behind its required checks and the key that signs them, and the program offers "install Lint to preview `lint/team`". It never installs without a click and refuses a bundle the named key didn't sign. Being the authority on merges doesn't give the remote the right to put code on a laptop.

### Ruled out

- **Plugins inside the core's process** (worker threads, `vm`): saves memory but reintroduces the coupling v2 removed; a slow rule would stall the hub Quiver and the MCP server depend on.
- **Plugin UIs embedded in the program's webview:** makes the program a tool host, against its plan's first constraint.
- **WASM-sandboxed plugins:** strong isolation, but an engine reading `/api/v1` needs the network and file access the sandbox would have to grant. Not worth it until a third party's plugin is the reason.

## 11. What plugins give up by living outside

**Four real costs, each with a bounded answer; and one design, the hub calling plugins synchronously, that would remove two of them at a price not worth paying yet.**

| Cost | What it means | Bounded by |
| --- | --- | --- |
| **No blocking at commit** | A plugin can't refuse a single write, on either hub. Commit-time checks are advisory and arrive seconds later. | v1 already capped graph rules at `warn` for commits, so only document rules lose a `require`. A rule that must hold on every write is an invariant: propose it for the hub's engine by ADR, with the two-client test. |
| **Merges wait** | After a push or bring-in, a required check must report on the new head before the merge goes through. | Long-poll latency plus run time: seconds for Lint at the seed's scale. `checks_pending` and `dryRun` let clients wait honestly instead of failing. |
| **The service has to be running** | If the Lint service is down, merges into `main` with a `Required` lint check stall. | Override with a reason, an administrator turning the requirement `Advisory`, or a run posted by hand with the CLI under the reporter's credential. All three leave a trail. |
| **Run detail outside the graph** | What the 5 warnings were isn't in Armature's history; only that the check failed. | `detailsUrl`; a person keeps what matters as a `DesignFinding`; the plugin can recompute any commit. |

**Declined for now: synchronous checks.** The hub could call registered check URLs inside the merge route (or even each write) and wait for an answer. That restores blocking and removes the waiting. It also puts outbound HTTP, timeouts, retries, callback authentication and a plugin's uptime into every merge, and does nothing on a laptop where the service isn't running. If a plugin someday needs it, it can be added to this design as a requirement flag, `mode: "sync"`, without changing the records or the trailers. The ADR should record it as a considered alternative with that trigger.

---

## Part B. Lint as a check service

## 12. Lint's shape

**Lint is a separate repository with three outputs: a pure rule engine, a remote service, and a local runner. All of them use the hub only through `/api/v1` and the four primitives.**

| Piece | Runs | Does |
| --- | --- | --- |
| `@armature/lint` | Wherever it's imported | Rule catalog, evaluators over a graph snapshot from `GET /export` plus the intelligence reads, `effective()` layering, the result type. No I/O. |
| Lint service | Beside the remote hub, as `agent:lint/service` with a service credential | Long-polls the remote feed, debounces pushes, evaluates every branch head that has a `lint/*` requirement, posts runs, serves `detailsUrl` pages. |
| `armature-lint` CLI | Anywhere | `run` once against any hub and ref; `watch` against a local workspace hub; `requirement set` to write a `CheckRequirement` with the person's own credential; `keep` to record a finding. |

**Rule configuration, layered inside the plugin.** The layers from v1 survive, now resolved by Lint from the requirement `params` the hub hands it:

- **Graph:** `lint/team` required for merges into `main`, written by a maintainer of `main`; `params.rules` sets each rule's action. A locked entry (administrator) binds every branch.
- **Branch:** `lint/branch` on branch B, written by B's owner, tightening or (where unlocked) loosening.
- **Personal:** `lint/personal` in `checks.json`, evaluated only by the local runner.

Per rule and event the action is `off`, `inform`, `warn` or `require`. The run's conclusion is `fail` if any hit resolves to `require`, else `pass`. Graph rules (coverage, alignment, prerequisites) can't block commits under this design anyway, so v1's "scope caps" reduce to one sentence in Lint's docs.

**Results become design records only by a person's act.** `keep` writes an Open `DesignFinding` with the hit's subject, `fragmentId`, `asOf` and an `ExternalRef` (`system: Other`, `identifier: armature/lint:<rule>`). A deliberate exception is a Dismissed finding with `resolutionRationale` (constraint 11); Lint treats a hit with a standing Dismissed finding as `inform`. Every suppression then has an author, a reason and a place on the record, with no hub support beyond what ADR-0020 already gives.

**Non-aggregation.** No result or `detailsUrl` page groups hits by author, and `review.self-attested-only` reports items, never people (ADR-0021). That's now Lint's own rule to keep; the ADR should say plugins posting runs are expected to honor it.

## 13. Starting rule catalog

**Thirteen rules, eleven of them named in `demo-coverage.md` already; ten need no path read and can ship on code the hub has today.** "Builds on" says what each reuses; "path read" marks rules that wait for SESSION.md item 18 or get hand-coded traversals until then. Defaults are what applies with no policy at all, which should be quiet: inform everywhere, warn at merge for the core alignment rules.

| Rule id | Scope | What it flags | Builds on | Default commit / push / merge |
| --- | --- | --- | --- | --- |
| `coverage.uncovered` | graph | An objective Uncovered at the ref | `coverageOf`, ADR-0029 thresholds | inform / warn / warn |
| `coverage.over-assessed` | graph | An objective OverAssessed | `coverageOf` | inform / inform / inform |
| `coverage.regressed` | graph | An objective whose verdict drops versus the merge target | `coverageOf` at two refs | off / warn / warn |
| `alignment.bloom-gap` | graph | An item's Bloom level below its objective's | alignment read, `bloomsRank` | inform / warn / warn |
| `alignment.untargeted-objective` | graph | An objective no activity targets | alignment read | inform / warn / warn |
| `alignment.triangle-incomplete` | graph | Activity, item, formative use around an objective, missing side named | module content + alignment | off / inform / inform |
| `order.assessed-before-practiced` | graph | An item placed before the activity that practices its objective | module content read | inform / warn / warn |
| `prereq.cycle` | graph | A cycle in `PrerequisiteRecord`s | path read | warn / warn / warn |
| `prereq.assessed-before-taught` | graph | An objective assessed before its prerequisite is taught | path read + module order | off / inform / inform |
| `prereq.bloom-descends` | graph | A prerequisite at a higher Bloom level than what depends on it | path read | off / inform / inform |
| `review.self-attested-only` | document | An item whose only attestations are by its own author | attestations read | off / inform / inform |
| `review.agent-unattested` | document | A record created by an agent `User` with no Affirmed attestation by a person | attestations, `the agent: prefix on externalId` | inform / warn / warn |
| `orphan.unreferenced` | graph | A record nothing references | impact read | off / inform / inform |

Two notes on specific rules:

- **`review.agent-unattested` is the brand rule.** "AI-created content goes through the same review process as human-created content" becomes a check an instance can require at merge. It filters on whether the author is an agent, which ADR-0068's 2026-11-05 change already treats as open (`GET /users?kind=agent`): agents are tools, not people.
- **`review.self-attested-only` stays on the record side of ADR-0021.** It answers "is this item independently reviewed?", never "how much does this person self-review?" No rollup by author, ever, including in the CLI's summary.

## 14. The second client: the Structure analyzer, and one from CoQui

**The primitives pass the two-client test only if a second plugin uses them unchanged. Two candidates do, with different shapes, which is the better evidence.**

|  | Lint | Structure analyzer | CoQui round complete |
| --- | --- | --- | --- |
| Check names | `lint/team`, `lint/branch`, `lint/personal` | `structure/spof`, `structure/duplicates` | `coqui/round-complete` |
| Reacts to | Every commit (debounced) | Merges and pushes; heavier graph algorithms | Attestation writes on a round branch |
| `params` | Rule actions | Thresholds: minimum items per objective, similarity cut-off | Affirmations needed per item |
| Typical level | `Required` on `main` | `Advisory`; its proposals become findings | `Required` on merges into main from coqui-\* branches only |
| Reporter | `agent:lint/service` | `agent:structure/service` | CoQui's own service agent |

CoQui is the stronger second client, because it exists and its "submit a round for merge" is already ADR-0068's open question 2. A round coordinator requiring `coqui/round-complete` on the feature branch the round merges into gives that question a hub-side answer with no CoQui-specific code in the hub. Name it in the ADR's two-client paragraph.

CoQui also exposes a gap in the requirement record: its check should bind merges *from* round branches, not every merge into `main`. That needs one more Optional field on `CheckRequirement`, `fromPrefix` (e.g. `coqui-`), part of the key. Lint and the Structure analyzer leave it empty. It's cheap in the first schema commit and awkward later, so it goes in now (decision 4).

## 15. Build order

**Two tracks that meet at step 6: Lint starts now with no hub change, and the hub builds its four primitives in the order each becomes useful.** Hub steps are PRs in `mossglenn/armature`; Lint steps are in a new `mossglenn/armature-lint` (or a name of its own, given the plugin-branding decision).

1. **Lint L1: engine and CLI, no hub change.** `@armature/lint` with the ten rules that need no path read, over `GET /export` and the intelligence reads; `armature-lint run --hub --ref`; policy from a local file.
   - *Exit:* a failing and passing fixture per rule; a snapshot of the seed's results reviewed so defaults aren't noisy.
2. **Hub H1: ADR-0070.** Feed, runs, `CheckRequirement` keyed on `check`, `branch` and `fromPrefix`, the gate with "up to date" on gated merges, trailers, `report_check`, locks for administrators, codes `checks_pending` and `checks_failed`, the desktop push gate. CoQui named as the second client. Written from the decisions above.
   - *Exit:* accepted; dated notes queued on ADR-0025, ADR-0059, ADR-0065 (decision 7's token, for step 2 of the ladder later), ADR-0067 decision 4 and ADR-0068.
3. **Hub H2: the feed and the run store, both roles.** `GET /events`, `POST /checks/runs`, `GET /checks`, `armature/checks`, one client revision. No enforcement yet.
   - *Exit:* a test client resumes from a cursor after a restart; runs show on a commit on both roles; Quiver and the desktop program can display them.
4. **Lint L2: `watch` and the service.** The runner against the local feed (exits when its standard input closes); the service against a remote, posting runs as `agent:lint/service`.
   - *Exit:* a commit on the desktop shows a lint status within 5 s on the seed; the service survives a hub restart without missing a head.
5. **Program P1: the Tools list (ladder step 1).** In the core: add, remove, start and stop commands; environment from the hub and the local token; restart with backoff; start after `started`, stop before the lock is released; output on the Log page; JavaScript plugins on `armature-node`. In the shell: a Tools page. Dated note on the desktop plan's §15 question 11.
   - *Exit:* Lint `watch` added once runs at every start; killing the shell outright leaves no process; a crashing command backs off and says so on its row.
6. **Hub H3: requirements and the merge gate.** The schema commit (`CheckRequirement`, two invariants), authority rows, revoke on branch deletion, `check`'s new rule, the gate and `dryRun`, overrides, trailers.
   - *Exit:* the contract tests in §16 pass; a merge into `main` with `lint/team` required is pending, then refused, then overridden with its trailer.
7. **Hub H4: the desktop side.** `checks.json` and the Settings editor, the push gate, the requirement mirror with refresh before push and deliver, deliver's dry run reporting remote checks.
   - *Exit:* `cycle.test.ts` covers a push stopped by a personal requirement and overridden, and a deliver waiting on a remote check.
8. **Lint L3: layering, findings, requirement editing.** `effective()` over requirement `params`, `keep`, suppression by Dismissed finding, `requirement set`; then a small UI for policy and triage if the CLI isn't enough.
9. **Later, each on its own trigger:** ladder step 2 (manifests, with scoped local tokens and agent registration first) when the Structure analyzer runs locally; ladder step 3 only if designers need managed installs; the path read (SESSION.md item 18) and the prerequisite rules; CoQui's round check; a viewer lens showing check status per branch; `mode: "sync"` if a plugin proves it needs it.

L1 and H2 are each worth shipping alone: L1 answers "does this branch break our rules?" today, and H2 gives every tool a way to react to changes, which SESSION.md item 18 lists as missing regardless of Lint.

## 16. Verification

**The hub's tests use a fake check service, a few lines that post runs, so no hub test depends on Lint.** That fake is also the proof that the primitives are generic. Suites run with `TERMINUS_DB=armature_test`.

- **Feed (H2):** events arrive in commit order; a cursor resumes after a hub restart; a rebuilt log matches the store's history; `types` and `branch` filters hold; a long-poll returns on the next commit.
- **Runs (H2):** any reader may post an advisory run; a run naming a commit the store lacks is 400; retention keeps runs a merge trailer cites.
- **Requirements (H3):** every authority row failing and passing, as ADR-0068's tests do; a requirement on a non-`main` branch is 400; a reporter that isn't an agent is 400; branch deletion revokes them; `check` reports orphans.
- **Gate (H3):** source behind target → `bring_in_first`; no run → `checks_pending`; a run by the wrong reporter doesn't count; a run with a stale `paramsHash` doesn't count; a failing run → `checks_failed`; override by a merger merges with trailers; a locked override needs an administrator; a client-supplied `Armature-Check` trailer → `reserved_trailer`; a branch with no requirements merges exactly as today.
- **Desktop (H4):** push stopped by a personal requirement, then overridden; a loopback tool can't write `checks.json`; the mirror refreshes before push; deliver reports a pending remote check.
- **Lint (L1 to L3):** fixtures per rule; `effective()` table-tested over requirement `params`; no result names a person; the seed's snapshot.

* **Tools list (P1):** a command starts after the hub and stops before the lock is released; closing the shell's pipe ends every child; a crashing command backs off and its row says so; the environment carries the hub URL, the owner and the local token and nothing else the shell holds.

## 17. Decisions taken

**Amos accepted every recommendation on 2026-11-12, and chose step 1 of the local-plugin ladder for decision 5.** These are inputs to ADR-0070, not yet an accepted ADR.

| # | Question | Decision | What it means for the build |
| --- | --- | --- | --- |
| 1 | Check runs outside the design graph? | **Yes.** Runs kept by the hub, never in the design graph; the merge commit's `Armature-Check` and `Armature-Check-Override` trailers are the durable record. | No `_checks` branch. The ADR names this as the first hub state about the graph kept outside it, and why. Where the hub keeps runs (memory or persisted) and how it keeps the event feed (derived or logged) came up while drafting ADR-0070 and are its open questions 1 and 2, decided 2026-11-12 as recommended: runs in memory, the feed derived from the logs. |
| 2 | A service credential that posts runs | **One new operation, `report_check`**, allowed to the reporter a requirement names; advisory runs open to any reader. | Dated notes on ADR-0067 decision 4 and ADR-0068's table: posting a run is not a graph write. |
| 3 | Who may lock a requirement onto every branch? | **Administrators only.** | Authority row for `locked: true`; a locked override needs an administrator too. |
| 4 | `fromPrefix` on `CheckRequirement` | **Now**, in the first schema commit, part of the key. | Key: Hash over `check`, `branch`, `fromPrefix`. Lint and the Structure analyzer leave it empty; CoQui uses `coqui-`. |
| 5 | Should the desktop program start local plugins? | **Yes, at step 1: a Tools list** that supervises commands the person adds. Steps 2 and 3 wait for their triggers; scoped local tokens come before step 2. | Built with Lint `watch` (L2), as the desktop plan's §7 option (b). Dated note on that plan's §15 question 11. |
| 6 | Require "up to date" on every gated merge? | **Yes, on merges that have requirements only.** | `bring_in_first` from the remote's merge route when requirements apply; ungated merges unchanged. |

## 18. Risks and trade-offs

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Soft rules harden into hard ones | A required heuristic blocks legitimate designs; people learn to override reflexively | Lint's defaults stay quiet; overrides are trailers, so a check overridden on most merges is visible and can be retuned |
| A stalled service stalls merges | `checks_pending` forever when the Lint service is down | Override with reason; an administrator flips the requirement to `Advisory`; the reporter's credential can post a run from the CLI |
| The gate's guarantee rests on "up to date" | Without it, a pass at the source head says nothing about the merge | The gate enforces it for every merge that has requirements (decision 6) |
| Run state outside the graph | A reader can't see pre-merge check history in Armature | Merge trailers keep what was decided; `detailsUrl` and findings keep what mattered |
| Desktop preview drifts from the remote | A different local Lint version, or stale mirrored `params`, predicts the wrong result | The remote's dry run at deliver is authoritative; local results are labeled previews; the mirror refreshes before push |
| The feed becomes an integration API people lean on | Events, cursors and retention become a contract to keep | Small payloads that point at existing reads; documented retention; versioned under `armature/checks` |
| Plugins break the non-aggregation line | A third-party check could post per-person summaries in `summary` | ADR-0070 states the expectation; the hub stores `summary` as text, never indexes or filters by it |
| Launched plugins cost memory and authority | Each plugin is a Node process near the core's 60 to 84 MiB, and at step 1 every launched command holds the owner's full local token | Step 1 supervises only what the person adds, as a terminal would; scoped local tokens are a precondition of step 2; the Tools page shows each plugin's memory |
