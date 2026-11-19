// The package as a tool meets it: the typed data and the two functions (ADR-0073
// §Verification). Run by `npm test` here, with Node's own test runner and no build.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { findAvoided, isReserved, terms, vocabulary } from '../src/index.ts';
import type { Audience } from '../src/index.ts';

const here = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('the data is typed and keyed by id', () => {
  assert.equal(terms['action.push']?.name, 'Push');
  assert.equal(terms['action.update-from-parent']?.name, 'Update from <parent>');
  assert.equal(Object.keys(terms).length, vocabulary.terms.length, 'no id is used twice');
  assert.match(vocabulary.revision, /^\d{4}-\d{2}-\d{2}$/);
});

test('a name that waits on ADR-0072 carries its name for until then', () => {
  assert.deepEqual(terms['action.open-merge-request']?.until, { name: 'Merge into main', adr: '0072' });
  // Without a name, the concept does not exist until then.
  assert.deepEqual(terms['action.link-to-this-computer']?.until, { adr: '0072' });
});

test("a refusal code's words are a term whose identifiers name the code", () => {
  const worded = vocabulary.terms.filter((term) => term.id.startsWith('refusal.'));
  assert.ok(worded.length >= 4);
  for (const term of worded) assert.deepEqual(term.identifiers, [term.id.slice('refusal.'.length)]);
  assert.equal(terms['refusal.bring_in_first']?.name, 'Update from <parent> first');
});

test('the revision is the newest entry of CHANGES.md', () => {
  const newest = /^## (\d{4}-\d{2}-\d{2})/m.exec(here('../CHANGES.md'));
  assert.equal(newest?.[1], vocabulary.revision, 'a change of name or status gets a dated entry in CHANGES.md and the same date as the revision');
});

test('findAvoided finds "saved" for people, with the commit as the word to use', () => {
  const findings = findAvoided('Saved to the workspace', 'people');
  assert.equal(findings.length, 1);
  assert.deepEqual(
    { match: findings[0].match, index: findings[0].index, word: findings[0].word, use: findings[0].use, instead: findings[0].instead },
    { match: 'Saved', index: 0, word: 'save', use: 'commit', instead: 'commit' },
  );
  assert.match(findings[0].allowed ?? '', /settings/i);
  assert.ok(findings[0].reason.length > 0);
});

test('findAvoided skips a string that carries the marker naming the entry', () => {
  assert.deepEqual(findAvoided("'Saved. The hub is not running.' // vocabulary-allow: save", 'people'), []);
  assert.deepEqual(findAvoided('{/* vocabulary-allow: save */}\nSaved. The hub is not running.', 'people'), []);
  // The marker exempts the word it names and no other.
  const others = findAvoided('Saved on the remote // vocabulary-allow: save', 'people');
  assert.deepEqual(others.map((finding) => finding.word), ['remote']);
  // Several words are separated by commas.
  assert.deepEqual(findAvoided('Saved on the remote // vocabulary-allow: save, remote', 'people'), []);
});

test('findAvoided finds "remote" for people and not for developers', () => {
  assert.deepEqual(findAvoided('The remote moved', 'people').map((finding) => finding.instead), ['instance']);
  assert.deepEqual(findAvoided('The remote moved', 'developers'), []);
});

test('findAvoided matches whole words, in any case, and phrases across white space', () => {
  assert.deepEqual(findAvoided('The remotely held savings', 'people'), []);
  assert.deepEqual(findAvoided('remote_unreachable', 'people'), [], 'an identifier is one word');
  assert.deepEqual(findAvoided('BRING\n  IN main', 'people').map((finding) => finding.word), ['bring in']);
  assert.deepEqual(findAvoided('Open a pull request', 'developers').map((finding) => [finding.word, finding.instead]), [['pull request', 'merge request']]);
});

test("findAvoided leaves an avoided word inside a term's own name", () => {
  assert.deepEqual(findAvoided('Add a design note', 'people'), []);
  assert.deepEqual(findAvoided('Add a note', 'people').map((finding) => finding.instead), ['message']);
  assert.deepEqual(findAvoided('Its API revision is 2026-11-16', 'people'), []);
});

test('findAvoided reports an outright avoided word with nothing to use instead', () => {
  const [finding] = findAvoided('Sync now', 'people');
  assert.deepEqual({ for: finding.for, use: finding.use, instead: finding.instead }, { for: '*', use: null, instead: null });
});

test('findAvoided answers for every audience the vocabulary names', () => {
  for (const audience of ['people', 'administrators', 'developers'] satisfies Audience[]) {
    assert.ok(Array.isArray(findAvoided('A plugin', audience)));
  }
  assert.deepEqual(findAvoided('A plugin', 'developers').map((finding) => finding.instead), ['client']);
  assert.deepEqual(findAvoided('A plugin', 'people').map((finding) => finding.instead), ['tool']);
});

test('isReserved("Draft") names the item status', () => {
  const held = isReserved('Draft');
  assert.ok(held);
  assert.ok(held.some((reservation) => reservation.for === 'item-status' && reservation.source === 'reserved'));
  // The word is an objective state too, so the answer is a list.
  assert.ok(held.some((reservation) => reservation.for === 'objective-state'));
  assert.deepEqual(isReserved('  draft '), held, 'case and spacing are ignored');
});

test("isReserved holds a term's name for that term, and its name for until then", () => {
  assert.deepEqual(isReserved('workspace')?.map((reservation) => [reservation.for, reservation.source]), [['workspace', 'term']]);
  assert.deepEqual(isReserved('Merge into main')?.map((reservation) => reservation.for), ['action.open-merge-request']);
});

test('isReserved answers null for a free word, so a plain test of it works', () => {
  assert.equal(isReserved('banana'), null);
  assert.equal(isReserved(''), null);
});
