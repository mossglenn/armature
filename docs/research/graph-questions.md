# Armature: Graph Questions

Oct 28, 2026 · Amos Glenn, with Claude

> **Status (2026-10-28).** A dated research snapshot: a catalogue of graph questions plugins might ask, collected as input for a path read's ADR (`docs/demo-coverage.md`, § Graph-native intelligence). It is not a decision and changes nothing in the API. ADR-0062 decision 6 still declines a raw query route on `/api/v1`, and this document keeps that position; it records what a safe alternative would have to answer.

Abbreviations: ADR (Architecture Decision Record), API (application programming interface), CASE (Competencies and Academic Standards Exchange), WOQL (TerminusDB's query language).

## Why collect questions

The question was whether `/api/v1` should accept graph query strings, checked to be read-only and within the API's rules, so plugins could ask new questions without an API change. The answer was no, for the reasons ADR-0062 decision 6 gives and four more found on 2026-10-28:

- **Read-only is the easy check; the read rules are about meaning.** The non-aggregation guard (ADR-0021), the export profiles that replace people's names, and declared slices (ADR-0031) concern what a question computes, which inspecting a query string cannot reliably decide. An allow-list strict enough to be safe becomes a query language of its own.
- **It would break "every hub serves the same API".** The workspace hub's file-backed store (`docs/workspace-hub-plan.md` §10) has no WOQL, so a plugin built on raw queries would fail on a workspace hub, and WOQL would become part of the contract.
- **It leaks what the API hides** (store IRIs and prefixes, nested subdocument ids, the store's shape instead of the API's envelopes; ADR-0023, ADR-0025 decision 7), and its meaning would change with each store release and schema change, which ADR-0059's versioning cannot shield.
- **It skips the two-client test.** Each plugin would keep private queries, and the hub would never learn which questions matter.

Collecting the questions anyway shows which shapes recur, which the API already answers, and what a safe mechanism must support.

## Notation

`→field` follows a reference forward; `←field` follows it backward (the records whose `field` names this one). `Item ←implements ItemInstance` is every placement of the item. Class and field names are the schema's (`schema/schema.json`).

## The catalogue

### A. Fixed paths: several hops, known in advance

1. Every item that assesses an objective the module declares: `Module ←module ModuleObjective →references LearningObjective ←assesses AssessmentItem`
2. Every module that places an item: `AssessmentItem ←implements ItemInstance →assessment Assessment →module Module`
3. The evidence behind an item, with confidence: `AssessmentItem →assesses LearningObjective →generatedBy LearningNeed ←need NeedEvidenceLink →evidence LearningEvidence`
4. Every metric about the items in a module: `Module ←module Assessment ←assessment ItemInstance →implements AssessmentItem ←subject LearningMetric`
5. Every activity that practices what an item assesses: `AssessmentItem →assesses LearningObjective ←targets LearningActivity`
6. The lessons holding activities for an objective: `LearningObjective ←targets LearningActivity ←activity LessonActivityLink →lesson Lesson`
7. Every course that relies on a piece of evidence: `LearningEvidence ←evidence NeedEvidenceLink →need LearningNeed ←generatedBy LearningObjective ←references ModuleObjective →module Module →course Course`
8. Every finding about anything in a module: the records reached from the module, each then `←subject DesignFinding`

### B. Closures: paths of unknown length

9. All of an objective's prerequisites, direct and indirect (`PrerequisiteRecord` followed repeatedly)
10. Everything that depends on an objective: the same walk backward
11. Prerequisite cycles
12. The longest prerequisite chain in a course
13. Whether A is a prerequisite of B at any depth

### C. Something missing

14. Declared objectives with no item placed in the module's assessments
15. Objectives assessed but never practiced: items, no activity
16. Objectives practiced but never assessed
17. Needs that generated no objective; evidence linked to no need
18. Objectives assessed in a module before their prerequisite's module
19. Placed items with no attestation at all
20. Open findings whose subject changed after the finding's `asOf`, which may already be addressed

### D. Conditions on fields along a path

21. Items at a lower Bloom's level than the objective they assess
22. Prerequisites at a higher Bloom's level than the objective that needs them
23. Approved placements of items now Retired (the merge route's gap, Quiver's scenarios 7 and 8)
24. Needs backed only by Low-confidence evidence, and the objectives resting on them
25. Objectives whose only items are Draft

### E. Across time

26. Every connection an objective ever had: when it was made, by whom, with what message
27. The order records were created in: objectives, then items, then activities (backward design)
28. Items edited after they were attested
29. Design changes between two administrations that touched the items their results measured
30. Objectives whose coverage changed between two commits
31. Churn: records changed and then changed back

### F. Whole-graph algorithms

32. Bridges: items whose retirement leaves an objective uncovered
33. Centrality: the objectives most paths from needs to items pass through
34. Clusters of objectives, compared with module boundaries
35. Items with nearly identical neighborhoods (structural duplicates, part of the deferred redundancy detection, within P4)

### G. Questions that must be refused

Negative test cases for any mechanism, each a per-person aggregate ADR-0021 keeps out of the hub:

36. How many items did each person write or attest?
37. Whose attestations go stale most often?
38. Which designer's modules have the lowest coverage (by `createdBy`)?

The refusal is friction, not a barrier (ADR-0021 decision 3): a plugin could count from an export itself. The hub's part is never to make the tally its own answer.

## What the API already answers

| Question | Read |
|---|---|
| 3, and much of 7 | `GET /intelligence/trace/:type/:id` |
| 10 | `GET /intelligence/impact/:type/:id` |
| 14, 30 | `GET /intelligence/coverage/:moduleId`, at one ref or two |
| 15, 21; 16 in part | `GET /intelligence/alignment` (`objectivesWithoutActivity`; `itemsBelowObjective`; `objectivesWithoutItemAtLevel`, which counts an objective with items below its level as well as one with none) |
| 28 | `GET /intelligence/attestations/:type/:id` (staleness by fragment) |
| 26, 29, 31, in part | `GET /documents/:type/:id/history` and `GET /branches/:name/changes?since=` |

## Shapes, and what answers each

| Shape | Answered by | New in the API |
|---|---|---|
| A. Fixed paths | A path read | One capability |
| B. Closures | A path read with a repeated step and a depth limit | (the same) |
| C. Something missing | A path read with a "no such step" condition, beside the existing reads | (the same) |
| D. Field conditions | A path read with filters on enum and status fields at each step | (the same) |
| E. Across time | History, changes since and reads at a commit, combined in the plugin | Nothing |
| F. Algorithms | `GET /export` at a commit and a graph library in the plugin | Nothing |
| G. Refused | A path read with no step through a field targeting `User` and no grouping | (the same) |

Shapes A to D, more than half the catalogue, need one new capability with four features: forward steps, backward steps, a bounded repetition, and filters. E and F need nothing new.

## Two ways to offer paths

- **Declared paths.** Named paths in configuration on the hub, as slices are in `slices.json`. A new path is a configuration change, not an API change, but a plugin's author asks whoever runs the hub.
- **Paths in the request.** The plugin sends the path in a small fixed grammar: steps are the schema's reference fields, forward or backward; a repetition carries a depth limit; filters apply to enum and status fields; there is no grouping or counting; no step passes through a field targeting `User`. This gives plugins room without API changes. It is safe because every step is checked against the schema and the grammar cannot express a per-person tally, so G is refused by construction rather than by analyzing what a query means. It runs in the hub's code, so it works on any store, the workspace hub's file-backed one included, and it is versioned as one capability (ADR-0059).

Either is a constrained traversal the API defines, which is what separates it from a query string whose effect the hub must guess. The choice between them, the grammar's exact steps and limits, and whether a request path may reach a filter on `createdBy` (a `User` field, so refused under the list route's rule) are the ADR's questions when the first graph-native plugin is built (Whyfinder, Lint, Ripple or the Response tracker, which share the path shape).

If a richer query language is ever justified by evidence, the safe form is one the hub defines over Armature's own model, such as a GraphQL schema generated from `schema.json` and served through the adapter, never the store's language passed through.
