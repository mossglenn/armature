import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Backend, UpdateState } from '@/lib/backend';

/** The shell's action names (src-tauri/src/core.rs `describe`) as a sentence names them. */
const ACTION_WORDS: Record<string, string> = {
  create: 'the workspace being created',
  clone: 'the clone',
  push: 'the push',
  bringIn: 'the bring-in',
  deliver: 'the delivery',
  remove: 'the removal',
};

/**
 * An update the release channel offers (docs/desktop-program-plan.md §10), above every page so it is
 * seen wherever the person is, and installed only when they ask. Installing stops the hub for the
 * moment it takes, so the notice says that before the person chooses; the program then starts again
 * into the new version. A failed install keeps the update offered, with the reason.
 *
 * While a push, bring-in, deliver, create, clone or remove runs (`blocked`, the shell's state), the
 * button waits, since installing would stop the hub under it; the shell refuses too (the 2026-11-09
 * review's R10 and S3). Only the sentence that says what is happening is a live region, so a screen
 * reader hears each change of state once and not every percent of the download, which is a progress
 * bar (R10).
 */
export function UpdateNotice({ backend, update, blocked, refresh }: { backend: Backend; update: UpdateState; blocked?: string; refresh: () => void }) {
  const [asked, setAsked] = useState(false);
  const install = () => {
    setAsked(true);
    // Settles only when the install failed; the shell's state then says why.
    void backend
      .installUpdate()
      .catch(() => undefined)
      .finally(() => {
        setAsked(false);
        refresh();
      });
  };
  const working = update.state === 'downloading' || update.state === 'installing';
  const waitingFor = blocked ? (ACTION_WORDS[blocked] ?? 'the action') : undefined;

  return (
    <section aria-label="Update" className="mb-6 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-50">
      {update.state === 'downloading' && (
        <>
          <p className="font-medium" role="status">
            Downloading version {update.version}…
          </p>
          {update.progress !== undefined && (
            <p className="mt-2 flex items-center gap-3">
              <progress className="w-full max-w-md" max={100} value={update.progress} aria-label="Download progress" />
              <span className="tabular-nums" aria-hidden="true">
                {update.progress}%
              </span>
            </p>
          )}
        </>
      )}
      {update.state === 'installing' && (
        <p className="font-medium" role="status">
          Installing version {update.version}; the program starts again in a moment.
        </p>
      )}
      {(update.state === 'available' || update.state === 'failed') && (
        <>
          <p className="font-medium" role="status">
            Version {update.version} is available (this is {update.current}).
          </p>
          {update.notes && <p className="mt-1 whitespace-pre-line opacity-80">{update.notes}</p>}
          {update.state === 'failed' && (
            <p className="text-destructive mt-2" role="alert">
              The update could not be installed: {update.error ?? 'no reason was given'}. This version keeps running; you can try again.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={asked || working || waitingFor !== undefined} onClick={install}>
              {update.state === 'failed' ? 'Try again' : 'Install and restart'}
            </Button>
            <span className="text-xs opacity-80">
              {waitingFor ? `Install when ${waitingFor} finishes; the hub would stop under it.` : 'The hub stops while it installs; your tools reach it again once the program is back.'}
            </span>
          </div>
        </>
      )}
    </section>
  );
}
