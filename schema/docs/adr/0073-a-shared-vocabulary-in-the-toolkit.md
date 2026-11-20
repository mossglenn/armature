# ADR-0073: A Shared Vocabulary in the Toolkit, With Reserved and Avoided Words

> **In brief.** Every tool built on Armature names the same things for the same people: a workspace,
> a commit, a merge request, a refusal. Today those names live in one working document in this
> repository (`docs/naming-vocabulary.md`). Each tool can only copy from it by hand, and copies drift.
> This decision puts the names in the toolkit, beside `@armature/types` and `@armature/client`, as a
> new package, `@armature/vocabulary`. One JSON file holds three lists. **Terms** give each shared
> concept its name and a status: recommended, chosen or kept. **Reserved words** each hold one
> meaning across Armature and every tool. **Avoided words** are words deliberately not used for a
> concept or an audience, each with the word to use instead and why: "save" is avoided for a commit,
> which is called a commit, while settings may still be saved. The working document keeps the
> reasoning, and a check in CI fails when it and the file disagree. A tool that updates its Armature
> dependency gets the current words, with no one copying anything. Accepted on 18 November 2026,
> its five open questions decided as recommended; nothing is built.

## Status

Accepted (2026-11-18, Amos). Proposed the same day, drafted at Amos's request after the review of
`docs/naming-vocabulary.md` (PR #178), when he asked for the vocabulary to sit in the toolkit, with
a way to track reserved words and words purposefully avoided. Amos decided the five open questions
the same day, each as recommended (decisions 1, 2 and 6, and §Alternatives for question 5), before
accepting the record. Not built.

> **Note (2026-11-19): built**, as decided: the package, its schema, the two functions, the check in
> CI's first job with the report over Armature's own pages, the tests of §Verification and the
> install check. The first file holds 194 terms, 34 reserved words and 66 avoided words, every term
> `chosen`. Building settled these points, each open to overrule:
>
> - **The file's shape has six fields the tables of decisions 2 to 4 do not list.** A term may have
>   `also`, the other rows where the document chooses the same name ("commit" has three rows). A
>   term's `row` may carry `"in": "recommended"`, for a refusal code's words, which the document gives
>   in a Recommended cell and not as a row's chosen name. `until` may give a condition in words
>   (`when`) where no ADR is waited on ("Revert", if an undo is built), and may lack a `name`: the
>   concept then does not exist until the decision is built, and nothing is shown (linking a
>   workspace). A reserved word may have a `row` and `identifiers` (`ItemStatus.InReview` for "In
>   review"). An avoided word's forms are a list, `forms`, beside `word`.
> - **The words held for a planned concept are terms, not reserved entries** (decision 3 named
>   `proposal`, `Revert` and `level` as reserved). An avoided entry's `use` must name a term, and
>   "draft", "restore" and "verdict" each point at one of them. The reserved list is the enumeration
>   values a person reads. `operator` is a term for administrators and developers and an avoided word
>   for people, as decision 3 says.
> - **How a term meets its row (decision 5).** A Chosen cell may hold several names and a few
>   connecting words ("Merge into main until requests are built"). A term's name must appear in its
>   row's cell whole, a placeholder standing as itself or as the document's example of it (`<parent>`
>   as "main"), and once every claimed name is taken out, only a short list of connecting words kept
>   in the script may remain. So a name changed, added or dropped on either side alone fails. A term
>   may instead be named for its row's Concept cell when the cell lists its values ("item status" over
>   "Draft, In review, Approved, Retired", each value a reserved word citing the row). The document
>   was not edited to fit: no Chosen cell changed.
> - **`isReserved` answers a list, or null for a free word**, since a word may be held for two terms
>   (`Draft` is an item status and an objective state) and an empty list would pass a plain test.
> - **`findAvoided` leaves an avoided word inside a term's own name**: "design note" is not a
>   "note", nor "API revision" a "revision".
> - **No dependency anywhere.** The tests run under Node's own test runner, and the script and the
>   tests import the package's TypeScript source as it is (Node 22.18 or later). The check validates
>   the file with a validator of its own for the keywords the schema uses; a keyword it does not know
>   is an error. The pages are parsed with the workspace's TypeScript.
> - **The report's first run** found 264 avoided words on Armature's own pages (158 on the desktop
>   app's, 81 in the core's messages, 25 on the viewer's), led by "remote", "program" and "deliver".
>   The list of files held to the vocabulary (`BROUGHT`, in the script) is empty, so the report fails
>   nothing yet.
>
> Left: the one line in Quiver's and CoQui's `CLAUDE.md` (Consequences), once this is on `main`.

> **Note (2026-11-19, later): Armature's own surfaces are brought to the vocabulary** (decision 6).
> The desktop app's pages and components, the desktop core's messages and the viewer's pages were
> reworded together, 264 findings to none, so the check's list holds all three folders and a
> finding in any of them fails CI. The list takes a folder as well as a file. An allowed use
> carries its marker with the reason beside it: settings and `checks.json` are saved, a branch or a
> record is deleted on the instance, "Delivered" is the coverage figure. The desktop shell now
> depends on the package (`desktop/package.json`) and takes the words for four refusal codes from
> it (`RefusalNotice.tsx`), the first place the app stops being a separate copy (Consequences).
> The pages name the instance by its own name, from the settings the core already sends. Not
> brought, and outside the three surfaces the check reads: the messages of the hub's own workspace
> routes, which a page shows as given, and the shell's diagnostic lines.

It changes no schema and no route, and the hub never reads the vocabulary, so it needs no platform
check, no client revision and no entry in `docs/client-changes.md` (§Decision 7). It adds a third
package to the npm workspace built in Phase 7 (`docs/development-plan.md`, Phase 7: "tools-first
needs a toolkit").

When the package is built, `docs/naming-vocabulary.md` gains a banner saying the names in force are
the package's, and that the document is the reasoning behind them (decision 5); until then its
status line names this record. No ADR is annotated: the
vocabulary is not a capability under ADR-0059, since no hub serves it (§Alternatives).

## Context

**One concept goes by several names.** The working document found 23 collisions across the
desktop program's pages, the viewer, the guides, the plans and Quiver: the shared server called
"your instance" on one page and "the remote" on the next; "deliver" for a merge that designers read
as teaching a course; "verdict" for a check's outcome, an attestation's judgment and a coverage
level. Each tool met the problem alone, and each would meet it again.

**The tools already share a dependency.** Phase 7 built the toolkit as an npm workspace:
`@armature/types` (the schema as TypeScript and Zod, generated from `schema/schema.json`) and
`@armature/client` (every route as a typed function). Quiver, CoQui and the planned Model Context
Protocol (MCP) server take them by git reference, and CI's install check proves a separate
repository can (`packages/client/install-check/`). Whatever the toolkit carries reaches every tool
when it updates.

**Copies drift; generated files with a drift check do not.** The repository already keeps one
source and checks everything derived from it: `schema/schema.json` produces `types.ts`, `schemas.ts`
and `SCHEMA_APPENDIX.md`, and `npm run check:types` fails in CI when they disagree. A vocabulary
copied into each tool's documents would have no such check.

**Choosing a name is half the work; the other half is the word not used.** The working document's
principles are as much about what to avoid as what to use. "Save" means a file write in the
program's settings, so a commit must not be called a save. "Sync" means a one-way overwrite in
Canvas, so it names nothing. "Remote" is a role in ADR-0065, not a place a person knows. Words like
"sidecar" and "trailer" must never reach a person at all (the document's §17). And some words belong
to one concept so firmly that no tool may borrow them: `Draft` is an item status, so Quiver's edit
in progress cannot be a "draft". A list of names alone loses all of this; the next tool picks
"save" again because nothing says why not.

**The two-client test is met.** The words for a refusal code are shown by the desktop program today,
and would be by Quiver and CoQui when they meet the same refusals; the names of workspace actions are
shown by the program and by Quiver's buttons that open it (`docs/naming-vocabulary.md` §16).

**Development Principle 5 draws a line.** Interface patterns belong in tools, not in the hub. The
vocabulary is therefore a *suggestion* from the toolkit, never something the hub serves or enforces,
and it covers only names for what Armature defines. A tool's own experience (Quiver's status strip,
its "uncommitted edit") keeps its own words, under one rule: never use a shared word for something
else.

## Decision

1. **A package, `@armature/vocabulary`**, in `packages/vocabulary/`, consumed by git reference like
   the other two:
   - `vocabulary.json`: the source, edited by hand, readable from any language (the desktop shell is
     Rust);
   - `vocabulary.schema.json`: its JSON Schema, so a tool in any language can validate it;
   - `src/index.ts`: the data typed for TypeScript, and two small functions, `findAvoided(text,
     audience)` and `isReserved(word)`, so a tool can check its own strings. `findAvoided` reports
     every avoided word it finds with the entry's `use` and `allowed`; it cannot tell an allowed use
     from prose, so a string that is one carries a marker naming the entry (`vocabulary-allow: save`,
     in a comment beside it), and the function skips it.

   It has no dependencies and no build, as `@armature/types` has none. It offers no command line: a
   tool calls the two functions from its own suite until a second tool asks for a command (open
   question 3).

2. **Terms: one entry per shared concept.**

   | Field | Meaning |
   |---|---|
   | `id` | A stable key (`workspace`, `action.update-from-parent`, `state.changed-elsewhere`); never renamed, so a tool and a translation can key on it |
   | `name` | The word or label, with `<parent>` or `<instance>` where the label names one |
   | `status` | `recommended` (the working document's proposal), `chosen` (Amos decided) or `kept` (in use and unchanged; no decision needed) |
   | `audience` | Who reads it: `people`, `administrators`, `developers`, one or more |
   | `means` | One sentence: what it names |
   | `identifiers` | The codes, routes, fields or enum values it stands for (`bring_in_first`, `POST /workspace/:name/deliver`, `ItemStatus.InReview`) |
   | `until` | For a name that waits on a decision not yet built, the name to use until then and the decision it waits on (`{ "name": "Merge into main", "adr": "0072" }`) |
   | `row` | Where the working document argues it: its section and its concept cell |

   A refusal code's words are a term whose `identifiers` name the code, so the words shown for
   `bring_in_first` are kept as any other name is. The terms cover the concepts Armature defines and
   no others: a tool's own concepts stay out. The vocabulary is English; a translation would key on
   the ids, and a map of names by language is added beside `name` when a tool is translated (open
   question 4).

3. **Reserved words: words that hold one meaning.** Each entry is `{ word, for, audience, reason }`:
   the word, the term `id` it belongs to, the audiences for which it is held, and why. Every term's
   `name` is reserved for that term implicitly; the list adds the words that are held without being a
   term's name. These are enumeration values a person reads (`Draft`, `In review`, `Approved`,
   `Retired`, `Affirmed`, `Declined`); words held for a concept already planned (`proposal` for an
   agent's output, `Revert` if an undo is built, `level` for a coverage level); and words held to one
   audience (`operator`, who runs the server, for administrators and developers, and avoided for
   people under decision 4). A tool may use a reserved word
   only in the meaning it is reserved for.

4. **Avoided words: words deliberately not used, with the reason.** Each entry is:

   | Field | Meaning |
   |---|---|
   | `word` | The word avoided, with its forms (`save`, `saved`, `saving`) |
   | `for` | The term `id` it must not name, or `*` when it is avoided outright for the audience |
   | `audience` | For whom it is avoided |
   | `use` | The term `id` to use instead, or none when the thing needs no name for that audience |
   | `allowed` | Uses that remain correct, in words ("settings and files that are not commits") |
   | `reason` | Why, in one sentence, with the evidence's reference from the working document ([S24] for Canvas's "Sync") |
   | `row` | The collision or row that decided it |

   Three kinds fall under it, kept apart by `for` and `audience`. The first is a word avoided for one
   concept and allowed for others: "save" for a commit (use "commit"; settings may be saved), "deliver"
   for a merge (use the merge request's words; the viewer's "Delivered" figure keeps the course
   sense). The second is a word avoided outright: "sync", "publish", "pull request". The third is a
   word avoided for one audience: "remote", "operator", "sidecar", "trailer", "snapshot" and the rest
   of the working document's §17 for people, all correct for administrators or developers.

5. **The working document keeps the reasoning; the file holds the names.** The document's
   collisions, evidence and rejected options stay where they are, and its Recommended and Chosen
   columns stay as they are. A check, `npm run check:vocabulary` (`scripts/check_vocabulary.js`, beside
   `check_context_size.js`), run in CI's first job, which runs for documents alone too, reads both
   and fails when:
   - the file does not validate against its schema;
   - a term's `row` names no row in the document, or a row's name disagrees with the term (the Chosen
     cell when filled, otherwise the first bold phrase of the Recommended cell), or a status
     disagrees (`chosen` exactly where the Chosen cell is filled);
   - a word is both reserved for one term and the `name` of another, for a shared audience;
   - a word is avoided for a term and is also that term's `name`, for a shared audience;
   - an avoided entry's `use` or a reserved entry's `for` names no term.

   A name changes in one pull request touching both, or CI stops it. The document gains no new
   column: rows are matched by section and concept cell.

6. **Armature's own surfaces are checked too, softly first.** The same check runs `findAvoided` over
   the person-facing strings of the desktop program's pages and components (`desktop/src/`), the
   core's messages (`app/lib/desktop/`) and the viewer's pages (`app/app/`), and prints what it finds.
   It reports and does not fail while the strings are the ones in use before any name is chosen,
   since every page would fail today. It fails for a surface once that surface has been brought to
   the vocabulary, which the check learns from a list kept with the script, filled as each page is
   reworded; the list is Armature's, not the package's, since tools have surfaces of their own. It
   fails surface by surface, never all at once on a date (open question 2). A
   string that keeps an avoided word on purpose, an allowed use, carries the marker of decision 1.

7. **The vocabulary has its own versions, not the hub's.** `vocabulary.json` carries a `revision`
   date, and the package lists each change of name or status in `packages/vocabulary/CHANGES.md`. A
   change to a word changes no hub behavior, so it is not a client revision: `REVISIONS` and
   `docs/client-changes.md` are untouched, and a tool reads the vocabulary from its dependency, never
   from a hub. A route that renames nothing never waits on a word.

8. **Seeded from the working document, as recommended.** The first file holds the shared rows of
   `docs/naming-vocabulary.md` §§4 to 15, each `status` `recommended` or `kept` as the document has
   it; the refusal codes whose words the document gives (`bring_in_first`, `profile_changed`,
   `unsupported_version` and the others it words), the rest of the guide's table of refusals
   (`docs/desktop-program.md` § "When something is refused") added as each is reworded; the
   reserved and avoided words its collisions and principles name; and nothing from §16 (Quiver's
   own words) beyond the avoided entries those rows create. As Amos fills a row's Chosen cell, its term becomes `chosen` in the same pull request, the
   check holding the two together. Tools may align on recommended names from the start: when a name
   is chosen differently, its `id` stays, so a tool keyed on ids changes only the word.

   > **Note (2026-11-18):** Amos chose every name the same day, after this record was accepted: all
   > 23 collisions and every other row as recommended, recorded in the working document's Chosen
   > column. So the file is seeded with every term `chosen`, not `recommended`; `kept` is not used
   > at seeding, since a kept name was chosen too. The names that wait on ADR-0072 carry their
   > `until` names.

## Alternatives considered

- **A separate vocabulary repository.** Neutral ground, not tied to Armature's releases. Rejected: a
  fourth place to keep in step, unable to check itself against the pages and documents whose names
  it records, and reached by tools through submodules or copies, which is the drift this decision
  removes.
- **A pointer in each tool's `CLAUDE.md` to the working document.** Costs nothing. Rejected as the
  mechanism: nothing enforces it, and only people and Claude read it, never a tool's code or its CI.
  It stays as a one-line pointer to the package (Consequences).
- **A subpath of `@armature/types` (`@armature/types/vocabulary`).** No new package. Rejected: that
  package is generated from the schema and describes the schema, and its `src/` is never edited by
  hand; the vocabulary is neither.
- **An export of `@armature/client`.** The refusal words would sit beside the routes that produce the
  codes. Rejected: it ties the words to the TypeScript client, where a tool in another language, or
  the desktop shell, cannot read them.
- **Served by the hub** (a route, or an entry in `GET /discover`). Rejected: a word is not an
  instance's state, an offline tool needs it, every word would wait on a hub's revision, and the hub
  would own interface text, against Development Principle 5.
- **The JSON as the only source, with the working document's tables generated from it.** One file
  instead of two held together. Rejected for now: the document's rows carry the evidence, the names
  in use and the notes, prose that is the reason for each name and reads badly as data. Revisited if
  keeping the two in step proves costly.
- **Names only, without reserved and avoided words.** Smaller. Rejected: the reasons a word is not
  used are the part a new tool most needs, and the part a list of names loses.
- **A tool registers its own words** in the package, so collisions between tools are caught here.
  Rejected for now: a tool's words are its own (Development Principle 5). A tool runs `findAvoided`
  and `isReserved` over its own strings instead (open question 3).

## Open questions

**Amos decided all five on 2026-11-18, each as recommended;** the decisions are in decisions 1, 2
and 6 and, for question 5, in §Alternatives, and the options are kept here as the record of what was
weighed.

1. **The package's name and place.** *Recommendation:* `@armature/vocabulary` in `packages/`, as
   decided above. If a third package proves a burden for the install check, the subpath of
   `@armature/types` is the fallback, at the cost §Alternatives gives.
2. **When Armature's own check starts failing** (decision 6). *Recommendation:* per surface, as each
   page is reworded after its names are chosen, rather than all at once on a date.
3. **Whether the package offers tools a command** (`npx armature-vocabulary check <dir>`) beside the
   functions. *Recommendation:* not until a second tool asks; the functions are enough for a test in
   a tool's own suite.
4. **Translations.** The vocabulary is English. *Recommendation:* nothing now; the term ids are what a
   translation would key on, and a `names` map by language can be added beside `name` when a tool
   is translated.
5. **Whether the working document should eventually be generated from the file** (§Alternatives).
   *Recommendation:* revisit after the Chosen column is filled, when the document stops changing
   often.

## Verification

No platform check is needed: nothing here touches the store or a route. Tests on building, run with
the package's own `npm test` and in CI's first job:

- the seeded file validates against its schema, and a file with each kind of error fails it;
- `check:vocabulary` passes on `main` as seeded, and fails on a fixture for each rule of decision 5:
  a row's name changed in the document alone, a status changed in the file alone, a word reserved for
  one term and named by another, an avoided word that is its own term's name, a dangling `use`;
- `findAvoided` finds "saved" in "Saved to the workspace" for people, with `use` naming the commit;
  skips "Saved. The hub is not running." when it carries the marker `vocabulary-allow: save`; and
  finds "remote" for people but not for developers; `isReserved("Draft")` names the item status;
- the install check (`packages/client/install-check/`) imports the package from a separate
  repository, as it does the client.

## Consequences

- **The toolkit gains a third package**, `@armature/vocabulary`: JSON, its schema, a typed export and
  two functions; no dependencies.
- **Every tool gets the current words by updating its Armature dependency.** Each tool's `CLAUDE.md`
  gains one line, written once: user-facing names for Armature's concepts come from
  `@armature/vocabulary`, and its reserved and avoided words apply.
- **A name changes in one pull request**: the working document's row, the file's term, and its
  `CHANGES.md` line, held together by `check:vocabulary`.
- **Armature's own pages are measured against it**, reporting at first and failing surface by surface.
  The desktop core's refusal messages and the guide's table of refusals can later take their words
  from the package, so the program itself stops being a separate copy.
- **The repository map changes**: CLAUDE.md's structure gains `packages/vocabulary/`, and its toolkit
  line names three packages. `docs/demo-coverage.md`'s toolkit row and the toolkit follow-ups in
  `SESSION.md` (item 7) mention it.
- **Nothing changes for the hub or for a client of its routes.**
