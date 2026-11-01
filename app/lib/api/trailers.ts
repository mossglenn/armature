import { ApiError } from './errors';

/**
 * Commit message trailers (architecture decision record ADR-0025 decision 2;
 * ADR-0067 decisions 3, 5 and 6). A trailer is a `Name: value` line in the
 * message's last paragraph, git's convention, which the store returns byte for
 * byte (platform check AJ). Two are the hub's own: it writes them and refuses
 * them from a client, so a reader of history can trust them.
 *
 *   Armature-On-Behalf-Of: <person externalId>   an agent acted for this person (decision 3)
 *   Armature-Relayed-By: <agent externalId>      a service delivered this person's work (decision 5)
 *
 * Every other trailer is the caller's claim, kept as sent: the workspace
 * trailers of ADR-0065 decision 5, `Co-Authored-By` for someone who
 * contributed without signing in.
 */
export const ON_BEHALF_OF_TRAILER = 'Armature-On-Behalf-Of';
export const RELAYED_BY_TRAILER = 'Armature-Relayed-By';
export const RESERVED_TRAILERS: readonly string[] = [ON_BEHALF_OF_TRAILER, RELAYED_BY_TRAILER];

const TRAILER_LINE = /^[A-Za-z][A-Za-z0-9-]*: \S.*$/;

/**
 * The message with `trailer` added: into the trailer block when the message
 * already ends in one, else as a new last paragraph.
 */
export function withTrailer(message: string, trailer: string): string {
  const text = message.trimEnd();
  const paragraphs = text.split(/\n[ \t]*\n/);
  const lastLines = paragraphs[paragraphs.length - 1].split('\n');
  const endsInTrailers = paragraphs.length > 1 && lastLines.every((line) => TRAILER_LINE.test(line.trim()));
  return `${text}${endsInTrailers ? '\n' : '\n\n'}${trailer}`;
}

/** 400 `reserved_trailer` when a client's message carries a line the hub writes itself (decision 6). */
export function refuseReservedTrailers(message: string): void {
  for (const line of message.split('\n')) {
    const lower = line.trim().toLowerCase();
    const reserved = RESERVED_TRAILERS.find((name) => lower.startsWith(`${name.toLowerCase()}:`));
    if (reserved) {
      throw new ApiError(400, 'reserved_trailer', `${reserved} is a trailer the hub writes itself, never a client (ADR-0067 decision 6)`);
    }
  }
}
