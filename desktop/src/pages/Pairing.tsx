import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import type { Backend } from '@/lib/backend';
import type { Refusal } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/**
 * Pairing (docs/desktop-program-plan.md §4, item 5; §7; ADR-0065 decision 7, notes): the value every
 * tool on this machine sends with its writes, kept across the program's starts. A tool pairs once by
 * pasting it; resetting draws a new one, after which every paired tool pairs again, so the reset is
 * confirmed on the page first.
 */
export function Pairing({ backend }: { backend: Backend }) {
  const { run, busy } = useRequest(backend);
  const [value, setValue] = useState<string | null | undefined>();
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();

  useEffect(() => void backend.pairingValue().then(setValue), [backend]);

  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The clipboard can be refused; the value is selectable in the field.
      (document.getElementById('pairing-value') as HTMLInputElement | null)?.select();
    }
  };

  const reset = async () => {
    setConfirming(false);
    setRefusal(undefined);
    const outcome = await run<{ localToken: string }>('resetPairing');
    if (outcome.ok) setValue(outcome.body.localToken);
    else setRefusal(outcome);
  };

  return (
    <section>
      <PageHeader title="Pairing">Paste this where the tool asks for its Armature pairing value. The tools the program starts itself need nothing.</PageHeader>
      {value === null ? (
        <p className="text-sm">The hub has not started yet, so there is no pairing value.</p>
      ) : (
        <div className="flex max-w-2xl gap-2">
          <input id="pairing-value" readOnly value={value ?? ''} aria-label="The pairing value" className="bg-muted min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs" onFocus={(e) => e.target.select()} />
          <Button onClick={() => void copy()} disabled={!value}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}

      <div className="mt-8 max-w-2xl rounded-lg border p-4">
        <p className="font-medium">Reset the pairing</p>
        <p className="text-muted-foreground mt-1 text-sm">Draws a new value. Every tool paired with the old one is refused until it is given the new one.</p>
        {confirming ? (
          <div className="mt-3 flex items-center gap-2" role="group" aria-label="Confirm the reset">
            <span className="text-sm">Every paired tool will need the new value. Reset?</span>
            <Button variant="destructive" size="sm" onClick={() => void reset()}>
              Reset the pairing
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="outline" className="mt-3" disabled={busy !== undefined || !value} onClick={() => setConfirming(true)}>
            Reset…
          </Button>
        )}
        {refusal && (
          <div className="mt-3">
            <RefusalNotice {...refusal} />
          </div>
        )}
      </div>
    </section>
  );
}
