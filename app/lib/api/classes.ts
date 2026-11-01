import { CLASS_ANCESTORS, CLASS_CATEGORY, CLASS_FIELDS } from '@armature/types';

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
 * categories, and the one infrastructure class clients write, `Grant`.
 * Fragments are parts of a document; the rest of infrastructure (`User`, the
 * abstract roots, the embedded coordinates) has its own routes or none.
 */
export const isWritable = (type: string): boolean =>
  categories[type] === 'artifact' || categories[type] === 'relationship' || livesOnMain(type);

/**
 * Classes kept on `main` only, whatever branch a request names, because they
 * are read there for every request: `Grant` (ADR-0068 decision 2; constraint
 * 21). `User` lives there too (ADR-0032 decision 2) but has its own route.
 */
export const livesOnMain = (type: string): boolean => type === 'Grant';

/** True when `type` is `ancestor` or inherits from it, transitively. */
export const inheritsFrom = (type: string, ancestor: string): boolean =>
  type === ancestor || (ancestors[type]?.includes(ancestor) ?? false);

/** Classes that carry `createdBy` (ADR-0015, ADR-0032 decision 4). */
export const hasCreatedBy = (type: string): boolean => inheritsFrom(type, 'ArmatureDocument');

/**
 * Classes whose attester is a field filled from the resolved identity
 * (ADR-0028 decision 4): `attestedBy`, part of the record's key.
 */
export const hasAttestedBy = (type: string): boolean =>
  Object.prototype.hasOwnProperty.call((CLASS_FIELDS as Record<string, Record<string, unknown>>)[type] ?? {}, 'attestedBy');
