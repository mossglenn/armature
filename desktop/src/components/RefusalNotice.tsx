import { Badge } from '@/components/ui/badge';
import type { Refusal } from '@/lib/types';

interface Conflict {
  id: string;
  field?: string;
  op?: string;
  base?: unknown;
  target?: unknown;
  source?: unknown;
}

const shown = (value: unknown) => (value === undefined ? '(absent)' : typeof value === 'string' ? value : JSON.stringify(value));

/**
 * A refusal as the hub gave it (docs/desktop-program-plan.md §4, item 4): its message, its code, and
 * whether the remote or this machine refused. A merge's conflicts are listed field by field with the
 * three values; what a conflict means for an item is the tool's to explain, so the notice says which
 * tool to open rather than resolving anything.
 */
export function RefusalNotice({ refusal, status }: { refusal: Refusal; status?: number }) {
  const conflicts = Array.isArray(refusal.conflicts) ? (refusal.conflicts as Conflict[]) : [];
  return (
    <div role="alert" className="border-destructive/40 bg-destructive/5 rounded-md border p-3 text-sm">
      <p>{refusal.message}</p>
      <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className="font-mono">
          {status ? `${status} ` : ''}
          {refusal.error}
          {refusal.reason ? ` · ${refusal.reason}` : ''}
        </Badge>
        <span>{refusal.remote ? 'from the remote' : 'from this machine'}</span>
      </p>
      {conflicts.length > 0 && (
        <div className="mt-3">
          <p className="font-medium">
            {conflicts.length} conflict{conflicts.length === 1 ? '' : 's'}: open the tool you edit these records in to review and resolve them, push, then bring main in again.
          </p>
          <ul className="mt-2 space-y-2">
            {conflicts.map((conflict, i) => (
              <li key={`${conflict.id}-${conflict.field ?? conflict.op}-${i}`} className="rounded border p-2 text-xs">
                <p className="font-mono">
                  {conflict.id}
                  {conflict.field ? ` · ${conflict.field}` : ''}
                </p>
                {conflict.op === 'InsertConflict' ? (
                  <p className="text-muted-foreground">Created on both sides with different content.</p>
                ) : (
                  <dl className="mt-1 grid grid-cols-[6rem_1fr] gap-x-2">
                    <dt className="text-muted-foreground">before</dt>
                    <dd>{shown(conflict.base)}</dd>
                    <dt className="text-muted-foreground">yours</dt>
                    <dd>{shown(conflict.target)}</dd>
                    <dt className="text-muted-foreground">main's</dt>
                    <dd>{shown(conflict.source)}</dd>
                  </dl>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
