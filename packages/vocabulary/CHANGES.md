# Changes to the vocabulary

Every change of a name or a status in `vocabulary.json`, newest first. Each entry's date is the file's `revision`. A change here changes no hub behavior, so it is not a client revision: `docs/client-changes.md` and the hub's `REVISIONS` are untouched (ADR-0073 decision 7).

A term's `id` is never renamed. When a name is chosen differently, its entry here gives the id, the old name and the new one, so a tool keyed on ids changes only the word.

## 2026-11-19

The first file, seeded from `docs/naming-vocabulary.md` as Amos decided it on 2026-11-18 (ADR-0073 decision 8 and its note of that day).

- **Terms:** 194, every one `chosen`: the shared rows of the document's §§4 to 15, and the words the document gives for five refusal codes (`bring_in_first`, `not_registered`, `profile_changed`, `unsupported_version`, and `remote_unreachable` as the state "<instance> cannot be reached").
- **Names that wait on ADR-0072** carry `until`. Two have a name for until then: "Open merge request into <branch>" is "Merge into main", and "the merge request's health" is "Preview merge". The other ten have none, since the thing does not exist yet: linking and unlinking a workspace, a merge request and closing one. "Clone a branch" is the reverse case, a label that stays until ADR-0072 is built and then goes. "Revert" and "Start over from <parent>" are held for actions not built.
- **Reserved words:** 34, the enumeration values a person reads, each for the term of its kind: objective states, item statuses, three item types, a sign-off's verdicts, a check's results and levels, a merge request's statuses and health, the two coverage figures and the three privacy levels.
- **Avoided words:** 66, from the document's collisions, its principles and its §17.
- Nothing from the document's §16 (Quiver's own words) beyond the avoided entries its rows create.

Later the same day, from Quiver's request for a §16 row (`docs/vocabulary-handoff-from-quiver.md`); no name or status changed, so the revision stands:

- **`set aside`** gains the forms "set it aside", "set them aside" and "set these aside", so that a label with a word inside the phrase, as Quiver's "Set these aside" was, is found. Quiver now says **Shelve** and **Put back** for that step (the document's §16); neither is a term, since no Armature surface names the step.
- **`discarded-folder`**'s `means` no longer uses "set aside" itself: "Where a discarded workspace's files are copied before its branch is deleted."
