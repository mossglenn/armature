import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import type { Backend, ShellState } from '@/lib/backend';
import { sentence, useInstance } from '@/lib/instance';
import type { Person, Refusal } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/**
 * Sign in (docs/desktop-program-plan.md §4, item 2; §6): the core opens the system browser at the
 * sign-in provider and waits for it on a loopback port; this page says so, and shows who the instance
 * says the person is once it answers. A person the instance does not know sees its refusal and whom to
 * ask; a provider that refuses offline_access is answered with the choice of signing in without
 * staying signed in. No token reaches this page.
 */
export function SignIn({ backend, state, onDone }: { backend: Backend; state?: ShellState; onDone: () => void }) {
  const { run, busy } = useRequest(backend);
  const [opened, setOpened] = useState<string | undefined>();
  const [person, setPerson] = useState<{ person: Person; staysSignedIn: boolean } | undefined>();
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  /** A sign-in begun on an earlier visit to this page is still waiting on the browser. */
  const [waitingElsewhere, setWaitingElsewhere] = useState(false);
  const instance = useInstance();
  // Where the browser opens, as the settings keep it, so the person sees the provider before it does.
  const issuer = typeof state?.started?.issuer === 'string' ? state.started.issuer : undefined;
  const signedIn = state?.started?.signedIn === true;

  useEffect(
    () =>
      backend.onEvent((event) => {
        if (event.event === 'open' && typeof event.url === 'string') setOpened(event.url);
      }),
    [backend]
  );

  // Already signed in (an earlier visit, or the keychain's sign-in at start): the page says who,
  // where it used to offer "Sign in" again (the 2026-11-09 review's P8).
  useEffect(() => {
    if (!signedIn) return;
    void run<{ person: Person; staysSignedIn: boolean }>('whoAmI').then((outcome) => outcome.ok && setPerson(outcome.body));
  }, [signedIn, run]);

  const signIn = async (offline = true) => {
    setRefusal(undefined);
    setOpened(undefined);
    setWaitingElsewhere(false);
    const outcome = await run<{ person: Person; staysSignedIn: boolean }>('signIn', offline ? {} : { offline: false });
    setOpened(undefined);
    if (outcome.ok) return setPerson(outcome.body);
    // The sign-in this page began on an earlier visit is still waiting: say so, with the way out, not a bare refusal.
    if (outcome.refusal.error === 'sign_in_in_progress') return setWaitingElsewhere(true);
    // Cancelled from this page: nothing went wrong, so nothing is shown but the button again.
    if (outcome.refusal.error === 'sign_in_cancelled') return;
    setRefusal(outcome);
  };

  const cancel = async () => {
    await run('cancelSignIn');
    setWaitingElsewhere(false);
    setOpened(undefined);
  };

  if (person) {
    return (
      <section>
        <PageHeader title="Signed in">{sentence(instance)} knows you as:</PageHeader>
        <div className="max-w-md rounded-lg border p-4">
          <p className="font-medium">{person.person.displayName ?? person.person.externalId}</p>
          <p className="text-muted-foreground text-sm">{person.person.externalId}</p>
        </div>
        {!person.staysSignedIn && <p className="text-muted-foreground mt-3 text-sm">You will sign in again when this sign-in expires: the sign-in provider does not keep you signed in.</p>}
        <Button className="mt-4" onClick={onDone}>
          Go to your workspaces
        </Button>
      </section>
    );
  }

  const scopeRefused = refusal?.refusal.offlineAccess === true;
  const unregistered = refusal?.refusal.error === 'not_registered';
  /** The provider signed the person in and the credential is kept; only the instance's answer about them is missing (the 2026-11-09 review's C16). */
  const keptSignIn = refusal?.refusal.signedIn === true;
  const checkAgain = async () => {
    const outcome = await run<{ person: Person; staysSignedIn: boolean }>('whoAmI');
    if (outcome.ok) {
      setRefusal(undefined);
      return setPerson(outcome.body);
    }
    // Still refused: the same sentence stands, with what the instance says now.
    setRefusal({ ...outcome, refusal: { ...outcome.refusal, signedIn: true } });
  };
  return (
    <section>
      <PageHeader title="Sign in">
        Sign in to {instance} in your browser{issuer ? <>, at <span className="break-all">{issuer}</span></> : ''}. The app keeps you signed in until you sign out.
      </PageHeader>
      {busy === 'signIn' ? (
        <div className="max-w-xl rounded-lg border p-4" aria-live="polite">
          <p className="font-medium">Continue in your browser</p>
          <p className="text-muted-foreground mt-1 text-sm">The app is waiting for your sign-in provider. Come back here when it says you are signed in.</p>
          {opened && <p className="text-muted-foreground mt-2 text-xs break-all">If no browser opened, go to {opened}</p>}
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void cancel()}>
            Cancel the sign-in
          </Button>
        </div>
      ) : waitingElsewhere ? (
        <div className="max-w-xl rounded-lg border p-4" role="status">
          <p className="font-medium">A sign-in is already waiting in your browser</p>
          <p className="text-muted-foreground mt-1 text-sm">Finish it there, or cancel it and start again.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void cancel()}>
            Cancel the sign-in
          </Button>
        </div>
      ) : (
        <Button onClick={() => void signIn()}>Sign in</Button>
      )}
      {refusal && (
        <div className="mt-4 max-w-xl space-y-3">
          <RefusalNotice {...refusal} />
          {scopeRefused && (
            <Button variant="outline" onClick={() => void signIn(false)}>
              Sign in without staying signed in
            </Button>
          )}
          {unregistered && !keptSignIn && <p className="text-sm">Ask an administrator of {instance} to register you, then sign in again.</p>}
          {keptSignIn && (
            <div className="space-y-2 text-sm">
              <p>
                {unregistered
                  ? `Your sign-in itself went through and is kept. Ask an administrator of ${instance} to register you; you will not need to sign in again.`
                  : `Your sign-in itself went through and is kept; ${instance} could not say who you are just now.`}
              </p>
              <Button variant="outline" disabled={busy !== undefined} onClick={() => void checkAgain()}>
                Try again
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
