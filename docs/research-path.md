# The research path: standing up a constrained Armature for one study

This guide is for a learning scientist who wants to use Armature as a data-collection instrument for one study: to record how a design was made, export the record in a form that can be shared and compared, and let others reproduce it. It assumes you can run Docker and read JSON. It does not assume you know TerminusDB (the graph database underneath) or have read the rest of the documentation; where a decision matters, it points at the Architecture Decision Record (ADR) that made it.

What Armature records is the **design process as data**: the artifacts (needs, objectives, items, activities, modules), the relationships between them with their rationale, the review verdicts on them, and the measurements that came back, all in a history where every change has an author and a reason (ADR-0025). What it never records is anyone's performance (ADR-0021): there is no field, read or export that summarizes one person's work, and a study built on Armature inherits that norm.

## 1. Stand up an instance

1. Clone the repository and start an instance (the root `README.md`, "Getting started"; `deployment.md` for a server): the database in Docker and the hub, the API (application programming interface) in front of it, either on your machine with `npm run start:hub` in `app/` or as the compose file's container. Load the schema.
2. Decide whether to start from the demonstration course or empty. The seed (`node scripts/seed_data.js`) is a fictional course with one administration's results, useful for learning the shape. A study starts empty: load the schema and register its participants.
3. Register every participant as a `User` on `main` through `POST /api/v1/users` (ADR-0032). Participants are the people whose decisions the study records: designers, reviewers, and any AI agent acting on their behalf (an `externalId` beginning with `agent:`). Record `institution` if the institutional export profile will be used (§4).
4. Keep the hub where only the study's tools reach it. The default identity resolver, `header`, trusts the `Armature-User` header naming the user (ADR-0032 decision 1), so the hub stays on the server's loopback or the compose file's private network, which publishes only the read-only viewer; since 2026-10-30 it also refuses requests for host names it does not serve and from web origins it has not been told about (ADR-0067 decision 7). The study's tools therefore write from the server itself today. For tools that write from other machines, the `oidc` resolver is specified in ADR-0067 (accepted 2026-10-30; its `Host` and `Origin` checks built) and not otherwise built yet. `deployment.md`, "Who can do what", says who reaches what.

One database holds one course or program today; comparability across courses is an open question (`docs/development-plan.md` §6, "Project boundaries"), and for now a multi-course study is one database per course exported separately.

## 2. Decide what the study records

The schema (`docs/schema-guide.md`) is the instrument's codebook. Three things to settle before collection starts:

- **Which tools write.** Nothing is written by hand; tools write through the API as a byproduct of use. CoQui (review of items in rounds) writes items, findings and attestations; a curriculum mapper writes objectives, prerequisites and module declarations; an outcomes importer writes datasets and metrics. If the study's tool does not exist yet, its writes are ordinary documents through `PUT` and `POST /api/v1/documents` with a `message` saying why (`docs/api.md`).
- **What counts as a decision.** The graph holds decisions in three places: fields on the records themselves (a prerequisite's `rationale`, a declaration's `roleRationale`), `DesignNote`s about any record or part, and the commit messages. A study that wants rationale should make sure its tool asks for it at the moment of the decision; Armature will store it, not elicit it.
- **Rounds and branches.** Parallel work (a review round, an alternative design) happens on a branch and is merged, with the merge recorded (ADR-0025). A study of review can read each round's branch at its own commits.

Measurements come in through `LearningDataset` (one administration of an assessment) and `LearningMetric` (one measurement, with the record it is about in `subject`). Both must name their source: the assessment inside Armature that produced them, or a reference to the outside system they came from (constraint 20, ADR-0063). Each carries `asOf`, the commit the cohort met, so "coverage as delivered" is a read at that commit (ADR-0057).

## 3. Declare the slice

An export can carry the whole graph or a **slice**: a named list of classes in `app/lib/api/export/slices.json` (ADR-0031). Three ship:

| Slice | What it holds | For |
|---|---|---|
| `full` | Everything | Reproduction; handing a course to another institution |
| `outcomes-loop` | Evidence, needs, objectives, prerequisites, items, placements, assessments, modules, declarations, the course, datasets, metrics, users | The needs-to-objectives-to-outcomes path |
| `review` | Items with the findings, notes and attestations about them, and their authors | How review happens |

A study's slice is a new entry, by pull request: a description and the class names. A document is included when its type is one of the names or inherits one. A slice is not closed under references: a metric's subject or a note's subject can name a record outside the slice, and the export lists every such reference under `armature.unresolved` rather than dropping anything. Only the `full` slice reproduces a graph when re-imported. Check the unresolved list on a trial export before collection starts; it tells you which classes the study's questions actually reach.

