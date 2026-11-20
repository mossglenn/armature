#!/usr/bin/env node
// Holds the vocabulary to the document that argues it (ADR-0073 decisions 5 and 6).
//
// The names Armature's tools share live in packages/vocabulary/vocabulary.json
// (@armature/vocabulary); the reasoning for each lives in docs/naming-vocabulary.md.
// Both are edited by hand, so this check is what keeps them one: a name changes in
// one pull request touching both, or CI stops it.
//
// It fails when:
//   - the file does not validate against vocabulary.schema.json;
//   - a term's `row` names no row of the document; or its name is not in that row's
//     Chosen cell (when the cell is empty, among the bold phrases of its Recommended
//     cell); or a Chosen cell holds words no term of the file claims;
//   - a status disagrees: `chosen` exactly where the Chosen cell is filled;
//   - a word is reserved for one term and is the name of another, for a shared audience;
//   - a word is avoided for a term and is that term's name, for a shared audience;
//   - an avoided entry's `use` or `for`, or a reserved entry's `for`, names no term;
//   - an avoided entry's `row` names no section, collision, principle or row.
//
// How a term meets its row. The document's Chosen cells were written for people, so
// one cell may hold several names ("Sign in, Sign out; Try again") and a few words
// that are not names ("until requests are built"). A term's name must appear in the
// cell whole, and after every claimed name is taken out, only the QUALIFIERS below
// and punctuation may remain. Three allowances, each written into the file and not
// guessed here: a term whose name is the row's Concept cell (a kind whose values are
// the cell: "item status" over "Draft, In review, Approved, Retired", the values being
// reserved words with the same row); a term with `"in": "recommended"` on its row (a
// refusal code's words, given in the Recommended cell); and `also`, for a name the
// document chooses again in another row. A placeholder in a name (<parent>) matches
// itself or the document's standing example of it (main); see EXAMPLES.
//
// Then it reads Armature's own person-facing strings (the desktop app's pages and
// components, the desktop core's messages, the viewer's pages, and for the report
// only the hub's workspace routes) with the package's
// findAvoided and prints what it finds. A finding fails the check in a file listed
// in BROUGHT, or under a folder listed there: the files brought to the vocabulary.
// The first three surfaces are, since 2026-11-19; a surface that is not listed
// reports without failing. A string that keeps an avoided word on
// purpose carries `vocabulary-allow: <word>` in a comment on its line or the line
// above, with the reason beside it.
//
// Runs in CI's app job, which runs for documents alone too, and from the root:
//   npm run check:vocabulary            the check, and a summary of the pages
//   npm run check:vocabulary -- --all   every finding on the pages, by file and line
// No dependencies for the check itself; the pages are parsed with the workspace's
// own TypeScript (`npm ci` at the root). Node 22.18 or later, which runs the
// package's TypeScript source as it is. The tests are packages/vocabulary/test/.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const PATHS = {
  vocabulary: 'packages/vocabulary/vocabulary.json',
  schema: 'packages/vocabulary/vocabulary.schema.json',
  document: 'docs/naming-vocabulary.md',
};

// The sections whose rows are shared concepts (ADR-0073 decision 8): every Chosen
// cell in them must be claimed. Section 16 holds Quiver's own words, which stay out.
const SHARED_SECTIONS = { from: 4, to: 15 };

// What a placeholder in a name may stand as in the document, beside itself: the
// document's standing examples. Each is a regular expression's source.
const EXAMPLES = {
  parent: ['main'],
  branch: ['<parent>', 'main'],
  instance: ['Westfield Armature'],
  n: ['\\d+'],
};

// Words a Chosen cell may hold that are not names. A cell that gains another fails
// the check, and the answer is a term in the file or, rarely, a phrase here.
const QUALIFIERS = [
  'until ADR-0072 is built',
  'until requests are built',
  'no person-facing name',
  'as the page title',
  'inside the app',
  '(administrators)',
  '(developers)',
  '(documents)',
  'spaced forms',
  'part of the',
  'not cloned',
  'not shown',
  '(people)',
  'if built',
  '(pages)',
  '(API)',
  'then',
  'kept',
];

