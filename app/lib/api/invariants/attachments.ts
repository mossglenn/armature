import { CLASS_CATEGORY } from '@/lib/types';
import type { TerminusDocument } from '../store';
import type { Violation } from './index';

/**
 * External references and attachments (ADR-0030), checked on every document
 * because any artifact and any fragment may carry them:
 *
 *  18  an attachment is a verifiable coordinate: `revision` is present when
 *      the store is a versioned kind, and `contentHash` is lower-case
 *      hexadecimal of the length `hashAlgorithm` implies, for the algorithms
 *      the hub knows (IANA Named Information Hash Algorithm Registry names);
 *      an algorithm the hub does not know is accepted with the hash unchecked
 *  19  a fragment carries content: text, or at least one attachment
 *
 * The walk is by `@type` through the whole document, so an attachment on the
 * artifact, on a stem, on an option or on any later part is found at its path
 * without this module knowing the schema's field names.
 */

/** Store kinds whose state is addressed by an immutable revision (ADR-0030 decision 3). */
const VERSIONED_STORES = new Set(['Git', 'Lore']);

/** Hex digits each known algorithm produces; names as in the IANA registry. */
const HASH_HEX_LENGTH: Record<string, number> = {
  'sha-256': 64,
  'sha-512': 128,
  'sha-384': 96,
  'sha-224': 56,
  'sha-1': 40,
  md5: 32,
  'blake2b-256': 64,
  'blake2b-512': 128,
  'blake2s-256': 64,
};

const isFragmentClass = (type: unknown): boolean =>
  typeof type === 'string' && (CLASS_CATEGORY as Record<string, string>)[type] === 'fragment';

export async function checkAttachments(doc: TerminusDocument, index: number): Promise<Violation[]> {
  const out: Violation[] = [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  const push = (code: string, field: string, message: string) => out.push({ code, id, index, field, message });

  const walk = (value: unknown, path: string): void => {
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (!value || typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;

    if (obj['@type'] === 'Attachment') {
      if (VERSIONED_STORES.has(String(obj.store)) && (typeof obj.revision !== 'string' || obj.revision.trim() === '')) {
        push('revision_required', path, `${String(obj.store)} is a versioned store; an attachment in one names a revision (ADR-0030, constraint 18)`);
      }
      const expected = HASH_HEX_LENGTH[String(obj.hashAlgorithm)];
      const hash = String(obj.contentHash ?? '');
      if (expected !== undefined && !new RegExp(`^[0-9a-f]{${expected}}$`).test(hash)) {
        push('hash_malformed', `${path}.contentHash`, `${String(obj.hashAlgorithm)} produces ${expected} lower-case hexadecimal digits; found ${hash.length} characters`);
      }
    }

    if (isFragmentClass(obj['@type'])) {
      const hasText = typeof obj.text === 'string' && obj.text.trim() !== '';
      const hasAttachment = Array.isArray(obj.attachments) && obj.attachments.length > 0;
      if (!hasText && !hasAttachment) {
        push('empty_fragment', path, `fragment ${String(obj.fragmentId ?? '')} carries neither text nor an attachment (ADR-0030, constraint 19)`);
      }
    }

    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('@')) continue;
      walk(v, path === '' ? k : `${path}.${k}`);
    }
  };

  for (const [k, v] of Object.entries(doc)) {
    if (k.startsWith('@')) continue;
    walk(v, k);
  }
  return out;
}
