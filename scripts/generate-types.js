#!/usr/bin/env node
/**
 * generate-types.js
 * Generates app/lib/types.ts and app/lib/schemas.ts from Armature's schema.json.
 *
 * schema.json is the single source of truth for all type information.
 * This generator derives TypeScript interfaces and union types from it
 * so that app/lib/types.ts never needs to be hand-maintained.
 *
 * Usage (from repo root):
 *   node scripts/generate-types.js           # write types.ts and schemas.ts
 *   node scripts/generate-types.js --check   # exit 1 if either is out of sync
 *
 * Usage (from armature/app/):
 *   npm run generate:types
 *   npm run check:types
 *
 * --check is intended for CI (continuous integration). It regenerates both
 * files in memory, diffs them against the committed versions, and exits
 * non-zero if either differs. Run `npm run generate:types` to fix drift.
 *
 * Schema path:  schema/schema.json   (relative to repo root)
 * Output paths: app/lib/types.ts, app/lib/schemas.ts   (relative to repo root)
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
 * --- Schema self-description (architecture decision record ADR-0027) ---
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
 * --- Schema as data (Phase 3) ---
 *
 * Beside the interfaces, types.ts carries the schema as runtime data so the
 * hub never keeps a second copy of it: CLASS_CATEGORY, CLASS_ANCESTORS,
 * CLASS_KEY (each class's @key strategy and fields) and CLASS_FIELDS (every
 * field of every class, own and inherited, with its kind: primitive, enum,
 * subdocument or reference, its target type, and whether it is optional or
 * many). The invariants engine reads CLASS_FIELDS to find the references it
 * must check and CLASS_KEY to find an existing Hash-keyed document.
 *
 * --- Zod request schemas (second output, app/lib/schemas.ts) ---
 *
 * One Zod (TypeScript validation library) schema per concrete class, for the
 * generic write routes (ADR-0054 decision 4). The mapping mirrors the
 * TypeScript one:
 *
 *   xsd:string / xsd:anyURI        → z.string().min(1).max(10_000)  (never empty)
 *   xsd:boolean                    → z.boolean()
 *   xsd:integer                    → z.number().int()
 *   xsd:decimal                    → z.number()
 *   xsd:dateTime / xsd:date        → z.iso.datetime() / z.iso.date()
 *   sys:JSON                       → z.unknown()
 *   Enum                           → z.enum(VALID_<Enum>)  (the same arrays)
 *   Reference to a document Class  → ReferenceSchema: an id, or { "@ref" } to a
 *                                    document captured earlier in the same batch
 *   @subdocument Class             → that class's schema, inline; an abstract
 *                                    subdocument is the union of its concrete
 *                                    descendants discriminated on @type
 *   Optional<T>                    → .optional()
 *   Set<T> / List<T>               → z.array(T), with .min(@min_cardinality)
 *
 * Objects are strict: an unknown key is a 400, not a store error. A document
 * schema takes an optional @id, @type and @capture (the route fills @id and
 * @type from the path); a subdocument schema requires @type, which the store
 * needs, and ignores any nested @id, which the store regenerates (ADR-0023).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CHECK_MODE = process.argv.includes('--check');
const schemaPath = join(__dirname, '../schema/schema.json');
const outputPath = join(__dirname, '../app/lib/types.ts');
const schemasPath = join(__dirname, '../app/lib/schemas.ts');

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
line(` * The generated Zod schemas in schemas.ts build their enum checks from these`);
line(` * arrays, so request validation and the types can never disagree.`);
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

/**
 * Every class a given class inherits from, transitively, nearest first.
 * `@inherits` may be a string or an array; TerminusDB's implicit root is not
 * a schema class and is not listed. Used by the hub to know which classes
 * carry ArmatureDocument's createdBy (ADR-0032 decision 4) and to check that
 * a reference's target is the declared class or a subclass of it (CLAUDE.md
 * constraint 0, ADR-0027).
 */
function ancestorsOf(id) {
  const out = [];
  const queue = [id];
  while (queue.length) {
    const entry = classes[queue.shift()];
    if (!entry) continue;
    const parents = entry['@inherits'] ? [].concat(entry['@inherits']) : [];
    for (const parent of parents) {
      if (!out.includes(parent) && classes[parent]) {
        out.push(parent);
        queue.push(parent);
      }
    }
  }
  return out;
}

line(`/** Every class @id mapped to its transitive @inherits ancestors, nearest first (ADR-0032; CLAUDE.md constraint 0). */`);
line(`export const CLASS_ANCESTORS = {`);
for (const entry of Object.values(classes)) {
  line(`  ${entry['@id']}: [${ancestorsOf(entry['@id']).map((a) => `"${a}"`).join(', ')}],`);
}
line(`} as const;`);
line();

// ── Schema as data: keys and fields ───────────────────────────────────────────

