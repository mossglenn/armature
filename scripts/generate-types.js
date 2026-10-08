#!/usr/bin/env node
/**
 * generate-types.js
 * Generates app/lib/types.ts from Armature's schema.json.
 *
 * schema.json is the single source of truth for all type information.
 * This generator derives TypeScript interfaces and union types from it
 * so that app/lib/types.ts never needs to be hand-maintained.
 *
 * Usage (from repo root):
 *   node scripts/generate-types.js           # write types.ts
 *   node scripts/generate-types.js --check   # exit 1 if types.ts is out of sync
 *
 * Usage (from armature/app/):
 *   npm run generate:types
 *   npm run check:types
 *
 * --check is intended for CI. It regenerates the file in memory, diffs
 * against the committed version, and exits non-zero if they differ.
 * Run `npm run generate:types` to fix drift.
 *
 * Schema path:  schema/schema.json   (relative to repo root)
 * Output path:  app/lib/types.ts     (relative to repo root)
 *
 * --- Type mapping decisions ---
 *
 * TerminusDB field values map to TypeScript as follows:
 *
 *   xsd:string / xsd:anyURI        → string
 *   xsd:boolean                    → boolean
 *   xsd:integer                    → number
 *   xsd:decimal                    → number
 *   xsd:dateTime                   → string  (ISO 8601 datetime)
 *   xsd:date                       → string  (ISO 8601 date)
 *   sys:JSON                       → unknown (schema-free JSON payload)
 *   Optional<T>                    → T (field marked optional with ?)
 *   Set<T> / List<T> / Array<T>    → T[]
 *   Reference to a document Class  → string  (TerminusDB @id)
 *   Reference to a @subdocument    → the subdocument's interface, inline
 *   Enum reference                 → the generated union type
 *
 * References to document classes become `string` because TerminusDB
 * returns @id strings in query results, not inline nested objects.
 * Subdocuments are the exception: the store returns them inline by
 * default (verified on v12.0.7, scripts/platform_checks.js check D), each
 * carrying its own nested @id and @type, so they are typed as objects.
 * Inline comments on reference fields (e.g. `// Module @id`) preserve
 * the semantic target for readers.
 *
 * --- Schema self-description (ADR-0027) ---
 *
 * Every class declares @metadata.armature.category, one of:
 *   infrastructure  User, DesignRecord, ArmatureDocument
 *   fragment        @subdocument classes: parts of an artifact (ADR-0033)
 *   artifact        primary instructional artifacts
 *   relationship    reified relationships (junction documents)
 *
 * Output is grouped by category in that order, schema order within each
 * group. There is no hand-maintained list of types in this file: adding a
 * class to schema.json with its category is the whole job. A class with no
 * category fails generation, so the omission is caught by check:types in CI.
 *
 * Inheritance is emitted as declared: a class extends the first entry of
 * its @inherits, or TerminusDocument if it has none. Junction documents
 * therefore extend DesignRecord (ADR-0017), and the artifact types extend
 * ArmatureDocument.
 *
 * Abstract classes (@abstract) emit a normal interface with an @abstract
 * JSDoc tag. A class with no own properties emits a type alias, since an
 * empty interface is equivalent and is rejected by the app's lint config.
 *
 * --- Extending the generator ---
 *
 * Phase 3 of docs/development-plan.md adds a second output pass emitting
 * Zod request schemas for the generic write route (ADR-0054 decision 4).
 * resolveFieldType and isOptional map cleanly to z.string(), z.boolean(),
 * z.optional(), z.array(), etc.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHECK_MODE = process.argv.includes('--check');
const schemaPath = join(__dirname, '../schema/schema.json');
const outputPath = join(__dirname, '../app/lib/types.ts');

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Schema meta-keys to exclude when iterating a Class entry's fields.
 * Everything not in this set is treated as a typed field to emit.
 */
const SKIP_KEYS = new Set([
  '@type', '@id', '@inherits', '@abstract', '@subdocument', '@documentation',
  '@comment', '@key', '@metadata', '@min_cardinality',
]);

