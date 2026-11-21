import Link from 'next/link';
import { viewerHub } from '@/lib/viewer';
import { historyEntries, type Person } from '@/lib/graph/history';

/**
 * A branch's history: its commits, newest first, each with who made it, for
 * whom, and what it said, from the branch's commits route (paged by the hub;
 * the first page here). vocabulary-allow: log, `GET /branches/:name/log`. The design process as the record holds it: who
 * designed, who reviewed, what an agent proposed and for whom. Each commit
 * opens the Design Graph as it stood then, or the changes made since it.
 * Names come from the registry on `main`; an instance that keeps the registry
 * from the viewer's credential (ADR-0068 decision 4, under `oidc`) leaves
 * the ids, and the page still renders.
 */
export const dynamic = 'force-dynamic';

const PAGE = 50;

async function people(): Promise<Person[]> {
  try {
    return (await viewerHub().documents.list('User', { branch: 'main' })).data as Person[];
  } catch {
    return [];
  }
}

const when = (seconds: number) => new Date(seconds * 1000).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const { branch } = await searchParams;
  const name = branch ?? 'main';
  const hub = viewerHub();
  const [log, registry] = await Promise.all([hub.branches.log(name, { count: PAGE }), people()]);
  const entries = historyEntries(log.data.commits, registry);
  const onBranch = branch ? `&branch=${encodeURIComponent(branch)}` : '';

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 font-sans">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">History</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Every commit on <span className="font-mono">{name}</span>, newest first: who made it, for whom, and why, in their own words.
        </p>
      </header>

      <ol className="divide-y divide-zinc-200 dark:divide-zinc-800" aria-label={`History of ${name}`}>
        {entries.map((e) => (
          <li key={e.commit} className={`py-4 ${e.author.setUp ? 'opacity-60' : ''}`}>
            <p className="text-base font-medium">{e.title}</p>
            {e.body && <p className="mt-1 whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">{e.body}</p>}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{e.author.setUp ? 'Set up outside the hub' : e.author.name}</span>
              {e.author.agent && <span className="rounded border border-violet-300 px-1 text-[11px] text-violet-700 dark:border-violet-700 dark:text-violet-300">agent</span>}
              {e.onBehalfOf && <span>for {e.onBehalfOf}</span>}
              {e.mergeSource && <span>· merged commit <span className="font-mono text-xs">{e.mergeSource.slice(0, 8)}</span></span>}
              <span className="text-zinc-400 dark:text-zinc-500">· {when(e.timestamp)}</span>
            </p>
            <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-zinc-500 dark:text-zinc-400">
              <span className="font-mono">{e.commit.slice(0, 12)}</span>
              <Link href={`/graph?ref=${encodeURIComponent(e.commit)}`} className="hover:underline">Design Graph at this commit</Link>
              <Link href={`/graph?lens=changes&since=${encodeURIComponent(e.commit)}${onBranch}`} className="hover:underline">Changes since</Link>
            </p>
          </li>
        ))}
      </ol>
      {log.data.count === entries.length && entries.length >= PAGE && (
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">The newest {PAGE} commits are shown.</p>
      )}
    </main>
  );
}
