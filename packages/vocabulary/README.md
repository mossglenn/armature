# @armature/vocabulary

The names Armature's tools share, so that a workspace, a commit, a merge request and a refusal go by the same word in every tool a person opens. It is a suggestion from the toolkit: no hub serves it or enforces it, and it covers only the names for what Armature defines. A tool's own concepts keep their own words, under one rule: never use a shared word for something else.

The decision is [ADR-0073](../../schema/docs/adr/0073-a-shared-vocabulary-in-the-toolkit.md). The reasoning behind every name is [`docs/naming-vocabulary.md`](../../docs/naming-vocabulary.md): the collisions that were found, the evidence from other software, and the options that were rejected.

## What is in it

| File | What it gives |
|---|---|
| `vocabulary.json` | The source, edited by hand and readable from any language: three lists and a `revision` date |
| `vocabulary.schema.json` | Its JSON Schema, so a tool in any language can validate it |
| `src/index.ts` | The same data typed for TypeScript (`vocabulary`, and `terms` keyed by id), and two functions: `findAvoided` and `isReserved` |
| `CHANGES.md` | Every change of a name or a status, by revision |

The three lists:

- **Terms** give each shared concept, or each label of one, its name. A term has a stable `id` that is never renamed (`workspace`, `action.update-from-parent`, `state.changed-elsewhere`), a `name`, a `status` (`recommended`, `chosen` or `kept`), the `audience` that reads it, what it `means`, and the `identifiers` it stands for: a refusal code, a route, a field or an enumeration value. Identifiers never change with the word.
- **Reserved words** hold one meaning without being a term's name: the enumeration values a person reads (`Draft`, `In review`, `Affirmed`, `Could not run`), each for the term of its kind. Every term's name is reserved for that term without an entry.
- **Avoided words** are deliberately not used for a concept or an audience. Each has the term to `use` instead, the uses that stay `allowed`, and the `reason`. "Save" is avoided for a commit, while settings may still be saved. "Sync" is avoided outright. "Remote" is avoided for people and correct for developers.

There are three audiences: `people` (designers, reviewers, researchers), `administrators` (and whoever runs an instance) and `developers` (tool authors).

## Using it

```ts
import { findAvoided, isReserved, terms } from '@armature/vocabulary';

// A label, keyed on the id, so a renamed word changes nothing in your code.
const label = terms['action.push'].name;                        // "Push"

// A name with a placeholder: <parent>, <branch>, <instance> or <n>.
terms['action.update-from-parent'].name.replace('<parent>', 'main');   // "Update from main"

// A name that waits on something not yet built says what to show until then.
terms['action.open-merge-request'].until;                       // { name: "Merge into main", adr: "0072" }

// The words for a refusal code are a term whose identifiers name the code.
terms['refusal.bring_in_first'].name;                           // "Update from <parent> first"

// Your own strings, checked in your own suite.
findAvoided('Saved to the workspace', 'people');
// [{ match: 'Saved', index: 0, word: 'save', for: 'commit', use: 'commit', instead: 'commit',
//    allowed: 'Settings and files that are not commits.', reason: '…' }]

isReserved('Draft');     // held for item-status and for objective-state
isReserved('banana');    // null: the word is free
```

A term whose `until` has no `name` (`action.link-to-this-computer`) names something that does not exist yet: show nothing until the decision it waits on is built.

### An allowed use

`findAvoided` cannot tell an allowed use from prose. A string that keeps an avoided word on purpose carries a marker naming the entry's head word, in a comment beside it:

```ts
const kept = 'Saved. The hub is not running.'; // vocabulary-allow: save
```

The marker exempts that word for the whole text passed, so pass one string with its comment, or one line, never a whole file. Several words are separated by commas. An avoided word inside a term's own name needs no marker: "design note" is not a "note".

### A test for a tool's strings

There is no command line yet (ADR-0073, open question 3). A tool calls the function from its own suite:

```ts
import { findAvoided } from '@armature/vocabulary';

test('the buttons use the shared words', () => {
  for (const label of Object.values(LABELS)) expect(findAvoided(label, 'people')).toEqual([]);
});
```

### From another language

Read `vocabulary.json` and validate it against `vocabulary.schema.json`. Both are exported (`@armature/vocabulary/vocabulary.json`), and they are plain files in the repository at `packages/vocabulary/`.

## Installing it

The package ships TypeScript source and no build, and has no dependencies. Inside this repository it is a workspace package. Another repository installs it by git reference, as it does the client:

```sh
pnpm add github:mossglenn/armature#path:packages/vocabulary
```

A Next.js app adds `'@armature/vocabulary'` to `transpilePackages`; Vitest and `tsx` need nothing. The consumer's `tsconfig.json` needs `resolveJsonModule`, which a Next.js app has. CI's install check (`packages/client/install-check/`) proves all of this from outside the workspace.

## Versions

`vocabulary.json` carries a `revision` date, and `CHANGES.md` lists each change. A change to a word changes no hub behavior, so it is not a client revision: a tool reads the vocabulary from its dependency, never from a hub.

## Changing a name

A name changes in one pull request that touches three places: the row's Chosen cell in `docs/naming-vocabulary.md`, the term in `vocabulary.json`, and a dated line in `CHANGES.md` with the `revision` moved to that date. `npm run check:vocabulary`, at the repository root and in CI, fails when the file and the document disagree; the header of `scripts/check_vocabulary.js` says exactly how a term is matched to its row. An `id` is never renamed.

`npm test` here runs the package's tests with Node's own test runner (Node 22.18 or later).