/** Category emission order and the heading each group gets. */
const CATEGORIES = [
  ['infrastructure', 'Infrastructure — User, and the abstract roots every record inherits'],
  ['fragment',       'Fragments — subdocument parts of an artifact, returned inline (ADR-0033)'],
  ['artifact',       'Artifacts — primary instructional design documents'],
  ['relationship',   'Relationships — reified junction documents; no label / description / createdBy unless they inherit ArmatureDocument'],
];

/**
 * Mapping from TerminusDB primitive types to TypeScript primitives.
 * xsd:dateTime and xsd:date both become string — TerminusDB returns ISO 8601
 * strings, not Date objects. Inline comments in the output mark the format.
 */
const XSD_MAP = {
  'xsd:string':   'string',
  'xsd:boolean':  'boolean',
  'xsd:integer':  'number',
  'xsd:decimal':  'number',
  'xsd:dateTime': 'string',
  'xsd:date':     'string',
  'xsd:anyURI':   'string',
  'sys:JSON':     'unknown',
};

// ── Schema parsing ────────────────────────────────────────────────────────────

const classes = {};
const enums = {};

for (const entry of schema) {
  if (entry['@type'] === '@context') continue;
  if (entry['@type'] === 'Class') classes[entry['@id']] = entry;
  if (entry['@type'] === 'Enum')  enums[entry['@id']]   = entry;
}

const classIds  = new Set(Object.keys(classes));
const enumIds   = new Set(Object.keys(enums));
const subdocIds = new Set(Object.values(classes).filter((c) => c['@subdocument'] !== undefined).map((c) => c['@id']));

/** Category of a class from @metadata.armature.category. Fails loudly if absent (ADR-0027). */
function categoryOf(entry) {
  const cat = entry['@metadata']?.armature?.category;
  if (!cat) {
    console.error(`✗ ${entry['@id']} has no @metadata.armature.category — every class must declare one (ADR-0027)`);
    process.exit(1);
  }
  if (!CATEGORIES.some(([c]) => c === cat)) {
    console.error(`✗ ${entry['@id']} has unknown category "${cat}"; expected one of ${CATEGORIES.map(([c]) => c).join(', ')}`);
    process.exit(1);
  }
  return cat;
}

// ── Type resolution ───────────────────────────────────────────────────────────

/**
 * Resolve a TerminusDB field value to a TypeScript type string.
 *
 * Handles:
 *   - primitives → TypeScript primitives via XSD_MAP
 *   - Enum @ids → the enum's union type name
 *   - @subdocument Class @ids → the interface name (returned inline)
 *   - other Class @ids → `string` (TerminusDB @id reference)
 *   - Optional<T> → resolves T (caller marks the field key with `?`)
 *   - Set<T> / List<T> / Array<T> → `T[]`
 *
 * @param {string|object} val - A TerminusDB field value from schema.json
 * @returns {string} TypeScript type string
 */
function resolveFieldType(val) {
  if (typeof val === 'string') {
    if (XSD_MAP[val])       return XSD_MAP[val];
    if (enumIds.has(val))   return val;        // enum union type name
    if (subdocIds.has(val)) return val;        // inline subdocument
    if (classIds.has(val))  return 'string';   // @id reference to another document
    return 'string';                           // unknown — safe fallback
  }
  if (!val || typeof val !== 'object') return 'unknown';
  const inner = val['@class'];
  switch (val['@type']) {
    case 'Optional': return resolveFieldType(inner);           // unwrap; caller adds `?`
    case 'Set':
    case 'List':
    case 'Array':    return `${resolveFieldType(inner)}[]`;    // typed array
    default:         return resolveFieldType(inner ?? val);
  }
}

/**
 * Returns true if the field value is an Optional wrapper.
 * Used to determine whether to emit `field?:` vs `field:`.
 *
 * @param {*} val - A TerminusDB field value from schema.json
 * @returns {boolean}
 */
function isOptional(val) {
  return typeof val === 'object' && val !== null && val['@type'] === 'Optional';
}

