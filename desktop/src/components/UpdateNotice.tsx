import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Backend, UpdateState } from '@/lib/backend';

/**
 * An update the release channel offers (docs/desktop-program-plan.md §10), above every page so it is
 * seen wherever the person is, and installed only when they ask. Installing stops the hub for the
 * moment it takes, so the notice says that before the person chooses; the program then starts again
 * into the new version. A failed install keeps the update offered, with the reason.
 */
export function UpdateNotice({ backend, update, refresh }: { backend: Backend; update: UpdateState; refresh: () => void }) {
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

  return (
    <div role="status" aria-label="Update" className="mb-6 rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-50">
      {update.state === 'downloading' && (
        <p className="font-medium">
          Downloading version {update.version}
          {update.progress !== undefined ? `… ${update.progress}%` : '…'}
        </p>
      )}
      {update.state === 'installing' && <p className="font-medium">Installing version {update.version}; the program starts again in a moment.</p>}
      {(update.state === 'available' || update.state === 'failed') && (
        <>
          <p className="font-medium">
            Version {update.version} is available (this is {update.current}).
          </p>
          {update.notes && <p className="mt-1 whitespace-pre-line opacity-80">{update.notes}</p>}
          {update.state === 'failed' && (
            <p className="text-destructive mt-2" role="alert">
              The update could not be installed: {update.error ?? 'no reason was given'}. This version keeps running; you can try again.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={asked || working} onClick={install}>
              {update.state === 'failed' ? 'Try again' : 'Install and restart'}
            </Button>
            <span className="text-xs opacity-80">The hub stops while it installs; your tools reach it again once the program is back.</span>
          </div>
        </>
      )}
    </div>
  );
}
