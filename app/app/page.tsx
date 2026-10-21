import Link from 'next/link';
import { hubPublicUrl, viewerHub } from '@/lib/viewer';

/**
 * The viewer's index: the modules on a branch, each linking to its Coverage
 * View. Read from the hub over HTTP through @armature/client, like every
 * page in this app and like any plugin (see lib/viewer.ts).
 */
export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { branch } = await searchParams;
  const query = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  const { data, commit } = await viewerHub().documents.list('Module', { branch });
  const publicHub = hubPublicUrl();
  const modules = data
    .slice()
    .sort((a, b) => (a.sequence ?? Infinity) - (b.sequence ?? Infinity) || a['@id'].localeCompare(b['@id']));

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 font-sans">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Armature</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Design intelligence from the artifact graph. Branch <span className="font-mono">{branch ?? 'main'}</span>
          {commit && <> at commit <span className="font-mono">{commit.slice(0, 12)}</span></>}.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-lg font-semibold">Modules</h2>
        {modules.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">No modules on this branch.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {modules.map((m) => {
              const id = m['@id'].replace(/^Module\//, '');
              return (
                <li key={m['@id']} className="py-3">
                  <Link href={`/coverage/${encodeURIComponent(id)}${query}`} className="text-base font-medium hover:underline">
                    {m.label ?? m['@id']}
                  </Link>
                  {m.description && <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{m.description}</p>}
                  <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Coverage View</p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <footer className="mt-10 border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        This page is a client of the hub&apos;s API{publicHub && (
          <>: raw data at <a className="font-mono hover:underline" href={`${publicHub}/api/v1/documents/Module${query}`}>{publicHub}/api/v1</a></>
        )}.
      </footer>
    </main>
  );
}
