# ADR-0064: Lesson, an Ordered Set of Activities

> **In brief.** This decision renames the class that holds an ordered set of learning
> activities. It was called `ActivityGroup`, a name that describes its shape; it is now
> `Lesson`, the name instructional designers give the thing: what a module schedules, as it
> schedules an assessment, which is an ordered set of items. Nothing about the record changes
> except its name and the names of the two link records around it. (ADR stands for
> Architecture Decision Record.)

## Status

Accepted and implemented (2026-10-22). Annotates ADR-0005 (module content sequencing), whose
mechanism is unchanged, and ADR-0003 (junction naming). Breaking for stored data at the level
of a class name; at demonstration scale a reload (`load_schema.js --clear-instances`, then
the seed).

## Context

The schema has held an `ActivityGroup` since ADR-0005: "a reusable, named collection of
LearningActivities with a defined pedagogical sequence," placed in a module by
`ModuleActivityGroupLink` with a module-level `sequence`, its members placed by
`ActivityGroupMember` with a sequence of their own, and deliberately flat (constraint 6). The
name was never discussed; ADR-0005 is about the two sequence namespaces.

Reviewing the first build of the Design Graph (`docs/graph-view-plan.md`, 2026-10-22) put the
record beside its peer. A module holds two kinds of ordered container: an `Assessment`, an
ordered set of items, and this record, an ordered set of activities. Drawn in one column
under one header, the pair asked for a parallel name, and "group" was the one word in the
schema that names a container by its shape rather than its role.

Candidates considered:

- **Lesson.** The common hierarchy in curriculum design and in most delivery platforms is
  course → module → lesson → activity, and "lesson" names exactly this: a designed sequence
  of activities that a module schedules and that can be reused. It reads as the peer of
  "assessment" in prose and on the page. Its other sense, a timed teaching session, is a
  risk; the schema carries no time, and the class documentation says so.
- **ActivitySequence.** Accurate and neutral, but it names the mechanism rather than the
  thing, as "ItemSequence" would for an assessment.
- **Session.** Implies delivery and time, which the design graph does not model.
- **Unit.** Usually sits above a module; it would mislead.
- **Keep `ActivityGroup`.** Costs nothing now and is honest about the shape.

## Decision

1. `ActivityGroup` is renamed **`Lesson`**: a reusable, named, ordered set of learning
   activities that a module schedules. Its documentation states that a lesson is a designed
   sequence, not a timetable slot.
2. `ActivityGroupMember` is renamed **`LessonActivityLink`**, with its `group` field renamed
   `lesson`; the Hash key is over `(lesson, activity)`. It follows ADR-0003's junction naming
   (both sides, as `ActivityItemLink` and `ModuleActivityLink` do).
3. `ModuleActivityGroupLink` is renamed **`ModuleLessonLink`**, with its `group` field renamed
   `lesson`; the Hash key is over `(module, lesson)`.
4. The constraints keep their numbers and their meaning: 3 (one sequence namespace across
   `ModuleActivityLink` and `ModuleLessonLink` in a module), 4 (unique `sequence` within a
   lesson), 6 (lessons are flat, since `LessonActivityLink.activity` is a `LearningActivity`).
5. The module-content read (`GET /api/v1/intelligence/module-content/:moduleId`, ADR-0005)
   says `kind: "lesson"`, names the record in `lesson`, and counts `summary.lessons`; the link
   that placed an activity is a `ModuleActivityLink` or a `LessonActivityLink`.
   `@armature/client`'s types follow. The change rides the `2026-10-22` revision
   (ADR-0059): a client reading that revision reads the new names.
6. No other semantics change: a lesson is still content in ADR-0005's sense and an assessment
   still is not; coverage (ADR-0029) is untouched; formative use (ADR-0061) is untouched.

## Alternatives considered

Keeping the class and adding a `@label` of "Lesson" for display only. Declined: a client reads
the class name in every document and every route, and two names for one thing is the
confusion this decision removes.

## Platform checks

None. A class rename relies on no store behavior the earlier decisions did not; the schema
loads as before (`load_schema.js`), and the reload with `--clear-instances` is the documented
path for a breaking change at demonstration scale (ADR-0022). For a store with real data, a
rename is operator work through the adapter's operator-side methods (ADR-0031 decision 4,
ADR-0062): export at a commit, rewrite the three `@type` values and the two field names in the
documents, load the new schema into an empty branch, post the documents. No migration route is
added to the API.

## Consequences

- The vocabulary matches the field's: a module holds lessons and assessments; the Design
  Graph's column reads "Assessments and lessons" with the class it names.
- Every document that names the old classes is invalid against the new schema. At this stage
  that is the seed, reloaded; CoQui, the one real client, never writes activities or lessons.
- Three class names and two field names change in the schema, the generated types, the
  invariants engine, the module-content and trace reads, the client's types, the seed, the
  tests and the documentation. Historical records (earlier ADRs, `client-changes.md` entries
  before this date, the retired demo API specification, the research mappings) keep the old
  names; this ADR is the key to reading them.