/**
 * Returns an inline comment for a field that is a document reference or
 * a date/datetime type, to preserve semantic target info for readers.
 * Subdocument fields get no comment: their type already names the shape.
 *
 * Examples:
 *   "Module"              → "// Module @id"
 *   Optional<Assessment>  → "// Assessment @id"
 *   Set<LearningObjective>→ "// LearningObjective @id[]"
 *   xsd:dateTime          → "// ISO 8601 datetime"
 *
 * @param {string|object} fieldVal - The raw field value from schema.json
 * @returns {string|null}
 */
function refComment(fieldVal) {
  let target  = null;
  let isArray = false;

  if (typeof fieldVal === 'string' && classIds.has(fieldVal)) {
    target = fieldVal;
  } else if (fieldVal?.['@type'] === 'Optional' && classIds.has(fieldVal['@class'])) {
    target = fieldVal['@class'];
  } else if (
    (fieldVal?.['@type'] === 'Set' || fieldVal?.['@type'] === 'List') &&
    classIds.has(fieldVal['@class'])
  ) {
    target  = fieldVal['@class'];
    isArray = true;
  }

  if (target && subdocIds.has(target)) return null;
  if (target) return `// ${target} @id${isArray ? '[]' : ''}`;

  // Date/datetime annotations — these become `string` in TS but the format matters
  const raw = typeof fieldVal === 'string' ? fieldVal : fieldVal?.['@class'];
  if (raw === 'xsd:dateTime') return '// ISO 8601 datetime';
  if (raw === 'xsd:date')     return '// ISO 8601 date';
  return null;
}

/**
 * Returns the data fields of a schema Class entry,
 * excluding all schema meta-keys (see SKIP_KEYS).
 *
 * @param {object} entry - A Class entry from schema.json
 * @returns {[string, *][]} Array of [fieldName, fieldValue] pairs
 */
function getFields(entry) {
  return Object.entries(entry).filter(([k]) => !SKIP_KEYS.has(k));
}

/**
 * Returns the TypeScript base interface name for a Class entry:
 * the first @inherits parent, or TerminusDocument when there is none.
 *
 * @param {object} entry - A Class entry from schema.json
 * @returns {string} Interface name to extend
 */
function baseInterface(entry) {
  const inherits = entry['@inherits'];
  if (!inherits) return 'TerminusDocument';
  return Array.isArray(inherits) ? inherits[0] : inherits;
}

// ── Code generation helpers ───────────────────────────────────────────────────

/** Output line buffer. Joined at the end to produce the final file. */
const out = [];

/** Append a line (or blank line) to the output buffer. */
function line(s = '') { out.push(s); }

/** Emit a named section divider. */
function divider(label) {
  line(`// ${'─'.repeat(56)}`);
  line(`// ${label}`);
  line(`// ${'─'.repeat(56)}`);
  line();
}

/**
 * Emit field declarations for a Class entry into the output buffer.
 * Handles optional fields, type resolution, and reference annotations.
 *
 * @param {object} entry - A Class entry from schema.json
 */
function renderClassFields(entry) {
  for (const [k, v] of getFields(entry)) {
    const opt     = isOptional(v);
    const tsType  = resolveFieldType(opt ? v['@class'] : v);
    const comment = refComment(v);
    line(`  ${k}${opt ? '?' : ''}: ${tsType};${comment ? `  ${comment}` : ''}`);
  }
}

/**
 * Emit one class as an interface, or as a type alias when it adds no fields.
 *
 * @param {object} entry - A Class entry from schema.json
 */
function renderClass(entry) {
  const id         = entry['@id'];
  const base       = baseInterface(entry);
  const tags       = [];
  if (entry['@abstract'] !== undefined)    tags.push('@abstract');
  if (entry['@subdocument'] !== undefined) tags.push('@subdocument — returned inline with a nested @id; cannot be referenced from another document');
  if (tags.length) line(`/** ${tags.join(' · ')} */`);

  // A class with no own properties is emitted as a type alias, not an empty
  // interface. `interface X extends Y {}` is equivalent to `type X = Y` and is
  // rejected by @typescript-eslint/no-empty-object-type in the app's lint config.
  if (getFields(entry).length === 0) {
    line(`export type ${id} = ${base};  // no additional fields`);
    line();
    return;
  }

  line(`export interface ${id} extends ${base} {`);
  renderClassFields(entry);
  line(`}`);
  line();
}

