import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import type { Backend, ShellState } from '@/lib/backend';
import type { Refusal } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/**
 * Pairing (docs/desktop-program-plan.md §4, item 5; §7; ADR-0065 decision 7, notes): the value every
 * tool on this machine sends with its writes, kept across the program's starts. A tool pairs once by
 * pasting it; resetting draws a new one, after which every paired tool pairs again, so the reset is
 * confirmed on the page first. Beside it, the identifier a tool sends as Armature-User: under oidc
 * that is the provider's sub, which a person sees nowhere else (the Keycloak rehearsal, 2026-11-08);
 * shown only when the core can say it (signed in, or an identifier set under header), and otherwise
 * the page says why it is not shown.
 *
 * Since 2026-11-16 (the 2026-11-09 review's P14) the value is covered until the person asks to see
 * it, since the page may be open beside someone else or on a shared screen; Copy works either way.
 * And the page reads the value again when the hub's state changes: opened before the hub had
 * started, it said there was no value and went on saying so.
 */
export function Pairing({ backend, state }: { backend: Backend; state?: ShellState }) {
  const { run, busy } = useRequest(backend);
  const [value, setValue] = useState<string | null | undefined>();
  const [toolUser, setToolUser] = useState<string | undefined>();
  /** Why the identifier is not shown, once the core has said it cannot give one. */
  const [noToolUser, setNoToolUser] = useState<string | undefined>();
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState<'pairing-value' | 'tool-user' | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  /** The shell's sentence when the keychain would not keep the new value: it is in force now and the old one returns at the next start (the 2026-11-09 review's S5). */
  const [keychain, setKeychain] = useState<string | undefined>();

  // Both are read again when the hub starts or stops and when the person signs in or out.
  const hub = state?.core;
  const signedIn = state?.started?.signedIn;
  useEffect(() => void backend.pairingValue().then(setValue), [backend, hub]);
  useEffect(() => {
    void backend
      .request<{ user: string }>('toolIdentity')
      .then((reply) => {
        setToolUser(reply.status === 200 ? reply.body.user : undefined);
        const code = reply.status === 200 ? undefined : (reply.body as { error?: string } | null)?.error;
        setNoToolUser(
          code === undefined
            ? undefined
            : code === 'signed_out'
              ? 'A tool also sends who you are. Sign in, and your identifier for tools is shown here.'
              : code === 'no_user'
                ? 'A tool also sends who you are. Set your identifier in the settings, and it is shown here.'
                : code === 'not_started' || code === 'not_opened'
                  ? undefined
                  : 'A tool also sends who you are; the remote could not be asked for your identifier just now.'
        );
      })
      .catch(() => setToolUser(undefined));
  }, [backend, hub, signedIn]);

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
    setKeychain(undefined);
    const outcome = await run<{ localToken: string; keychain?: string }>('resetPairing');
    if (!outcome.ok) return setRefusal(outcome);
    setValue(outcome.body.localToken);
    setKeychain(outcome.body.keychain);
  };

  return (
    <section>
      <PageHeader title="Pairing">Paste this where the tool asks for its Armature pairing value. The tools the program starts itself need nothing.</PageHeader>
      {value === null ? (
        <p className="text-sm">The hub has not started yet, so there is no pairing value.</p>
      ) : (
        <div className="flex max-w-2xl gap-2">
          <input
            id="pairing-value"
            readOnly
            type={shown ? 'text' : 'password'}
            autoComplete="off"
            value={value ?? ''}
            aria-label="The pairing value"
            className="bg-muted min-w-0 flex-1 rounded-md border px-3 py-2 font-mono text-xs"
            onFocus={(e) => e.target.select()}
          />
          <Button variant="outline" onClick={() => setShown((now) => !now)} disabled={!value} aria-pressed={shown}>
            {shown ? 'Hide' : 'Show'}
          </Button>
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

      {!toolUser && noToolUser && <p className="text-muted-foreground mt-6 max-w-2xl text-sm">{noToolUser}</p>}

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
        {keychain && (
          <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {keychain}
          </p>
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
