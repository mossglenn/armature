import type { TerminusDocument } from '../store';

/**
 * The identifiers the store mints, reproduced from TerminusDB (ADR-0066
 * decision 6, note of 2026-11-02; platform check AI), so that a junction or
 * an attestation written on a workspace hub has the same `@id` the remote
 * would give it, and a push maps nothing but commits.
 *
 * A Hash-keyed class's id is the class name, `/`, and the lower-case
 * hexadecimal SHA-256 of the Lexical string of its key: each key field's
 * value, in the key's order, a reference as its full IRI under the context's
 * `@base`, an enum value as its full IRI under `@schema` (`GrantRole/Owner`),
 * a string or an integer as itself, an absent Optional as the literal
 * `+none+`, each percent-encoded except for the unreserved characters and
 * `!$&'()*,;=@`, joined with `+` (AI1 to AI3). A Random-keyed document gets
 * sixteen characters of the URL-safe base64 alphabet; a subdocument gets its
 * parent's id, the field, its position in a list, its class and the same
 * random tail, regenerated on every write of the parent (platform checks J4
 * and AB4), which is why a part's identity is its `fragmentId` (ADR-0033).
 *
 * What the schema says about a class is read from the store's own schema
 * entries, not from the generated types, so a store holding another schema
 * version mints its ids by that schema.
 */

export interface FieldInfo {
  /** The xsd or sys type, the enum, or the class a reference or a subdocument names. */
  type: string;
  kind: 'primitive' | 'enum' | 'class';
  container?: 'Optional' | 'Set' | 'List' | 'Array';
}

export interface ClassInfo {
  name: string;
  key: { type: string; fields: string[] };
  /** Own and inherited fields. */
  fields: Map<string, FieldInfo>;
  subdocument: boolean;
  abstract: boolean;
}

type Entry = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The classes, enums and context of one schema, as the store needs them. */
export class SchemaIndex {
  readonly base: string;
  readonly schema: string;
  private readonly classes = new Map<string, ClassInfo>();
  private readonly enums = new Set<string>();
  private readonly parents = new Map<string, string[]>();

  constructor(entries: readonly Entry[]) {
    let base = '';
    let schema = '';
    const own = new Map<string, Entry>();
    for (const entry of entries) {
      const type = entry['@type'];
      if (type === '@context' || type === 'Context') {
        base = String(entry['@base'] ?? '');
        schema = String(entry['@schema'] ?? '');
      } else if (type === 'Enum' && typeof entry['@id'] === 'string') {
        this.enums.add(entry['@id']);
      } else if (type === 'Class' && typeof entry['@id'] === 'string') {
        own.set(entry['@id'], entry);
        const inherits = entry['@inherits'];
        this.parents.set(entry['@id'], Array.isArray(inherits) ? inherits.map(String) : typeof inherits === 'string' ? [inherits] : []);
      }
    }
    this.base = base;
    this.schema = schema;
    for (const [name, entry] of own) {
      const fields = new Map<string, FieldInfo>();
      for (const ancestor of this.ancestorsOf(name)) this.ownFields(own.get(ancestor), fields);
      this.ownFields(entry, fields);
      const key = isRecord(entry['@key']) ? entry['@key'] : {};
      this.classes.set(name, {
        name,
        key: { type: String(key['@type'] ?? 'Random'), fields: Array.isArray(key['@fields']) ? key['@fields'].map(String) : [] },
        fields,
        subdocument: Array.isArray(entry['@subdocument']),
        abstract: Array.isArray(entry['@abstract']),
      });
    }
  }

  private ownFields(entry: Entry | undefined, into: Map<string, FieldInfo>): void {
    if (!entry) return;
    for (const [field, value] of Object.entries(entry)) {
      if (field.startsWith('@')) continue;
      let type: string;
      let container: FieldInfo['container'];
      if (typeof value === 'string') type = value;
      else if (isRecord(value) && typeof value['@class'] === 'string') {
        type = value['@class'];
        container = value['@type'] as FieldInfo['container'];
      } else continue;
      const kind: FieldInfo['kind'] = type.includes(':') ? 'primitive' : this.enums.has(type) ? 'enum' : 'class';
      into.set(field, container ? { type, kind, container } : { type, kind });
    }
  }

  /** Every class `name` inherits from, transitively, nearest last. */
  private ancestorsOf(name: string, seen = new Set<string>()): string[] {
    const out: string[] = [];
    for (const parent of this.parents.get(name) ?? []) {
      if (seen.has(parent)) continue;
      seen.add(parent);
      out.push(...this.ancestorsOf(parent, seen), parent);
    }
    return out;
  }

  class(name: string): ClassInfo | undefined {
    return this.classes.get(name);
  }

  isEnum(name: string): boolean {
    return this.enums.has(name);
  }

