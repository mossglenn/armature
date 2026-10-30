# Armature Schema Guide for Tool Authors

This guide is for a developer writing a tool on Armature: a plugin that reads the design graph, writes to it, or both. It assumes you have the repository, Docker and the client package, and it is meant to be enough on its own: nothing here requires reading TerminusDB's documentation, and no tool ever talks to the database directly. It sits between three other documents:

- The [API reference](api.md) lists every route, parameter, envelope and error code. This guide says how to use them; that one is the contract.
- The [Schema appendix](SCHEMA_APPENDIX.md) lists every type and field. It is generated from `schema/schema.json`, whose inline documentation is authoritative.
- [How Armature Works](how-armature-works.md) explains *why* the schema is shaped this way, for a general academic audience (its Section 12 covers the schema).

Decisions are cited by their Architecture Decision Record (ADR) number; all are in `schema/docs/adr/`. What changes in the contract is recorded in [`client-changes.md`](client-changes.md), newest first; a tool that last synchronized at a given date reads every entry above it.

The guide has three parts. **Part I** gets a hub running and a client talking to it. **Part II** is the graph itself: the mental model, the patterns every type follows, and what is checked where. **Part III** is the work of a tool: reading, writing, handling refusals, mapping your own concepts onto the schema, and what to do when the schema does not fit.

---

## Part I: A hub and a client

### 1. Run a hub

A hub is the Armature API in front of one TerminusDB database. Two ways to have one, both answering at `/api/v1`:

| Way | Command | Address |
|---|---|---|
| An instance: store, hub and viewer as containers (a hosted deployment adds Caddy with `--profile public`; [`deployment.md`](deployment.md)) | `cd docker && docker compose --profile hub up -d --build` | `http://localhost:3100`, from the machine only |
| Store in Docker, the API as a process on your machine | `cd docker && docker compose up -d`, then in `app/`: `npm run build:hub && npm run start:hub` | `http://localhost:3100` |

Armature's own pages (the viewer, `npm run dev` in `app/`, port 3000) are a client of whichever hub `ARMATURE_HUB_URL` names, exactly as your tool will be; they serve no API of their own.

The repository README's "Getting started" covers the install and the `.env.local` file. Whichever way, load the schema and the demonstration course once from the repository root: `node scripts/load_schema.js`, then `node scripts/seed_data.js`. The seed is a small fictional course, "Introduction to AI for Instructional Designers", with 61 documents in its first commit, then one attestation, one administration's results, and the designer's response to them (a finding and a second item); every example below reads it.

Check the hub is up with the one read that needs no database:

```
curl http://localhost:3100/api/v1/discover
```

It returns the contract revisions the hub serves, its capabilities with their settings, and where the schema is (Section 15).

The hub published by the compose file listens on the machine's loopback interface only, and so does the standalone process by default, because the only identity resolver built so far trusts whatever identity a request claims (Section 10). A hub other machines can reach is a decision, not a default; a tool that writes runs on the hub's machine, or behind a proxy that authenticates, until the `oidc` resolver exists, specified in ADR-0067 (accepted 2026-10-30; its `Host` and `Origin` checks built, the rest not yet). Since 2026-10-30 a tool that calls a hub by any name but a loopback one needs that name in `ARMATURE_ALLOWED_HOSTS`, else 403 `host_not_allowed` (Section 11).

### 2. The client in five lines

[`@armature/client`](../packages/client/README.md) is one typed function per route, grouped as the API reference groups them: `documents`, `branches`, `users`, `intelligence`, `export`, plus `discover()` and `schema()`. Types come from [`@armature/types`](../packages/types/README.md), generated from the schema. Both ship TypeScript source, which your tool compiles. Another repository installs them by git reference, the types first, since the client takes them as a peer dependency: `pnpm add github:mossglenn/armature#path:packages/types github:mossglenn/armature#path:packages/client`. A Next.js app adds `transpilePackages: ['@armature/client', '@armature/types']` to its `next.config`; Vitest and `tsx` need nothing. The client's README has the details, including pinning a commit.

```ts
import { createClient, HubError } from '@armature/client';

const hub = createClient({ baseUrl: 'http://localhost:3100', user: 'demo-designer@example.edu' });

const { data: objectives, commit } = await hub.documents.list('LearningObjective');
const coverage = await hub.intelligence.coverage('how-ai-works', { ref: commit });
```

