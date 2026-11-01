# Changes for client tools

What changed in the Armature API (application programming interface) and schema that a client
tool must know about, newest first. Each entry says what changed, what a client does differently,
and where the detail lives. Entries are tool-neutral; where CoQui, the first plugin, has to map
something at its boundary, a **CoQui** note says how.

This file starts where CoQui's handoff stops: [`armature-asks-from-Coqui.md`](armature-asks-from-Coqui.md)
records what CoQui asked for on 2026-10-05, reading the repository at commit `3f00f40`. A client
that last synchronized with Armature at a given date reads every entry above that date.

The contract itself is the [API reference](api.md); the reasons are the
[Architecture Decision Records](../schema/docs/adr/README.md) (ADRs). This file never restates
them in full. It is updated whenever a change reaches `main` that a client would act on.

---

## 2026-10-31 · Stricter requests, deadlines and ancestry

**What changed.** The deep review's confirmed small fixes (SESSION What's Next item 28), riding
today's revision. `If-Match: *` is refused with **400** `bad_if_match` instead of being read as no
condition. Numeric and boolean query values must be in their exact forms (digits, an optional
sign and fraction, `true` or `false`); `?sequence=1e1`, `?randomize=yes`, `?count=1e1` and
`?diff=maybe` are now **400** `bad_query` rather than coerced. A request body over 10 MiB is
**413** `body_too_large`. `GET /branches/:name/changes?since=` requires `since` to be in the
branch's history, its log or a merge into it followed back, else **400** `not_an_ancestor`. A
history longer than the 5,000 commits the hub walks is **500** `history_too_long` (the changes
route, a merge, a branch delete) instead of being read as a shorter one, which made a merge
report `no_common_ancestor`. The hub gives up on the database after 30 seconds with **504**
`store_timeout`. `@armature/client` takes `signal` and `timeout` options that apply to every call
(no default deadline, no retry).

**What a client does.** Send a commit in `If-Match`, or none. Send query values in their exact
forms. Treat `store_timeout` on a write like a dropped connection: re-read before retrying, since
the write may have landed. A changes read since a commit from another branch now fails rather
than returning a diff between unrelated states. **CoQui:** nothing it sends today is refused;
consider `timeout` on its client. **Quiver:** its bring-in reads changes since its base, which is
on the workspace branch's log, so nothing changes.

## 2026-10-31 · Reads and writes at one commit

