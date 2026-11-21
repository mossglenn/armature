/** One conflict as the hub reports it: a field with its three values, or a record created on both sides (`InsertConflict`). */
export interface Conflict {
  id: string;
  field?: string;
  op?: string;
  base?: unknown;
  target?: unknown;
  source?: unknown;
}

const shown = (value: unknown) => (value === undefined ? '(absent)' : typeof value === 'string' ? value : JSON.stringify(value));

/**
 * The conflicts of a merge, field by field with the three values in the vocabulary's columns (Starting point, Your
 * workspace, the parent). An update merges the parent into the workspace, a request the workspace into the parent, so
 * the target and source columns are named by the merge. Shared by a refused merge's notice and the workspace page's
 * "what an update would meet" (issue #169), so both read alike.
 */
export function ConflictList({ conflicts, sides, label }: { conflicts: Conflict[]; sides: { target: string; source: string }; label?: string }) {
  return (
    <ul className="mt-2 space-y-2" aria-label={label}>
      {conflicts.map((conflict, i) => (
        <li key={`${conflict.id}-${conflict.field ?? conflict.op}-${i}`} className="rounded border p-2 text-xs">
          <p className="font-mono">
            {conflict.id}
            {conflict.field ? ` · ${conflict.field}` : ''}
          </p>
          {conflict.op === 'InsertConflict' ? (
            <p className="text-muted-foreground">Created in both places, differently.</p>
          ) : (
            <dl className="mt-1 grid grid-cols-[8rem_1fr] gap-x-2">
              <dt className="text-muted-foreground">Starting point</dt>
              <dd>{shown(conflict.base)}</dd>
              <dt className="text-muted-foreground">{sides.target}</dt>
              <dd>{shown(conflict.target)}</dd>
              <dt className="text-muted-foreground">{sides.source}</dt>
              <dd>{shown(conflict.source)}</dd>
            </dl>
          )}
        </li>
      ))}
    </ul>
  );
}
