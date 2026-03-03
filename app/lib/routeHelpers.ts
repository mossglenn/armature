import { NextResponse } from 'next/server';
import client from '@/lib/terminusdb';

// ── TerminusDB error parsing ──────────────────────────────────────────────────

/**
 * Parse a raw error thrown by the TerminusDB JS client into a structured form.
 *
 * The client throws plain Error objects whose message is a concatenated
 * string of the HTTP response JSON fields, e.g.:
 *
 *   "API Error @type api:InsertDocumentErrorResponse api:message Schema check
 *    failure api:request_id b7dbf93a-... api:status api:failure Code: 400"
 *
 * This function maps known @type and api:message substrings to a
 * { status, message } pair suitable for returning to the client.
 *
 * Coverage is intentionally limited to error strings observed in this project.
 * Unknown errors return status 500 and log the raw message for diagnosis.
 * Add cases here as new error patterns are encountered.
 *
 * @param error   - The thrown value (may not be an Error instance)
 * @param context - Short description of the operation, used in log output
 * @returns NextResponse with appropriate status and { error: string } body
 */
export function handleTerminusError(error: unknown, context: string): NextResponse {
  if (!(error instanceof Error)) {
    console.error(`TerminusDB unexpected error (${context}):`, error);
    return NextResponse.json({ error: 'Unexpected database error' }, { status: 500 });
  }

  const msg = error.message;

  // Schema violation, type mismatch, or referential integrity failure
  // @type: api:InsertDocumentErrorResponse, api:message: "Schema check failure"
  if (msg.includes('api:InsertDocumentErrorResponse')) {
    return NextResponse.json(
      { error: 'Document validation failed — check field values and referenced IDs' },
      { status: 400 }
    );
  }

  // Delete target not found
  // @type: api:DeleteDocumentErrorResponse, api:message: "Missing target(s) for deletion"
  if (msg.includes('api:DeleteDocumentErrorResponse')) {
    return NextResponse.json(
      { error: 'Document not found' },
      { status: 404 }
    );
  }

  // Auth failure — misconfigured env vars, wrong credentials
  // @type: api:ErrorResponse, api:message: "Incorrect authentication information"
  if (msg.includes('Incorrect authentication')) {
    console.error(`TerminusDB auth failure (${context}) — check TERMINUS_* env vars`);
    return NextResponse.json(
      { error: 'Database connection error' },
      { status: 500 }
    );
  }

  // Unknown — log the full message so new patterns can be identified and added above
  console.error(`TerminusDB unclassified error (${context}):`, msg);
  return NextResponse.json({ error: `Database error during ${context}` }, { status: 500 });
}

// ── GET handler factory ───────────────────────────────────────────────────────

export function createGetHandler(type: string) {
  return async function GET() {
    try {
      const result = await client.getDocument({ type, as_list: true });
      return NextResponse.json(result);
    } catch (error) {
      return handleTerminusError(error, `fetch ${type}`);
    }
  };
}

