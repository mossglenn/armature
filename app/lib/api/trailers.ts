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
 * Two more are the merge gate's record of what a merge relied on (ADR-0070
 * decision 7), written on the merge commit and refused from clients alike:
 *
 *   Armature-Check: <check> <conclusion> run=<id> params=sha256:<hash>   one per requirement that applied
 *   Armature-Check-Override: <check> reason="<the reason given>"         one per check a person overrode
 *
 * And one joins a merge to the request it was made through (ADR-0072
 * decision 5), written on the merge commit and refused from clients alike:
 *
 *   Armature-Merge-Request: <MergeRequest id>
 *
 * Every other trailer is the caller's claim, kept as sent: the workspace
 * trailers of ADR-0065 decision 5, `Co-Authored-By` for someone who
 * contributed without signing in.
 */
export const ON_BEHALF_OF_TRAILER = 'Armature-On-Behalf-Of';
export const RELAYED_BY_TRAILER = 'Armature-Relayed-By';
export const CHECK_TRAILER = 'Armature-Check';
export const CHECK_OVERRIDE_TRAILER = 'Armature-Check-Override';
export const MERGE_REQUEST_TRAILER = 'Armature-Merge-Request';
export const RESERVED_TRAILERS: readonly string[] = [ON_BEHALF_OF_TRAILER, RELAYED_BY_TRAILER, CHECK_TRAILER, CHECK_OVERRIDE_TRAILER, MERGE_REQUEST_TRAILER];

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
      throw new ApiError(400, 'reserved_trailer', `${reserved} is a trailer the hub writes itself, never a client (ADR-0067 decision 6; ADR-0070 decision 7; ADR-0072 decision 5)`);
    }
  }
}

/**
 * The trailers a workspace hub's push writes (ADR-0065 decision 5): the
 * pusher's claims, kept as sent and never refused. A push also removes the
 * hub-written lines above from a local message before it replays it, since
 * the local hub wrote them and the remote writes its own.
 */
export const WORKSPACE_COMMIT_TRAILER = 'Armature-Workspace-Commit';
export const AUTHORED_AT_TRAILER = 'Armature-Authored-At';
export const WORKSPACE_PART_TRAILER = 'Armature-Workspace-Part';
/**
 * A push's own claim that the owner set a personal requirement aside (ADR-0070 decision 8, later change of
 * 2026-11-15): kept as sent, never refused, and never the remote's `Armature-Check-Override`, which only
 * the remote hub writes.
 */
export const LOCAL_CHECK_OVERRIDE_TRAILER = 'Armature-Local-Check-Override';

/** The value of the last `name: value` line in the message, or undefined; CRLF accepted (platform check AJ3). */
export function trailerValue(message: string, name: string): string | undefined {
  const prefix = `${name.toLowerCase()}:`;
  let value: string | undefined;
  for (const line of message.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.toLowerCase().startsWith(prefix)) value = trimmed.slice(prefix.length).trim();
  }
  return value;
}

/** The message with every line that is a trailer named in `names` removed, and no trailing blank lines. */
export function withoutTrailers(message: string, names: readonly string[]): string {
  const prefixes = names.map((name) => `${name.toLowerCase()}:`);
  return message
    .split('\n')
    .filter((line) => !prefixes.some((prefix) => line.trim().toLowerCase().startsWith(prefix)))
    .join('\n')
    .replace(/\s+$/, '');
}
