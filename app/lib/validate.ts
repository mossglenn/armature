/**
 * validate.ts
 * Input validation utilities for Armature API route handlers.
 *
 * All POST/PATCH handlers should validate user-submitted strings through
 * these helpers before constructing TerminusDB documents. This prevents:
 *   - Missing required fields reaching the database
 *   - Oversized strings bloating the graph
 *   - Invalid enum values causing opaque TerminusDB errors
 *   - Raw request body fields being spread into documents unexpectedly
 *
 * --- Enum validation ---
 *
 * Enum allowlists live in types.ts as VALID_* const arrays, generated from
 * schema.json. Import them from there and pass to validateEnum():
 *
 *   import { VALID_BloomsLevel, VALID_NeedPriority } from '@/lib/types';
 *   import { validateEnum } from '@/lib/validate';
 *
 *   const bloomsLevel = validateEnum(body.bloomsLevel, 'bloomsLevel', VALID_BloomsLevel, false);
 *   const priority    = validateEnum(body.priority, 'priority', VALID_NeedPriority, false);
 *
 * The VALID_* arrays are the runtime source of truth. The union types
 * (BloomsLevel, NeedPriority, etc.) are derived from them — never duplicated.
 *
 * --- Usage pattern in a route handler ---
 *
 *   import { validateString, validateOptionalString, validateEnum, validateReference, validatePositiveInt, ValidationError, MAX_LENGTH } from '@/lib/validate';
 *   import { VALID_NeedPriority } from '@/lib/types';
 *
 *   export async function POST(request: Request) {
 *     try {
 *       const body     = await request.json();
 *       const label    = validateString(body.label, 'label');
 *       const priority = validateEnum(body.priority, 'priority', VALID_NeedPriority, false);
 *     } catch (error) {
 *       if (error instanceof ValidationError) {
 *         return NextResponse.json({ error: error.message }, { status: 400 });
 *       }
 *       throw error;
 *     }
 *   }
 *
 * --- Length limits ---
 *
 * Defaults are set conservatively for instructional design content.
 * Override per-field when domain context warrants it (e.g. rationale fields
 * are longer than labels). Limits are not arbitrary — they reflect what is
 * reasonable to store, query, and display in a graph-based design tool.
 */

/** Thrown by all validate* functions on invalid input. */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ── Length limits ─────────────────────────────────────────────────────────────

/**
 * Default maximum lengths by semantic field role.
 * Import and use these constants in route handlers for consistency.
 */
export const MAX_LENGTH = {
  /** Short display names, titles, item stems. */
  label:       500,
  /** Supporting prose — descriptions, cohort names, units. */
  description: 5_000,
  /** Design rationale, findings, feedback — expect longer content. */
  rationale:   10_000,
} as const;

// ── String validators ─────────────────────────────────────────────────────────

/**
 * Validate a required string field.
 * Trims whitespace, rejects empty strings, enforces max length.
 *
 * @param val       - Raw value from request body
 * @param name      - Field name for error messages
 * @param maxLength - Maximum allowed length after trimming (default: MAX_LENGTH.label)
 * @returns Trimmed string
 * @throws ValidationError if missing, not a string, empty, or too long
 */
export function validateString(
  val: unknown,
  name: string,
  maxLength: number = MAX_LENGTH.label
): string {
  if (val === undefined || val === null || val === '') {
    throw new ValidationError(`${name} is required`);
  }
  if (typeof val !== 'string') {
    throw new ValidationError(`${name} must be a string`);
  }
  const trimmed = val.trim();
  if (trimmed === '') {
    throw new ValidationError(`${name} is required`);
  }
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${name} exceeds maximum length of ${maxLength} characters`);
  }
  return trimmed;
}

/**
 * Validate an optional string field.
 * Returns undefined if the value is absent or empty.
 * Trims and enforces max length if present.
 *
 * @param val       - Raw value from request body
 * @param name      - Field name for error messages
 * @param maxLength - Maximum allowed length after trimming (default: MAX_LENGTH.description)
 * @returns Trimmed string, or undefined
 * @throws ValidationError if present but not a string or too long
 */
export function validateOptionalString(
  val: unknown,
  name: string,
  maxLength: number = MAX_LENGTH.description
): string | undefined {
  if (val === undefined || val === null || val === '') return undefined;
  if (typeof val !== 'string') {
    throw new ValidationError(`${name} must be a string`);
  }
  const trimmed = val.trim();
  if (trimmed === '') return undefined;
  if (trimmed.length > maxLength) {
    throw new ValidationError(`${name} exceeds maximum length of ${maxLength} characters`);
  }
  return trimmed;
}

// ── Integer validator ─────────────────────────────────────────────────────────

/**
 * Validate an optional positive integer field.
 * Returns undefined if absent. Rejects non-integers, non-numbers, and
 * values less than 1.
 *
 * Used for sequence fields throughout the schema — ItemInstance.sequence,
 * Module.sequence, ModuleObjective.sequence, etc.
 *
 * @param val  - Raw value from request body
 * @param name - Field name for error messages
 * @returns Positive integer, or undefined
 * @throws ValidationError if present but not a positive integer
 */
export function validatePositiveInt(
  val: unknown,
  name: string
): number | undefined {
  if (val === undefined || val === null) return undefined;
  const n = Number(val);
  if (!Number.isInteger(n) || n < 1) {
    throw new ValidationError(`${name} must be a positive integer`);
  }
  return n;
}

// ── Reference validator ───────────────────────────────────────────────────────

/**
 * Validate a required TerminusDB @id reference field.
 * Ensures the value is a non-empty string — does not verify the referenced
 * document exists (TerminusDB enforces referential integrity at insert time).
 *
 * When TerminusDB rejects an insert due to a missing reference, catch the
 * error in the route handler and return a 400 with a meaningful message.
 *
 * @param val  - Raw value from request body
 * @param name - Field name for error messages
 * @returns The @id string
 * @throws ValidationError if missing or not a non-empty string
 */
export function validateReference(val: unknown, name: string): string {
  if (!val || typeof val !== 'string' || val.trim() === '') {
    throw new ValidationError(`${name} is required`);
  }
  return val.trim();
}

// ── Enum validator ────────────────────────────────────────────────────────────

/**
 * Validate a field against a known set of allowed string values.
 *
 * Use for any field that maps to a TerminusDB Enum type. Catching invalid
 * values here produces a clear API error; letting them reach TerminusDB
 * produces an opaque internal error.
 *
 * Allowlists are VALID_* const arrays exported from types.ts — generated
 * from schema.json. Never define local allowlist arrays in route handlers.
 *
 * @param val      - Raw value from request body
 * @param name     - Field name for error messages
 * @param allowed  - VALID_* array from types.ts
 * @param required - Whether the field is required (default: true)
 * @returns The validated value, or undefined if optional and absent
 * @throws ValidationError if required and missing, or present but not in allowed set
 *
 * @example
 *   import { VALID_BloomsLevel } from '@/lib/types';
 *   const bloomsLevel = validateEnum(body.bloomsLevel, 'bloomsLevel', VALID_BloomsLevel, false);
 */
export function validateEnum<T extends string>(
  val: unknown,
  name: string,
  allowed: readonly T[],
  required: boolean = true
): T | undefined {
  if (val === undefined || val === null || val === '') {
    if (required) throw new ValidationError(`${name} is required`);
    return undefined;
  }
  if (!allowed.includes(val as T)) {
    throw new ValidationError(
      `Invalid ${name}: "${val}". Must be one of: ${allowed.join(', ')}`
    );
  }
  return val as T;
}
