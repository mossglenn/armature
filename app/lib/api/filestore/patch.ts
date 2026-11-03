import { canonical } from '../fragments';

/**
 * The diff format the API exposes is TerminusDB's JSON patch (ADR-0066
 * decision 5; `docs/vendor/terminusdb/json-diff-and-patch.md`), so the
 * file-backed store produces the same operations:
 *
 *   - a changed scalar is `{ "@op": "SwapValue", "@before", "@after" }`, an
 *     absent side `null`; an unchanged field is an implicit copy and absent
 *     from the patch;
 *   - a changed subdocument is a nested patch of its fields (its `@id`, which
 *     the store regenerates on every write, shows as a swap);
 *   - a changed list is a chain: `CopyList` over the equal prefix (`@to`),
 *     then `PatchList` over elements patched in place or `SwapList` over the
 *     region replaced (`@before`, `@after`), then `KeepList` for the rest;
 *   - over a branch, a document inserted is `{ "@op": "Insert", "@insert" }`,
 *     one deleted `{ "@op": "Delete", "@delete" }`, one changed its patch
 *     under `@id` (`changesOf` in ../store.ts reads these three forms).
 *
 * The segmentation of a list may differ from the store's own where several
 * chains describe one change; every patch here applies with `applyPatch` to
 * give the after state, and the tests hold it to that.
 */

export type Patch = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const equal = (a: unknown, b: unknown): boolean => canonical(a) === canonical(b) && (!isRecord(a) || !isRecord(b) || a['@id'] === b['@id']);

/** The patch taking `before` to `after`, or undefined when they are equal. */
export function diffValue(before: unknown, after: unknown): unknown {
  if (Array.isArray(before) && Array.isArray(after)) return diffList(before, after);
  if (isRecord(before) && isRecord(after)) {
    const patch = diffFields(before, after, false);
    return Object.keys(patch).length ? patch : undefined;
  }
  if (equal(before, after)) return undefined;
  return { '@op': 'SwapValue', '@before': before ?? null, '@after': after ?? null };
}

/** The changed fields of two objects as a patch; `@id` left out when `skipId`. */
function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, skipId: boolean): Patch {
  const patch: Patch = {};
  for (const key of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (skipId && key === '@id') continue;
    const d = diffValue(before[key], after[key]);
    if (d !== undefined) patch[key] = d;
  }
  return patch;
}

function diffList(before: unknown[], after: unknown[]): unknown {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && equal(before[prefix], after[prefix])) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && equal(before[before.length - 1 - suffix], after[after.length - 1 - suffix])) suffix++;
  const midBefore = before.slice(prefix, before.length - suffix);
  const midAfter = after.slice(prefix, after.length - suffix);
  if (!midBefore.length && !midAfter.length) return undefined;
  const rest = { '@op': 'KeepList' };
  const middle =
    midBefore.length === midAfter.length && midBefore.every((b, i) => isRecord(b) && isRecord(midAfter[i]))
      ? { '@op': 'PatchList', '@patch': midBefore.map((b, i) => diffValue(b, midAfter[i]) ?? {}), '@rest': rest }
      : { '@op': 'SwapList', '@before': midBefore, '@after': midAfter, '@rest': rest };
  return prefix ? { '@op': 'CopyList', '@to': prefix, '@rest': middle } : middle;
}

/**
 * The difference between two states of one document: an insert, a delete,
 * the patch of the changed fields under `@id`, or `{}` when nothing changed.
 */
export function diffDocument(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): Patch {
  if (!before && after) return { '@op': 'Insert', '@insert': after };
  if (before && !after) return { '@op': 'Delete', '@delete': before };
  if (!before || !after) return {};
  const patch = diffFields(before, after, true);
  return Object.keys(patch).length ? { '@id': after['@id'], ...patch } : {};
}

/** The difference between two states of a branch: one entry per document that changed, by id. */
export function diffDocuments(before: ReadonlyMap<string, Record<string, unknown>>, after: ReadonlyMap<string, Record<string, unknown>>): Patch[] {
  const entries: Patch[] = [];
  for (const id of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const patch = diffDocument(before.get(id), after.get(id));
    if (Object.keys(patch).length) entries.push(patch);
  }
  return entries;
}

/** `before` with `patch` applied: the after state (a `Delete` gives undefined). */
export function applyPatch(before: unknown, patch: unknown): unknown {
  if (!isRecord(patch)) return before;
  switch (patch['@op']) {
    case undefined: {
      const base = isRecord(before) ? before : {};
      const out: Record<string, unknown> = { ...base };
      for (const [key, p] of Object.entries(patch)) {
        if (key === '@id') continue;
        const value = applyPatch(base[key], p);
        if (value === undefined) delete out[key];
        else out[key] = value;
      }
      return out;
    }
    case 'Insert':
      return patch['@insert'];
    case 'Delete':
      return undefined;
    case 'SwapValue':
      return patch['@after'] === null ? undefined : patch['@after'];
    case 'KeepList':
      return before;
    case 'CopyList': {
      const list = Array.isArray(before) ? before : [];
      const to = Number(patch['@to']);
      return [...list.slice(0, to), ...(applyPatch(list.slice(to), patch['@rest']) as unknown[])];
    }
    case 'SwapList': {
      const list = Array.isArray(before) ? before : [];
      const dropped = Array.isArray(patch['@before']) ? patch['@before'].length : 0;
      const added = Array.isArray(patch['@after']) ? patch['@after'] : [];
      return [...added, ...(applyPatch(list.slice(dropped), patch['@rest']) as unknown[])];
    }
    case 'PatchList': {
      const list = Array.isArray(before) ? before : [];
      const patches = Array.isArray(patch['@patch']) ? patch['@patch'] : [];
      return [...patches.map((p, i) => applyPatch(list[i], p)), ...(applyPatch(list.slice(patches.length), patch['@rest']) as unknown[])];
    }
    default:
      throw new Error(`Unknown patch operation ${String(patch['@op'])}`);
  }
}
