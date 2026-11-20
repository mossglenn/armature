import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { PersonalChecksEditor } from '@/components/PersonalChecksEditor';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { verbatim } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import type { Backend, ShellState } from '@/lib/backend';
import { sentence, useInstance } from '@/lib/instance';
import type { Person, Profile, Refusal, Settings as SettingsShape, SettingsReply, WorkspaceRecord } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/** A field's text as a whole number of 0 or more, or undefined when it is not one. */
const wholeNumber = (text: string): number | undefined => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : undefined);

/**
 * Settings (docs/desktop-program-plan.md §4, item 6; §9): the remote (changed on the connect page,
 * and only while no workspace exists), the folder with the synced-folder warning, the port, the
 * snapshot budget, the identifier under header, with what the remote says of the one saved (who it is,
 * or that it knows no such identifier; `whoAmI`); a change the hub needs a restart for says so and
 * offers it; starting at login, saved as it is ticked (the shell makes the system's entry follow it,
 * src-tauri/src/login.rs, and the state says what the entry then is, shown beside the box when it
 * differs from the setting; the 2026-11-09 review's R10); sign out; and the versions: the program's, the hub revision it carries,
 * the remote's, with a check of the release channel on demand (the daily one is the shell's); and the
 * person's own required checks, which gate their pushes (components/PersonalChecksEditor.tsx).
 */