/**
 * One field's shape as data: the target type, its kind, and its cardinality.
 * `kind` is primitive (an xsd or sys type), enum, subdocument (inline) or
 * reference (an @id of another document). `many` for Set/List/Array, with
 * `min` when the schema declares @min_cardinality.
 */
function fieldDescriptor(val) {
  let optional = false;
  let many = false;
  let min;
  let inner = val;
  if (val && typeof val === 'object') {
    if (val['@type'] === 'Optional') {
      optional = true;
      inner = val['@class'];
    } else if (val['@type'] === 'Set' || val['@type'] === 'List' || val['@type'] === 'Array') {
      many = true;
      inner = val['@class'];
      min = val['@min_cardinality'];
    } else {
      inner = val['@class'] ?? val;
    }
  }
  const type = String(inner);
  const kind = XSD_MAP[type] !== undefined ? 'primitive'
    : enumIds.has(type) ? 'enum'
    : subdocIds.has(type) ? 'subdocument'
    : classIds.has(type) ? 'reference'
    : 'primitive';
  // A Set or List is zero-or-more unless @min_cardinality says otherwise, so
  // the store accepts its absence; the request schema does too.
  if (many && !(min >= 1)) optional = true;
  return { type, kind, optional, many, ...(min !== undefined ? { min } : {}) };
}

/** Own and inherited fields, ancestors' first, a subclass's declaration winning. */
function allFields(entry) {
  const chain = [...ancestorsOf(entry['@id']).reverse(), entry['@id']];
  const fields = {};
  for (const id of chain) for (const [k, v] of getFields(classes[id])) fields[k] = v;
  return Object.entries(fields);
}

line(`/** Each class's @key strategy; Hash keys name the fields the id is derived from (ADR-0016, ADR-0024). */`);
line(`export const CLASS_KEY = {`);
for (const entry of Object.values(classes)) {
  const key = entry['@key'];
  if (!key) continue;
  line(`  ${entry['@id']}: ${JSON.stringify({ type: key['@type'], ...(key['@fields'] ? { fields: key['@fields'] } : {}) })},`);
}
line(`} as const;`);
line();

line(`/** One field's shape as data; see CLASS_FIELDS. */`);
line(`export interface FieldShape {`);
line(`  /** The xsd/sys type, enum, subdocument class or referenced class. */`);
line(`  type: string;`);
line(`  kind: "primitive" | "enum" | "subdocument" | "reference";`);
line(`  optional: boolean;`);
line(`  many: boolean;`);
line(`  /** @min_cardinality on a Set or List. */`);
line(`  min?: number;`);
line(`}`);
line();
line(`/** Every field of every class, own and inherited: the schema as data for the invariants engine (ADR-0027). */`);
line(`export const CLASS_FIELDS: Record<ClassName, Record<string, FieldShape>> = {`);
for (const entry of Object.values(classes)) {
  const fields = allFields(entry);
  if (fields.length === 0) {
    line(`  ${entry['@id']}: {},`);
    continue;
  }
  line(`  ${entry['@id']}: {`);
  for (const [k, v] of fields) line(`    ${k}: ${JSON.stringify(fieldDescriptor(v))},`);
  line(`  },`);
}
line(`};`);
line();

// ── Zod schemas (second output) ───────────────────────────────────────────────

const ZOD_XSD = {
  'xsd:string':   'z.string().min(1).max(10_000)',
  'xsd:boolean':  'z.boolean()',
  'xsd:integer':  'z.number().int()',
  'xsd:decimal':  'z.number()',
  'xsd:dateTime': 'z.iso.datetime()',
  'xsd:date':     'z.iso.date()',
  'xsd:anyURI':   'z.string().min(1).max(10_000)',
  'sys:JSON':     'z.unknown()',
};

const sBody = [];
function sline(s = '') { sBody.push(s); }

/** The Zod expression for one field value. */
function zodFor(val) {
  const d = fieldDescriptor(val);
  let expr;
  switch (d.kind) {
    case 'primitive':   expr = ZOD_XSD[d.type] ?? 'z.string().min(1).max(10_000)'; break;
    case 'enum':        expr = `z.enum(VALID_${d.type})`; break;
    case 'subdocument': expr = `${d.type}Schema`; break;
    case 'reference':   expr = 'ReferenceSchema'; break;
  }
  if (d.many) expr = `z.array(${expr})${d.min !== undefined ? `.min(${d.min})` : ''}`;
  if (d.optional) expr += '.optional()';
  return expr;
}

const isAbstract = (entry) => entry['@abstract'] !== undefined;
const concreteDescendants = (id) =>
  Object.values(classes).filter((c) => !isAbstract(c) && ancestorsOf(c['@id']).includes(id)).map((c) => c['@id']);

