import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { verbatim } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import type { Backend, ShellState } from '@/lib/backend';
import type { Person, Profile, Refusal, SettingsReply } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/**
 * Connect (docs/desktop-program-plan.md §4, item 1; §8): the remote's address, typed or brought by an
 * `armature://connect` link, read and shown before anything is connected. The profile is what the
 * remote's GET /discover says; the person confirms the instance's name, its address and how it signs
 * people in. The address shown is always the one dialed, never the one the hub declares for itself,
 * and the card goes when the field changes; `connect` carries the identity and instance confirmed,
 * so the core keeps nothing else (the 2026-11-09 review's C1 and C2). A remote under header asks
 * for the person's identifier instead, and says it is a development arrangement. The link is
 * untrusted: it only fills the address field.
 */
export function Connect({ backend, state, link, onDone }: { backend: Backend; state?: ShellState; link?: string; onDone: (next: 'signIn' | 'workspaces', keychain?: string) => void }) {
  const { run, busy } = useRequest(backend);
  const current = typeof state?.started?.remote === 'string' ? state.started.remote : undefined;
  const needsUser = state?.started?.needs === 'user';
  const [address, setAddress] = useState(link ?? current ?? '');
  const [profile, setProfile] = useState<Profile | undefined>();
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [user, setUser] = useState('');
  const [askUser, setAskUser] = useState(needsUser);
  const [keychain, setKeychain] = useState<string | undefined>();
  /** The identifier just saved that the remote answered it does not know. */
  const [unknown, setUnknown] = useState<string | undefined>();

  useEffect(() => {
    if (link) {
      setAddress(link);
      setProfile(undefined);
    }
  }, [link]);
  useEffect(() => setAskUser(needsUser), [needsUser]);

  const read = async () => {
    setRefusal(undefined);
    setProfile(undefined);
    const outcome = await run<Profile>('profile', { remote: address });
    if (outcome.ok) setProfile(outcome.body);
    else setRefusal(outcome);
  };

  /** The hub starts, or starts again, under the settings just written. */
  const restartHub = async () => {
    if (state?.started?.started === true) await backend.setHub(false);
    await backend.setHub(true);
  };

  const confirm = async () => {
    if (!profile) return;
    setRefusal(undefined);
    const outcome = await run<SettingsReply & { keychain?: string }>('connect', { remote: profile.remote, identity: profile.identity, ...(profile.instance ? { instance: profile.instance } : {}) });
    if (!outcome.ok) return setRefusal(outcome);
    // The shell's sentence when the keychain kept the sign-in for the remote left behind.
    setKeychain(outcome.body.keychain);
    if (profile.identity.resolver === 'header' && !outcome.body.settings.user) return setAskUser(true);
    await restartHub();
    onDone(profile.identity.resolver === 'oidc' ? 'signIn' : 'workspaces', outcome.body.keychain);
  };

  // The identifier is saved and the hub started whatever the remote says of it, so the program works
  // offline and for a person registered a minute later; but a remote that answers it does not know
  // the identifier is said here, before the first push is refused for it (found at 0.1.3's rehearsal,
  // where the page went on and showed nothing). A remote that cannot be asked holds no one back.
  const saveUser = async () => {
    setRefusal(undefined);
    setUnknown(undefined);
    const outcome = await run<SettingsReply>('settings', { set: { user } });
    if (!outcome.ok) return setRefusal(outcome);
    await restartHub();
    const asked = await run<{ person: Person }>('whoAmI');
    if (!asked.ok && asked.refusal.error === 'unknown_user') return setUnknown(user.trim());
    onDone('workspaces', keychain);
  };

  if (askUser) {
    return (
      <section>
        <PageHeader title="Who are you on this remote?">
          The remote at {current ?? profile?.remote} takes your identifier as you say it, with no sign-in: a development arrangement, not one for real work.
        </PageHeader>
        <form
          className="flex max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveUser();
          }}
        >
          <Label htmlFor="user">Your identifier on the remote</Label>
          <Input
            id="user"
            {...verbatim}
            value={user}
            onChange={(e) => {
              setUser(e.target.value);
              setUnknown(undefined);
            }}
            placeholder="you@example.edu"
            autoFocus
          />
          <Button type="submit" disabled={!user.trim() || busy !== undefined}>
            {busy ? 'Starting the hub…' : 'Continue'}
          </Button>
          {unknown && (
            <div role="alert" className="border-destructive/40 bg-destructive/5 flex flex-col gap-2 rounded-md border p-3 text-sm">
              <p>
                The remote does not know <span className="font-mono">{unknown}</span>. Nothing can be created, pushed or delivered as an identifier it does not know. Correct it above, or ask the instance&rsquo;s administrator to register you.
              </p>
              <p className="text-muted-foreground">It is kept as typed, and can be changed on the Settings page.</p>
              <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => onDone('workspaces', keychain)}>
                Go on with it
              </Button>
            </div>
          )}
          {refusal && <RefusalNotice {...refusal} />}
        </form>
      </section>
    );
  }

  return (
    <section>
      <PageHeader title="Connect to your instance">
        {current ? `Connected to ${current}. Connecting elsewhere is possible only while no workspace exists.` : 'The address your instance’s administrator gave you, or the one its web pages link to.'}
      </PageHeader>
      <form
        className="flex max-w-xl gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void read();
        }}
      >
        <Label htmlFor="remote" className="sr-only">
          The instance's address
        </Label>
        <Input
          id="remote"
          {...verbatim}
          value={address}
          onChange={(e) => {
            setAddress(e.target.value);
            setProfile(undefined);
          }}
          placeholder="https://api.armature.example.edu"
          autoFocus={!link}
        />
        <Button type="submit" variant="outline" disabled={!address.trim() || busy !== undefined}>
          {busy === 'profile' ? 'Reading…' : 'Read'}
        </Button>
      </form>
      {link && !profile && <p className="text-muted-foreground mt-2 text-sm">A link asked to connect here. Read the instance and check it before connecting.</p>}

      {profile && (
        <div className="mt-6 max-w-xl rounded-lg border p-4" aria-label="The instance">
          <p className="text-lg font-medium">{profile.instance?.name ?? profile.remote}</p>
          <dl className="mt-3 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted-foreground">Address</dt>
            <dd className="font-mono break-all">{profile.remote}</dd>
            <dt className="text-muted-foreground">Signs you in at</dt>
            <dd className="break-all">{profile.identity.resolver === 'oidc' ? profile.identity.issuer : 'No sign-in: you say who you are'}</dd>
            <dt className="text-muted-foreground">Versions</dt>
            <dd>
              {profile.compatible ? (
                <Badge variant="success">Compatible</Badge>
              ) : (
                <span>
                  <Badge variant="warning">Not compatible</Badge> This program speaks {profile.revision}; the instance serves {profile.versions.join(', ')}.
                  {profile.instance?.program?.releases ? ` Get the program that matches from ${profile.instance.program.releases}.` : ''}
                </span>
              )}
            </dd>
          </dl>
          {profile.warning && <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900">{profile.warning}</p>}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void confirm()} disabled={!profile.compatible || busy !== undefined}>
              {busy === 'connect' ? 'Connecting…' : `Connect to ${profile.instance?.name ?? profile.remote}`}
            </Button>
            <Button variant="ghost" onClick={() => setProfile(undefined)}>
              Not this one
            </Button>
          </div>
        </div>
      )}
      {refusal && (
        <div className="mt-4 max-w-xl">
          <RefusalNotice {...refusal} />
        </div>
      )}
    </section>
  );
}
