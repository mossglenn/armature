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
 *   Optional<T>                    → T (field marked optional with ?)
 *   Set<T> / List<T> / Array<T>    → T[]
 *   Reference to another Class     → string  (TerminusDB @id)
 *   Enum reference                 → the generated union type
 *
 * References to other Class types become `string` because TerminusDB
 * returns @id strings in query results, not inline nested objects.
 * Inline comments on reference fields (e.g. `// Module @id`) preserve
 * the semantic target for readers.
 *
 * Junction documents (Hash-keyed, no @inherits) extend TerminusDocument
 * rather than ArmatureDocument — they have no label/description/createdBy.
 * The JUNCTION_IDS set below is the authoritative list.
 *
 * Abstract classes (@abstract) emit a normal interface. The @abstract
 * flag is preserved as a JSDoc comment. TerminusDB prevents direct
 * instantiation; TypeScript does not, but the comment serves as a signal.
 *
 * --- Adding new types to schema.json ---
 *
 * 1. Add the new Class or Enum to schema/schema.json (with an ADR if it's
 *    a Class — see CLAUDE.md).
 * 2. If the new Class is a junction document (Hash-keyed, no @inherits),
 *    add its @id to the JUNCTION_IDS set below.
 * 3. Add the @id to CLASS_ORDER in the desired output section.
 * 4. Run: npm run generate:types (from armature/app/)
 * 5. Commit both schema.json and the updated types.ts together.
 *
 * --- Extending the generator ---
 *
 * To also generate Zod schemas for POST/PATCH input validation, add a
 * second output pass after the TypeScript generation. The resolveFieldType
 * and isOptional helpers map cleanly to Zod's z.string(), z.boolean(),
 * z.optional(), z.array(), etc. See SESSION.md for the deferred scope note.
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
  '@type', '@id', '@inherits', '@abstract', '@documentation',
  '@comment', '@key', '@metadata', '@min_cardinality',
]);

/**
 * Junction document @ids.
 *
 * Junction documents are Hash-keyed and have no @inherits — they represent
 * reified many-to-many relationships and do NOT carry label/description/createdBy.
 * They extend TerminusDocument rather than ArmatureDocument.
 *
 * Keep this list in sync with the junction types in schema.json.
 * If you add a new junction type, add its @id here AND to CLASS_ORDER below.
 */
const JUNCTION_IDS = new Set([
  'NeedEvidenceLink',
  'ActivityGroupMember',
  'ModuleObjective',
  'ModuleActivityLink',
  'ModuleActivityGroupLink',
  'ItemInstance',
]);

/**
 * Mapping from TerminusDB xsd primitive types to TypeScript primitives.
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
};

// ── Schema parsing ────────────────────────────────────────────────────────────

const classes = {};
const enums = {};

for (const entry of schema) {
  if (entry['@type'] === '@context') continue;
  if (entry['@type'] === 'Class') classes[entry['@id']] = entry;
  if (entry['@type'] === 'Enum')  enums[entry['@id']]   = entry;
}

const classIds = new Set(Object.keys(classes));
const enumIds  = new Set(Object.keys(enums));

// ── Type resolution ───────────────────────────────────────────────────────────

/**
 * Resolve a TerminusDB field value to a TypeScript type string.
 *
 * Handles:
 *   - xsd primitives → TypeScript primitives via XSD_MAP
 *   - Enum @ids → the enum's union type name
 *   - Class @ids → `string` (TerminusDB @id reference, not inline object)
 *   - Optional<T> → resolves T (caller marks the field key with `?`)
 *   - Set<T> / List<T> / Array<T> → `T[]`
 *
 * @param {string|object} val - A TerminusDB field value from schema.json
 * @returns {string} TypeScript type string
 */
