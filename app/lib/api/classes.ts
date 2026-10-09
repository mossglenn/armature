import { CLASS_ANCESTORS, CLASS_CATEGORY } from '@/lib/types';

/**
 * What the schema says about a class, read from the generated maps
 * (architecture decision record ADR-0027). Nothing here is hand-maintained:
 * a new class in schema.json appears in `CLASS_CATEGORY` and `CLASS_ANCESTORS`
 * on the next `npm run generate:types`, and the continuous integration (CI)
 * drift check catches a stale copy.
 */

const categories = CLASS_CATEGORY as Record<string, string>;
const ancestors = CLASS_ANCESTORS as Record<string, readonly string[]>;

export const isKnownType = (type: string): boolean => Object.prototype.hasOwnProperty.call(categories, type);

/**
 * Writable through the document routes: the artifact and relationship
 * categories. Fragments are parts of a document; infrastructure (`User`, the
 * abstract roots) has its own routes or none.
 */
export const isWritable = (type: string): boolean =>
  categories[type] === 'artifact' || categories[type] === 'relationship';

/** True when `type` is `ancestor` or inherits from it, transitively. */
export const inheritsFrom = (type: string, ancestor: string): boolean =>
  type === ancestor || (ancestors[type]?.includes(ancestor) ?? false);

/** Classes that carry `createdBy` (ADR-0015, ADR-0032 decision 4). */
export const hasCreatedBy = (type: string): boolean => inheritsFrom(type, 'ArmatureDocument');