**What changed.** A write is checked and committed at one commit (the deep review's B2). The
hub captures the branch head when the write begins, checks the write's rules against the branch
at that commit, and sends that commit to the store as the write's condition, so two writers who
each pass a rule alone (two placements at one `sequence`) can no longer land together. A write
**without** `If-Match` that loses a race to another commit is run again, whole, on the new head,
up to three runs; if the branch moves under every run the answer is **409** `branch_moved` and
nothing is written. A write **with** `If-Match` that is not the head is now refused with **412**
before its rules are checked, so a stale `If-Match` outranks `type_conflict` and
`invariant_violation`. A read that reads the store more than once (every intelligence read, the
export) resolves a branch to its head once and reads everything at that commit, its `ETag` (B1).
`GET /documents/:type/:id/history` serves only an answer read with the head standing still around
it, and answers **503** `branch_busy` with `Retry-After: 1` if the head moved around three reads
in a row. Also a fix with no revision of its own: `POST /branches` from a `from` branch that does
not exist answers **404** `unknown_ref`, as the error table promised, not **409**
`branch_exists`. `@armature/client`'s `CLIENT_REVISION` is this revision.

**What a client does.** Treat `branch_moved` on a write like a 412: re-read and decide again;
it is rare, since the hub has already retried. Back off on `branch_busy` for the `Retry-After`
seconds. A client that shows several responses together (a page reading the export, then the
coverage, then the trace) reads the later ones at the first one's `ETag` with `?ref=` so they
describe one commit; the viewer now does. **CoQui:** its writes send no `If-Match`, so they are
the ones the hub retries; map `branch_moved` onto its existing retry for a 412. **Quiver:**
nothing until it resumes; its push already sends `If-Match`.

## 2026-10-30 · The hub refuses hosts and web origins it does not serve

**What changed.** Every hub checks two request headers before anything else runs (ADR-0067
decision 7). A request whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or a name under
`.localhost` (any port), or a name listed in `ARMATURE_ALLOWED_HOSTS`, is refused with **403**
`host_not_allowed`. A request carrying an `Origin` header is refused with **403**
`origin_not_allowed` when the origin is a remote web origin (`http` or `https` on a name other
than a loopback one) that `ARMATURE_ALLOWED_ORIGINS` does not list, or `null`. A loopback origin
and a non-web scheme (`tauri://localhost`, which Tauri's HTTP plugin sends on every request) are
served. Only a listed origin gets CORS (cross-origin resource sharing) answers: a preflight, and
`Access-Control-Allow-Origin` with `ETag` and `Armature-Version` exposed on every response,
refusals included. This closes DNS rebinding, a web page reaching a hub on its reader's machine
under the trusted `header` resolver. `@armature/client`'s `CLIENT_REVISION` is this revision.

**What a client does.** A tool outside a browser, calling a hub by a loopback name, does
nothing: it sends no `Origin`, or a desktop shell's. One that calls a hub by another name (the
compose network's `hub`, a server's own name) needs that name in the hub's
`ARMATURE_ALLOWED_HOSTS`; the compose file sets `hub`. A page in a browser that calls a hub
directly needs its origin in `ARMATURE_ALLOWED_ORIGINS`. **CoQui:** nothing, since its server
calls `http://hub:3100` with no `Origin` and the compose file allows `hub`. **Quiver:** nothing;
its Tauri origin is served.

## 2026-10-22 · `ActivityGroup` is `Lesson`

**What changed.** The ordered set of activities a module schedules is the class `Lesson`
(ADR-0064), the peer of an `Assessment`; it was `ActivityGroup`. Its two links are renamed
with it: `LessonActivityLink` (fields `lesson`, `activity`, `sequence`; Hash key over
`(lesson, activity)`) replaces `ActivityGroupMember`, and `ModuleLessonLink` (fields `module`,
`lesson`, `sequence`; Hash key over `(module, lesson)`) replaces `ModuleActivityGroupLink`.
Constraints 3, 4 and 6 keep their numbers and meaning. The module-content read says
`kind: "lesson"`, names the record in `lesson` and counts `summary.lessons`; `@armature/client`'s
`ModuleContentEntry` and `ModuleContentReport` follow. Same revision as the entries below.

**What a client does.** One that writes or reads activities in sequence uses the new class
and field names; a document naming the old classes is refused as an unknown type. One that
reads the module-content view reads `kind === 'lesson'` and `entry.lesson`. At demonstration
scale the store is reloaded (`load_schema.js --clear-instances`, then the seed); for real data
the rename is operator work (ADR-0064 § Platform checks). **CoQui:** nothing; it never writes
activities or lessons.

## 2026-10-22 · A module's content in teaching order

**What changed.** `GET /api/v1/intelligence/module-content/:moduleId` returns a module's
activities and groups merged by `sequence`, each group's members in their order, and each
activity's formative items (`ActivityItemLink`) in theirs, at any ref (ADR-0005). Each entry has
`kind` (`activity` or `group`) and the `link` that placed it; an entry without a `sequence` comes
last. An activity placed more than once in the module appears at every placement and is named in
`repeated`. Capability `armature/intelligence.module-content`; `@armature/client` adds
`intelligence.moduleContent()`. Same revision as the entry below: the capability is what a client
declares to find out whether a hub has the read.

**What a client does.** Nothing unless it shows or exports a module's activities. One that does
reads this instead of listing `ModuleActivityLink`, `ModuleActivityGroupLink`,
`ActivityGroupMember` and `ActivityItemLink` and sorting them itself. A client that assumed one
node per activity keys its nodes by `link` instead.

**CoQui.** Nothing: CoQui reviews items, not module content. An item's formative uses remain in
the trace and impact reads.

## 2026-10-22 · Item statistics in one read

**What changed.** `GET /api/v1/intelligence/item-statistics` returns the item statistics in the
bank, or with `?module=` in a module's assessments: each item with every `LearningMetric` whose
`subject` is that item, newest administration first, each with its value, unit, `asOf` and the
dataset it came from (cohort, administration date). `?unit=` keeps one unit; `units` lists those
in scope; items with no statistic are listed apart. It summarizes nothing: which figure counts as
an item's difficulty (latest, one cohort, across cohorts) is the client's choice (ADR-0058,
decision 3, whose form the viewer's Coverage View decided). Capability
`armature/intelligence.item-statistics`; `@armature/client` adds `intelligence.itemStatistics()`
and sends this revision.

**What a client does.** Nothing unless it shows item performance. One that does reads this
instead of listing `LearningMetric?subject=` once per item, and takes the first statistic for "the
latest administration" or filters by `dataset` for one cohort.

**CoQui.** An item's performance beside its findings is
`itemStatistics({ module })` filtered to the item under review, or the per-item list route as
before.

## 2026-10-21 · The hub runs as its own process and container

**What changed.** Nothing in the contract. The API is served by a standalone Node process
(`npm run build:hub && npm run start:hub` in `app/`, port 3100) and by a container
(`docker compose --profile hub up` in `docker/`, port 3100); a running API in front of a store is
a hub. The Next.js app on port 3000 no longer serves the API: it is the viewer, a client of a hub
through `@armature/client` like any plugin, and has its own container. A hosted instance is the
compose file's three containers with only the viewer public (`deployment.md`).

**What a client does.** Point at the hub, port 3100 locally, not at the Next.js address; make the
base address configuration if it was not already. `@armature/client` takes it as `baseUrl`.

**CoQui.** When an instance is hosted, its address replaces the recorded hub, which becomes the
fallback; until then nothing changes.

## 2026-10-21 · The version contract: `Armature-Version`, `Armature-Capabilities`, `GET /discover`, `GET /schema` (ADR-0059)

**What changed.** The contract has dated revisions: every dated entry of this file is one, and
this hub serves all of them (they are additive). A request may name the revision it was written
against in `Armature-Version`; a revision the hub does not serve is refused with 400
`unsupported_version` listing `supported`, except that a *newer* revision is served on a read and
refused on a write (so a client ahead of a hub can still look, and stops before its first commit).
Every response carries `Armature-Version` saying which revision served it. A request may declare
the capabilities it relies on in `Armature-Capabilities` (`armature/documents`,
`armature/intelligence.coverage`, …); one the hub lacks is 400 `unsupported_capability` naming it.
`GET /discover` lists the revisions, the capabilities with their settings (the coverage
thresholds, the batch limit) and where the schema is; `GET /schema?branch=|ref=` returns the
schema graph at a ref in the form the store reloads, the route ADR-0027 scheduled in Phase 1.
Both headers are optional: a client that sends neither is served as before.

**What a client does.** Nothing, to keep working. To fail early and by name, send
`Armature-Version` with the date of the entry it last read here, and `Armature-Capabilities` with
what it relies on; or call `GET /discover` first. Read `Armature-Version` from responses to know
which revision a hub is at. Discover types from `GET /schema` instead of a copy of `schema.json`.

**CoQui.** `@armature/client` sends `Armature-Version` on every call (`CLIENT_REVISION`) and
returns the response header as `version`; CoQui's own version check can read that, or go.

---

## 2026-10-21 · A typed client over every route (`@armature/client`)

**What changed.** `packages/client` is a workspace package, `@armature/client`, with one function
per `/api/v1` route in the reference's five groups (`documents`, `branches`, `users`,
`intelligence`, `export`). Every call returns `{ data, commit }`, the commit read from the
`ETag`; a read takes `{ branch }` or `{ ref }`; a write takes `message`, `branch` and an optional
`ifMatch` that becomes `If-Match`; the `user` given to `createClient` is sent as `Armature-User`;
a non-2xx answer throws `HubError` with the hub's `status`, stable `code`, `message` and the
body's other fields as `details`. Reads are typed by class name through `ClassMap`, new in
`@armature/types`. The client takes a `fetch`, so a plugin's tests can run it over a Hono app
in-process; the hub's own contract test does (`app/lib/api/client.test.ts`). No route changed.

**What a client does.** Install by git reference (pnpm:
`github:mossglenn/armature#path:packages/client`) and call the functions instead of building
URLs, headers and envelopes by hand. The client sends no `Armature-Version` header yet; ADR-0059
(Proposed) is the next unit, and the hub serves its current revision to a request without one.

**CoQui.** `httpHub` becomes a consumer of this package rather than a reimplementation of the
routes (plan Phase 7); its own version check can read `Armature-Version` from responses once
ADR-0059 lands, or be replaced by the client's.

---

## 2026-10-21 · The schema's types are an installable package (`@armature/types`)

**What changed.** The generated TypeScript interfaces, the schema as data (`CLASS_FIELDS`,
`CLASS_KEY`, `CLASS_ANCESTORS`, `CLASS_CATEGORY`) and the Zod request schemas moved from
`app/lib/` into `packages/types`, a workspace package named `@armature/types`, exporting `.`
(types and schema data) and `./schemas` (the request schemas the write routes check a body
with). It ships TypeScript source and no build, so a bundler compiles it with the code that
imports it. Nothing in the API or the schema changed; the 145-test contract suite now also runs
in CI against a TerminusDB service container on every change.

**What a client does.** Install the package by git reference instead of copying `types.ts`
(pnpm: `github:mossglenn/armature#path:packages/types`), and validate a body with the same Zod
schema the hub will apply before sending it. A client that copied the file keeps working; the
copy just no longer tracks the schema.

**CoQui.** CoQui's `types.ts` ("the target schema", its PR 3) can become an import of
`@armature/types`; the typed client over the routes (the next Phase 7 piece) will depend on it.

---

## 2026-10-20 · Outcome records name their source (ADR-0063)

**What changed.** A `LearningDataset` must carry `producedBy` (the `Assessment` whose
administration produced it) or at least one `externalRef`; a `LearningMetric` must carry
`derivedFrom` or at least one `externalRef`. Neither: 422 `dataset_without_source` or
`metric_without_source` (rule 20). This replaces the rule the schema documentation had carried as
"planned" since Phase 1. The seed now holds one administration (a dataset and three metrics), so
Narrative 1 runs on `main`.

**What a client does.**

- **An importer names the source of every dataset and metric it writes.** Results of an Armature
  assessment: `producedBy`. Results from elsewhere: an `ExternalRef` (`system: "xAPI"` or
  `"Other"`, the identifier the source uses). A metric derived from a dataset needs nothing more.
- **A benchmark or third-party figure** is a metric with an `externalRef` and no `derivedFrom`.

**CoQui:** no change. **Outcomes importer** (planned): maps the LMS activity or export id onto the
dataset's `externalRefs` beside `producedBy`.

Detail: ADR-0063; the API reference's rules table (rule 20).

---

## 2026-10-20 · Export profiles and schema slices (ADR-0031)

**What changed.** A new read, `GET /api/v1/export?branch=|ref=&profile=&slice=`, returns the
graph at a ref as one JSON-LD document: the store's `@context`, the schema as it can be reloaded,
and the documents of the slice under the profile, with the commit in `ETag` and in `armature.ref`.
Profiles: `full`, `pseudonymous` (every `User` a stable token, every reference to one rewritten,
nothing else about the person), `institutional` (the token plus `institution`). Slices are a
configuration (`GET /api/v1/export/slices`): `full`, `outcomes-loop`, `review`. References that
leave a slice are listed in `armature.unresolved`, never dropped from a document.

**What a client does.**

- **An exporter plugin reads the whole graph at a commit in one request**, instead of walking the
  list routes; `armature.ref` is the commit to stamp into whatever it produces (ADR-0057).
- **A research exporter asks for `profile=pseudonymous`** and, where the deployment has set
  `ARMATURE_EXPORT_KEY`, gets tokens that are the same across exports (`pseudonyms: "stable"`).
  It does not scrub free text; that is the exporter's job if it matters to the study.
- **A study declares its slice** as a list of class names in `app/lib/api/export/slices.json`, by
  pull request, not by code.
- **Nothing imports through the API.** Reproducing an export is an operator step: load `schema`,
  post `documents` (ADR-0062).

**CoQui:** no change. **text2qti exporter** (planned, outside this repository): reads
`GET /api/v1/export?ref=<commit>` and emits from `documents`.

Detail: ADR-0031; the API reference's Export section.

---

## 2026-10-20 · External references and attachments (ADR-0030)

**What changed.** Every artifact (every type inheriting `ArmatureDocument`) may carry two new
optional sets of embedded records: `externalRefs`, identifiers in other systems
(`{ "@type": "ExternalRef", "system": "CASE" | "QTI" | "xAPI" | "LTI" | "Other", "identifier", "label"? }`),
and `attachments`, verifiable references to bytes or to a revision of a tree of bytes in a store the
hub may or may not operate (`{ "@type": "Attachment", "store": "S3" | "Lore" | "Git" | "Other",
"storeUri", "contentHash", "hashAlgorithm", "revision"?, "path"?, "container"?, "mediaType"?,
"byteSize"?, "role"?, "label"? }`). Every fragment (a stem, an option, a feedback) may carry
`attachments` too, and `Fragment.text` is now optional. Two rules: an attachment in a `Git` or
`Lore` store names a `revision`, and `contentHash` has the length its `hashAlgorithm` implies
(422 `revision_required`, `hash_malformed`, rule 18); a fragment carries text or at least one
attachment (422 `empty_fragment`, rule 19). Rule 9 now checks option text for uniqueness only where
present. The graph never holds bytes, and the hub does not fetch or verify them.

**What a client does.**

- **Guard `fragment.text`.** It may be absent on a part that is a picture or a clip; render the
  attachment instead. Treat an absent `externalRefs` or `attachments` as empty, as for `assesses`.
- **Send attachments and references inline**, inside the record, with their `@type`. Never store
  their nested `@id`; it regenerates on every replace.
- **Name the hash algorithm as the IANA registry does** (`sha-256`, `sha-1`, `md5`); give a
  `revision` for a versioned store. A store or algorithm the hub does not know is accepted as
  written.
- **Expect staleness.** Writing a new `contentHash` or `revision` on a fragment's attachment is a
  change to that part: attestations on it report `Stale`, as after a text edit.
- **A text-less option that used to be 400 is now 422** `empty_fragment` with the fragment named,
  unless it carries an attachment.

**CoQui:** no change until it shows media options; a CoQui item that imports with a picture choice
maps the picture onto an `Attachment` on the option and leaves `text` out. **Curriculum mappers and
importers:** a CASE competency, a QTI source or an xAPI activity goes in `externalRefs`.

Detail: ADR-0030; the API reference's rules table (rules 9, 18, 19) and its documents section;
`docs/schema-guide.md` §4.12.

---

## 2026-10-20 · Formative use of items inside activities (ADR-0061)

**What changed.** A new relationship record, `ActivityItemLink`, records that a `LearningActivity`
uses an `AssessmentItem` formatively: a poll in a lecture, a question on a content page, a
practice set. Fields: `activity`, `item`, optional `sequence`. The identifier is derived from
`(activity, item)`. It carries no points, no clearance and no verdict, and counts toward no
coverage. The trace read follows an item downstream to the activities that use it, and shows an
activity with the modules it is placed in; the impact read reaches a use through its `item`.

**What a client does.**

- **Write a use through `POST /api/v1/documents` without an `@id`**, as for any Hash-keyed record.
  Writing the same activity and item again replaces the use (for example to reorder it).
- **Give `sequence` only when the activity orders its items.** Within one activity two uses may not
  share a `sequence` (422 `duplicate_sequence`, rule 17). It is independent of every module and
  group sequence.
- **Do not use it for a graded test.** An assessment with points and clearance is an `Assessment`
  with `ItemInstance` placements, as before. Those are what coverage counts.
- **Look in two places for where an item is used:** `ItemInstance` for placements and
  `ActivityItemLink` for formative uses, or read `GET /api/v1/intelligence/impact/AssessmentItem/:id`,
  which lists both.

**CoQui:** no change; CoQui reviews items, not their uses. **QuiQui and Tessera** (mapped in
`docs/research/`): a live poll and a question on a content page map onto this record.

Detail: ADR-0061; the API reference's rules table (rule 17) and trace section.

---

## 2026-10-20 · Items may exist unaligned (ADR-0060)

**What changed.** `AssessmentItem.assesses` no longer needs at least one objective. A write with
`assesses: []`, or with no `assesses` field, is accepted. The alignment read,
`GET /api/v1/intelligence/alignment`, gains `itemsWithoutObjective`: every item that assesses
nothing, or, with `module`, those placed in the module's assessments. `LearningActivity.targets`
still needs at least one objective.

**What a client does.**

- **Import or draft items before aligning them.** An adapter for a bank whose questions are not yet
  aligned writes them as they are; it never mints a placeholder objective.
- **Guard reads of `assesses`.** The database returns no field for an empty set, so an item read
  back may lack `assesses` altogether. Treat an absent field as an empty list.
- **Show the gap.** `itemsWithoutObjective` is the bank's list of unaligned items at any ref; a
  review or mapping tool can surface it as work to do. Nothing in the hub blocks an unaligned item
  from being `Approved` or placed; whether anything should is open (`docs/development-plan.md` §6).

**CoQui:** no change. Its items arrive from Armature already aligned. If it ever reads an item
written by another tool, it treats a missing `assesses` as none.

Detail: ADR-0060; the API reference's rules table (rule 1 retired) and alignment section.

---

## 2026-10-18 · Attestations (ADR-0028; PR #16)

**What changed.** A new record type, `Attestation`: one person's verdict, `Affirmed` or
`Declined`, about a design record or one part of it, as of a commit. A new read,
`GET /api/v1/intelligence/attestations/:type/:id`, reports whether each verdict still holds. An
optional `fragmentId` on `DesignNote` and `DesignFinding` lets notes and findings point at one part.

**What a client does.**

- **Write attestations through `POST /api/v1/documents` without an `@id`.** The hub derives the
  identifier from `subject`, `fragmentId`, `claimRef` and `attestedBy`. Writing the same four again
  replaces the verdict; a supplied `@id` is a 400 `bad_id`.
- **Send a claim whole or not at all.** `claimRef` (an identifier your tool chooses for the claim
  and its lineage, kept when the wording changes) and `claimText` (the wording) come together, or
  neither for a plain endorsement of the record. Half a claim is a 422 `claim_incomplete`.
- **Attest as the reviewer.** `attestedBy` is always the identity the request resolved to. A tool
  pushing several reviewers' verdicts sends each reviewer's in a request carrying that reviewer's
  `Armature-User`. A body naming anyone else is a 422 `attester_not_caller`.
- **Write the record first, then attest it, in two requests.** An attestation's subject may not
  be written in the same request (422 `subject_in_same_write`): the commit the verdict names must
  already hold what it judges.
- **Supply `asOf` when re-sending an old verdict.** Every write of an attestation is a new verdict,
  so an omitted `asOf` is filled with the branch head again, also on a replace. A retried push or
  an import of past verdicts sends the commit the verdict was about.
- **Read staleness, do not compute it.** The attestations read compares the judged part at `asOf`
  and now, by `fragmentId`, and reports `Current`, `Stale`, `FragmentRemoved` or `Unanchored`. It
  works after a merge, when the attested commit is on another branch.
- **Name parts on notes and findings** with `fragmentId`. The record then names exactly one
  `subject`, and the part must exist in it (422 `fragment_needs_one_subject`, `unknown_fragment`).
- `attestedBy` cannot be used as a list filter (400 `person_filter_refused`, ADR-0021).

**CoQui.** The type follows the shape CoQui proposed (O-J), with four mappings at its boundary:

| CoQui's proposal | In the hub |
|---|---|
| `Attestation/coqui-<itemId>-<fragmentId or item>-<lineage>-<reviewer>` | No client id. Keep that string as CoQui's own mapping; the same key fields give the same hub id, so a retried push is idempotent |
| `grid`, `claim` (lineage), `claimVersion` | Inside the opaque `claimRef`; the wording in `claimText` |
| `verdict: Cannot` | `Declined` |
| `asOf` (the item version) and `sourceCommit` | `asOf` is the commit; supply the version's `sourceCommit` on every push. CoQui's version row stays in CoQui |

The outbox rows held for this type can now be sent: per reviewer, after the item's own push.
A decline that is not a finding crosses as `Declined` with its `reason`.

Detail: [ADR-0028](../schema/docs/adr/0028-attestation.md); [API reference, attestations
read](api.md#get-intelligenceattestationstypeid); [schema guide §4.11](schema-guide.md).

## 2026-10-18 · Item statistics are metrics about the item (ADR-0058; PR #15)

**What changed.** `AssessmentItem.difficultyIndex` and `discriminationIndex` are removed. An item
statistic is a `LearningMetric` whose new `subject` field names the item, `derivedFrom` the
administration's `LearningDataset`. `ModuleObjective` declarations are written by any client
through the generic document routes (ADR-0007, confirmed).

**What a client does.** Write item statistics as metrics; list an item's metrics with
`GET /api/v1/documents/LearningMetric?subject=<item id>`. Send no statistics fields on an item:
they are unknown keys, a 400.

Detail: [ADR-0058](../schema/docs/adr/0058-item-statistics-are-metrics-about-the-item.md).

## 2026-10-18 · List filters, and no filter by person (ADR-0021; PR #14)

**What changed.** `GET /api/v1/documents/:type?<field>=<value>` filters `Optional` and `Set` fields
correctly (they had answered 500). A filter on any field that names a `User` (`createdBy`, and now
`attestedBy`) is refused.

**What a client does.** Do not list documents by who made them: 400 `person_filter_refused`. The
API offers no enumeration of one person's work.

## 2026-10-18 · Records name the state they refer to: `asOf` (ADR-0057; PR #12)

**What changed.** `LearningDataset`, `LearningMetric` and `DesignFinding` (and since PR #16
`Attestation`) carry `asOf`, a bare commit identifier. The hub fills it with the branch head on
create, keeps it on replace (except for an attestation, above), copies a dataset's onto its
metrics, and checks every value it did not take from the head (422 `unknown_commit`,
`absent_at_commit`, `as_of_disagrees`).

**What a client does.** A finding judged against an earlier version of its subject sends that
version's commit as `asOf`. To re-judge a finding, send a new `asOf`; a replace without one keeps
the old.

**CoQui.** A finding's `asOf` is the `sourceCommit` of the item version the note was about.

Also on 2026-10-18 (PR #13): deleting a branch that is already gone answers 404 `unknown_ref`
(it had answered 500), and `GET /api/v1/branches` no longer fails when a branch is deleted while
it is read.

## 2026-10-08 · Design intelligence reads; coverage is never stored (ADR-0029, ADR-0056; Phase 4)

**What changed.** Four reads under `/api/v1/intelligence/`: coverage, alignment, trace and impact,
each at any `?branch=` or `?ref=`. Coverage is computed on read; `ModuleObjective` has no coverage
field.

**What a client does.** Read coverage from `GET /api/v1/intelligence/coverage/:moduleId`; never
write it. A `ModuleObjective` with a coverage field is a 400.

**CoQui.** Narrative 2 reads both coverage figures: `coverage` counts Approved items in Approved
placements, and `projected` counts everything not Retired, so it shows progress while items are
still in review.

## 2026-10-08 · Generic writes, identity and the invariants engine (ADR-0024, ADR-0032; Phase 3)

**What changed.** Every type is written through `PUT /api/v1/documents/:type/:id` and
`POST /api/v1/documents`; the demo-era routes are retired. `Armature-User` carries an `externalId`,
resolved to a `User` on `main`. Rules the database cannot express are answered 422 with every
violation at once.

**What a client does.**

- Supply your own `@id` on an artifact's first write if you want one; later writes under it
  replace. Never supply one on a relationship (junction) record.
- Send `Armature-User: <externalId>`, not a `User` id. Register users on `main` with
  `POST /api/v1/users`. Never send `createdBy`; the hub sets it.
- Read the `violations` list on a 422 and the `issues` list on a 400; the codes are stable
  ([API reference](api.md#the-write-pipeline)).

## 2026-10-08 · Version control (ADR-0025; Phase 2)

**What changed.** Reads at a branch or a commit, `ETag` and `If-Match` as bare commit identifiers
(412 when the branch moved), branches, a three-way merge with a per-field conflict report,
per-document history and diff, and changes since a commit.

**What a client does.** Pin reads with `?ref=<commit>`; send `If-Match` on writes that must not
overwrite someone else's change. Never expose or rely on history rewriting: there is no reset,
squash or rebase.

**CoQui.** The handoff's statement that TerminusDB "has no three-way merge with markers" (§4) is
wrong for v12: correct it when PR 6 (`feat/armature-merge`) is picked up. Merge *policy*, who may
merge and whether findings and attestations reach `main` without approval (O-P), is still open
([development plan §6](development-plan.md)).

*2026-10-30:* who may merge is proposed in ADR-0068 decision 4 (a maintainer of `main`); what the
merge route checks remains open.

## 2026-10-07 · Schema catch-up (ADR-0017, 0018, 0020, 0022, 0023, 0024; Phase 1)

**What changed.** `DesignRecord` is the root every note and finding can point at; items carry their
own `status` (`ItemStatus`); `DesignFinding` exists; an item's stem, options and feedback are
embedded fragments with client-assigned `fragmentId`s.

**What a client does.** Assign `fragmentId` once per part and never derive it from position;
address parts as `{ item @id, fragmentId }`, never by the database's nested identifiers.

**CoQui.** One divergence is recorded and undecided: CoQui's handoff gives each option's own
feedback a `{ fragmentId, text }` shape, but `ItemOption.feedback` is plain text.
