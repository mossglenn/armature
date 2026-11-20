import { connectLink, hubPublicUrl, viewerHub } from '@/lib/viewer';

/**
 * "Work from your own computer" (docs/desktop-program-plan.md §8): the link that
 * opens Armature Desktop at this instance. The address comes from the hub's
 * own profile, so the link is right wherever the viewer runs; a hub under
 * `header` publishes none, and the viewer then offers the address a browser
 * could reach it at, when it has one. The page only reads, like every other.
 */
export const dynamic = 'force-dynamic';

export default async function Connect() {
  const { data } = await viewerHub().discover();
  const remote = data.instance?.api ?? hubPublicUrl();
  const releases = data.instance?.program.releases;

  return (
    <main className="mx-auto max-w-2xl px-4 py-10 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">Work from your own computer</h1>
      <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
        Armature Desktop, the desktop app, keeps a workspace of this instance on your computer. You work there, online or offline, and
        push your commits here when they are ready.
      </p>

      <dl className="mt-6 space-y-3 text-sm">
        {data.instance && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">This instance</dt>
            <dd className="font-medium">{data.instance.name}</dd>
          </div>
        )}
        {remote && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">Its address</dt>
            <dd className="font-mono break-all">{remote}</dd>
          </div>
        )}
      </dl>

      {remote ? (
        <p className="mt-6">
          <a
            href={connectLink(remote)}
            className="inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            Open in Armature Desktop
          </a>
        </p>
      ) : (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
          This instance gives no address for the app. Ask an administrator of it for its address.
        </p>
      )}

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        The link does nothing until the app is installed, and the app connects only after you confirm the instance details it
        shows you.
        {releases && (
          <>
            {' '}
            <a className="underline hover:text-zinc-900 dark:hover:text-zinc-100" href={releases}>
              Get the app
            </a>
            .
          </>
        )}
      </p>
    </main>
  );
}