// What has been brought to the vocabulary, as paths from the repository's root: a
// file, or a folder with everything under it. A finding there fails the check
// (ADR-0073 decision 6); the list is Armature's, not the package's. The three
// surfaces were reworded together on 2026-11-19.
export const BROUGHT = ['desktop/src', 'app/lib/desktop', 'app/app'];

// Whether a file is held to the vocabulary: listed itself, or under a folder that is.
export function isBrought(file, brought = BROUGHT) {
  return brought.some((path) => file === path || file.startsWith(`${path}/`));
}

// Armature's own surfaces a person reads.
export const SURFACES = [
  { name: "The desktop app's pages and components", dir: 'desktop/src', include: /\.tsx$/ },
  { name: "The desktop core's messages", dir: 'app/lib/desktop', include: /\.ts$/, exclude: /\.test\.ts$/ },
  { name: "The viewer's pages", dir: 'app/app', include: /\.tsx$/ },
  // Not in BROUGHT: the API's messages are read by tool authors too, for whom "remote" and "ETag" are
  // the right words. The refusals a person meets on a page were reworded on 2026-11-19; what this
  // reports is the rest, a hub's messages about itself and about a proxy in front of an instance.
  { name: "The hub's workspace routes, for the report only", dir: 'app/lib/api', include: /^app\/lib\/api\/(workspace\/[^/]+|routes\/workspace)\.ts$/, exclude: /\.test\.ts$/ },
];

// ---------------------------------------------------------------------------
// The schema. A validator for the keywords vocabulary.schema.json uses and no
// others, so the check needs no dependency; a keyword it does not know is an
// error, so the schema cannot outgrow it unnoticed.

const ANNOTATIONS = new Set(['$schema', '$defs', 'title', 'description']);

