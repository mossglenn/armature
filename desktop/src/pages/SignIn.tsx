import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import type { Backend, ShellState } from '@/lib/backend';
import type { Person, Refusal } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/**
 * Sign in (docs/desktop-program-plan.md §4, item 2; §6): the core opens the system browser at the
 * identity provider and waits for it on a loopback port; this page says so, and shows who the remote
 * says the person is once it answers. A person the remote does not know sees its refusal and whom to
 * ask; a provider that refuses offline_access is answered with the choice of signing in without
 * staying signed in. No token reaches this page.
 */
export function SignIn({ backend, state, onDone }: { backend: Backend; state?: ShellState; onDone: () => void }) {
  const { run, busy } = useRequest(backend);
  const [opened, setOpened] = useState<string | undefined>();
  const [person, setPerson] = useState<{ person: Person; staysSignedIn: boolean } | undefined>();
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const remote = typeof state?.started?.remote === 'string' ? state.started.remote : 'the remote';

  useEffect(
    () =>
      backend.onEvent((event) => {
        if (event.event === 'open' && typeof event.url === 'string') setOpened(event.url);
      }),
    [backend]
  );

  const signIn = async (offline = true) => {
    setRefusal(undefined);
    setOpened(undefined);
    const outcome = await run<{ person: Person; staysSignedIn: boolean }>('signIn', offline ? {} : { offline: false });
    setOpened(undefined);
    if (outcome.ok) setPerson(outcome.body);
    else setRefusal(outcome);
  };

  if (person) {
    return (
      <section>
        <PageHeader title="Signed in">{remote} knows you as:</PageHeader>
        <div className="max-w-md rounded-lg border p-4">
          <p className="font-medium">{person.person.displayName ?? person.person.externalId}</p>
          <p className="text-muted-foreground text-sm">{person.person.externalId}</p>
        </div>
        {!person.staysSignedIn && <p className="text-muted-foreground mt-3 text-sm">You will sign in again when this sign-in expires: the identity provider does not keep you signed in.</p>}
        <Button className="mt-4" onClick={onDone}>
          Go to your workspaces
        </Button>
      </section>
    );
  }

  const scopeRefused = refusal?.refusal.offlineAccess === true;
  const unregistered = refusal?.refusal.error === 'not_registered';
  return (
    <section>
      <PageHeader title="Sign in">Sign in to {remote} in your browser. The program keeps you signed in until you sign out.</PageHeader>
      {busy === 'signIn' ? (
        <div className="max-w-xl rounded-lg border p-4" aria-live="polite">
          <p className="font-medium">Continue in your browser</p>
          <p className="text-muted-foreground mt-1 text-sm">The program is waiting for your identity provider. Come back here when it says you are signed in.</p>
          {opened && <p className="text-muted-foreground mt-2 text-xs break-all">If no browser opened, go to {opened}</p>}
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
          {unregistered && <p className="text-sm">Ask your instance’s administrator to register you, then sign in again.</p>}
        </div>
      )}
    </section>
  );
}