Every result is `{ data, commit, version }`: the document or report, the commit it was read at or created (from the response's `ETag`), and the contract revision the hub served it under. Every refusal is a thrown `HubError` with the hub's HTTP `status`, a stable `code` (Section 11), a `message`, and the body's other fields as `details`: a rule failure's `violations`, a merge's `conflicts`.

Nothing in the client is more than the routes are. If you prefer raw HTTP, the [API reference](api.md) is complete; the client exists so a plugin does not re-implement refs, commits, envelopes and error parsing.

**Testing without a server.** `createClient` takes a `fetch`. Given a Hono app's `request`, every call runs in-process; the hub's own contract test does this. A plugin's tests can run against the real routes with no socket.

### 3. The working model: branches, commits, refs

Everything a tool does is one of two things: a **read at a ref** or a **write to a branch**.

- A **ref** is a branch name or a commit id. Every read takes `{ branch }` or `{ ref }`; neither means `main`. A read at a commit is the graph exactly as it was then, forever, so a tool can pin what it showed someone.
- A **write** goes to a branch (`main` when none is named) and makes one commit, with the caller as author and the tool's `message` as the reason. There is no write at a commit.
- **`main` is the shared design.** Branch from it for work in progress, merge back when the work is accepted, or never merge: a branch left as it is remains readable at every commit. The hub's three-way merge reports field-level conflicts and resolves nothing on its own.
- **Nothing is ever rewritten.** No reset, squash or rebase exists. A mistake is undone by a new commit.

A tool's unit of work is usually a branch. CoQui, the first plugin, reviews items in *rounds*; a round is a CoQui concept with no document in the hub, and its trace in Armature is one branch per round, created from `main` when the round opens, with one commit per revision and, at most, one merge at the end (Section 12).

```ts
await hub.branches.create('review-round-3', { branch: 'main' });
const { commit: head } = await hub.branches.head('review-round-3');
// ... writes with { branch: 'review-round-3' } ...
await hub.branches.merge('main', { message: 'Round 3 accepted', from: 'review-round-3' });
await hub.branches.changes('review-round-3', head);   // what the round changed: [{ id, op }]
```

A branch can be deleted only when another branch already holds its latest commit, and `main` never.

---

## Part II: The graph

### 4. The mental model

Armature records instructional design as a **graph of documents**. Each document is one design record: a learning need, an objective, an assessment item, a module. Documents point at each other through **reference fields**, and the references are the **design relations**: "this item assesses that objective," "this need generated that objective."

Three ideas organize the schema:

1. **The learning objective is the central node.** Needs generate objectives; prerequisite records connect objectives; items assess them; activities target them; modules declare them. Almost every query passes through an objective.
2. **A relationship that carries data is a document.** If a relationship needs its own fields (a rationale, a role, a position, a confidence), it is a *junction document*. Otherwise it is a plain reference field (ADR-0003).
3. **History is not in the schema.** No document has version or timestamp fields. Every change is a commit in the database, with an author and a reason, and any document can be read as it was at any commit (ADR-0025).

### 5. The lifecycle the schema follows

```
LearningEvidence ──NeedEvidenceLink(confidence)──▶ LearningNeed
                                                        ▲
                                          generatedBy   │
LearningObjective ──────────────────────────────────────┘
   ▲   ▲   ▲   ▲
   │   │   │   └── PrerequisiteRecord (objective, prerequisite, type, rationale)
   │   │   └────── ModuleObjective (module, references, role, roleRationale, sequence) ── Module ── Course
   │   └────────── LearningActivity.targets
   └────────────── AssessmentItem.assesses
                        ▲
                        └── ItemInstance (assessment, implements, sequence, status) ── Assessment ── Module
                                                                                          ▲
                                                           LearningDataset.producedBy ────┘
                                                                ▲
                                          LearningMetric.derivedFrom
                                          LearningMetric.subject ──▶ the record it measures
                                                                     (an item, for an item statistic)
```

The arrows point from the document holding the reference to the document it names.

### 6. Four categories of class

Every class declares a category in its schema metadata (`@metadata.armature.category`, ADR-0027). A tool reads the category to decide how to treat a type (`CLASS_CATEGORY` in `@armature/types`, or `@metadata` in what `hub.schema()` returns), and the generators fail on a class without one.

| Category | Classes | What it means for a tool |
|---|---|---|
| `artifact` | `Course`, `Module`, `LearningObjective`, `AssessmentItem`, `Assessment`, `LearningActivity`, `Lesson`, `LearningNeed`, `LearningEvidence` (abstract), `LearningMetric`, `DescriptiveEvidence`, `LearningDataset`, `DesignNote`, `DesignFinding` | A primary design record with a `label`, an optional `description` and a `createdBy`. Writable. The tool chooses its identifier |
| `relationship` | `NeedEvidenceLink`, `PrerequisiteRecord`, `ModuleObjective`, `ModuleActivityLink`, `ModuleLessonLink`, `LessonActivityLink`, `ItemInstance`, `ActivityItemLink`, `Attestation` | A junction document. Writable. Its identifier is derived from its key fields; a tool never supplies one |
| `fragment` | `Fragment` (abstract), `TextFragment`, `ItemOption` | An embedded part of an item. Not a document; written as part of its item. Carries text, attachments or both |
| `infrastructure` | `User`, `DesignRecord` (abstract), `ArmatureDocument` (abstract), `ExternalRef`, `Attachment` | Identity, abstract roots, and the two embedded coordinates that point out of the graph (Section 7.12). `User` has its own routes; the roots cannot be created; the coordinates are written as part of the record that carries them |

### 7. Patterns you will meet everywhere

#### 7.1 References, not ownership (ADR-0002)

Documents are independent and reusable. An activity can appear in several modules; an item can appear in several assessments. Deleting or changing one document never silently changes another. The one exception is an item's parts (Section 7.6), which are embedded because they have no meaning outside their item.

#### 7.2 Back-references on children (ADR-0004)

In a one-to-many relationship the reference lives on the child: `Assessment.module`, `Module.course`, `ItemInstance.assessment`, `ModuleObjective.module`, `LearningObjective.generatedBy`. Parents hold no lists of children. To find a module's assessments, list `Assessment` documents whose `module` is the module:

```ts
const { data } = await hub.documents.list('Assessment', { filter: { module: 'Module/how-ai-works' } });
```

#### 7.3 Sets for plain links, junctions for links with data (ADR-0003)

| Relationship | Stored as |
|---|---|
| Item assesses objectives | `AssessmentItem.assesses`: a set, possibly empty (an item may exist before it is aligned, ADR-0060; it then counts toward no objective) |
| Activity targets objectives | `LearningActivity.targets`: a set (at least one) |
| Need informed by evidence | `NeedEvidenceLink` with `confidence` |
| Objective requires objective | `PrerequisiteRecord` with `prerequisiteType` and `rationale` |
| Module declares objective | `ModuleObjective` with `role`, `roleRationale`, `sequence` |
| Activity or lesson placed in module | `ModuleActivityLink` / `ModuleLessonLink` with `sequence` |
| Activity placed in lesson | `LessonActivityLink` with `sequence` |
| Item placed in assessment | `ItemInstance` with `sequence`, `pointValue`, `randomize`, `status` |
| Item used formatively in an activity | `ActivityItemLink` with optional `sequence`; no points or clearance, counts toward no coverage (ADR-0061) |

Do not create a junction for tidiness. A relationship earns one by carrying data (ADR-0017).

`NeedEvidenceLink.confidence` is the designer's assessment of the evidence's *reliability*, not the direction it points. A link means the evidence informed the need; there is no way yet to record evidence that was weighed and argues against a need, and a low confidence does not mean that. If usage shows the need, the path is an optional `relation` enum beside `confidence`, not a negative value (development plan §6, "Evidence that argues against a need").

#### 7.4 Required, optional and controlled values

- A field is required unless the schema marks it `Optional`. Sets may be empty unless they declare `@min_cardinality`.
- Controlled vocabularies are top-level enums (ADR-0008). There are fifteen: `BloomsLevel`, `ObjectiveState`, `ObjectiveRole`, `PrerequisiteType`, `ItemType`, `ItemStatus`, `EvidenceMethod`, `ConfidenceLevel`, `NeedPriority`, `ActivityType`, `DesignNoteCategory`, `FindingStatus`, `AttestationVerdict`, `ExternalSystem` and `AttachmentStore`. `@armature/types` exports each as a union type with a `VALID_*` array, so a tool's own dropdown can be the hub's list. Several are deliberately short (two verdicts, four item statuses): a tool maps its richer vocabulary onto them at its boundary (Section 12).
- Free-text rationale fields (`rationale`, `roleRationale`, `purpose`, `finding`, `resolutionRationale`) are free text on purpose. Do not propose replacing them with structure without evidence from real usage (ADR-0010, progressive formalization).

#### 7.5 Identity and keys (ADR-0016, ADR-0024)

- **Artifacts** declare a random key. The tool supplies the identifier on first write, as `Type/<anything>`; a UUID (universally unique identifier) is recommended, and readable slugs are allowed. Writing again under the same identifier replaces the document. The hub never parses or regenerates an identifier. The client accepts `Type/local` and bare `local` alike.
- **Junctions** declare a hash key over their defining references, for example `ModuleObjective` over `(module, references)` and `ItemInstance` over `(assessment, implements)`. The database computes the identifier from those fields, so a pair can exist only once. Writing the same pair again replaces the document, which keeps its other fields (sequence, role) editable. `CLASS_KEY` in `@armature/types` says which fields.
- **`Attestation`'s hash key includes optional fields:** `(subject, fragmentId, claimRef, attestedBy)`. An absent field is part of the key, so a person's endorsement of a whole item, their verdict on one option and their verdict on a named claim are three documents (ADR-0028).
- **No key ever includes an editable field.** Otherwise editing the field would create a different document. `fragmentId` and `claimRef` are identifiers, not content: changing one means judging a different part or claim.

#### 7.6 Items are trees of fragments (ADR-0022, ADR-0023, ADR-0033)

An `AssessmentItem` embeds its parts:

```json
{
  "@id": "AssessmentItem/5b0c…",
  "@type": "AssessmentItem",
  "label": "Identify a hallucination",
  "itemType": "MultipleChoice",
  "status": "Draft",
  "bloomsLevel": "Understand",
  "assesses": ["LearningObjective/identify-ai-limitations"],
  "stem": { "@type": "TextFragment", "fragmentId": "f-stem", "text": "Which output is a hallucination?" },
  "options": [
    { "@type": "ItemOption", "fragmentId": "f-a", "text": "A cited source that does not exist", "isCorrect": true },
    { "@type": "ItemOption", "fragmentId": "f-b", "text": "A summary that omits a detail", "isCorrect": false,
      "purpose": "Targets the misconception that any error is a hallucination" }
  ],
  "incorrectFeedback": { "@type": "TextFragment", "fragmentId": "f-wrong", "text": "Look for invented facts." }
}
```

Rules for fragments:

- **The authoring tool assigns `fragmentId`** once, when the part is created. Never derive it from position or display order, never regenerate it, never reuse a retired one. Armature checks only that it is unique within the item (rule 8).
- **Address a part as the pair `{ item @id, fragmentId }`.** The database's own nested identifiers for parts are regenerated every time the item is replaced; never store them. A `DesignNote`, `DesignFinding` or `Attestation` about one part carries the part's `fragmentId` beside its `subject`, which then names exactly one record, and the part must exist in it (rule 16, ADR-0028).
- **The options list is in presentation order.** Identity is `fragmentId`, not position.
- **Every fragment carries text or at least one attachment** (rule 19). A picture option has `attachments` and no `text` (Section 7.12).
- **Option text, where present, must be unique within the item, and the number of correct options must suit the item type** (rule 9): multiple choice and true/false have exactly one correct option (true/false exactly two options); multiple select has one or more.
- `ItemOption.feedback` is plain text, not a fragment, so per-option feedback cannot yet be addressed as a part. (CoQui's handoff proposed a `{ fragmentId, text }` shape for it; that divergence is recorded and unresolved.)

#### 7.7 Two statuses for items (ADR-0018)

`AssessmentItem.status` is the item's own review (is the question correct and aligned?). `ItemInstance.status` is clearance in one assessment. Both use `ItemStatus` (`Draft`, `InReview`, `Approved`, `Retired`). A placement cannot be `Approved` while its item is `Draft` or `InReview` (rule 10). Map a richer workflow onto these four at your tool's boundary (Section 12).

#### 7.8 Rationale has three homes

1. The **commit message**, required on every write: the primary record of why a change was made.
2. **Inline rationale fields** where the reason is intrinsic to a relationship (`PrerequisiteRecord.rationale`, `ModuleObjective.roleRationale`, `ItemOption.purpose`).
3. **`DesignNote`** for a decision that fits no slot, and **`DesignFinding`** for a concern that something is wrong (ADR-0012, ADR-0020). Both take a `subject` set of any `DesignRecord`: any artifact or junction, never a `User`.

A finding has a status (`Open`, `Addressed`, `Dismissed`); a `Dismissed` finding must carry a `resolutionRationale` (rule 11).

#### 7.9 Provenance is set by the hub

`createdBy` on every artifact is set by the API from the identity the request resolved to, on create, and preserved on replace (ADR-0032). A value in a request body is ignored. The commit author is the same user. Do not try to set either. An `Attestation`'s `attestedBy` is set the same way; a body naming anyone else is refused (rule 15).

`asOf` names the state of the design a record refers to: the commit a `LearningDataset`'s assessment was taken from, a `LearningMetric` was measured against, or a `DesignFinding`'s subject was judged at (ADR-0057). Unlike `createdBy`, a tool may set it, and an importer of past results should. When it is left out, the API fills it with the branch head the write starts from, keeps the stored value on a replace (so marking a finding `Addressed` does not move what it was about), and copies a dataset's value onto the metrics derived from it. A supplied value must be a real commit at which the record's subjects exist (rule 13). Because a commit cannot name itself, a finding written together with a new item about that item records the state just before the item existed. An attestation cannot be written in the same request as its subject for the same reason, and its `asOf` is refilled on every write, since each write of one is a new verdict (ADR-0028 decision 5).

#### 7.10 Nothing derived is stored (ADR-0056)

The schema holds what people decided and what was observed. Coverage, alignment and any future score are computed by the intelligence reads at a ref (Section 9). If a judgment needs to be on record under someone's name, it is a `DesignFinding` or an `Attestation`. Before proposing any stored score, ask: *could this value appear in a commit under a person's name and be true as a record of what they did?*

Item statistics show the line between an observation and a summary (ADR-0058). A difficulty or discrimination figure arrives from the tool that holds learners' responses, so it is an observation, but it describes one cohort meeting one version of the item. It is therefore not a field on the item: it is a `LearningMetric` whose `subject` is the item, `derivedFrom` the dataset of the administration, with that dataset's `asOf`, so each cohort's figures sit beside the others instead of overwriting them. "The metrics about this item" is `hub.documents.list('LearningMetric', { filter: { subject: itemId } })`; a summary such as an item's latest difficulty is a read, built when a tool needs one.

#### 7.11 Attestations: a person's verdict as of a commit (ADR-0028)

An `Attestation` records that one person (or agent) affirmed or declined something about one design record, or one part of it, as the record stood at `asOf`.

- **With a claim** (`claimRef`, an identifier your tool chooses, and `claimText`, its wording), the verdict is about the claim: "option a is the only correct answer". Rewording a claim keeps its `claimRef`, so the new verdict replaces the old one.
- **Without a claim**, the verdict is an endorsement of the record itself: a sign-off, or a person accepting what an AI assistant proposed. `claimRef` and `claimText` come together or not at all (rule 14).
- **One current verdict per person, part and claim.** The key guarantees it; a later verdict replaces the record, and earlier ones stay in the commit history.
- **Staleness is a read**, never a field: `hub.intelligence.attestations(type, id)` compares the judged part at `asOf` with the part now, by `fragmentId`, and reports `Current`, `Stale`, `FragmentRemoved` or `Unanchored`. A stale affirmation still records what its attester affirmed then.
- **No tool has to attest.** Nothing else in the hub reads attestations; `ItemStatus` remains the readiness signal.

```ts
await hub.documents.batch({
  branch: 'review-round-3',
  message: 'Reviewer affirms the key of the bias item',
  documents: [{
    '@type': 'Attestation',
    subject: 'AssessmentItem/bias-type-mc',
    fragmentId: 'bias-type-mc-opt-a',
    claimRef: 'coqui:key-is-correct',
    claimText: 'Training data bias is the only correct answer to this stem.',
    verdict: 'Affirmed',
  }],
});
```

No `@id`: the hub derives it, and adds `attestedBy` and `asOf`.

#### 7.12 Pointing outside the graph: external references and attachments (ADR-0030)

Two embedded shapes let a record point at things the graph does not hold. Every artifact (every type that inherits `ArmatureDocument`) may carry both; every fragment may carry attachments.

```json
{
  "@id": "LearningObjective/explain-training-data",
  "@type": "LearningObjective",
  "label": "Explain how training data shapes model behavior",
  "state": "Active",
  "externalRefs": [
    { "@type": "ExternalRef", "system": "CASE", "identifier": "https://case.example.edu/ims/case/v1p0/CFItems/4f2c", "label": "AI.2.1" }
  ]
}
```

```json
{ "@type": "ItemOption", "fragmentId": "f-chart", "isCorrect": true,
  "attachments": [
    { "@type": "Attachment", "store": "Git", "storeUri": "https://example.edu/course-assets.git",
      "revision": "c0ffee1", "path": "img/bias-types.png",
      "contentHash": "ab…64 hex digits…", "hashAlgorithm": "sha-256", "mediaType": "image/png" }
  ] }
```

Rules:

- **An `ExternalRef` is the other system's identifier, as that system writes it**, with the system named (`CASE`, `QTI`, `xAPI`, `LTI`, `Other`). It copies nothing else in; the optional `label` is a convenience. It carries no relation to its target (exact, broad, narrow); that enum is added beside `identifier` when a tool needs it.
- **An `Attachment` never holds bytes.** It names where they are (`store`, `storeUri`, optional `container` and `path`), which state (`revision`, required when the store is `Git` or `Lore`, rule 18) and what they are (`contentHash` and `hashAlgorithm`, both mandatory). `hashAlgorithm` is an IANA registry name (`sha-256`, `sha-1`, `md5`, and so on); for the names the hub knows it checks the hash's length (rule 18). The hub does not fetch or verify bytes; a reference is a claim the writing tool makes.
- **Neither has identity.** Like fragments, they are subdocuments whose nested `@id` the database regenerates on every replace; never store one. Unlike fragments they have no `fragmentId` and are not parts: a note or attestation is about the artifact or the fragment that carries the reference.
- **A changed attachment is a changed fragment.** Re-export an image and write the new hash, and every attestation on that option goes `Stale` (Section 7.11), exactly as after a text edit.
- **Absent means none.** The database returns no field for an empty set, so read `externalRefs ?? []`.

### 8. What the database checks and what the API checks

| The database checks | The API checks (the invariants engine) |
|---|---|
| Field types, required fields, enum values | That every reference names a document of the declared class (rule 0) |
| Minimum set sizes (`@min_cardinality`) | Unique positions in modules, lessons, assessments and activities (rules 3 to 5, 17) |
| That a referenced document exists | Fragment and option rules (rules 8, 9, 19) |
| Unique identifiers | Item and placement status consistency (rule 10) |
| | A reason for every dismissal (rule 11) |
| | No identifier reused across types (rule 12) |
| | `asOf` names a real state that holds the record's subjects (rule 13) |
| | An attestation's claim comes whole and its attester is the caller (rules 14, 15) |
| | A named part exists in the record's one subject (rule 16) |
| | An attachment names a revision when its store is versioned, and its hash has the length its algorithm implies (rule 18) |
| | A dataset or metric names its source, inside the graph or outside it (rule 20) |

The database does **not** check that a reference points at the right *class* of document. Never describe a typed reference as "schema-enforced"; the API enforces it. For a tool the distinction is invisible: both kinds of failure come back from the same write as a refusal with a code (Section 11). The full rule list, with codes, is in the [API reference](api.md#the-write-pipeline).

---

## Part III: The work of a tool

### 9. Reading

**One document, a list, a filtered list.** `documents.get(type, id)` returns the document as stored, parts inline. `documents.list(type, { filter, count, skip })` returns documents of one type; a filter keeps documents whose field equals the value, or whose set contains it. Filters on required single-valued fields are answered by the database; filters on optional or multi-valued fields are answered by the hub after reading the whole type, which matters only for very large types. A filter on a field that names a person (`createdBy`) is refused: the API does not list documents by who made them (ADR-0021; Section 14).

**Every read takes a ref.** `{ branch: 'review-round-3' }` or `{ ref: commit }`. The `commit` in every result is the ref resolved, so a tool that reads a list at `main` and then wants the same objective exactly as it appeared uses `{ ref: result.commit }`.

**Absent fields.** The database returns no field for an empty set. An item that assesses nothing has no `assesses` key; read `doc.assesses ?? []`. The generated interfaces type every set as an array, so a reader guards the field, never the type.

**History and difference.** `documents.history(type, id, { branch, start, count, diff })` lists the commits on a branch that touched one document, newest first, each with who, why, when, and the structural difference it made (TerminusDB's JSON patch; see the API reference). `documents.diff(type, id, { from, to })` is the difference between two commits. Lists inside a document (an item's options) are compared by position, so reordering reads as several changes.

**What a module or course looks like now.** The seven intelligence reads answer design questions from the graph's structure alone, at any ref, storing nothing (ADR-0056):

| Read | Answers | Returns |
|---|---|---|
| `intelligence.coverage(moduleId, { fullyAssessedAt, overAssessedAbove })` | How well the module's assessments cover each objective it declares, twice: as delivered (approved items in approved placements) and as projected (everything not retired) | A verdict per declaration with the items behind it, the thresholds used, counts, and objectives the module assesses without declaring |
| `intelligence.courseCoverage({ course })` | The same for every module of a course | One block per module in sequence order |
| `intelligence.alignment({ module })` | Where Bloom's levels disagree: items below their objective, objectives no item reaches, objectives no activity targets, items that assess nothing | Lists by case |
| `intelligence.trace(type, id)` | Everything one record connects to, both directions, from evidence through needs, objectives, items, placements and assessments to datasets and metrics, with every note, finding and attestation along the way | Nodes, edges with the field or junction followed, annotations |
| `intelligence.impact(type, id)` | Everything that references this record, before it is changed | References by type, each with the field and the container it sits in |
| `intelligence.attestations(type, id)` | Which verdicts on this record still hold | Each attestation with `Current`, `Stale`, `FragmentRemoved` or `Unanchored` |
| `intelligence.itemStatistics({ module, unit })` | How the items performed, per administration | Each item with every metric about it, newest administration first, its cohort and date; the units in scope; items with none. Which figure is "the" difficulty is the tool's choice |
| `intelligence.moduleContent(moduleId)` | What the module teaches, in what order (ADR-0005) | Its activities and lessons merged by `sequence`, each lesson's activities and each activity's formative items in their own order; each entry with the link that placed it (`kind` says activity or lesson); activities placed more than once listed in `repeated` |

The coverage thresholds are the hub's provisional cut; a tool passes its own and reads the hub's defaults from `discover()`. Formative uses of items (`ActivityItemLink`) and unaligned items count toward nothing.

### 10. Writing

**Who you are.** Every write carries an identity: the `user` given to `createClient` is sent as `Armature-User`, an external identifier of a `User` registered on `main`. The seed registers `demo-designer@example.edu`. A tool registers its own people, and its AI agents, once: `users.register({ message, user: { displayName, externalId, email?, institution? } })`; an agent's `externalId` begins with `agent:` (`agent:coqui/item-drafter`). There are no routes to edit or delete a user. The resolver built so far trusts the header, which is why a hub stays local (Section 1); an authenticating resolver, `oidc`, is specified in ADR-0067 (accepted 2026-10-30, not yet built) and is a prerequisite of the workspace hub (ADR-0065, accepted the same day); the hub already refuses hosts and web origins it does not serve (Section 11).

**Why.** Every write carries a `message`, the reason for the change, which becomes the commit message and the first home of rationale (Section 7.8). Write it for the designer who inherits the course in three years.

**One document.** `documents.put(type, id, { branch, message, document, ifMatch })` creates or replaces one artifact. The tool chooses `id` (Section 7.5), and writing the same `id` again replaces the document whole: send every field, not a patch. That is what makes a retried write safe: the same push twice is one state, and a tool can mint deterministic identifiers (`DesignFinding/coqui-<noteId>`) so its own records and the hub's never drift apart.

**Several documents, one commit.** `documents.batch({ branch, message, documents, ifMatch })` writes up to 500 documents that succeed or fail together. Each carries its `@type`. Documents in one batch may reference each other by identifier in any order, since the rules are checked against the branch as it will be after the write. A junction's identifier is not known until it is written, so a document may mark itself `'@capture': 'name'` and another in the same batch refer to it as `{ '@ref': 'name' }`; this is how a junction and a note about it are created together (Section 13.1). Use a batch for anything that must be whole: an item with its placements, an imported administration with its metrics.

**What the hub sets for you.** `createdBy` and `attestedBy` from the identity; `asOf` from the branch head when you leave it out; a junction's `@id` from its key fields; a copy of your `User` onto the branch if it is not there yet. Send a `createdBy` and it is ignored; send someone else's `attestedBy` and it is refused.

**Not stepping on each other.** `ifMatch: commit` says "I expect the branch to be at this commit". The hub refuses with 412 `precondition_failed` if it has moved; the tool re-reads and decides. A tool that is the only writer to its branch (CoQui on a round's branch) can omit it; a tool writing to `main` should not.

**No delete.** Lifecycle changes are status changes (`ItemStatus.Retired`, `FindingStatus.Dismissed`, `ObjectiveState.Archived`), which keep every reference and every line of history. A document that must truly go is an operator's task outside the API, still as a commit (ADR-0062).

### 11. When the hub says no

Every refusal is a `HubError` with a stable `code`. A tool branches on the code, never on the message. The classes, and what a tool does with each:

| Status | Codes | What it means | What a tool does |
|---|---|---|---|
| 400 | `invalid_document` (with `issues`: `{ index, path, message }` per problem) | The shape is wrong: a missing required field, a bad enum value, an unknown field, an empty or over-long string | A bug in the tool's mapping. Fix the tool; the `path` says where |
| 400 | `bad_id`, `id_mismatch`, `type_mismatch`, `duplicate_id`, `duplicate_capture`, `invalid_type`, `message_required`, `unknown_field` | The request disagrees with itself or with the route | The same |
| 400 | `unsupported_version`, `unsupported_capability` | The hub does not serve the revision or feature the tool declared (Section 15) | Stop and say so; the `details` list what the hub supports |
| 401 | `identity_required`, `unknown_user` | No `user`, or one not registered on `main` | Register the user, or ask who the caller is |
| 403 | `host_not_allowed`, `origin_not_allowed` | The hub does not answer to the name the tool called it by, or to the web page the request came from | Call the hub by a loopback name or one its administrator lists in `ARMATURE_ALLOWED_HOSTS`; a page in a browser needs its origin in `ARMATURE_ALLOWED_ORIGINS` |
| 404 | `not_found`, `unknown_type`, `unknown_ref` | No such document, type, branch or commit | The tool's view is stale, or the identifier is from another instance |
| 409 | `type_conflict` | The identifier is held by a document of another type (rule 12) | Mint a different identifier; identifiers are never reused across types |
| 409 | `branch_exists`, `user_exists`, `unmerged_branch`, `branch_moved`, `registration_conflict` | Branch and user bookkeeping | Usually fine to treat as done (`branch_exists`, `user_exists`) or retry once |
| 409 | `merge_conflict` (with `conflicts`), `no_common_ancestor` | Both sides changed the same field, or created the same identifier differently | Show the three values; nothing is resolved for you |
| 412 | `precondition_failed` | The branch moved since `ifMatch` | Re-read at the new head, reconcile, write again |
| 422 | `invariant_violation` (with `violations`: `{ code, id?, index, field?, message }`) | The shape is right but a rule is broken: a reference to the wrong class, a duplicate position, a placement approved ahead of its item, an attestation naming a part that does not exist | Every violation at once, so fix them together. Codes are listed per rule in the [API reference](api.md#the-write-pipeline); most mean the tool's own state disagrees with the hub's |
| 500 | `store_unavailable`, `store_error`, `internal_error` | The hub or its database is in trouble; details are in the hub's log only | Retry later; `store_error` after a long wait under concurrent writers is the database giving up a transaction, and a retry succeeds |

Two codes deserve care. **`reference_class`** (a rule 0 violation) means the document you named exists but is not of the class the field declares: a `User` where a `DesignRecord` was expected, an item where a module was. The database would have accepted it; the hub does not. **`unknown_reference`** means the target does not exist on that branch, as the write would leave it; **`unknown_capture`** is a `@ref` to a name no document in the batch captured.

### 12. Mapping your tool's concepts onto the schema

The hub is deliberately smaller than any tool built on it. It holds the structure of a design and the outcomes of working on it; a tool keeps its own workflow, its own interface, its own operational data, and whatever its users say to each other. The test for whether something crosses: *would a researcher studying the design process, or a designer inheriting this course in three years, need it?* Review outcomes pass; review discourse does not.

The hub also refuses to grow a field for one tool. A capability enters only in the generic form a second, different tool would need (the two-client test, `.claude/CLAUDE.md` principle 6; the reference tools it is tested against are listed in `docs/development-plan.md` §2). So a tool should expect to map, and the first plugin's mappings are the worked example:

| CoQui concept | What it is in CoQui | Where it lives in Armature |
|---|---|---|
| A **round** of review | A facilitator, a set of items, assigned reviewers, opened and ended | A **branch** created from `main` when the round opens; every push of the round is a commit on it; one merge at the end, or none. The round itself has no document |
| An item **version** | A numbered revision in CoQui's own store | A **commit** on the branch; the item's `@id` never changes. CoQui keeps its version row as the pin and records the commit beside it, since a merge gives commits new identifiers |
| **Workflow states** (a richer review lifecycle) | CoQui's own state machine | `AssessmentItem.status` and `ItemInstance.status`, four values each (Section 7.7), mapped at CoQui's boundary |
| The **craft grid** (criteria a reviewer judges) | A matrix of claims per item | `Attestation.claimRef` (CoQui's own criterion identifier) and `claimText` (its wording); one attestation per reviewer, part and claim |
| A reviewer's **concern** | A note with a lifecycle | A `DesignFinding` with a deterministic identifier (`DesignFinding/coqui-<noteId>`), `Dismissed` with a rationale when withdrawn |
| The **reason** for a revision | Free text on the version | The commit `message`, plus a `DesignNote` when it should be addressable |
| **Reviewers** | People, and the drafting agent | `User` documents registered once; the agent as `agent:coqui/item-drafter` |
| **Discussion** (who said what, when) | CoQui's event log | Never crosses (ADR-0021) |

Three habits make a mapping robust: write **projections, never replays** (derive the current outcome from your state and upsert it, so a retry or a backfill is one write); mint **deterministic identifiers** so your record and the hub's are the same thing twice; and **read back at the commit you wrote**, so what your users see is what the hub holds.

Three more mappings, for tools that build courses, draw from question banks or deliver items, are research notes in `docs/research/` (`tessera-mapping.md`, `dq-questionbank-mapping.md`, `quiqui-mapping.md`).

### 13. Worked examples

#### 13.1 A module declares an objective, with a note on the declaration

Any tool writes declarations through the generic routes, as it writes any other relationship (ADR-0007). Because `ModuleObjective`'s identifier is derived from its key fields, a request that creates one and annotates it in the same commit uses `@capture` and `@ref`:

```ts
const { data, commit } = await hub.documents.batch({
  branch: 'curriculum-review',
  message: 'Declare limitations as a supporting objective of the how-AI-works module',
  documents: [
    { '@type': 'ModuleObjective', '@capture': 'decl',
      module: 'Module/how-ai-works', references: 'LearningObjective/identify-ai-limitations',
      role: 'Supporting', roleRationale: 'Introduced here, assessed fully in module 3' },
    { '@type': 'DesignNote', label: 'Why supporting',
      rationale: 'SMEs wanted limitations previewed before the ethics module',
      subject: [{ '@ref': 'decl' }], category: 'SequencingDecision' },
  ],
});
// data.ids holds both identifiers in input order; the declaration's was minted by the hub
```

#### 13.2 Importing an administration's results

An outcomes importer writes the dataset and its metrics in one batch. The dataset names the assessment it came from (`producedBy`) or an external reference to where it lives (rule 20); its `asOf` is the commit the delivered assessment was built from, which a course builder stamps into its package (ADR-0057). Each metric names what it measures in `subject` and is derived from the dataset, whose `asOf` it inherits:

```ts
await hub.documents.batch({
  message: 'Import the fall administration of the module 3 quiz',
  documents: [
    { '@type': 'LearningDataset', '@id': 'LearningDataset/fall-mod3-quiz', '@capture': 'ds',
      label: 'Module 3 quiz, fall cohort', cohort: 'Fall 2026', administrationDate: '2026-11-20',
      producedBy: 'Assessment/mod3-assessment', asOf: deliveredCommit,
      externalRefs: [{ '@type': 'ExternalRef', system: 'xAPI', identifier: 'https://lrs.example.edu/statements?activity=…' }] },
    { '@type': 'LearningMetric', '@id': 'LearningMetric/fall-bias-type-difficulty',
      label: 'Item difficulty: bias-type item, fall', subject: 'AssessmentItem/bias-type-mc',
      derivedFrom: { '@ref': 'ds' }, value: 0.62, unit: 'proportion correct',
      collectedAt: '2026-11-21T09:00:00Z', source: 'LMS item analysis export' },
  ],
});
```

The seed holds one such administration (`LearningDataset/mod3-spring-pilot` and three metrics), so the trace below walks on `main`. Field names are in the [appendix](SCHEMA_APPENDIX.md); the hub's 400 names any you get wrong, by path.

#### 13.3 A prerequisite you cannot write yet (ADR-0011)

If the prerequisite objective exists only as an idea, create it as a draft objective first, then the record:

```ts
await hub.documents.put('LearningObjective', 'tbd-prereq-x', {
  branch, message: 'Hold a place for the statistics prerequisite',
  document: { label: 'TBD: prerequisite for distinguishing AI approaches', state: 'Draft' },
});
await hub.documents.batch({
  branch, message: 'Record the soft prerequisite the pilot showed',
  documents: [{ '@type': 'PrerequisiteRecord', label: 'Basic statistics before AI approaches',
    objective: 'LearningObjective/distinguish-ai-approaches', prerequisite: 'LearningObjective/tbd-prereq-x',
    prerequisiteType: 'Soft', rationale: 'Learners struggled with probability language in the pilot' }],
});
```

If even a draft objective is premature, record a `DesignNote` with `category: 'PrerequisiteIntent'` about the objective instead.

#### 13.4 Tracing a result back to the design

```ts
const trace = await hub.intelligence.trace('LearningMetric', 'mod3-bias-type-difficulty');
const asOf = trace.data.nodes.find((n) => n.id === 'LearningDataset/mod3-spring-pilot')?.asOf;
const then = await hub.intelligence.coverage('risks-and-ethics', { ref: asOf });
```

The trace returns the dataset, assessment, items, objectives, needs and evidence the metric connects to, the modules that declare those objectives, and every note, finding and attestation about them. The coverage read at the dataset's `asOf` is the module's coverage as that cohort met it; in the seed it says *Distinguish Bias Types* was partially assessed then, and the same read without a ref says fully assessed now, since the designer added a second item after the pilot (the finding that explains why is among the annotations). See [How Armature Works](how-armature-works.md#174-trace-follow-the-chain-from-evidence-to-outcomes).

### 14. For research: what leaves the hub

A learning scientist's tool reads the graph out whole: `export.read({ ref, profile, slice })` returns the graph at a commit as one JSON-LD document with its reloadable schema (ADR-0031). A **profile** rewrites people only (`full`, `pseudonymous` with stable tokens when the hub has an export key, `institutional`); a **slice** is a named list of classes (`export.slices()`), with every reference that leaves the slice reported as `unresolved` and never dropped. Free text is not scrubbed. The hub never lists documents by who made them, so questions about people are asked of the export, under the study's own rules, not of the API (ADR-0021). [`research-path.md`](research-path.md) walks a study through it.

### 15. Discovering the hub and the schema at runtime

A tool need not carry a copy of `schema.json`. `hub.discover()` returns the contract revisions the hub serves, newest first, and its capabilities with their settings (the coverage thresholds, the batch limit). `hub.schema({ ref })` returns the schema graph at a commit, every class with its category, fields and documentation, in the form the store reloads (ADR-0027).

The contract has dated **revisions**: each dated entry in [`client-changes.md`](client-changes.md) is one, and they are additive. The client sends the revision it was written against on every call (`Armature-Version`); a hub that does not serve it refuses by name, except that a hub *older* than the tool serves reads and refuses writes, so a tool ahead of its hub can look but stops before its first commit. A tool that relies on a feature names it (`capabilities: ['armature/intelligence.coverage']`) to be refused by name when a hub lacks it. Both are optional; a tool that sends neither is served as before (ADR-0059).

### 16. When the schema does not fit

The schema will not have a slot for everything your tool knows. In order of preference:

1. **Keep it in the tool.** If it is workflow, interface, discourse or operational state, it was never meant to cross (Section 12).
2. **Use the free-text homes.** A `DesignNote` about any record, with a `category`; a finding's `finding` text; a relationship's `rationale`. These fields are provisional on purpose, and real text in them is the evidence a structured field would later be built from (ADR-0010).
3. **Point outward.** An identifier in your system or a standard's is an `ExternalRef`; a file is an `Attachment` (Section 7.12). Both exist so the graph can name what it does not hold.
4. **Ask for a change.** Say what your tool needs and what a *second*, different tool would need it for. A change to the schema is an ADR first (`schema/docs/adr/`), then the generators (`npm run generate:types`), then a validator for any rule the database cannot express, then the appendix; the maintainers' checklist is in `.claude/CLAUDE.md`. Watch [`client-changes.md`](client-changes.md) for what lands.

What never changes for a tool's convenience: a stored derived value (Section 7.10), a per-tool field, a nested identifier made addressable, a write that skips identity or the rules.

### 17. Things never to do

- **Never store a nested identifier** (`AssessmentItem/x/options/0/ItemOption/...`). Parts are `{ item @id, fragmentId }`; references and attachments have no identity at all.
- **Never regenerate a `fragmentId`**, derive it from position, or reuse a retired one.
- **Never send `createdBy` or `attestedBy`** expecting them to be kept; they come from the caller's identity.
- **Never store coverage, alignment or any score** in a document; read it at a ref.
- **Never treat a typed reference as checked by the database**; the hub checks it, and `reference_class` is the refusal.
- **Never assume an empty set is present**; read `field ?? []`.
- **Never write to `main` without `ifMatch`** when anything else might be writing there.
- **Never talk to TerminusDB.** Nothing a tool needs is behind the hub; what the hub does not offer is a question for the project, not a reason to go around it.