export function validate(schema, value, at = '$', whole = schema) {
  const errors = [];
  const fail = (message) => errors.push(`${at}: ${message}`);
  for (const [keyword, rule] of Object.entries(schema)) {
    if (ANNOTATIONS.has(keyword)) continue;
    switch (keyword) {
      case '$ref': {
        const target = rule.startsWith('#/$defs/') ? whole.$defs?.[rule.slice(8)] : undefined;
        if (!target) throw new Error(`The schema refers to ${rule}, which it does not define.`);
        errors.push(...validate(target, value, at, whole));
        break;
      }
      case 'type': {
        const is = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
        if (is !== rule) fail(`is ${is === 'object' ? 'an object' : is === 'array' ? 'an array' : `${is}`}, not ${rule}`);
        break;
      }
      case 'enum':
        if (!rule.includes(value)) fail(`is ${JSON.stringify(value)}, not one of ${rule.map((v) => JSON.stringify(v)).join(', ')}`);
        break;
      case 'pattern':
        if (typeof value === 'string' && !new RegExp(rule).test(value)) fail(`${JSON.stringify(value)} does not match ${rule}`);
        break;
      case 'minLength':
        if (typeof value === 'string' && value.length < rule) fail('is empty');
        break;
      case 'minimum':
        if (typeof value === 'number' && value < rule) fail(`is ${value}, below ${rule}`);
        break;
      case 'minItems':
        if (Array.isArray(value) && value.length < rule) fail(`has ${value.length} entries, fewer than ${rule}`);
        break;
      case 'uniqueItems':
        if (rule && Array.isArray(value) && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) fail('repeats an entry');
        break;
      case 'minProperties':
        if (isObject(value) && Object.keys(value).length < rule) fail('is empty');
        break;
      case 'required':
        if (isObject(value)) for (const key of rule) if (!(key in value)) fail(`has no "${key}"`);
        break;
      case 'properties':
        if (isObject(value)) {
          for (const [key, sub] of Object.entries(rule)) {
            if (key in value) errors.push(...validate(sub, value[key], `${at}.${key}`, whole));
          }
        }
        break;
      case 'additionalProperties':
        if (rule !== false) throw new Error('The check knows additionalProperties only as false.');
        if (isObject(value)) for (const key of Object.keys(value)) if (!(key in (schema.properties ?? {}))) fail(`has "${key}", which the schema does not know`);
        break;
      case 'items':
        if (Array.isArray(value)) {
          value.forEach((item, i) => errors.push(...validate(rule, item, `${at}[${labelOf(item, i)}]`, whole)));
        }
        break;
      default:
        throw new Error(`The schema uses "${keyword}", which scripts/check_vocabulary.js does not check. Teach it the keyword, with a test.`);
    }
  }
  return errors;
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// An entry is named by its id or its word where it has one, so an error is found without counting.
function labelOf(item, index) {
  return isObject(item) && typeof (item.id ?? item.word) === 'string' ? (item.id ?? item.word) : index;
}

// ---------------------------------------------------------------------------
// The document.

function plain(cell) {
  return cell.replace(/`/g, '').replace(/\*\*/g, '').trim();
}

// The rows of every "| Concept | … | Recommended | Chosen |" table, with the numbered
// collisions of section 1 and principles of section 2, which an avoided entry may cite.
export function parseDocument(markdown) {
  const rows = [];
  const problems = [];
  const sections = new Set();
  const collisions = new Set();
  const principles = new Set();
  let section = 0;
  let heading = '';
  let table = null;
  markdown.split('\n').forEach((line, index) => {
    const title = /^## (\d+)\. /.exec(line);
    if (title) {
      section = Number(title[1]);
      sections.add(section);
      heading = '';
    } else if (line.startsWith('### ')) {
      heading = line.slice(4).trim();
    }
    const numbered = /^(\d+)\. \*\*/.exec(line);
    if (numbered && section === 1) collisions.add(Number(numbered[1]));
    if (numbered && section === 2 && heading === 'Principles') principles.add(Number(numbered[1]));

    if (!line.startsWith('|')) {
      table = null;
      return;
    }
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (!table) {
      // Section 2's table of metaphors has a Concept column too; a row of names has all three.
      table = ['Concept', 'Recommended', 'Chosen'].every((column) => cells.includes(column)) ? { columns: cells } : { columns: null };
      return;
    }
    if (!table.columns || cells.every((cell) => /^-+$/.test(cell))) return;
    if (cells.length !== table.columns.length) {
      problems.push(`${PATHS.document}:${index + 1}: the row has ${cells.length} cells where its table has ${table.columns.length}; a "|" inside a cell splits it.`);
      return;
    }
    const cell = (column) => cells[table.columns.indexOf(column)] ?? '';
    rows.push({
      section,
      concept: plain(cell('Concept')),
      recommended: cell('Recommended'),
      chosen: plain(cell('Chosen')),
      line: index + 1,
    });
  });
  return { rows, sections, collisions, principles, problems };
}

// ---------------------------------------------------------------------------
// The file against the document.

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const EDGE_BEFORE = '(?<![A-Za-z0-9])';
const EDGE_AFTER = '(?![A-Za-z0-9])';

// A name as the document may write it: whole, a placeholder as itself or its example,
// and its first letter in either case, since a cell may begin a sentence with it.
function namePattern(name) {
  let source = name
    .split(/(<[a-z]+>)/)
    .map((piece) => {
      const placeholder = /^<([a-z]+)>$/.exec(piece);
      if (!placeholder) return escape(piece);
      return `(?:${[escape(piece), ...(EXAMPLES[placeholder[1]] ?? [])].join('|')})`;
    })
    .join('');
  source = source.replace(/^[A-Za-z]/, (letter) => `[${letter.toUpperCase()}${letter.toLowerCase()}]`);
  return new RegExp(`${EDGE_BEFORE}${source}${EDGE_AFTER}`, 'g');
}

function has(text, name) {
  return namePattern(name).test(text);
}

function same(a, b) {
  return a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase();
}

function shares(a, b) {
  return a.some((audience) => b.includes(audience));
}

function rowKey(row) {
  return `${row.section}|${row.concept}`;
}

function rowName(row) {
  return `§${row.section} "${row.concept}"`;
}

function boldPhrases(cell) {
  return [...cell.matchAll(/\*\*(.+?)\*\*/g)].map((found) => plain(found[1]));
}

// Every disagreement between a vocabulary that passed the schema and the parsed document, in words.
export function checkVocabulary(vocabulary, document) {
  const problems = [...document.problems];
  const rows = new Map(document.rows.map((row) => [rowKey(row), row]));
  const termsById = new Map();
  for (const term of vocabulary.terms) {
    if (termsById.has(term.id)) problems.push(`term ${term.id}: the id is used twice; an id names one term.`);
    termsById.set(term.id, term);
  }

  // What each row's Chosen cell may hold: the names of its terms, their names for until
  // then, their identifiers, and the reserved words that cite the row.
  const claims = new Map();
  const claim = (row, text) => claims.set(rowKey(row), [...(claims.get(rowKey(row)) ?? []), text]);

  for (const term of vocabulary.terms) {
    const at = rows.get(rowKey(term.row));
    if (!at) {
      problems.push(`term ${term.id}: its row ${rowName(term.row)} is not a row of ${PATHS.document}.`);
      continue;
    }
    const filled = at.chosen !== '';
    if (filled !== (term.status === 'chosen')) {
      problems.push(filled
        ? `term ${term.id}: its status is "${term.status}", but the Chosen cell of ${rowName(term.row)} is filled; the status is "chosen".`
        : `term ${term.id}: its status is "chosen", but the Chosen cell of ${rowName(term.row)} is empty.`);
    }
    if (term.row.in === 'recommended') {
      if (!has(plain(at.recommended), term.name)) {
        problems.push(`term ${term.id}: its name "${term.name}" is not in the Recommended cell of ${rowName(term.row)}.`);
      }
    } else if (!filled) {
      if (!boldPhrases(at.recommended).some((phrase) => has(phrase, term.name))) {
        problems.push(`term ${term.id}: its name "${term.name}" is not a bold phrase of the Recommended cell of ${rowName(term.row)}, whose Chosen cell is empty.`);
      }
    } else if (!has(at.chosen, term.name) && !same(term.name, at.concept)) {
      problems.push(`term ${term.id}: its name "${term.name}" is not in the Chosen cell of ${rowName(term.row)}, which reads "${at.chosen}".`);
    }
    if (term.until?.name && filled && !has(at.chosen, term.until.name) && !(term.also ?? []).some((row) => has(rows.get(rowKey(row))?.chosen ?? '', term.until.name))) {
      problems.push(`term ${term.id}: its name for until then, "${term.until.name}", is not in the Chosen cell of ${rowName(term.row)} or of a row it also names.`);
    }
    if (term.row.in !== 'recommended') {
      for (const text of [term.name, term.until?.name, ...(term.identifiers ?? [])]) if (text) claim(term.row, text);
    }
    for (const row of term.also ?? []) {
      const other = rows.get(rowKey(row));
      if (!other) {
        problems.push(`term ${term.id}: it also names ${rowName(row)}, which is not a row of ${PATHS.document}.`);
      } else if (!has(other.chosen, term.name) && !(term.until?.name && has(other.chosen, term.until.name))) {
        problems.push(`term ${term.id}: its name "${term.name}" is not in the Chosen cell of ${rowName(row)}, which reads "${other.chosen}".`);
      }
      for (const text of [term.name, term.until?.name]) if (text) claim(row, text);
    }
  }

  for (const entry of vocabulary.reserved) {
    const owner = termsById.get(entry.for);
    if (!owner) problems.push(`reserved "${entry.word}": it is for "${entry.for}", which is no term's id.`);
    for (const term of vocabulary.terms) {
      if (term.id !== entry.for && same(term.name, entry.word) && shares(term.audience, entry.audience)) {
        problems.push(`reserved "${entry.word}": it is reserved for ${entry.for} and is also the name of ${term.id}, for a shared audience.`);
      }
    }
    if (!entry.row) continue;
    const at = rows.get(rowKey(entry.row));
    if (!at) {
      problems.push(`reserved "${entry.word}": its row ${rowName(entry.row)} is not a row of ${PATHS.document}.`);
    } else if (!has(at.chosen !== '' ? at.chosen : plain(at.recommended), entry.word)) {
      problems.push(`reserved "${entry.word}": it is not in the ${at.chosen !== '' ? 'Chosen' : 'Recommended'} cell of ${rowName(entry.row)}.`);
    }
    claim(entry.row, entry.word);
  }

  for (const entry of vocabulary.avoided) {
    const words = [entry.word, ...(entry.forms ?? [])];
    const name = `avoided "${entry.word}"${entry.for === '*' ? '' : ` for ${entry.for}`}`;
    if (entry.for !== '*') {
      const target = termsById.get(entry.for);
      if (!target) {
        problems.push(`${name}: "${entry.for}" is no term's id.`);
      } else if (words.some((word) => same(word, target.name)) && shares(target.audience, entry.audience)) {
        problems.push(`${name}: the word is that term's own name, for a shared audience.`);
      }
    }
    if (entry.use && !termsById.has(entry.use)) problems.push(`${name}: its "use", "${entry.use}", is no term's id.`);
    const cited = /^§(\d+)(?:, (?:collision (\d+)|principle (\d+)|(.+)))?$/.exec(entry.row);
    const [section, collision, principle, concept] = cited ? [Number(cited[1]), cited[2], cited[3], cited[4]] : [];
    if (!cited || !document.sections.has(section)
      || (collision && !(section === 1 && document.collisions.has(Number(collision))))
      || (principle && !(section === 2 && document.principles.has(Number(principle))))
      || (concept && !rows.has(rowKey({ section, concept })))) {
      problems.push(`${name}: its row "${entry.row}" names no section, collision, principle or row of ${PATHS.document}.`);
    }
  }

  // Every word of a shared row's Chosen cell is a name the file holds.
  for (const row of document.rows) {
    if (row.section < SHARED_SECTIONS.from || row.section > SHARED_SECTIONS.to || row.chosen === '') continue;
    let rest = row.chosen;
    for (const text of [...new Set(claims.get(rowKey(row)) ?? [])].sort((a, b) => b.length - a.length)) {
      rest = rest.replace(namePattern(text), ' ');
    }
    for (const qualifier of QUALIFIERS) rest = rest.split(qualifier).join(' ');
    rest = rest.replace(/[\s;,.:"'“”]+/g, ' ').trim();
    if (rest) {
      problems.push(`${PATHS.document}:${row.line}: the Chosen cell of ${rowName(row)} holds "${rest}", which no term of ${PATHS.vocabulary} claims. Add the term, or correct the cell.`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Armature's own pages.

// A JSX attribute whose value a person reads or hears.
const PROSE_ATTRIBUTES = new Set(['title', 'placeholder', 'alt', 'label', 'aria-label', 'aria-description', 'description', 'hint', 'summary']);
// A JSX attribute whose expression holds no prose.
const CODE_ATTRIBUTES = new Set(['className', 'class', 'style', 'href', 'src', 'id', 'key', 'type', 'variant', 'size', 'name', 'htmlFor', 'role', 'rel', 'target', 'to']);

// Whether a string outside the markup reads as words for a person, not as code: a
// sentence or a capitalized label, never an identifier, a path or a list of classes.
function isProse(text) {
  const trimmed = text.trim();
  if (!/[A-Za-z]{2}/.test(trimmed)) return false;
  const words = trimmed.split(/\s+/);
  if (words.length === 1) return /^[A-Z][a-z]+[.…:?!]*$/.test(trimmed);
  if (words.some((word) => /[_=/\\[\]{}<>@#]|-\d|\w:\w/.test(word))) return false;
  return /^[A-Z“"(]/.test(trimmed) || words.length >= 3;
}

// The strings of one source file a person may read, each with its line: the text of
// the markup, the attributes a person reads, and the literals that read as prose.
export function surfaceStrings(ts, file, source) {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const add = (node, text) => found.push({ line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1, text });
  const compared = new Set([
    ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
    ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
  ]);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) return;
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(tree);
      const value = node.initializer;
      if (value && ts.isStringLiteral(value)) {
        if (PROSE_ATTRIBUTES.has(name)) add(value, value.text);
        return;
      }
      if (CODE_ATTRIBUTES.has(name) || name.startsWith('data-')) return;
    }
    if (ts.isJsxText(node)) {
      const text = node.text.replace(/\s+/g, ' ').trim();
      if (text) add(node, text);
    } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      const isCode = (ts.isBinaryExpression(parent) && compared.has(parent.operatorToken.kind))
        || ts.isCaseClause(parent)
        || ts.isElementAccessExpression(parent)
        || ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node);
      if (!isCode && isProse(node.text)) add(node, node.text);
    } else if (ts.isTemplateExpression(node)) {
      const text = node.head.text + node.templateSpans.map((span) => `…${span.literal.text}`).join('');
      if (isProse(text)) add(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return found;
}

// The avoided words in one file's strings, for people. A marker on a string's line
// or the line above it exempts the words it names.
export function surfaceFindings(ts, findAvoided, file, source) {
  const lines = source.split('\n');
  const findings = [];
  for (const { line, text } of surfaceStrings(ts, file, source)) {
    const markers = [lines[line - 2] ?? '', lines[line - 1] ?? '']
      .flatMap((nearby) => nearby.match(/vocabulary-allow:[^\n\r*}]*/gi) ?? []);
    for (const finding of findAvoided([text, ...markers].join('\n'), 'people')) {
      findings.push({ file, line, text, ...finding });
    }
  }
  return findings;
}

function filesUnder(dir, surface) {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    .filter((file) => surface.include.test(file) && !surface.exclude?.test(file) && !file.includes('node_modules/'))
    .sort();
}

// ---------------------------------------------------------------------------

async function main() {
  const all = process.argv.includes('--all');
  const read = (path) => readFileSync(join(root, path), 'utf8');
  const vocabulary = JSON.parse(read(PATHS.vocabulary));
  const invalid = validate(JSON.parse(read(PATHS.schema)), vocabulary);
  if (invalid.length) {
    console.error(`FAIL  ${PATHS.vocabulary} does not match ${PATHS.schema}:`);
    for (const error of invalid) console.error(`      ${error}`);
    process.exit(1);
  }
  const problems = checkVocabulary(vocabulary, parseDocument(read(PATHS.document)));
  if (problems.length) {
    console.error(`FAIL  ${PATHS.vocabulary} and ${PATHS.document} disagree (${problems.length}). A name changes in one pull request touching both:`);
    for (const problem of problems) console.error(`      ${problem}`);
    process.exit(1);
  }
  console.log(`ok    ${PATHS.vocabulary} (revision ${vocabulary.revision}): ${vocabulary.terms.length} terms, ${vocabulary.reserved.length} reserved words, ${vocabulary.avoided.length} avoided words, each held to ${PATHS.document}`);

  let ts;
  try {
    ts = (await import('typescript')).default;
  } catch {
    if (BROUGHT.length) {
      console.error('FAIL  TypeScript is not installed, so the pages brought to the vocabulary cannot be read. Run `npm ci` at the root.');
      process.exit(1);
    }
    console.log('skip  The pages were not read: TypeScript is not installed (`npm ci` at the root).');
    return;
  }
  const { findAvoided } = await import(pathToFileURL(join(root, 'packages/vocabulary/src/index.ts')).href);

  const failing = [];
  for (const surface of SURFACES) {
    const findings = filesUnder(surface.dir, surface).flatMap((file) => surfaceFindings(ts, findAvoided, file, read(file)));
    failing.push(...findings.filter((finding) => isBrought(finding.file)));
    const files = new Set(findings.map((finding) => finding.file));
    console.log(`\n${surface.name} (${surface.dir}): ${findings.length} avoided ${findings.length === 1 ? 'word' : 'words'} in ${files.size} ${files.size === 1 ? 'file' : 'files'}`);
    if (all) {
      for (const finding of findings) {
        console.log(`      ${finding.file}:${finding.line}  "${finding.match}"${finding.instead ? ` → ${finding.instead}` : ''}  in "${clip(finding.text)}"`);
      }
    } else {
      const counts = new Map();
      for (const finding of findings) counts.set(finding.word, (counts.get(finding.word) ?? 0) + 1);
      const most = [...counts].sort((a, b) => b[1] - a[1]).map(([word, count]) => `${word} ${count}`);
      if (most.length) console.log(`      ${most.join(', ')}`);
    }
  }
  if (failing.length) {
    console.error(`\nFAIL  ${failing.length} avoided ${failing.length === 1 ? 'word' : 'words'} in files brought to the vocabulary. Use the word given, or mark an allowed use with \`vocabulary-allow: <word>\` in a comment beside it:`);
    for (const finding of failing) {
      console.error(`      ${finding.file}:${finding.line}  "${finding.match}"${finding.instead ? `: use "${finding.instead}"` : ''}. ${finding.reason}${finding.allowed ? ` Allowed: ${finding.allowed}` : ''}`);
    }
    process.exit(1);
  }
  console.log(`\nok    Armature's own pages hold to the vocabulary: no avoided word under ${BROUGHT.join(', ')} (ADR-0073 decision 6).`);
}

function clip(text) {
  return text.length > 70 ? `${text.slice(0, 67)}…` : text;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