function resolveFieldType(val) {
  if (typeof val === 'string') {
    if (XSD_MAP[val])      return XSD_MAP[val];
    if (enumIds.has(val))  return val;        // enum union type name
    if (classIds.has(val)) return 'string';   // @id reference to another document
    return 'string';                          // unknown — safe fallback
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
 *
 * Examples:
 *   "Module"              → "// Module @id"
 *   Optional<Assessment>  → "// Assessment @id"
 *   Set<LearningObjective>→ "// LearningObjective @id[]"
 *   xsd:dateTime          → "// ISO 8601 datetime"
 *
 * Returns null for fields that don't need annotation (primitives, enums).
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
 * Returns the TypeScript base interface name for a Class entry.
 *
 * Junction documents → TerminusDocument (no label/description/createdBy)
 * Classes with @inherits → the first parent's @id (e.g. ArmatureDocument)
 * All others → TerminusDocument
 *
 * @param {object} entry - A Class entry from schema.json
 * @returns {string} Interface name to extend
 */
function baseInterface(entry) {
  if (JUNCTION_IDS.has(entry['@id'])) return 'TerminusDocument';
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
  const fields = getFields(entry);
  if (fields.length === 0) {
    line(`  // no additional fields`);
    return;
  }
  for (const [k, v] of fields) {
    const opt     = isOptional(v);
    const tsType  = resolveFieldType(opt ? v['@class'] : v);
    const comment = refComment(v);
    line(`  ${k}${opt ? '?' : ''}: ${tsType};${comment ? `  ${comment}` : ''}`);
  }
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
  values.forEach((v, i) => {
    line(`  "${v}"${i === values.length - 1 ? ',' : ','}`);
  });
  line(`] as const;`);
  line();
  // Derive the union type from the array — not duplicated, always in sync
  line(`export type ${id} = typeof VALID_${id}[number];`);
  line();
}

// ── Base types ────────────────────────────────────────────────────────────────

divider('Base types');

line(`/** Every document stored in TerminusDB carries @id and @type. */`);
line(`export interface TerminusDocument {`);
line(`  "@id": string;`);
line(`  "@type": string;`);
line(`}`);
line();

// User — infrastructure type, rendered separately (not in CLASS_ORDER)
const userEntry = classes['User'];
if (userEntry) {
  line(`/** Infrastructure type — not an instructional artifact. Does not extend ArmatureDocument. */`);
  line(`export interface User extends TerminusDocument {`);
  renderClassFields(userEntry);
  line(`}`);
  line();
}

// ArmatureDocument — abstract base, rendered separately (not in CLASS_ORDER)
const adEntry = classes['ArmatureDocument'];
if (adEntry) {
  line(`/** Abstract base for all primary instructional artifacts. */`);
  line(`export interface ArmatureDocument extends TerminusDocument {`);
  renderClassFields(adEntry);
  line(`}`);
  line();
}

// ── Document types ────────────────────────────────────────────────────────────

divider('Document types');

/**
 * Explicit output order for document types, grouped by domain.
 *
 * User and ArmatureDocument are excluded — they are rendered above in the
 * Base types section. All other Class @ids must appear here exactly once.
 *
 * If you add a new Class to schema.json, add its @id to the appropriate
 * position in this list. Junction types go in the last group.
 */
const CLASS_ORDER = [
  // Evidence & Needs Analysis
  'LearningEvidence', 'LearningMetric', 'DescriptiveEvidence',
  'LearningDataset', 'LearningNeed',
  // Objectives
  'LearningObjective', 'PrerequisiteRecord',
  // Assessment
  'AssessmentItem', 'Response', 'Assessment',
  // Activities & Structure
  'LearningActivity', 'ActivityGroup', 'Module', 'Course',
  // Design Rationale
  'DesignNote',
  // Junction documents
  'NeedEvidenceLink', 'ItemInstance', 'ModuleObjective',
  'ActivityGroupMember', 'ModuleActivityLink', 'ModuleActivityGroupLink',
];

for (const id of CLASS_ORDER) {
  const entry = classes[id];
  if (!entry) continue;

  // Emit a sub-section divider before the first junction type
  if (id === 'NeedEvidenceLink') {
    line(`// ${'─'.repeat(56)}`);
    line(`// Junction documents — no label / description / createdBy`);
    line(`// ${'─'.repeat(56)}`);
    line();
  }

  const isAbstract = entry['@abstract'] !== undefined;
  const base       = baseInterface(entry);

  if (isAbstract) line(`/** @abstract */`);
  line(`export interface ${id} extends ${base} {`);
  renderClassFields(entry);
  line(`}`);
  line();
}

// ── Write / check ─────────────────────────────────────────────────────────────

const output = out.join('\n').trimEnd() + '\n';

if (CHECK_MODE) {
  if (!existsSync(outputPath)) {
    console.error(`✗ ${outputPath} does not exist — run npm run generate:types first`);
    process.exit(1);
  }
  const committed = readFileSync(outputPath, 'utf8');
  if (committed === output) {
    console.log(`✓ types.ts is in sync with schema.json`);
    process.exit(0);
  } else {
    const committedLines = committed.split('\n').length;
    const generatedLines = output.split('\n').length;
    console.error(`✗ types.ts is out of sync with schema.json`);
    console.error(`  Run: npm run generate:types (from armature/app/)`);
    console.error(`  Committed: ${committedLines} lines  |  Generated: ${generatedLines} lines`);
    process.exit(1);
  }
}

writeFileSync(outputPath, output, 'utf8');
console.log(`✓ types.ts written to ${outputPath}`);
console.log(`  Document types: ${CLASS_ORDER.length}`);
console.log(`  Enums:          ${Object.keys(enums).length}`);
