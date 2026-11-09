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
 * confirmed on the page first. Beside it, the identifier a tool sends as Armature-User: under oidc
 * that is the provider's sub, which a person sees nowhere else (the Keycloak rehearsal, 2026-11-08);
 * shown only when the core can say it (signed in, or an identifier set under header).
 */
export function Pairing({ backend }: { backend: Backend }) {
  const { run, busy } = useRequest(backend);
  const [value, setValue] = useState<string | null | undefined>();
  const [toolUser, setToolUser] = useState<string | undefined>();
  const [copied, setCopied] = useState<'pairing-value' | 'tool-user' | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();

  useEffect(() => void backend.pairingValue().then(setValue), [backend]);
  useEffect(() => {
    void backend
      .request<{ user: string }>('toolIdentity')
      .then((reply) => setToolUser(reply.status === 200 ? reply.body.user : undefined))
      .catch(() => setToolUser(undefined));
  }, [backend]);

  const copy = async (field: 'pairing-value' | 'tool-user', text: string | null | undefined) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(field);
      setTimeout(() => setCopied(undefined), 2000);
    } catch {
      // The clipboard can be refused; the value is selectable in the field.
      (document.getElementById(field) as HTMLInputElement | null)?.select();
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
          <Button onClick={() => void copy('pairing-value', value)} disabled={!value}>
            {copied === 'pairing-value' ? 'Copied' : 'Copy'}
          </Button>
        </div>
      )}

      {toolUser && (
        <div className="mt-6 max-w-2xl">
          <p className="text-sm">
            A tool also sends who you are, as <code className="font-mono text-xs">Armature-User</code>:
          </p>
          <div className="mt-2 flex gap-2">
            <input id="tool-user" readOnly value={toolUser} aria-label="Your identifier for tools" className="bg-muted min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <Button variant="outline" onClick={() => void copy('tool-user', toolUser)} aria-label="Copy your identifier">
              {copied === 'tool-user' ? 'Copied' : 'Copy'}
            </Button>
          </div>
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
