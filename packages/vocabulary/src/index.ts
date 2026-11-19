// @armature/vocabulary: the names Armature's tools share (ADR-0073).
//
// The source is ../vocabulary.json, edited by hand and readable from any language;
// ../vocabulary.schema.json is its JSON Schema. This module is the same data typed
// for TypeScript, and two functions a tool calls on its own strings from its own
// suite: findAvoided and isReserved.
//
// The vocabulary is a suggestion from the toolkit, never something a hub serves or
// enforces (Development Principle 5), and it covers only names for what Armature
// defines. A tool's own concepts keep their own words, under one rule: never use a
// shared word for something else.
//
// The reasoning behind every name is docs/naming-vocabulary.md, which
// `npm run check:vocabulary` holds to the file. A name changes in one pull request
// touching both, with a line in ../CHANGES.md.
//
// Only syntax Node can strip is used here (no enums, no parameter properties), so
// scripts/check_vocabulary.js and the tests import this file as it is, with no build.

import data from '../vocabulary.json' with { type: 'json' };

/** Who reads a word. `people` are designers, reviewers and researchers; `administrators` include whoever runs an instance; `developers` are tool authors. */
export type Audience = 'people' | 'administrators' | 'developers';

/** `recommended`: the working document's proposal. `chosen`: decided. `kept`: in use and unchanged, no decision needed. */
export type TermStatus = 'recommended' | 'chosen' | 'kept';

/** A row of docs/naming-vocabulary.md: its section's number and its Concept cell. */
export interface Row {
  section: number;
  concept: string;
  /** Present when the words are given in the row's Recommended cell and are not one of its chosen names: a refusal code's words. */
  in?: 'recommended';
}

export interface Term {
  /** A stable key, never renamed: what a tool and a translation key on. */
  id: string;
  /** The word or label. `<parent>`, `<branch>`, `<instance>` and `<n>` stand for the name or number a label carries. */
  name: string;
  status: TermStatus;
  audience: Audience[];
  /** One sentence: what it names. */
  means: string;
  /** The codes, routes, fields or enumeration values it stands for; they never change with the word. */
  identifiers?: string[];
  /**
   * For a name that waits on something not yet built: what it waits on (an ADR's number,
   * or a condition in words) and the name to use until then. Without a `name`, the concept
   * does not exist until then and nothing is shown.
   */
  until?: { name?: string; adr?: string; when?: string };
  /** Where the working document argues it. */
  row: Row;
  /** Other rows where the document chooses the same name for the same concept. */
  also?: Row[];
}

/** A word that holds one meaning without being a term's name: an enumeration value a person reads, or a word held to some audiences. */
export interface ReservedWord {
  word: string;
  /** The id of the term the word belongs to. */
  for: string;
  audience: Audience[];
  reason: string;
  identifiers?: string[];
  row?: Row;
}

/** A word deliberately not used for a concept or an audience. */
export interface AvoidedWord {
  word: string;
  /** Its other forms, matched as the word is. */
  forms?: string[];
  /** The id of the term it must not name, or `*` when it is avoided outright for the audience. */
  for: string;
  audience: Audience[];
  /** The id of the term to use instead; absent when the thing needs no name for that audience. */
  use?: string;
  /** Uses that remain correct, in words. */
  allowed?: string;
  reason: string;
  /** The section, collision, principle or row of the working document that decided it. */
  row: string;
}

export interface Vocabulary {
  /** The date of the last change to a name or a status. Not a hub's client revision (ADR-0073 decision 7). */
  revision: string;
  terms: Term[];
  reserved: ReservedWord[];
  avoided: AvoidedWord[];
}

/** The whole file. */
export const vocabulary: Vocabulary = data as Vocabulary;

/** Every term by its id: `terms['action.push'].name`. */
export const terms: Readonly<Record<string, Term>> = Object.freeze(
  Object.fromEntries(vocabulary.terms.map((term) => [term.id, term])),
);

/** One avoided word found in a text. */
export interface AvoidedFinding {
  /** The text that matched, as written. */
  match: string;
  /** Where it starts in the text given. */
  index: number;
  /** The entry's head word, the one a `vocabulary-allow:` marker names. */
  word: string;
  /** The id of the term the word must not name, or `*`. */
  for: string;
  /** The id of the term to use instead, or null when there is none. */
  use: string | null;
  /** That term's name, or null. */
  instead: string | null;
  /** The uses that remain correct, or null when there are none. */
  allowed: string | null;
  reason: string;
}

const WORD = '[A-Za-z0-9_]';

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A word or phrase as a pattern: whole words only, any case, any white space between the words of a phrase.
function pattern(forms: string[]): RegExp {
  const alternatives = [...forms]
    .sort((a, b) => b.length - a.length)
    .map((form) => escape(form.trim()).replace(/\s+/g, '\\s+'));
  return new RegExp(`(?<!${WORD})(?:${alternatives.join('|')})(?!${WORD})`, 'gi');
}

