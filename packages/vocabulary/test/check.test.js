// The check that holds vocabulary.json to docs/naming-vocabulary.md
// (scripts/check_vocabulary.js; ADR-0073 decisions 5 and 6, §Verification): it passes
// on the file as it stands, and fails on a fixture for each of its rules. A fixture is
// the real file or the real document with one thing changed, so each test shows the
// drift the rule exists to catch. Plain JavaScript, as the script is.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';
import { findAvoided } from '../src/index.ts';
import {
  BROUGHT, PATHS, SURFACES, checkVocabulary, isBrought, parseDocument, surfaceFindings, surfaceStrings, validate,
} from '../../../scripts/check_vocabulary.js';

const root = new URL('../../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const schema = JSON.parse(read(PATHS.schema));
const markdown = read(PATHS.document);

// The real file, changed by `change` on a copy.
function file(change = () => {}) {
  const vocabulary = JSON.parse(read(PATHS.vocabulary));
  change(vocabulary);
  return vocabulary;
}
const term = (vocabulary, id) => vocabulary.terms.find((entry) => entry.id === id);

// The real document with one row's Chosen cell (or another column) rewritten.
function documentWith(concept, cell, column = 'Chosen') {
  const columns = ['Concept', 'What it is', 'Names in use now (where)', 'Notes', 'Recommended', 'Chosen'];
  let changed = 0;
  const lines = markdown.split('\n').map((line) => {
    if (!line.startsWith(`| ${concept} |`)) return line;
    const cells = line.split('|').slice(1, -1).map((text) => text.trim());
    cells[columns.indexOf(column)] = cell;
    changed += 1;
    return `| ${cells.join(' | ')} |`;
  });
  assert.equal(changed, 1, `one row of the document has the concept "${concept}"`);
  return lines.join('\n');
}

const problemsOf = (vocabulary, text = markdown) => checkVocabulary(vocabulary, parseDocument(text));
function assertOne(problems, pattern) {
  assert.ok(problems.some((problem) => pattern.test(problem)), `expected ${pattern} among:\n${problems.join('\n') || '(no problems)'}`);
}

// ---- The schema ----

test('the seeded file validates against its schema', () => {
  assert.deepEqual(validate(schema, file()), []);
});

test('a file with each kind of error fails the schema', () => {
  const cases = [
    ['a term without its meaning', (v) => { delete v.terms[0].means; }, /terms\[instance\]: has no "means"/],
    ['a status the schema does not know', (v) => { v.terms[0].status = 'decided'; }, /terms\[instance\]\.status: is "decided", not one of/],
    ['a field the schema does not know', (v) => { v.terms[0].note = 'x'; }, /terms\[instance\]: has "note"/],
    ['an id that is not a key', (v) => { v.terms[0].id = 'The Instance'; }, /\.id: "The Instance" does not match/],
    ['no audience', (v) => { v.terms[0].audience = []; }, /\.audience: has 0 entries/],
    ['an audience named twice', (v) => { v.terms[0].audience = ['people', 'people']; }, /\.audience: repeats an entry/],
    ['an audience the schema does not know', (v) => { v.terms[0].audience = ['everyone']; }, /\.audience\[0\]: is "everyone"/],
    ['an empty name', (v) => { v.terms[0].name = ''; }, /\.name: is empty/],
    ['a revision that is not a date', (v) => { v.revision = 'today'; }, /\$\.revision: "today" does not match/],
    ['a revision of the wrong type', (v) => { v.revision = 20261119; }, /\$\.revision: is integer, not string/],
    ['an empty until', (v) => { v.terms[0].until = {}; }, /\.until: is empty/],
    ['an ADR that is not a number', (v) => { v.terms[0].until = { adr: 'ADR-0072' }; }, /\.until\.adr: "ADR-0072" does not match/],
    ['a row without its section', (v) => { delete v.terms[0].row.section; }, /\.row: has no "section"/],
    ['a section below 1', (v) => { v.terms[0].row.section = 0; }, /\.row\.section: is 0, below 1/],
    ['a reserved word for nothing', (v) => { delete v.reserved[0].for; }, /reserved\[Draft\]: has no "for"/],
    ['an avoided word with no reason', (v) => { delete v.avoided[0].reason; }, /avoided\[save\]: has no "reason"/],
    ['an avoided row that cites nothing', (v) => { v.avoided[0].row = 'collision 5'; }, /avoided\[save\]\.row: "collision 5" does not match/],
    ['a list missing', (v) => { delete v.avoided; }, /\$: has no "avoided"/],
    ['terms that are not a list', (v) => { v.terms = {}; }, /\$\.terms: is an object, not array/],
  ];
  for (const [name, change, expected] of cases) {
    const errors = validate(schema, file(change));
    assert.ok(errors.some((error) => expected.test(error)), `${name}: expected ${expected} among:\n${errors.join('\n') || '(no errors)'}`);
  }
});

test('a schema keyword the check does not know is an error, never a pass', () => {
  assert.throws(() => validate({ type: 'string', maxLength: 3 }, 'abcd'), /uses "maxLength"/);
  assert.throws(() => validate({ $ref: '#/$defs/missing' }, 1), /does not define/);
});

// ---- The document ----

test('the document parses into rows, collisions and principles', () => {
  const document = parseDocument(markdown);
  assert.deepEqual(document.problems, []);
  assert.deepEqual([...document.collisions], Array.from({ length: 23 }, (_, i) => i + 1));
  assert.deepEqual([...document.principles], [1, 2, 3, 4, 5, 6, 7]);
  const row = document.rows.find((entry) => entry.concept === 'main moved');
  assert.deepEqual({ section: row.section, chosen: row.chosen }, { section: 8, chosen: '<parent> has updates' }, 'code marks are taken off a cell');
  // Section 2's table of metaphors also has a Concept column, and is not a table of names.
  assert.ok(document.rows.every((entry) => entry.section >= 4 && entry.section <= 16));
});

test('a cell split by a stray "|" is reported, not misread', () => {
  const document = parseDocument(documentWith("Read the app's log", 'Diagnostics | Console'));
  assertOne(document.problems, /the row has 7 cells where its table has 6/);
});

// ---- The file against the document ----

test('check:vocabulary passes on the file and the document as they stand', () => {
  assert.deepEqual(problemsOf(file()), []);
});

test("a row's name changed in the document alone fails", () => {
  const problems = problemsOf(file(), documentWith("Read the app's log", 'Troubleshooting'));
  assertOne(problems, /term diagnostics: its name "Diagnostics" is not in the Chosen cell of §7 "Read the app's log", which reads "Troubleshooting"/);
  assertOne(problems, /the Chosen cell of §7 "Read the app's log" holds "Troubleshooting", which no term/);
});

test('a name added to the document alone fails', () => {
  const problems = problemsOf(file(), documentWith("Read the app's log", 'Diagnostics; Console'));
  assert.equal(problems.length, 1);
  assertOne(problems, /holds "Console", which no term/);
});

test('a name dropped from the document alone fails', () => {
  assertOne(problemsOf(file(), documentWith('Sign in, sign out', 'Sign in, Sign out')), /term action\.try-again: its name "Try again" is not in the Chosen cell of §7 "Sign in, sign out"/);
});

test('a name changed in the file alone fails', () => {
  const problems = problemsOf(file((v) => { term(v, 'diagnostics').name = 'Troubleshooting'; }));
  assertOne(problems, /term diagnostics: its name "Troubleshooting" is not in the Chosen cell/);
  assertOne(problems, /holds "Diagnostics", which no term/);
});

test('a status changed in the file alone fails', () => {
  assertOne(problemsOf(file((v) => { term(v, 'diagnostics').status = 'recommended'; })), /term diagnostics: its status is "recommended", but the Chosen cell of §7 "Read the app's log" is filled/);
});

test('a row not yet chosen takes its name from the bold phrases of its Recommended cell', () => {
  const undecided = documentWith("Read the app's log", '');
  assertOne(problemsOf(file(), undecided), /term diagnostics: its status is "chosen", but the Chosen cell of §7 "Read the app's log" is empty/);
  assert.deepEqual(problemsOf(file((v) => { term(v, 'diagnostics').status = 'recommended'; }), undecided), []);
  assertOne(
    problemsOf(file((v) => { Object.assign(term(v, 'diagnostics'), { status: 'recommended', name: 'the diagnostic log' }); }), undecided),
    /its name "the diagnostic log" is not a bold phrase of the Recommended cell/,
  );
});

test("a refusal's words changed in the document alone fail", () => {
  const row = parseDocument(markdown).rows.find((entry) => entry.concept === 'Bring in main');
  const reworded = documentWith('Bring in main', row.recommended.replace('Update from main first', 'Take in main first'), 'Recommended');
  assertOne(problemsOf(file(), reworded), /term refusal\.bring_in_first: its name "Update from <parent> first" is not in the Recommended cell/);
});

test('a term whose row is not in the document fails', () => {
  assertOne(problemsOf(file((v) => { term(v, 'diagnostics').row.concept = 'Read the log'; })), /term diagnostics: its row §7 "Read the log" is not a row/);
  assertOne(problemsOf(file((v) => { term(v, 'main').also = [{ section: 7, concept: 'Nowhere' }]; })), /term main: it also names §7 "Nowhere", which is not a row/);
});

test('a name the document chooses in a second row is held there too', () => {
  assertOne(problemsOf(file(), documentWith('Other uses of "check"', 'Look for a new version')), /term action\.try-again: its name "Try again" is not in the Chosen cell of §11 "Other uses of "check""/);
});

test('an id used twice fails', () => {
  assertOne(problemsOf(file((v) => { v.terms.push({ ...term(v, 'diagnostics') }); })), /term diagnostics: the id is used twice/);
});

test('a word reserved for one term and named by another fails, for a shared audience only', () => {
  const entry = { word: 'diagnostics', for: 'history', audience: ['people'], reason: 'A fixture.' };
  assertOne(problemsOf(file((v) => { v.reserved.push(entry); })), /reserved "diagnostics": it is reserved for history and is also the name of diagnostics, for a shared audience/);
  assert.deepEqual(problemsOf(file((v) => { v.reserved.push({ ...entry, audience: ['developers'] }); })), []);
});

test('a reserved word the document no longer chooses fails', () => {
  assertOne(problemsOf(file(), documentWith('Item status', 'Draft, In review, Approved, Withdrawn')), /reserved "Retired": it is not in the Chosen cell of §12 "Item status"/);
});

test("an avoided word that is its own term's name fails, for a shared audience only", () => {
  const entry = { word: 'commits', forms: ['commit'], for: 'commit', audience: ['people'], reason: 'A fixture.', row: '§1, collision 5' };
  assertOne(problemsOf(file((v) => { v.avoided.push(entry); })), /avoided "commits" for commit: the word is that term's own name/);
  // "handle" is a developer's term and avoided for people: no shared audience, no problem.
  assert.ok(file().avoided.some((avoided) => avoided.word === 'handle' && avoided.for === 'handle'));
});

test('a dangling "use" or "for" fails', () => {
  assertOne(problemsOf(file((v) => { v.avoided[0].use = 'commits'; })), /avoided "save" for commit: its "use", "commits", is no term's id/);
  assertOne(problemsOf(file((v) => { v.avoided[0].for = 'commits'; })), /avoided "save" for commits: "commits" is no term's id/);
  assertOne(problemsOf(file((v) => { v.reserved[0].for = 'objective-states'; })), /reserved "Draft": it is for "objective-states", which is no term's id/);
});

test('an avoided entry that cites nothing in the document fails', () => {
  for (const row of ['§1, collision 99', '§2, principle 9', '§3, collision 5', '§40', '§6, No such row']) {
    assertOne(problemsOf(file((v) => { v.avoided[0].row = row; })), /avoided "save" for commit: its row ".+" names no section, collision, principle or row/);
  }
});

// ---- Armature's own pages ----

const page = `
import { Button } from './ui/button';
type Mode = 'Saved and done';
export function Page({ state, branch }: { state: string; branch: string }) {
  const note = state === 'Draft' ? 'Nothing to push: the remote has everything.' : \`Removed \${branch} from this machine\`;
  // vocabulary-allow: save
  const kept = 'Saved. The hub is not running.';
  return (
    <section className="flex gap-2 text-sm" data-state="Saved now">
      <h1 title="The remote">Your workspaces</h1>
      <p>Saved to the workspace</p>
      <Button variant="outline" onClick={() => alert('Deliver into main')}>Push</Button>
      {note}{kept}
    </section>
  );
}
`;

test('the strings a person reads are taken from a page, and its code is left', () => {
  const strings = surfaceStrings(ts, 'Page.tsx', page).map((found) => found.text);
  assert.deepEqual(strings, [
    'Nothing to push: the remote has everything.',
    'Removed … from this machine',
    'Saved. The hub is not running.',
    'The remote',
    'Your workspaces',
    'Saved to the workspace',
    'Deliver into main',
    'Push',
  ]);
});

test('avoided words on a page are found with their lines, and a marked string is skipped', () => {
  const findings = surfaceFindings(ts, findAvoided, 'Page.tsx', page);
  assert.deepEqual(
    findings.map((finding) => [finding.line, finding.match, finding.instead]),
    [
      [5, 'remote', 'instance'],
      [5, 'machine', 'this computer'],
      [10, 'remote', 'instance'],
      [11, 'Saved', 'commit'],
      [12, 'Deliver', 'merge request'],
    ],
  );
});

test('a file is held to the vocabulary when it, or a folder above it, is listed', () => {
  const brought = ['desktop/src', 'app/app/page.tsx'];
  assert.equal(isBrought('desktop/src/pages/Workspace.tsx', brought), true);
  assert.equal(isBrought('app/app/page.tsx', brought), true);
  assert.equal(isBrought('app/app/layout.tsx', brought), false);
  assert.equal(isBrought('desktop/src-tauri/src/tray.rs', brought), false, 'a folder is matched whole, not as a prefix of a name');
  // Armature's own three surfaces are held since 2026-11-19.
  for (const surface of SURFACES) assert.equal(isBrought(`${surface.dir}/x.tsx`), true, surface.dir);
});

test('every surface and every file held to the vocabulary exists', () => {
  for (const surface of SURFACES) assert.ok(existsSync(new URL(surface.dir, root)), surface.dir);
  for (const path of BROUGHT) assert.ok(existsSync(new URL(path, root)), `${path} is listed in BROUGHT and is not there`);
});
