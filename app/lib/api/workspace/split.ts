import type { TerminusDocument } from '../store';

/**
 * The split rule (ADR-0065 decision 5, note of 2026-10-30; the deep review's
 * B5). A local commit larger than one request is replayed as several, each
 * an ordinary write the remote checks like any other. Its documents are
 * ordered so that each follows what it names, documents that name each other
 * stay in one request, and the split falls only between such groups; a group
 * one request cannot hold is an error, not a split. Within a request a
 * provisional id is a `@capture` that its referrers `@ref` (ADR-0066 decision
 * 6; the store resolves them whatever their order in the list, platform check
 * AL2), so a group is kept whole for the boundary's sake, not the order's.
 *
 * What one request holds is the hub's own cap on a batch, 500 documents and
 * 10 MiB; the store takes more (check AL4). The byte limit here leaves room
 * for the envelope and the message.
 */
export interface PartLimits {
  documents: number;
  bytes: number;
}

export const PART_LIMITS: PartLimits = { documents: 500, bytes: 8 * 1024 * 1024 };

/** A group of documents naming each other that no single request can hold. */
export class GroupTooLarge extends Error {
  constructor(
    readonly ids: string[],
    readonly documents: number,
    readonly bytes: number,
    limits: PartLimits
  ) {
    super(`${documents} documents (${bytes} bytes) name each other and must travel in one request, which holds ${limits.documents} documents and ${limits.bytes} bytes`);
  }
}

const keyOf = (doc: TerminusDocument, index: number): string =>
  typeof doc['@id'] === 'string' ? doc['@id'] : typeof doc['@capture'] === 'string' ? `@capture:${doc['@capture']}` : `#${index}`;

/** Every document key this value names, at any depth: an `@id` as a string, or a `@capture` through `{ "@ref": … }`. */
function namesIn(value: unknown, keys: Set<string>, into: Set<string>): void {
  if (typeof value === 'string') {
    if (keys.has(value)) into.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) namesIn(v, keys, into);
    return;
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record['@ref'] === 'string' && keys.has(`@capture:${record['@ref']}`)) into.add(`@capture:${record['@ref']}`);
    for (const [k, v] of Object.entries(record)) {
      if (k !== '@id' && k !== '@capture') namesIn(v, keys, into);
    }
  }
}

/**
 * Tarjan's strongly connected components over "names", which lists each
 * component after every component it names: the order a replay needs.
 */
function groups(documents: TerminusDocument[]): number[][] {
  const keys = new Set(documents.map(keyOf));
  const named = documents.map((doc) => {
    const into = new Set<string>();
    namesIn(doc, keys, into);
    into.delete(keyOf(doc, documents.indexOf(doc)));
    return [...into];
  });
  const indexOf = new Map(documents.map((doc, i) => [keyOf(doc, i), i]));
  const edges = named.map((names) => names.map((key) => indexOf.get(key) as number));

  const index = new Array<number>(documents.length).fill(-1);
  const low = new Array<number>(documents.length).fill(0);
  const onStack = new Array<boolean>(documents.length).fill(false);
  const stack: number[] = [];
  const out: number[][] = [];
  let next = 0;
  const visit = (v: number): void => {
    index[v] = low[v] = next++;
    stack.push(v);
    onStack[v] = true;
    for (const w of edges[v]) {
      if (index[w] < 0) {
        visit(w);
        low[v] = Math.min(low[v], low[w]);
      } else if (onStack[w]) {
        low[v] = Math.min(low[v], index[w]);
      }
    }
    if (low[v] === index[v]) {
      const group: number[] = [];
      let w: number;
      do {
        w = stack.pop() as number;
        onStack[w] = false;
        group.push(w);
      } while (w !== v);
      out.push(group.sort((a, b) => a - b));
    }
  };
  for (let v = 0; v < documents.length; v++) if (index[v] < 0) visit(v);
  return out;
}

/**
 * The documents of one local commit as the requests that replay it, in
 * order: each at most `limits.documents` documents and `limits.bytes` bytes
 * of document JSON, a group of documents naming each other never split
 * across two. Throws GroupTooLarge when a group alone exceeds the limits.
 */
export function splitIntoParts(documents: TerminusDocument[], limits: PartLimits = PART_LIMITS): TerminusDocument[][] {
  const size = documents.map((doc) => Buffer.byteLength(JSON.stringify(doc)) + 1);
  const parts: TerminusDocument[][] = [];
  let part: TerminusDocument[] = [];
  let partBytes = 0;
  for (const group of groups(documents)) {
    const bytes = group.reduce((sum, i) => sum + size[i], 0);
    if (group.length > limits.documents || bytes > limits.bytes) {
      throw new GroupTooLarge(group.map((i) => keyOf(documents[i], i)), group.length, bytes, limits);
    }
    if (part.length && (part.length + group.length > limits.documents || partBytes + bytes > limits.bytes)) {
      parts.push(part);
      part = [];
      partBytes = 0;
    }
    part.push(...group.map((i) => documents[i]));
    partBytes += bytes;
  }
  if (part.length) parts.push(part);
  return parts;
}