const AVOIDED = vocabulary.avoided.map((entry) => ({
  entry,
  pattern: pattern([entry.word, ...(entry.forms ?? [])]),
}));

// A term's own name of several words protects the avoided word inside it: "design note" is
// not a "note", nor "API revision" a "revision". Names that carry a placeholder protect nothing.
const NAMES = vocabulary.terms
  .filter((term) => /\s/.test(term.name) && !term.name.includes('<'))
  .map((term) => ({ audience: term.audience, pattern: pattern([term.name]) }));

// `vocabulary-allow: save` or `vocabulary-allow: save, remote`, to the end of its line or of its comment.
const MARKER = /vocabulary-allow:\s*([^\n\r*}]*)/gi;

/**
 * Every avoided word in `text` for one audience, in the order found, each with the term
 * to use instead and the uses that remain correct.
 *
 * An avoided word inside a term's own name is not reported: "design note" is not a
 * "note". Beyond that it cannot tell an allowed use from prose. A string that keeps an avoided word on
 * purpose carries a marker naming the entry's head word, in a comment beside it:
 *
 *     'Saved. The hub is not running.' // vocabulary-allow: save
 *
 * A marker in the text given exempts that entry for the whole of that text, so a tool
 * passes one string with its comment, or one line, never a whole file. Several words
 * are separated by commas.
 */
export function findAvoided(text: string, audience: Audience): AvoidedFinding[] {
  const allowed = new Set<string>();
  // The marker's own words are blanked, at the same length, so they are not found and indexes hold.
  const scanned = text.replace(MARKER, (marker, words: string) => {
    for (const word of words.split(',')) {
      const name = word.replace(/-->|\*\/|\/\//g, '').trim().toLowerCase();
      if (name) allowed.add(name);
    }
    return ' '.repeat(marker.length);
  });

  const named: Array<[number, number]> = [];
  for (const name of NAMES) {
    if (!name.audience.includes(audience)) continue;
    for (const found of scanned.matchAll(name.pattern)) named.push([found.index, found.index + found[0].length]);
  }

  const findings: AvoidedFinding[] = [];
  for (const { entry, pattern } of AVOIDED) {
    if (!entry.audience.includes(audience)) continue;
    if (allowed.has(entry.word.toLowerCase())) continue;
    for (const found of scanned.matchAll(pattern)) {
      const end = found.index + found[0].length;
      if (named.some(([from, to]) => from <= found.index && end <= to && to - from > found[0].length)) continue;
      findings.push({
        match: found[0],
        index: found.index,
        word: entry.word,
        for: entry.for,
        use: entry.use ?? null,
        instead: entry.use ? (terms[entry.use]?.name ?? null) : null,
        allowed: entry.allowed ?? null,
        reason: entry.reason,
      });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

/** One meaning a word is held for. */
export interface Reservation {
  /** The word as the vocabulary writes it. */
  word: string;
  /** The id of the term it belongs to. */
  for: string;
  /** The audiences for which it is held. */
  audience: Audience[];
  /** Why: a reserved word's reason, or the term's meaning when the word is a term's name. */
  reason: string;
  /** `reserved`: an entry of the reserved list. `term`: a term's name, reserved for that term implicitly. */
  source: 'reserved' | 'term';
}

function normal(word: string): string {
  return word.trim().replace(/\s+/g, ' ').toLowerCase();
}

const RESERVATIONS = new Map<string, Reservation[]>();
function reserve(reservation: Reservation): void {
  const key = normal(reservation.word);
  RESERVATIONS.set(key, [...(RESERVATIONS.get(key) ?? []), reservation]);
}
for (const entry of vocabulary.reserved) {
  reserve({ word: entry.word, for: entry.for, audience: entry.audience, reason: entry.reason, source: 'reserved' });
}
for (const term of vocabulary.terms) {
  reserve({ word: term.name, for: term.id, audience: term.audience, reason: term.means, source: 'term' });
  if (term.until?.name) {
    reserve({ word: term.until.name, for: term.id, audience: term.audience, reason: term.means, source: 'term' });
  }
}

/**
 * The meanings `word` is reserved for, or null when it is free. A tool may use a
 * reserved word only in a meaning listed. Case and spacing are ignored: `Draft`,
 * `draft` and ` DRAFT ` are one word. A word may be held for more than one term
 * (`Draft` is an item status and an objective state), so the answer is a list.
 */
export function isReserved(word: string): Reservation[] | null {
  return RESERVATIONS.get(normal(word)) ?? null;
}
