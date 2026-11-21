/**
 * A branch's history as people read it: the commits of `GET /branches/:name/log`,
 * each with who made it, for whom, and what it said. The page is
 * app/history/page.tsx; this module is pure (no React, no DOM), so it is tested
 * on its own.
 *
 * A commit's message is the writer's own text with the hub's trailers after it
 * (app/lib/api/trailers.ts): `Armature-On-Behalf-Of` names the person an agent
 * acted for (ADR-0067 decision 3), `Armature-Merge-Request` the request a merge
 * made (ADR-0072), and so on. The commit's author is a `User` id, the agent's
 * when an agent acted, or the store's own user for what was written outside the
 * hub (the schema's load, a seed), which is shown as setting up rather than as a
 * person's work.
 */
import type { Commit } from '@armature/client';

export interface Person {
  '@id': string;
  displayName?: string;
  externalId?: string;
}

export interface Trailer {
  key: string;
  value: string;
}

export interface HistoryEntry {
  commit: string;
  /** Seconds since the epoch, as the store records it. */
  timestamp: number;
  /** The message's first line. */
  title: string;
  /** The lines between the first and the trailers, when there are any. */
  body?: string;
  trailers: Trailer[];
  author: {
    id: string;
    name: string;
    /** A registered agent: its externalId begins `agent:` (ADR-0067 decision 3). */
    agent: boolean;
    /** Not a `User`: the store's own user, writing outside the hub. */
    setUp: boolean;
  };
  /** The person an agent acted for, from `Armature-On-Behalf-Of`, by name where the registry knows them. */
  onBehalfOf?: string;
  /** The commit a merge brought in, from the metadata the merge route writes (ADR-0025 decision 5). */
  mergeSource?: string;
}

const TRAILER = /^([A-Za-z][A-Za-z0-9-]*): (.+)$/;
const AGENT_PREFIX = 'agent:';
const ON_BEHALF_OF = 'Armature-On-Behalf-Of';

/**
 * A message split as Git splits one: the first line, the body, and the trailers, the
 * last paragraph when every line of it is `Key: value`. A one-paragraph message has no
 * trailers, so a first line that happens to read `Key: value` stays the title.
 */
export function parseMessage(message: string): { title: string; body?: string; trailers: Trailer[] } {
  const paragraphs = message.replace(/\r\n/g, '\n').trim().split(/\n\s*\n/);
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1].split('\n') : [];
  const isTrailers = last.length > 0 && last.every((line) => TRAILER.test(line));
  const trailers = isTrailers ? last.map((line) => { const [, key, value] = TRAILER.exec(line)!; return { key, value }; }) : [];
  const kept = isTrailers ? paragraphs.slice(0, -1) : paragraphs;
  const [first, ...rest] = kept.join('\n\n').split('\n');
  const body = rest.join('\n').trim();
  return { title: first ?? '', ...(body ? { body } : {}), trailers };
}

/** The part of an id after its class, `User/former-designer` → `former-designer`. */
const localPart = (id: string) => id.slice(id.indexOf('/') + 1);

function mergeSourceOf(commit: Commit): string | undefined {
  const armature = commit.metadata?.armature;
  const value = armature && typeof armature === 'object' ? (armature as Record<string, unknown>).mergeSource : undefined;
  return typeof value === 'string' ? value : undefined;
}

/**
 * The log's commits as entries, newest first as the log gives them, with each author
 * and on-behalf-of person named from `people` (the registry on `main`) where it knows
 * them, and by the id or externalId otherwise.
 */
export function historyEntries(commits: Commit[], people: Person[]): HistoryEntry[] {
  const byId = new Map(people.map((p) => [p['@id'], p]));
  const byExternalId = new Map(people.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
  return commits.map((c) => {
    const { title, body, trailers } = parseMessage(c.message);
    const person = byId.get(c.author);
    const setUp = !c.author.startsWith('User/');
    const behalf = trailers.find((t) => t.key === ON_BEHALF_OF)?.value;
    const mergeSource = mergeSourceOf(c);
    return {
      commit: c.commit,
      timestamp: c.timestamp,
      title,
      ...(body ? { body } : {}),
      trailers,
      author: {
        id: c.author,
        name: person?.displayName ?? (setUp ? c.author : localPart(c.author)),
        agent: person?.externalId?.startsWith(AGENT_PREFIX) ?? false,
        setUp,
      },
      ...(behalf ? { onBehalfOf: byExternalId.get(behalf)?.displayName ?? behalf } : {}),
      ...(mergeSource ? { mergeSource } : {}),
    };
  });
}