// ── Generated file header ─────────────────────────────────────────────────────

line(`// GENERATED — do not edit manually`);
line(`// Source:      schema/schema.json`);
line(`// Regenerate:  npm run generate:types  (from armature/app/)`);
line(`// Check drift: npm run check:types`);
line(`//`);
line(`// To update types, modify schema/schema.json and re-run the generator.`);
line();

// ── Enums ─────────────────────────────────────────────────────────────────────

divider('Enums');

line(`/**`);
line(` * Runtime allowlists for every TerminusDB enum type.`);
line(` * Each VALID_* array is the source of truth — the union type is derived from it.`);
line(` *`);
line(` * Use with validateEnum() in route handlers:`);
line(` *   validateEnum(body.bloomsLevel, 'bloomsLevel', VALID_BloomsLevel, false)`);
line(` *`);
line(` * The arrays are readonly tuples so TypeScript can narrow the derived union type.`);
line(` */`);
line();

for (const [id, entry] of Object.entries(enums)) {
  const values = entry['@value'] || [];
  // Emit the const array first — this is the runtime value
  line(`export const VALID_${id} = [`);
  values.forEach((v) => line(`  "${v}",`));
  line(`] as const;`);
  line();
  // Derive the union type from the array — not duplicated, always in sync
  line(`export type ${id} = typeof VALID_${id}[number];`);
  line();
}

// ── Base type ─────────────────────────────────────────────────────────────────

divider('Base type');

line(`/** Every document and subdocument stored in TerminusDB carries @id and @type. */`);
line(`export interface TerminusDocument {`);
line(`  "@id": string;`);
line(`  "@type": string;`);
line(`}`);
line();

// ── Classes, grouped by category ──────────────────────────────────────────────

/**
 * Runtime map from class @id to category, exported so the app can ask
 * "is this type a relationship?" without a second copy of the taxonomy.
 */
const byCategory = new Map(CATEGORIES.map(([c]) => [c, []]));
for (const entry of Object.values(classes)) byCategory.get(categoryOf(entry)).push(entry);

for (const [category, heading] of CATEGORIES) {
  const group = byCategory.get(category);
  if (group.length === 0) continue;
  divider(heading);
  for (const entry of group) renderClass(entry);
}

divider('Schema self-description (ADR-0027)');

line(`/** Every class @id mapped to its @metadata.armature.category. */`);
line(`export const CLASS_CATEGORY = {`);
for (const entry of Object.values(classes)) {
  line(`  ${entry['@id']}: "${categoryOf(entry)}",`);
}
line(`} as const;`);
line();
line(`export type ClassName = keyof typeof CLASS_CATEGORY;`);
line(`export type ClassCategory = typeof CLASS_CATEGORY[ClassName];`);
line();
line(`/** Subdocument classes: returned inline, never addressable on their own (ADR-0022, ADR-0033). */`);
line(`export const SUBDOCUMENT_CLASSES = [`);
for (const id of subdocIds) line(`  "${id}",`);
line(`] as const;`);
line();

// ── Write / check ─────────────────────────────────────────────────────────────

const output = out.join('\n').trimEnd() + '\n';

if (CHECK_MODE) {
  if (!existsSync(outputPath)) {
    console.error(`✗ ${outputPath} does not exist — run npm run generate:types first`);
    process.exit(1);
  }
  const existing = readFileSync(outputPath, 'utf8');
  if (existing !== output) {
    console.error(`✗ types.ts is out of sync with schema.json — run npm run generate:types`);
    process.exit(1);
  }
  console.log(`✓ types.ts is in sync with schema.json`);
} else {
  writeFileSync(outputPath, output, 'utf8');
  console.log(`✓ types.ts written to ${outputPath}`);
  console.log(`  Classes: ${Object.keys(classes).length} (${[...byCategory].map(([c, g]) => `${g.length} ${c}`).join(', ')})`);
  console.log(`  Enums:   ${Object.keys(enums).length}`);
}
