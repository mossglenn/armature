import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * An error the hub chose to raise: an HTTP status, a stable machine-readable
 * code, a human message and optional extra fields. `app.onError` renders it
 * as `{ error: code, message, ...details }`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
