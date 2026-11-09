import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { RefusalNotice } from '@/components/RefusalNotice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { verbatim } from '@/lib/utils';
import { Label } from '@/components/ui/label';
import type { Backend, ShellState } from '@/lib/backend';
import type { Profile, Refusal, Settings as SettingsShape, SettingsReply } from '@/lib/types';
import { useRequest } from '@/lib/useShell';

/**
 * Settings (docs/desktop-program-plan.md §4, item 6; §9): the remote (changed on the connect page,
 * and only while no workspace exists), the folder with the synced-folder warning, the port, the
 * snapshot budget, the identifier under header; a change the hub needs a restart for says so and
 * offers it; starting at login, saved as it is ticked (the shell makes the system's entry follow it,
 * src-tauri/src/login.rs); sign out; and the versions: the program's, the hub revision it carries,
 * the remote's, with a check of the release channel on demand (the daily one is the shell's).
 */
export function Settings({ backend, state, connect, signedOut }: { backend: Backend; state?: ShellState; connect: () => void; signedOut: () => void }) {
  const { run, busy } = useRequest(backend);
  const [settings, setSettings] = useState<SettingsShape | undefined>();
  const [form, setForm] = useState({ folder: '', port: '', snapshots: '', user: '' });
  const [warning, setWarning] = useState<string | undefined>();
  const [restart, setRestart] = useState(false);
  const [saved, setSaved] = useState(false);
  const [refusal, setRefusal] = useState<{ refusal: Refusal; status: number } | undefined>();
  const [version, setVersion] = useState<string | undefined>();
  const [remoteVersions, setRemoteVersions] = useState<string[] | 'unreachable' | undefined>();
  const [checked, setChecked] = useState<{ busy: boolean; line?: string }>({ busy: false });

  const show = (reply: SettingsReply) => {
    setSettings(reply.settings);
    setWarning(reply.warning);
    setForm({ folder: reply.settings.folder ?? '', port: String(reply.settings.port), snapshots: String(reply.settings.snapshots), user: reply.settings.user ?? '' });
  };

  useEffect(() => {
    void backend.version().then(setVersion);
    void run<SettingsReply>('settings').then((outcome) => {
      if (!outcome.ok) return setRefusal(outcome);
      show(outcome.body);
      if (outcome.body.settings.remote) {
        void run<Profile>('profile', { remote: outcome.body.settings.remote }).then((profile) => setRemoteVersions(profile.ok ? profile.body.versions : 'unreachable'));
      }
    });
  }, [backend, run]);

  const save = async () => {
    if (!settings) return;
    setRefusal(undefined);
    setSaved(false);
    const set: Record<string, unknown> = {
      folder: form.folder.trim() ? form.folder.trim() : null,
      port: Number(form.port),
      snapshots: Number(form.snapshots),
    };
    if (settings.identity?.resolver === 'header') set.user = form.user.trim() || null;
    const outcome = await run<SettingsReply>('settings', { set });
    if (!outcome.ok) return setRefusal(outcome);
    show(outcome.body);
    setRestart(outcome.body.restart === true);
    setSaved(true);
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
      setChecked({ busy: false, line: after.update ? `Version ${after.update.version} is available; it is offered at the top of the window.` : 'This is the latest version.' });
    } catch (err) {
      setChecked({ busy: false, line: `The release channel could not be checked (${err instanceof Error ? err.message : String(err)}).` });
    }
  };

  const restartHub = async () => {
    await backend.setHub(false);
    await backend.setHub(true);
    setRestart(false);
  };

  const signOut = async () => {
    const outcome = await run('signOut');
    if (!outcome.ok) return setRefusal(outcome);
    signedOut();
  };

  const field = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm((all) => ({ ...all, [key]: e.target.value })) });
  const revision = typeof state?.started?.revision === 'string' ? state.started.revision : undefined;

  return (
    <section className="max-w-2xl">
      <PageHeader title="Settings" />

      <div className="rounded-lg border p-4" aria-label="The remote">
        <p className="font-medium">The remote</p>
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
        aria-label="This machine"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p className="font-medium">This machine</p>
        <Label htmlFor="folder">Workspaces folder</Label>
        <Input id="folder" {...verbatim} placeholder={state?.dataDir ? `${state.dataDir}/workspaces` : 'In the program’s data folder'} {...field('folder')} />
        {warning && <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-900">{warning}</p>}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="port">Port</Label>
            <Input id="port" inputMode="numeric" {...field('port')} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="snapshots">Older commits kept</Label>
            <Input id="snapshots" inputMode="numeric" {...field('snapshots')} />
          </div>
        </div>
        {settings?.identity?.resolver === 'header' && (
          <>
            <Label htmlFor="settings-user">Your identifier on the remote</Label>
            <Input id="settings-user" {...verbatim} {...field('user')} />
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!settings || busy !== undefined} checked={settings?.startAtLogin ?? false} onChange={(e) => void startAtLogin(e.target.checked)} />
          Start at login, in the tray
        </label>
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy !== undefined || !settings}>
            Save
          </Button>
          {saved && !restart && <span className="text-muted-foreground text-sm">Saved.</span>}
        </div>
        {restart && (
          <div className="flex items-center gap-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900" role="status">
            The hub uses these from its next start.
            <Button size="sm" variant="outline" onClick={() => void restartHub()}>
              Restart the hub
            </Button>
          </div>
        )}
        {refusal && <RefusalNotice {...refusal} />}
      </form>

      <div className="mt-6 rounded-lg border p-4 text-sm" aria-label="Versions">
        <p className="font-medium">Versions</p>
        <dl className="mt-2 grid grid-cols-[10rem_1fr] gap-y-1">
          <dt className="text-muted-foreground">This program</dt>
          <dd>{version ?? '…'}</dd>
          <dt className="text-muted-foreground">Its hub’s revision</dt>
          <dd>{revision ?? '…'}</dd>
          <dt className="text-muted-foreground">The remote serves</dt>
          <dd>{remoteVersions === 'unreachable' ? 'Cannot be reached' : (remoteVersions?.join(', ') ?? '…')}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={checked.busy} onClick={() => void checkUpdate()}>
            {checked.busy ? 'Checking…' : 'Check for updates'}
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
