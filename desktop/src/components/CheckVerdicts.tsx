import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useInstance } from '@/lib/instance';
import { stops, type CheckVerdict } from '@/lib/types';

export interface Override {
  check: string;
  reason: string;
}

/** A check's result in the vocabulary's words (`@armature/vocabulary`, reserved for `check-result`): the API's `conclusion` is the identifier. */
const RESULT: Record<string, string> = { pass: 'Passed', neutral: 'Neutral', pending: 'Waiting for a report', fail: 'Failed', error: 'Could not run' };

const resultBadge = (verdict: CheckVerdict): { variant: 'success' | 'warning' | 'outline' | 'muted'; text: string } => {
  const text = RESULT[verdict.conclusion] ?? 'Could not run';
  if (verdict.overridden) return { variant: 'muted', text: `${text}, overridden` };
  if (verdict.conclusion === 'pass' || verdict.conclusion === 'neutral') return { variant: 'success', text };
  if (verdict.conclusion === 'pending') return { variant: 'outline', text };
  return { variant: 'warning', text };
};

/**
 * The results of a gate's checks (ADR-0070 decisions 6 and 8; docs/desktop-program-plan.md §14, step 5a): one
 * row per required check with what its run concluded, the run's own summary and where its details
 * are. The hub evaluates nothing, so the page explains nothing: what a check found is the tool's to
 * say, at the address it gave.
 *
 * With `onOverride`, every check that stops the action gets a field for the reason it is overridden,
 * and the action goes again once each has one. On a push the checks are the person's own, so they
 * may always override one, and the reason travels with the push as their own statement. On a
 * merge the instance judges who may: a locked requirement needs an administrator, which the page
 * says rather than hiding the field, since the person may be one.
 */
export function CheckVerdicts({
  verdicts,
  whose,
  onOverride,
  again,
  busy,
}: {
  verdicts: CheckVerdict[];
  /** Whose requirements these are: the person's own (a push) or the instance's (a delivery). */
  whose: 'yours' | 'instance';
  onOverride?: (overrides: Override[]) => void;
  /** The action's name on the button: "Push anyway". */
  again?: string;
  busy?: boolean;
}) {
  const instance = useInstance();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const stopping = verdicts.filter(stops);
  const ready = stopping.length > 0 && stopping.every((v) => (reasons[v.check] ?? '').trim());
  return (
    <div className="rounded-md border p-3 text-sm" aria-label="Checks">
      <p className="font-medium">{whose === 'yours' ? 'Your personal checks' : `Required checks on ${instance}`}</p>
      <ul className="mt-2 divide-y">
        {verdicts.map((verdict) => {
          const badge = resultBadge(verdict);
          return (
            <li key={verdict.requirement} className="py-2" aria-label={verdict.check}>
              <p className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{verdict.check}</span>
                <Badge variant={badge.variant}>{badge.text}</Badge>
                {verdict.level === 'Advisory' && <Badge variant="muted">Advisory</Badge>}
                {verdict.locked && <Badge variant="outline">locked</Badge>}
              </p>
              {verdict.run?.summary && <p className="mt-1">{verdict.run.summary}</p>}
              {verdict.run?.detailsUrl && <p className="text-muted-foreground mt-1 font-mono text-xs break-all select-all">{verdict.run.detailsUrl}</p>}
              {verdict.overridden && <p className="text-muted-foreground mt-1">Overridden: {verdict.overridden.reason}</p>}
              {onOverride && stops(verdict) && (
                <div className="mt-2 flex flex-col gap-1">
                  <Label htmlFor={`override-${verdict.requirement}`}>
                    Reason for overriding {verdict.check}
                    {verdict.locked ? ` (locked: ${instance} takes this only from an administrator)` : ''}
                  </Label>
                  <Input id={`override-${verdict.requirement}`} value={reasons[verdict.check] ?? ''} onChange={(e) => setReasons((all) => ({ ...all, [verdict.check]: e.target.value }))} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {onOverride && stopping.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={!ready || busy} onClick={() => onOverride(stopping.map((v) => ({ check: v.check, reason: (reasons[v.check] ?? '').trim() })))}>
            {again ?? 'Go on anyway'}
          </Button>
          <span className="text-muted-foreground text-xs">
            {whose === 'yours' ? 'The reason goes with the push, as your own statement on its first commit.' : 'The reason is recorded on the merge into main, with your name as its author.'}
          </span>
        </div>
      )}
    </div>
  );
}
