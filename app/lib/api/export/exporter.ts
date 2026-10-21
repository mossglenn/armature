import { CLASS_ANCESTORS, CLASS_FIELDS, type FieldShape } from '@/lib/types';
import type { TerminusDocument } from '../store';
import slicesJson from './slices.json';

/**
 * Export profiles and schema slices (architecture decision record ADR-0031).
 *
 * An export is the graph at one commit, as the store holds it (JSON-LD, the
 * store's native shape), under a profile that says what happens to people
 * and a slice that says which classes are included. Nothing here reads the
 * store: the route gathers the documents and the schema, this module shapes
 * them. The slices are configuration (`slices.json`), not code, so the
 * needs-to-objectives-to-outcomes slice the position paper describes is a
 * list of class names.
 */

export const PROFILES = ['full', 'pseudonymous', 'institutional'] as const;
export type Profile = (typeof PROFILES)[number];

export interface Slice {
  description: string;
  /** Class names; a document is in the slice when its type is one of them or inherits one. */
  classes: string[];
}

export const SLICES: Record<string, Slice> = slicesJson;

const ancestors = CLASS_ANCESTORS as Record<string, readonly string[]>;
const fieldsOf = (type: string): Record<string, FieldShape> =>
  (CLASS_FIELDS as Record<string, Record<string, FieldShape>>)[type] ?? {};

/** True when `type` is one of the slice's classes or inherits one of them. */
export function inSlice(type: string, slice: Slice): boolean {
  return slice.classes.some((c) => c === type || (ancestors[type]?.includes(c) ?? false));
}

export const selectSlice = (documents: TerminusDocument[], slice: Slice): TerminusDocument[] =>
  documents.filter((d) => inSlice(d['@type'], slice));

export interface Unresolved {
  id: string;
  field: string;
  target: string;
}

/**
 * References from documents in the export to documents that are not in it.
 * A full export has none; a slice may, since a `DesignRecord`-typed field
 * (a metric's `subject`, a note's `subject`) can name any record. Re-import
 * of such a slice fails at the store's reference check, which is the right
 * outcome: a slice is for analysis, the full profile is for reproduction.
 */
export function unresolvedReferences(documents: TerminusDocument[]): Unresolved[] {
  const present = new Set(documents.map((d) => d['@id']));
  const out: Unresolved[] = [];
  for (const doc of documents) {
    for (const [field, shape] of Object.entries(fieldsOf(doc['@type']))) {
      if (shape.kind !== 'reference') continue;
      const value = doc[field];
      for (const target of Array.isArray(value) ? value : [value]) {
        if (typeof target === 'string' && !present.has(target)) out.push({ id: doc['@id'], field, target });
      }
    }
  }
  return out;
}

/**
 * The store decorates every `Set` it returns with `@max_cardinality: "inf"`,
 * which it then refuses to load (platform check AE5). An export carries the
 * schema as it can be reloaded.
 */
export function normalizeSchema(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  return entries.map((entry) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (value && typeof value === 'object' && !Array.isArray(value) && (value as Record<string, unknown>)['@max_cardinality'] === 'inf') {
        const { ['@max_cardinality']: _inf, ...rest } = value as Record<string, unknown>;
        void _inf;
        out[key] = rest;
      } else {
        out[key] = value;
      }
    }
    return out;
  });
}

export type Pseudonyms = 'none' | 'stable' | 'per-export';

/** Fields of each class whose target is `User`, read from the schema (ADR-0021's guard reads the same map). */
function userFields(type: string): string[] {
  return Object.entries(fieldsOf(type))
    .filter(([, shape]) => shape.kind === 'reference' && shape.type === 'User')
    .map(([field]) => field);
}

const hex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Applies a profile (ADR-0031 decision 3; ADR-0021's deferred section).
 *
 * `full` leaves people as stored. `pseudonymous` replaces every `User` by a
 * stable opaque token and every reference to one by the token's id, keeping
 * nothing else about the person. `institutional` keeps `institution` beside
 * the token (ADR-0021: warrant without identity). The token is an HMAC
 * (hash-based message authentication code, SHA-256) of the `User` id under
 * `key`: the same key gives the same token in every export of a deployment,
 * so a corpus can be compared across time; without a key a random one is
 * minted for this export and the result says so.
 */
export async function applyProfile(
  documents: TerminusDocument[],
  profile: Profile,
  key: string | undefined
): Promise<{ documents: TerminusDocument[]; pseudonyms: Pseudonyms }> {
  if (profile === 'full') return { documents, pseudonyms: 'none' };

  const keyBytes = key ? new TextEncoder().encode(key) : crypto.getRandomValues(new Uint8Array(32));
  const hmacKey = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const tokens = new Map<string, string>();
  const tokenFor = async (userId: string): Promise<string> => {
    let token = tokens.get(userId);
    if (!token) {
      token = hex(await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(userId))).slice(0, 32);
      tokens.set(userId, token);
    }
    return token;
  };

  const out: TerminusDocument[] = [];
  for (const doc of documents) {
    if (doc['@type'] === 'User') {
      const token = await tokenFor(doc['@id']);
      const user: TerminusDocument = { '@id': `User/${token}`, '@type': 'User', externalId: token };
      if (profile === 'institutional' && typeof doc.institution === 'string') user.institution = doc.institution;
      out.push(user);
      continue;
    }
    const copy: TerminusDocument = { ...doc };
    for (const field of userFields(doc['@type'])) {
      const value = copy[field];
      if (typeof value === 'string') copy[field] = `User/${await tokenFor(value)}`;
      else if (Array.isArray(value)) {
        copy[field] = await Promise.all(value.map(async (v) => (typeof v === 'string' ? `User/${await tokenFor(v)}` : v)));
      }
    }
    out.push(copy);
  }
  return { documents: out, pseudonyms: key ? 'stable' : 'per-export' };
}