  /** `type` and every class inheriting from it, transitively: what a query by `type` lists. */
  descendants(type: string): Set<string> {
    const out = new Set<string>([type]);
    for (const name of this.classes.keys()) {
      if (this.ancestorsOf(name).includes(type)) out.add(name);
    }
    return out;
  }
}

/** Kept as is in the Lexical string: the unreserved characters and the sub-delimiters TerminusDB keeps (check AI1). */
const KEPT = /[A-Za-z0-9!$&'()*,\-.;=@_~]/;

/** One key value as the store writes it into the Lexical string: UTF-8 bytes, percent-encoded upper case except for `KEPT`. */
export function encodeKeyPart(text: string): string {
  return Array.from(new TextEncoder().encode(text))
    .map((b) => (b < 128 && KEPT.test(String.fromCharCode(b)) ? String.fromCharCode(b) : `%${b.toString(16).toUpperCase().padStart(2, '0')}`))
    .join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A key field's value in the Lexical string, or `+none+` for an absent Optional. */
function keyPart(index: SchemaIndex, info: FieldInfo | undefined, value: unknown): string {
  if (value === undefined || value === null) return '+none+';
  if (Array.isArray(value)) {
    // A Set in a key (check AI4): empty it is the absent form, one element is that element; Armature's keys hold none.
    if (value.length === 0) return '+none+';
    if (value.length === 1) return keyPart(index, info, value[0]);
    throw new Error('A key over a Set with more than one element is not reproduced (check AI4)');
  }
  const text = String(value);
  if (info?.kind === 'class') return encodeKeyPart(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `${index.base}${text}`);
  if (info?.kind === 'enum') return encodeKeyPart(`${index.schema}${info.type}/${text}`);
  return encodeKeyPart(text);
}

/** The Lexical string of a Hash-keyed document's key, each field's value as `keyPart`, joined with `+`. */
export function keyString(index: SchemaIndex, info: ClassInfo, doc: Record<string, unknown>): string {
  return info.key.fields.map((field) => keyPart(index, info.fields.get(field), doc[field])).join('+');
}

/** The id the store mints for a Hash-keyed document; undefined for any other key type. */
export async function hashId(index: SchemaIndex, doc: Record<string, unknown>): Promise<string | undefined> {
  const type = String(doc['@type']);
  const info = index.class(type);
  if (!info || info.key.type !== 'Hash') return undefined;
  return `${type}/${await sha256Hex(keyString(index, info, doc))}`;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/** Sixteen characters of the URL-safe base64 alphabet, the tail of a Random id. */
export function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => ALPHABET[b % 64]).join('');
}

export const randomId = (type: string): string => `${type}/${randomKey()}`;

/** A subdocument's id under its parent: `<parent>/<field>/<position>/<Class>/<key>`, the position only in a list. */
export const nestedId = (parent: string, field: string, position: number | undefined, type: string): string =>
  position === undefined ? `${parent}/${field}/${type}/${randomKey()}` : `${parent}/${field}/${position}/${type}/${randomKey()}`;

/**
 * A document as the store holds it: every subdocument given a fresh nested id
 * (so a replace renumbers every part, as the store does), every empty Set
 * dropped (the store returns an empty Set as no field), keys in the store's
 * order (`@id`, `@type`, then alphabetical). The document's own `@id` must be
 * set already.
 */
export function asStored(index: SchemaIndex | undefined, doc: TerminusDocument): TerminusDocument {
  const info = index?.class(doc['@type']);
  return place(index, info, doc, doc['@id']) as TerminusDocument;
}

function place(index: SchemaIndex | undefined, info: ClassInfo | undefined, value: Record<string, unknown>, id: string): Record<string, unknown> {
  const out: Record<string, unknown> = { '@id': id, '@type': value['@type'] };
  const keys = Object.keys(value)
    .filter((k) => k !== '@id' && k !== '@type' && k !== '@capture')
    .sort();
  for (const key of keys) {
    const field = info?.fields.get(key);
    const held = value[key];
    if (Array.isArray(held)) {
      if (held.length === 0 && field?.container === 'Set') continue;
      out[key] = held.map((element, position) => (isRecord(element) ? placeChild(index, element, id, key, field?.container === 'Set' ? undefined : position) : element));
    } else if (isRecord(held)) {
      out[key] = placeChild(index, held, id, key, undefined);
    } else {
      out[key] = held;
    }
  }
  return out;
}

function placeChild(index: SchemaIndex | undefined, child: Record<string, unknown>, parent: string, field: string, position: number | undefined): Record<string, unknown> {
  const type = typeof child['@type'] === 'string' ? child['@type'] : undefined;
  if (!type) return child;
  const info = index?.class(type);
  return place(index, info, child, nestedId(parent, field, position, type));
}
