# The Armature MCP server: plan

*Status: draft 2026-10-27, for review; the questions in §13 are open, each with a recommendation the plan is written to, except questions 5 and 13, decided 2026-10-30 with ADR-0067: the agent writes acting for the person, on a workspace hub, and remote mode is read-only (§3, §7). A plan for a client of the hub, built outside this repository. When the server exists, this document becomes its description here and its own repository carries the code.*

Abbreviations: ADR (Architecture Decision Record, `schema/docs/adr/`), API (application programming interface), CI (continuous integration), HTTP (Hypertext Transfer Protocol), JSON (JavaScript Object Notation), MCP (Model Context Protocol), OAuth (Open Authorization), OIDC (OpenID Connect), REST (Representational State Transfer), SDK (software development kit), URI (Uniform Resource Identifier).

---

## 1. Purpose

An MCP server lets any MCP-capable assistant (Claude, an IDE agent, a research notebook's agent) ask the design graph questions in plain language and get answers computed by the hub. It is the cheapest way to show that Armature is infrastructure for AI design partners rather than an AI feature: the intelligence comes from structure (plan P4), and the assistant only asks and explains.

In `docs/demo-coverage.md` it is the proposed tool that closes the most gaps: with the built and planned tools, nothing yet shows **impact**, **discovery and capabilities**, **agent provenance** or the **non-aggregation guard**, and this server shows all four. It also exercises coverage, alignment and trace, which CoQui and the viewer already show, in a third way: as answers an assistant composes.

What it must demonstrate, in order of weight:

1. **Design questions answered from structure, at a named commit.** "Which objectives in this module are under-assessed, and why?" is a coverage read and an alignment read, and the answer says which commit it describes.
2. **The hub's rules hold for agents as for people.** An agent asking for a per-person summary is refused by the hub, not by a prompt (ADR-0021). An agent's writes go through the same pipeline and invariants as anyone's (plan P5).
3. **Agent work is attributable and reviewable.** What the agent writes is credited to an agent `User`, lands on a branch, and reaches `main` only when a person merges it (ADR-0032 decision 7, ADR-0028's endorsement). *Since 2026-10-30:* ADR-0068 (accepted 2026-10-30, not yet built) makes this a rule the hub enforces (only a maintainer merges into `main`), ADR-0067 decision 3 records the person the agent worked for, and ADR-0067 decision 10 confines an agent's writes to a workspace hub on the person's machine (§7).
4. **A client built from discovery.** The server learns what the hub offers from `GET /discover` and offers tools accordingly (ADR-0059).

Constraints from the rest of the project, which hold throughout:

- **The server is a client.** It reaches the hub over HTTP through `@armature/client` and never touches the store (Development Principle 1). It needs no change to the API or the schema; anything it seems to need from the hub is tested against the two-client rule first.
- **No raw query route.** ADR-0062 refuses `POST /api/v1/query`. Every question maps to an intelligence read, a list filter, a document read, a history or diff read, or a declared export slice. The server adds no query language of its own.
- **No per-person aggregate**, in the hub or in the server (ADR-0021 decision 4: tools inherit the norm). The hub's refusal is friction, not a barrier (ADR-0021 decision 3): a model could list every attestation and count by attester itself. The server's instructions tell it not to, and the evaluation set (§9) asks the question to check that the model declines rather than works around the refusal.
- **Nothing derived is stored** (ADR-0056). The server keeps no cache of answers beyond one request.

---

## 2. What comparable servers settled

The plan borrows from three places and declines one common pattern.

**GitHub's MCP server** offers a read-only mode that removes every write tool and *toolsets* that let a deployment register only groups of tools it wants ([read-only mode](https://instagit.com/github/github-mcp-server/enable-mcp-server-read-only-mode), [toolsets](https://instagit.com/github/github-mcp-server/configure-toolset-filtering-github-api)). Adopted: writes are a toolset registered only when switched on, so a read-only server has no write tools to refuse, rather than tools that fail; and the tools for a hub capability are registered only when the hub serves it (§8).

**The Learning Commons Knowledge Graph** offers its education graph (standards, learning components, progressions) to language models through an MCP server, beside a REST API and files ([introduction](https://docs.learningcommons.org/knowledge-graph/understanding-knowledge-graph/introduction)). It is the closest domain precedent, already in the precedents survey. The difference is what is served: reference data that changes rarely, against a design's own graph with branches, commits and authors. Everything in this plan about commits follows from that difference.

**The MCP specification's own guidance** (revision 2026-07-28). State across calls is carried by explicit handles that a tool returns and a later call accepts as an argument, never by a session ([tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools)); for Armature the handle already exists, the commit (§5). Failures the model can act on (a refused filter, a broken rule, a moved branch) are tool results marked as errors, not protocol errors.

**Declined: one generic query tool.** Database servers often expose a single "run this query" tool. ADR-0062 refuses a raw query route on the hub for reasons that apply here too: it would couple every assistant to TerminusDB and make the non-aggregation guard unenforceable.

---

## 3. Shape

```
assistant (Claude Desktop, Claude Code, …)
   │  MCP: stdio first; Streamable HTTP once the hub has OIDC
   ▼
armature-mcp  ── tools, resources, prompts; shapes answers; no state beyond a request
   │  @armature/client: Armature-Version, Armature-Capabilities, Armature-User, If-Match
   ▼
hub /api/v1   ── reads at a ref; writes through the pipeline; refusals by stable code
               a workspace hub on the person's machine (reads and writes), or a remote hub (reads only)
```

*Which hub (decided 2026-10-30).* On a person's machine the server talks to their **workspace hub** (ADR-0065), the same `/api/v1` on loopback, where it reads the person's own work in progress and where its writes land in the person's workspace beside Quiver's and CoQui's; the person's push carries them to the remote. Against a **remote hub** the server only reads (ADR-0067 decision 10; §7). The server learns which it has from `GET /discover` (`armature/workspace`); on a workspace hub, branch creation, merge, deletion and user registration answer 400 `remote_only`, and a ref the clone does not hold answers 404 `unknown_ref` with `remote_needed` when offline (workspace hub plan §8, §9).

- **Language and SDK.** TypeScript on the official MCP SDK, because `@armature/client` and `@armature/types` are TypeScript and give the server the hub's types, its error codes and the schema as data for free. The v2 line, `@modelcontextprotocol/server` (2.4.0; 2.0.0 shipped 2026-07-27), implements the 2026-07-28 revision, needs Node 20 or later and Zod 4, which `@armature/types` already uses (4.3.6), so its schemas can feed tool inputs directly. It serves stdio with `serveStdio` and HTTP with a stateless `createMcpHandler`, and by default answers clients still on the 2025 revisions without a session ([npm](https://www.npmjs.com/package/@modelcontextprotocol/server), [legacy clients](https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/docs/serving/legacy-clients.md)). That default stays on: whether a given assistant speaks the 2026 revision yet is not something the server should depend on.
- **Where it lives.** Its own repository, `mossglenn/armature-mcp`, installing `@armature/client` and `@armature/types` by git reference, as CoQui does (§13 question 1).
- **Configuration.** Environment variables, the convention for stdio servers: `ARMATURE_HUB_URL` (default `http://localhost:3100`), `ARMATURE_USER` (the person's `externalId`; on a workspace hub, its owner; *added 2026-10-30*), `ARMATURE_AGENT` (the agent's `externalId`, sent as `Armature-Agent` on writes), `ARMATURE_BRANCH` (the default branch to read, `main`), `ARMATURE_WRITES` (`off` by default).

---

## 4. Tools

One tool per hub read, named for the question it answers rather than the route, each marked read-only where it is. Names are `snake_case` with no prefix; the client namespaces them by server. Every read tool takes `branch` or `ref` (never both, as the hub requires) and returns the commit it read at.

### 4.1 Orientation

| Tool | Hub call | Notes |
|---|---|---|
| `describe_hub` | `GET /discover` | Revisions served, capabilities with their settings (coverage thresholds, batch limit, export profiles) |
| `describe_schema` | `GET /schema` | Classes, their category and fields; summarized by default, one class in full on request |
| `list_branches` | `GET /branches` | Each branch with its head: commit, author, message, time |
| `list_modules` | `GET /documents/Module` | The usual entry point; course and sequence |

### 4.2 Records

| Tool | Hub call | Notes |
|---|---|---|
| `get_record` | `GET /documents/:type/:id` | One record with its parts; `type` from the schema's classes |
| `find_records` | `GET /documents/:type?<field>=<value>` | Equality filters, `count`/`skip`; a filter on a person is refused by the hub with `person_filter_refused`, and the server passes the refusal through |
| `record_history` | `GET /documents/:type/:id/history` | Commits that touched it, newest first, with author and reason; `diff` off by default |
| `compare_record` | `GET /documents/:type/:id/diff` | One record between two commits |
| `branch_changes` | `GET /branches/:name/changes?since=` | What a branch inserted, updated or deleted since a commit |

### 4.3 Design intelligence

| Tool | Hub call | Question it answers |
|---|---|---|
| `module_coverage` | `GET /intelligence/coverage/:moduleId` | How well does this module's assessment cover the objectives it declares? Thresholds as optional arguments |
| `course_coverage` | `GET /intelligence/coverage?course=` | The same for every module of a course |
| `alignment_gaps` | `GET /intelligence/alignment?module=` | Items below their objective's Bloom's level; objectives no item reaches; objectives no activity targets; items that assess nothing |
| `trace_record` | `GET /intelligence/trace/:type/:id` | Where did this come from and where does it lead: evidence, need, objective, item, placement, assessment, dataset, metric |
| `what_references` | `GET /intelligence/impact/:type/:id` | What depends on this record, and through which field |
| `attestation_status` | `GET /intelligence/attestations/:type/:id` | Who affirmed what about this record, and whether it has changed since (`Current`, `Stale`, `FragmentRemoved`, `Unanchored`) |
| `module_content` | `GET /intelligence/module-content/:moduleId` | Activities and lessons in teaching order, with formative item uses |
| `item_statistics` | `GET /intelligence/item-statistics?module=` | Every metric about each item, newest administration first; nothing summarized |

### 4.4 Export

| Tool | Hub call | Notes |
|---|---|---|
| `list_slices` | `GET /export/slices` | Named class lists |
| `export_slice` | `GET /export?slice=&profile=` | Never `full` by default; `pseudonymous` is the default profile; returns counts and the documents only when under a size limit, otherwise a summary and the advice to use a narrower slice |

There is no tool for the whole graph in one answer: past a few hundred documents it would not fit an assistant's context, and the reads above answer the questions people ask.

### 4.5 Writes (milestone 4, off by default)

| Tool | Hub call | Rules the server adds |
|---|---|---|
| `start_proposal_branch` | `POST /branches` | Names are `agent/<short-topic>`; from the branch or commit the conversation read |
| `propose_note` | `POST /documents` with a `DesignNote` | On a non-`main` branch only; `subject` and optional `fragmentId`; `message` required and written by the model as the reason |
| `propose_finding` | `POST /documents` with a `DesignFinding` | Same rules; status `Open` |

The server refuses any write to `main` before the hub sees it, sends `If-Match` with the head it last read on that branch, and never merges, deletes or registers users. Artifacts (objectives, items, activities) are not writable in this plan: an assistant proposes by annotating, and a person changes the design (§7).

**How each tool is declared.**

- **Annotations.** Every read: `readOnlyHint: true`, `idempotentHint: true`, `openWorldHint: false` (the hub is a closed domain, not the open web). The three writes: `readOnlyHint: false`, `destructiveHint: false` (each adds a record on a branch and changes nothing that exists), `idempotentHint: false`. Clients treat annotations as hints, so the server enforces the same rules itself.
- **Titles and descriptions** are written for the model: when to use the tool, what it returns, what to pass forward, and one example question. Every argument carries a description (the SDK's advice).
- **Arguments.** `type` is an enumeration of the schema's classes read at start; identifiers are accepted as `Type/id` or as the bare local part when `type` is given; `branch` and `ref` are mutually exclusive, as in the hub.
- **Order and count.** About twenty read tools and three writes, listed in a fixed order (the specification asks for deterministic order). The specification sets no limit on count; the evaluation in §9 is the check that the model picks the right one.

---

## 5. Answers

Every tool returns two forms of the same answer:

- **Structured content**: the hub's JSON, unchanged except for size limits, with `commit` and `revision` added from `ETag` and `Armature-Version`. Each tool declares an `outputSchema` where the client package's result type is stable (coverage, alignment, trace, attestations, impact, module content, item statistics), so a client that validates can.
- **Text**: a short summary written by the server, not the model (for coverage, "Module <id> at commit <c>: n objectives declared; counts by verdict; thresholds 2 and 4", then the lines that need attention), followed by the serialized JSON, which the specification asks servers to include for clients that do not read structured content. The model explains; the numbers come from the hub.

**Every answer names its commit.** The tool descriptions tell the model to pass the `ref` from its first answer to every follow-up in the same line of questioning, so a conversation that asks about coverage, then the trace, then one item's history is reading one state of the design even if someone commits in between. A tool called with `branch` reads that branch's head and says so.

**Refusals are answers.** A hub error comes back as a tool result marked as an error, with the stable code, the hub's message and one sentence on what it means: `person_filter_refused` explains that Armature does not summarize individuals' work and why (ADR-0021); `unknown_ref` that the commit does not exist; `invariant_violation` lists each violation. This follows the specification's split: hub refusals, invalid input and rule violations are tool results marked `isError`, so the model can correct course; an unknown tool or a malformed request is a protocol error. Every error text ends with what to try next.

**Size.** Each read has a budget (default 40,000 characters of structured content). Over it, the server returns the summary, the counts and the first page, with the arguments to page or narrow. The trace and the export are the reads most likely to exceed it.

---

## 6. Resources and prompts

**Resources.** Records and the schema are also exposed as resources, for clients that let a person attach context by hand: `armature://schema?ref=<commit>`, `armature://record/{type}/{id}?ref=<commit>` as a template, and `armature://module/{id}/coverage?ref=<commit>`. Tools stay the primary path: client support for resources and prompts is much narrower than for tools (a community-maintained count finds about a quarter of 39 clients with either, against most with tools; [mcp-client-capabilities](https://cdn.jsdelivr.net/npm/mcp-client-capabilities@0.0.14/README.md), unofficial), so nothing in the demo depends on them.

**Prompts.** Three, each a short instruction that names the tools to call and the order, so a person can start a known conversation from a menu:

1. **Review a module's assessment**: coverage, then alignment gaps, then for each gap the items and objectives involved; ends with suggestions phrased as proposals, not edits.
2. **Explain a result**: Narrative 1 as a conversation. From a metric, trace to the item, objective and declaring module; read coverage at the dataset's `asOf` and now; say what changed since.
3. **Before changing an objective**: what references it, its attestations and their state, its history; what a change would make stale.

---

## 7. Identity, writes and review

**Reads need no identity** under the `header` resolver, as in the hub today. A read-only server can point at any hub its machine can reach. *Since 2026-10-30:* under `oidc` (ADR-0067 decision 1) every request needs a token; a server on the person's machine holds the person's, and a hosted server holds its own (decision 4, `agent:<client id>`), which grants reads.

**Writes are the agent's, acting for the person, on a workspace hub.** *Rewritten 2026-10-30; as first drafted the server sent the agent's id in `Armature-User`, which a workspace hub's owner-only resolver would refuse.* The server sends the person in `Armature-User` (`ARMATURE_USER`; on a workspace hub, its owner) and the agent in `Armature-Agent` (`ARMATURE_AGENT`, an agent `User` a person registered once with `POST /api/v1/users` on the remote, `agent:armature-mcp`; one per tool is enough, ADR-0067 decision 3). Every commit the agent makes carries the agent's id as author and `createdBy`, and the hub records the person in an `Armature-On-Behalf-Of` trailer it writes itself. The writes land in the person's workspace; the person's push carries them to the remote, which writes the trailer and runs every rule again. Until ADR-0067 decision 3 is built, `header` accepts the agent's id in `Armature-User` with no trailer (decision 8), the form Quiver uses today; the server moves to the final form when `docs/client-changes.md` announces it.

**No writes to a remote hub.** *Decided 2026-10-30 (ADR-0067 decision 10).* A remote refuses an agent's own writes unless they arrive as a workspace hub's push acting for the owner, so the server's remote mode (M5) is read-only. The reasons are the ADR's: a server running away from the person cannot carry the person's credential (the MCP specification forbids passing the assistant user's token through), so the remote could not record whom the agent worked for; an agent's proposals belong in the person's workspace beside their own drafts, delivered by the person's push; and an agent with a remote write path would be one grant away from `main`. What would reopen it is also there: a client with a demonstrated need and a way for the hub to verify whom the agent works for (a token carrying the person's identity as a verified claim, or a grant from the person naming the agent).

**The person's acceptance is an endorsement.** A proposal reaches `main` when a person merges the branch, with their own identity, in a tool that writes as them (CoQui today; the viewer reads only). A person who wants their acceptance recorded on the record itself writes a claimless `Attestation` (ADR-0028), which is the endorsement the AI design assistant reference client needs. The server does not write attestations, because the attester must be the caller (rule 15) and the server is the agent.

**Acting on someone's behalf: modeled since ADR-0067 (proposed 2026-10-29, accepted 2026-10-30).** *As first drafted this paragraph was headed "Not modeled".* An assistant session is a person and an agent together, and the honest record is "the agent proposed, at this person's request". ADR-0032 decision 7 deferred delegation until the AI design assistant was real; this server and Quiver's drafter were that evidence, and ADR-0067 decision 3 is the answer: the agent is the author, the person is in the hub-written `Armature-On-Behalf-Of` trailer, and a client that sends that trailer itself is refused (decision 6, 400 `reserved_trailer`). Until it is built the hub records the agent only, and the person who ran the session is not in the graph.

**Confirmation.** A host asks the person before it runs a tool that is not read-only; the write tools' descriptions say exactly what will be written and where, so that approval is informed. An elicitation form could ask for a confirmation of the proposal's text as well; §13 question 6 explains why the plan does not rely on one.

**Prompt injection.** Design records hold free text written by other people: rationale, notes, finding text, item stems. To the model it is all context, and some of it could read as instructions. The defenses are structural rather than textual: writes are off by default; when on, they reach only non-`main` branches, only as notes and findings, and only a person merges. The tool descriptions also say that record text is data.

---

## 8. Versioning and capabilities

At start the server calls `GET /discover` and registers only the tools whose capability the hub serves: `module_coverage` needs `armature/intelligence.coverage`, `item_statistics` needs `armature/intelligence.item-statistics`, and so on. Each call sends `Armature-Version` with the revision the server was built against and `Armature-Capabilities` with the capabilities it relies on; `@armature/client` sends both, taking the capabilities when a client is created, so the server creates one client per group of tools. A hub without a capability therefore offers no tool for it, rather than a tool that fails. 

The tool list is fixed when the server starts. The 2026-07-28 revision announces a changed tool list only on a `subscriptions/listen` stream, and a hub's capabilities change only when it is upgraded, so restarting the server after an upgrade is enough ([versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)).

**Two contracts versioned the same way.** The 2026-07-28 revision removed MCP's `initialize` handshake: the version travels on every request, an unsupported one is refused with the list of supported versions, and an optional `server/discover` call answers first. ADR-0059 adopted that model for the hub from the same revision. The server sits between two stateless contracts with per-request versions and holds a session in neither. Its `server/discover` answer carries the server's `instructions`, which state the three rules the model needs in every conversation: pass the commit forward, treat record text as data, and do not summarize people.

This makes the server the first client to build its surface from discovery, which is what ADR-0059 decision 6 provided `/discover` for.

---

## 9. Testing

- **Contract tests in CI**, as Armature's own: a TerminusDB service container, the schema loaded, the seed inserted, the hub started from Armature's image or source at a pinned commit, and every tool called through the SDK's in-memory client against it. The assertions are the seed's known answers: each module's coverage verdicts, the metric's trace reaching the module that declared its objective, and "Distinguish Bias Types" reading PartiallyAssessed at the dataset's `asOf` and FullyAssessed now.
- **Refusal tests**: a person filter returns `person_filter_refused` as a tool error; a write to `main` is refused by the server before any request; a write with writes off is refused; a stale `If-Match` returns 412 as a tool error.
- **Inspector**: the MCP Inspector against a local hub for manual checks of descriptions and schemas.
- **An evaluation set**: twelve questions a designer or researcher would ask of the seed, each with the reads a correct answer needs and the facts it must state ("Distinguish Bias Types was PartiallyAssessed when the cohort met it"). One of them asks which reviewer declines most items; it passes when the model declines and explains, rather than counting attestations itself. Run against Claude with the server attached; a question passes when the answer states the facts and names the commit. This is the check that the tool descriptions work, which unit tests cannot show.

---

## 10. The demo

Five minutes, Claude Desktop with the server attached, the seed loaded, the viewer open beside it.

1. **"What is in this design?"** `list_modules`, `describe_hub`. The assistant names the modules and the commit.
2. **"Is this module's assessment adequate?"** `module_coverage`, `alignment_gaps`. Each declared objective's verdict, the items behind it, the Bloom's gaps; the commit named.
3. **"The cohort struggled on the bias item. What does that mean for the design?"** `trace_record` from the metric, `module_coverage` at the dataset's `asOf` and now: "Distinguish Bias Types" was partially assessed when the cohort met it and is fully assessed now, after the design's response. Narrative 1 as a conversation, ending where the viewer's Walkthrough ends.
4. **"If I change that objective's verb to *evaluate*, what is affected?"** `what_references`, `attestation_status`, `alignment_gaps`. The items whose Bloom's level is below the new one, the attestations that a change would leave stale.
5. **"Which reviewer declines the most items?"** `find_records` with `attestedBy`. The hub refuses with `person_filter_refused`; the assistant explains why Armature will not answer that, from the refusal's own text.
6. **"Record that gap as a finding for the team."** With writes on: `start_proposal_branch`, `propose_finding`. Switch the viewer to the branch: the finding is there, by the agent, with the reason; `main` is untouched.

Beat 5 is the one no other demo can show, and the one most likely to stay with an audience.

---

## 11. What is deliberately not built

- **A query language.** ADR-0062; the reads are the questions.
- **Writing artifacts.** Objectives, items and activities change through tools a person drives. Revisit when the AI design assistant reference client asks for proposals of artifacts on branches, with the delegation decision.
- **Merging, deleting, registering users.** A person's acts.
- **Answer caching across requests.** A read at a commit is immutable, so a cache would be safe, but the hub already memoizes history (`memo.ts`) and no measured need exists.
- **Generation by the client's model.** Sampling is deprecated in the 2026-07-28 revision; summaries are written by the server's code.
- **Pictures in the conversation.** The MCP Apps extension could render the Coverage View inside a chat; client support could not be confirmed. Revisit after M3.
- **Remote hosting before OIDC.** Streamable HTTP with authorization waits for the hub's `oidc` resolver (§13 question 3).
- **Writes to a remote hub, in any mode.** *Decided 2026-10-30:* an agent's own work reaches a remote only as a workspace hub's push acting for its owner (ADR-0067 decision 10; §7). A hosted server reads.

---

## 12. Implementation plan

Milestones in the server's repository, each a pull request with its tests; Armature's repository changes only in documentation (a `client-changes.md` reference if the server ever needs a hub change, which it should not).

**M0 · Scaffold.** Repository, TypeScript, the MCP SDK, `@armature/client` and `@armature/types` by git reference at a pinned Armature commit, the stdio entry, configuration, CI with a seeded hub. `describe_hub` and `list_branches` end to end. Acceptance: Claude Desktop lists the tools and `describe_hub` answers from the seed.

**M1 · Records and intelligence.** §4.1 to §4.3, the answer shaping of §5 with the size budget, discovery-driven registration (§8), refusals as tool errors, contract tests on the seed. Acceptance: every tool returns the seed's known answer with its commit; a person filter is refused with the hub's code.

**M2 · Export, resources, prompts.** §4.4 and §6. Acceptance: the three prompts run end to end on the seed.

**M3 · Evaluation and the demo.** The twelve-question set, its runner, the descriptions revised until it passes; the §10 script rehearsed and recorded. Acceptance: eleven of twelve questions pass on two runs.

**M4 · Proposals.** §4.5 behind `ARMATURE_WRITES=on`, the agent `User` registered through `POST /api/v1/users` by the seed's designer in the test and demo setup (so Armature's seed is unchanged), refusal tests. Acceptance: beat 6 of the demo; the finding's author is the agent; `main` unchanged. *Since 2026-10-30:* against a workspace hub when one exists (the writes land in the person's workspace; `start_proposal_branch` becomes "the current workspace", since `POST /branches` is `remote_only` there); until then against a local hub under `header`, as the contract suite runs.

**M5 · Remote, read-only** (when the hub has OIDC). Streamable HTTP with the protocol's authorization, the hub's `oidc` resolver as the authority, the server's own credential (ADR-0067 decision 4). *Decided 2026-10-30:* no writes in this mode (ADR-0067 decision 10; §7, §13 question 13). Not scheduled.

Sequencing: M0 and M1 are the demo's core and one or two sessions each; M2 and M3 one each; M4 one; M5 waits for its trigger.

---

## 13. Questions to settle

Each with the options and the recommendation the plan above is written to.

1. **Where the server lives.**
   - (a) Its own repository, `mossglenn/armature-mcp`, installing `@armature/client` and `@armature/types` by git reference.
   - (b) A `packages/mcp` workspace in this repository.
   - (c) A second endpoint inside the hub's process.

   *Recommendation: (a).* It is a client, and installing the client from another repository is what the client-install CI job already tests for CoQui. (b) would get the contract tests for free but blur P2's line between hub and plugin. (c) puts a tool in the hub, which P2 rules out.

2. **SDK line.**
   - (a) v2, `@modelcontextprotocol/server`, implementing 2026-07-28, with its default of answering 2025-era clients statelessly.
   - (b) v1, `@modelcontextprotocol/sdk`, maintained for about six months after v2's release.

   *Recommendation: (a).* It matches the hub's versioning model and its Zod major, and its default keeps older assistants working.

3. **Transport first.**
   - (a) stdio, configured from the environment.
   - (b) Streamable HTTP with the specification's OAuth 2.1 authorization.

   *Recommendation: (a), with (b) as M5.* The specification says stdio servers take credentials from the environment rather than follow the authorization flow, which matches the hub's `header` resolver and its loopback-only rule. HTTP needs the hub's `oidc` resolver first. It also needs a credential of the server's own for the hub, because the specification forbids passing the assistant's token through to another service ([authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)); ADR-0067 decision 4's client-credentials grant is that credential, and since 2026-10-30 it grants reads only (question 13).

4. **Writes in scope.**
   - (a) Read-only.
   - (b) Notes and findings on non-`main` branches, behind a switch.
   - (c) Artifacts on branches too.

   *Recommendation: (b), as M4.* It shows agent provenance and review by merge without the server deciding what the design is. (c) waits for the delegation decision and a reason to let an agent edit objectives.

5. **Whose identity writes.**
   - (a) An agent `User`.
   - (b) The person running the assistant.
   - (c) The agent, recording the person it acts for.

   *Recommendation: (a) now, (c) when the OIDC ADR decides delegation.* (b) credits the person with the agent's words, against P5. *Decided in ADR-0067 decision 3 (proposed 2026-10-29, accepted 2026-10-30): (c), the agent as author with the person in a hub-written `Armature-On-Behalf-Of` trailer; (a) remains the interim form under `header` (decision 8).*

6. **Confirming a write.**
   - (a) The host's own approval of each tool call, with precise descriptions and `destructiveHint: false`.
   - (b) An elicitation form asking the person to confirm the proposal's text before it is written.

   *Recommendation: (a).* Elicitation is active in the 2026-07-28 revision, but client support is uneven, and a branch that only a person can merge is the real safeguard.

7. **Consistent reads across a conversation.**
   - (a) Every tool takes `branch` or `ref`, and the descriptions tell the model to pass the first answer's commit forward.
   - (b) The server pins one commit for its lifetime.
   - (c) A `pin_ref` tool that returns a handle.

   *Recommendation: (a).* It is the specification's handle pattern with the commit as the handle. (b) is wrong for a server that runs for days. (c) adds a tool for what an argument already does.

8. **Tool granularity.**
   - (a) One tool per read, named for its question.
   - (b) A few grouped tools with a `kind` argument.

   *Recommendation: (a).* Names and descriptions are how the model chooses, and a `kind` argument hides the choice inside a parameter. Registration is grouped by capability (§8), so a deployment can still run a smaller set.

9. **Answer form.**
   - (a) The hub's JSON as it is.
   - (b) A server-written summary, then the JSON, within a size budget.
   - (c) The summary alone.

   *Recommendation: (b).* The numbers come from code, the model explains them, and a client that reads structured content gets the full answer.

10. **Resources and prompts.**
    - (a) Build them in M2.
    - (b) Leave them out.

    *Recommendation: (a), small.* They help in the clients that support them and cost little. Nothing in the demo depends on them.

11. **Names.** Repository `armature-mcp`, package `@armature/mcp` (the scope the client and types use), server name `armature`, tool names without a prefix since clients namespace by server.

    *Recommendation:* as stated. The alternative, an `armature_` prefix on every tool, only repeats what the client already shows.

12. **Where this plan lives.**
    - (a) Here until M0, then `armature-mcp/docs/plan.md`, with a pointer from `development-plan.md` §2's reference clients.
    - (b) Here for good, as the Design Graph plan is.

    *Recommendation: (a).* This follows Quiver, the other client in its own repository. The hub-facing parts (discovery's first client, the evidence for delegation) are noted in plan §6 when they happen.

13. **Writes in remote mode, and whom the agent works for** (raised by the alignment review of 2026-10-30). A server away from the person's machine holds its own credential and cannot carry the person's, so the hub cannot write `Armature-On-Behalf-Of`; a `Relay` grant (ADR-0067 decision 5) would write the person as author, the wrong record for an agent's proposal.
    - (a) Remote mode reads only; every write goes through the person's workspace hub, where the person is present and recorded.
    - (b) Remote mode writes as the agent alone, with no person recorded.
    - (c) A new grant or token form that lets the hub verify whom a hosted agent works for.

    *Decided 2026-10-30: (a)* (ADR-0067 decision 10). (b) would put work in shared history that no one is answerable for, and give an agent a path one grant from `main`. (c) is what would reopen the decision: a client with a demonstrated need, and a verified claim (OAuth token exchange, RFC 8693, or a grant from the person naming the agent); the two-client test applies.