export function Settings({ backend, state, connect, signedOut }: { backend: Backend; state?: ShellState; connect: () => void; signedOut: (keychain?: string) => void }) {
  const { run, busy } = useRequest(backend);
  const instance = useInstance();
  const [settings, setSettings] = useState<SettingsShape | undefined>();
  const [form, setForm] = useState({ folder: '', port: '', snapshots: '', user: '' });
  const [warning, setWarning] = useState<string | undefined>();
  const [restart, setRestart] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [version, setVersion] = useState<string | undefined>();
  const [remoteVersions, setRemoteVersions] = useState<string[] | 'unreachable' | undefined>();
  const [checked, setChecked] = useState<{ busy: boolean; line?: string }>({ busy: false });
  /** What the page refuses to send: a port or a count that is not a number. */
  const [problem, setProblem] = useState<string | undefined>();
  const [restarting, setRestarting] = useState(false);
  /** The number of workspaces in the folder the hub runs over, when a save has just pointed the next start at another folder. */
  const [folderMoved, setFolderMoved] = useState<number | undefined>();
  /** The workspaces a check can be bound to; none when the hub is not running, and a check can still bind every workspace. */
  const [workspaces, setWorkspaces] = useState<string[]>([]);
  /** Under header, what the remote says of the identifier saved: the person it is, or that it knows no such one. */
  const [known, setKnown] = useState<{ user: string; person?: Person } | undefined>();

  const show = (reply: SettingsReply) => {
    setSettings(reply.settings);
    setWarning(reply.warning);
    setForm({ folder: reply.settings.folder ?? '', port: String(reply.settings.port), snapshots: String(reply.settings.snapshots), user: reply.settings.user ?? '' });
  };

  // Asked of the remote whenever the saved identifier is shown, never kept: the page used to take an
  // identifier the remote did not know and say nothing (found at 0.1.3's rehearsal). A remote that
  // cannot be asked leaves the line out; the Versions block says it cannot be reached.
  const askWho = useCallback(
    async (shown: SettingsShape) => {
      setKnown(undefined);
      const user = shown.user;
      if (shown.identity?.resolver !== 'header' || !shown.remote || !user) return;
      const asked = await run<{ person: Person }>('whoAmI');
      if (asked.ok) setKnown({ user, person: asked.body.person });
      else if (asked.refusal.error === 'unknown_user') setKnown({ user });
    },
    [run]
  );

  useEffect(() => {
    void backend.version().then(setVersion);
    void run<WorkspaceRecord[]>('workspaces').then((outcome) => outcome.ok && setWorkspaces(outcome.body.map((w) => w.branch)));
    void run<SettingsReply>('settings').then((outcome) => {
      if (!outcome.ok) return setRefusal(outcome);
      show(outcome.body);
      void askWho(outcome.body.settings);
      if (outcome.body.settings.remote) {
        void run<Profile>('profile', { remote: outcome.body.settings.remote }).then((profile) => setRemoteVersions(profile.ok ? profile.body.versions : 'unreachable'));
      }
    });
  }, [backend, run, askWho]);

  const save = async () => {
    if (!settings) return;
    setRefusal(undefined);
    setProblem(undefined);
    setSaved(false);
    setFolderMoved(undefined);
    // Checked here, not left to the core: `Number('31o1')` is NaN, which travels as null, which the
    // core reads as "restore the default", and the page then said "Saved." (the 2026-11-09 review's P2).
    const port = wholeNumber(form.port);
    const snapshots = wholeNumber(form.snapshots);
    if (port === undefined || port < 1 || port > 65535) return setProblem('The port is a whole number from 1 to 65535.');
    if (snapshots === undefined) return setProblem('The number of older commits kept offline is a whole number, 0 or more.');
    const set: Record<string, unknown> = {
      folder: form.folder.trim() ? form.folder.trim() : null,
      port,
      snapshots,
    };
    if (settings.identity?.resolver === 'header') set.user = form.user.trim() || null;
    const before = settings.folder ?? '';
    const outcome = await run<SettingsReply>('settings', { set });
    if (!outcome.ok) return setRefusal(outcome);
    show(outcome.body);
    setRestart(outcome.body.restart === true);
    setSaved(true);
    // The workspaces stay where they are: the hub will look in the new folder and find none (the 2026-11-09 review's P9).
    setFolderMoved((outcome.body.settings.folder ?? '') !== before && workspaces.length > 0 ? workspaces.length : undefined);
    void askWho(outcome.body.settings);
  };

  const startAtLogin = async (on: boolean) => {
    setRefusal(undefined);
    const outcome = await run<SettingsReply>('settings', { set: { startAtLogin: on } });
    if (!outcome.ok) return setRefusal(outcome);
    setSettings(outcome.body.settings);
  };

  const checkUpdate = async () => {
    setChecked({ busy: true });
    try {
      const after = await backend.checkUpdate();
      const line = {
        update: `Version ${after.state.update?.version ?? ''} is available; it is offered at the top of the window.`,
        latest: 'You have the latest version.',
        // Not "the latest version": the channel answered without a release, which is also what an error status looks like to the updater.
        no_release: 'The release channel answered without a release (none is released yet, or it did not answer); the app tries again within the hour.',
        packaged: 'This install is a system package; it is updated by installing the next package, and the app does not look at the release channel.',
      }[after.found];
      setChecked({ busy: false, line });
    } catch (err) {
      setChecked({ busy: false, line: `The release channel could not be reached (${err instanceof Error ? err.message : String(err)}).` });
    }
  };

  // The system's entry against the setting: the error the shell met, or the difference it found.
  const entry = state?.loginEntry;
  const entryProblem =
    entry && settings
      ? (entry.error ??
        (entry.enabled !== undefined && entry.enabled !== (settings.startAtLogin ?? false)
          ? settings.startAtLogin
            ? 'The system has no entry to start the app at login; it is made again at the next start.'
            : 'The system still has an entry starting the app at login; it is removed at the next start.'
          : undefined))
      : undefined;

  // A hub that is not running is started, not stopped first: after a start that failed (a port in
  // use) there is nothing to stop, and this is the way back without quitting (the 2026-11-09 review's P4).
  const hubRunning = state?.core === 'running';
  const restartHub = async () => {
    setRestarting(true);
    try {
      if (hubRunning) await backend.setHub(false);
      await backend.setHub(true);
      setRestart(false);
      setSaved(false);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setRestarting(false);
    }
  };

  const signOut = async () => {
    const outcome = await run<{ keychain?: string }>('signOut');
    if (!outcome.ok) return setRefusal(outcome);
    // `keychain`: the shell's sentence when the keychain would not give the sign-in up, so the person is not told they are signed out and left signed in at the next start.
    signedOut(outcome.body?.keychain);
  };

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((all) => ({ ...all, [key]: e.target.value })) });
  const revision = typeof state?.started?.revision === 'string' ? state.started.revision : undefined;

  return (
    <section className="max-w-2xl">
      <PageHeader title="Settings" />

      <div className="rounded-lg border p-4" aria-label="Your instance">
        <p className="font-medium">Your instance</p>
        <p className="mt-1 text-sm">{settings?.instance?.name ?? settings?.remote ?? 'Not connected'}</p>
        {settings?.remote && <p className="text-muted-foreground font-mono text-xs break-all">{settings.remote}</p>}
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={connect}>
            Connect elsewhere…
          </Button>
          {settings?.identity?.resolver === 'oidc' && (
            <Button variant="outline" size="sm" disabled={busy !== undefined} onClick={() => void signOut()}>
              Sign out
            </Button>
          )}
        </div>
      </div>

      <form
        className="mt-6 flex flex-col gap-3 rounded-lg border p-4"
        aria-label="This computer"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="font-medium">This computer</p>
        <Label htmlFor="folder">Workspaces folder</Label>
        <Input id="folder" {...verbatim} placeholder={state?.dataDir ? `${state.dataDir}/workspaces` : 'In the app’s data folder'} {...field('folder')} />
        {warning && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">{warning}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="port">Port</Label>
            <Input id="port" inputMode="numeric" {...field('port')} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="snapshots">Older commits kept offline</Label>
            <Input id="snapshots" inputMode="numeric" {...field('snapshots')} />
          </div>
        </div>
        {settings?.identity?.resolver === 'header' && (
          <>
            <Label htmlFor="settings-user">Your ID on {instance}</Label>
            <Input id="settings-user" {...verbatim} {...field('user')} />
            {known?.person && (
              <p className="text-muted-foreground text-sm">
                {sentence(instance)} knows <span className="font-mono">{known.user}</span> as {known.person.displayName ?? known.person.id}.
              </p>
            )}
            {known && !known.person && (
              <p className="text-destructive text-sm" role="alert">
                {sentence(instance)} does not know <span className="font-mono">{known.user}</span>. Nothing can be created, pushed or merged as an ID it does not know. Correct it here, or ask an administrator of {instance} to register you.
              </p>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!settings || busy !== undefined} checked={settings?.startAtLogin ?? false} onChange={(e) => void startAtLogin(e.target.checked)} />
          Start at login, in the tray
        </label>
        {entryProblem && (
          <p className="text-destructive text-sm" role="alert">
            {entryProblem}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy !== undefined || !settings}>
            {/* vocabulary-allow: save */}
            Save
          </Button>
          {/* vocabulary-allow: save */}
          {saved && !restart && hubRunning && <span className="text-muted-foreground text-sm">Saved.</span>}
        </div>
        {(restart || (saved && !hubRunning && settings?.remote !== undefined)) && (
          <div className="flex items-center gap-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900" role="status">
            {/* vocabulary-allow: save */}
            {hubRunning ? 'The hub uses these from its next start.' : 'Saved. The hub is not running.'}
            <Button type="button" size="sm" variant="outline" disabled={restarting} onClick={() => void restartHub()}>
              {hubRunning ? 'Restart the hub' : 'Start the hub'}
            </Button>
          </div>
        )}
        {folderMoved !== undefined && (
          <p className="max-w-2xl rounded-md bg-amber-50 p-3 text-sm text-amber-900" role="alert">
            {folderMoved === 1 ? 'The workspace you have stays' : `Your ${folderMoved} workspaces stay`} in the folder used until now, with any commits to push: the hub will find none in the new one. Merge or remove{' '}
            {folderMoved === 1 ? 'it' : 'them'} first, or move the old folder&rsquo;s contents to the new place before the hub starts again; setting the folder back undoes this.
          </p>
        )}
        {problem && (
          <p className="text-destructive text-sm" role="alert">
            {problem}
          </p>
        )}
        {refusal && <RefusalNotice {...refusal} />}
      </form>

      <PersonalChecksEditor backend={backend} workspaces={workspaces} />

      <div className="mt-6 rounded-lg border p-4 text-sm" aria-label="Versions">
        <p className="font-medium">Versions</p>
        <dl className="mt-2 grid grid-cols-[10rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">This app</dt>
          <dd>{version ?? '…'}</dd>
          <dt className="text-muted-foreground">Its hub’s API revision</dt>
          <dd>{revision ?? '…'}</dd>
          <dt className="text-muted-foreground">{sentence(instance)} serves</dt>
          <dd>{remoteVersions === 'unreachable' ? 'Cannot be reached' : (remoteVersions?.join(', ') ?? '…')}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={checked.busy} onClick={() => void checkUpdate()}>
            {checked.busy ? 'Looking…' : 'Look for a new version'}
          </Button>
          {checked.line && (
            <span className="text-muted-foreground" role="status">
              {checked.line}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