## 4. Decide the profile

A **profile** says what happens to people in the export (ADR-0031, ADR-0021):

- `full`: people as stored. For reuse within the institution or by a partner who needs to know whom to ask.
- `pseudonymous`: every `User` becomes an opaque token and every reference to a person is rewritten to it; nothing else about the person is kept. For a research corpus.
- `institutional`: the token plus `institution`. Keeps "verified by an expert at Memorial Health" without the person.

Set `ARMATURE_EXPORT_KEY` in `app/.env.local` before the first export and keep it for the life of the study: the token is a keyed hash of the user's id, so with the same key the same person is the same token in every export, and exports taken months apart can be joined. Without the key each export mints its own tokens and says so (`pseudonyms: "per-export"`). The key is a secret of the instance; it never appears in an export.

Two limits the profiles do not remove, and the study design must: **free text is not scrubbed** (a rationale that names a colleague names them in the export), and **small teams are re-identifiable from context** (with three designers on a course, a pseudonym is a thin veil). Say so in the data management plan, and read a trial export for names before sharing one.

## 5. Export

```
GET /api/v1/export?ref=<commit>&profile=pseudonymous&slice=<name>
```

Read the commit to export at from any response's `ETag`, or from `GET /api/v1/branches/main`. Pin it: an export at `ref=` is reproducible as long as the instance exists, because history is never rewritten (ADR-0025 decision 6). The file carries its own pin in `armature.ref`, the schema it obeys in `schema`, the counts by type and the unresolved references. Keep the file and its commit together with the study's materials; the schema inside it is what a reader needs to understand the documents, and `docs/SCHEMA_APPENDIX.md` at the matching repository commit is the human-readable version.

The export is JSON-LD in the database's own shape. It does not yet speak PROV-O, Web Annotation or LRMI vocabularies in its context (ADR-0031 §Open); the ADR records the mapping a reader applies.

## 6. Reproduce

Reproduction is an operator step, not an API call (ADR-0031 decision 4, ADR-0062): the API's write path would set authorship from the caller and refuse the source instance's commit ids. To stand the exported graph up elsewhere:

1. Create an empty database (or an empty branch in an existing one) in TerminusDB.
2. Load the export's `schema` into it as the schema graph.
3. Post the export's `documents` in one request.

The integration test `app/lib/api/export.test.ts` ("reproduction") does exactly this through the adapter and checks the result exports again as the same graph. A reproduced graph is a copy of a state, not a continuation of a history: its commit log is one commit, and its records' `asOf` values still name commits of the source instance.

## 7. Ask process questions, not person questions

The graph answers questions about how design happens: how often subject experts decline a designer's claim about an item; how many items an objective had when a cohort first met it; whether objectives with evidence behind them are assessed more fully than those without; how coverage changed between two rounds. The reads in `docs/api.md` ("Design intelligence") answer the structural ones at any commit; the export answers the rest offline.

The same questions narrowed to one person are out of scope by decision (ADR-0021): Armature offers no per-person aggregate, the list route refuses to filter by author, and a study built on it should not derive one either. The reason is not only ethical. Candor is the data: a reviewer who knows their declines are counted declines less, and the instrument then measures its own effect.

## 8. What is not there yet

- **History in the export.** An export is a state at a commit. A question about process over time is answered today by exporting at several commits, or by reading `GET /api/v1/documents/:type/:id/history` per record.
- **A branch's commit log.** The API serves a document's history, not a branch's log of commits with their authors, messages and times, so a question about the order and pace of decisions on a branch is answered today by an operator reading the store, or record by record. `GET /api/v1/branches/:name/log` is proposed in `docs/workspace-hub-plan.md` §12, with this reading of the design process as its second client.
- **Hash verification.** An attachment reference carries a content hash (ADR-0030) but the hub does not fetch or verify bytes; a study that depends on an image being the one reviewed verifies it in the store it lives in.
- **A packaging convention** (checksum of the export, a citation, the repository commit): open (ADR-0031 §Open). Until then, record the export's `armature.ref`, the repository commit, and a checksum of the file alongside it.
- **Cross-course comparability** in one database: open (plan §6).

## Checklist

- [ ] Instance running, schema loaded, participants registered with `institution`
- [ ] `ARMATURE_EXPORT_KEY` set and kept
- [ ] The study's tools write through the API, with a reason on every write
- [ ] Datasets and metrics name their source (`producedBy` or an external reference)
- [ ] Slice declared and trial-exported; `unresolved` understood
- [ ] Profile chosen; a trial export read for names in free text
- [ ] Export at a pinned commit; file, commit and repository commit kept together