sline(`/**`);
sline(` * A reference to another document: its id, or { "@ref": "<capture>" } naming a`);
sline(` * document captured earlier in the same batch with "@capture" (platform check X2).`);
sline(` */`);
sline(`export const ReferenceSchema = z.union([z.string().min(1), z.strictObject({ '@ref': z.string().min(1) })]);`);
sline();

// Subdocuments: a schema is emitted once every subdocument schema it names exists.
const subdocOrder = [];
const pending = new Set(subdocIds);
while (pending.size) {
  let progressed = false;
  for (const id of [...pending]) {
    const entry = classes[id];
    const deps = isAbstract(entry)
      ? concreteDescendants(id)
      : allFields(entry).map(([, v]) => fieldDescriptor(v)).filter((d) => d.kind === 'subdocument').map((d) => d.type);
    if (deps.every((d) => subdocOrder.includes(d))) {
      subdocOrder.push(id);
      pending.delete(id);
      progressed = true;
    }
  }
  if (!progressed) {
    console.error(`✗ subdocument schemas form a cycle: ${[...pending].join(', ')}`);
    process.exit(1);
  }
}

sline(`// ── Subdocuments (inline; @type required, nested @id ignored) ─────────────────`);
sline();
for (const id of subdocOrder) {
  const entry = classes[id];
  if (isAbstract(entry)) {
    const members = concreteDescendants(id);
    sline(`/** @abstract: any concrete ${id} */`);
    if (members.length === 1) sline(`export const ${id}Schema = ${members[0]}Schema;`);
    else sline(`export const ${id}Schema = z.discriminatedUnion('@type', [${members.map((m) => `${m}Schema`).join(', ')}]);`);
    sline();
    continue;
  }
  sline(`export const ${id}Schema = z.strictObject({`);
  sline(`  '@id': z.string().optional(),`);
  sline(`  '@type': z.literal('${id}'),`);
  for (const [k, v] of allFields(entry)) sline(`  ${k}: ${zodFor(v)},`);
  sline(`});`);
  sline();
}

sline(`// ── Documents (concrete classes; the route fills @id and @type) ───────────────`);
sline();
const documentIds = Object.values(classes).filter((c) => !isAbstract(c) && !subdocIds.has(c['@id'])).map((c) => c['@id']);
for (const id of documentIds) {
  sline(`export const ${id}Schema = z.strictObject({`);
  sline(`  '@id': z.string().min(1).optional(),`);
  sline(`  '@type': z.literal('${id}').optional(),`);
  sline(`  '@capture': z.string().min(1).optional(),`);
  for (const [k, v] of allFields(classes[id])) sline(`  ${k}: ${zodFor(v)},`);
  sline(`});`);
  sline();
}
sline(`/** Every concrete document class by @id. */`);
sline(`export const DOCUMENT_SCHEMAS = {`);
for (const id of documentIds) sline(`  ${id}: ${id}Schema,`);
sline(`} as const;`);
sline();
sline(`export type DocumentClassName = keyof typeof DOCUMENT_SCHEMAS;`);
sline();

// The header names only the enums the request schemas use.
const usedEnums = Object.keys(enums).filter((e) => sBody.some((l) => l.includes(`VALID_${e}`)));
const sOut = [
  `// GENERATED — do not edit manually`,
  `// Source:      schema/schema.json`,
  `// Regenerate:  npm run generate:types  (from armature/app/)`,
  `// Check drift: npm run check:types`,
  `//`,
  `// Zod request schemas for the generic write routes (ADR-0054 decision 4,`,
  `// Phase 3). Shape only: cross-document rules live in the invariants engine.`,
  ``,
  `import { z } from 'zod';`,
  `import { ${usedEnums.map((e) => `VALID_${e}`).join(', ')} } from './types';`,
  ``,
  ...sBody,
];

// ── Write / check ─────────────────────────────────────────────────────────────

const outputs = [
  [outputPath, 'types.ts', out.join('\n').trimEnd() + '\n'],
  [schemasPath, 'schemas.ts', sOut.join('\n').trimEnd() + '\n'],
];

if (CHECK_MODE) {
  let ok = true;
  for (const [path, name, content] of outputs) {
    if (!existsSync(path)) {
      console.error(`✗ ${path} does not exist — run npm run generate:types first`);
      ok = false;
    } else if (readFileSync(path, 'utf8') !== content) {
      console.error(`✗ ${name} is out of sync with schema.json — run npm run generate:types`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  console.log(`✓ types.ts and schemas.ts are in sync with schema.json`);
} else {
  for (const [path, name, content] of outputs) {
    writeFileSync(path, content, 'utf8');
    console.log(`✓ ${name} written to ${path}`);
  }
  console.log(`  Classes: ${Object.keys(classes).length} (${[...byCategory].map(([c, g]) => `${g.length} ${c}`).join(', ')})`);
  console.log(`  Enums:   ${Object.keys(enums).length}`);
}
