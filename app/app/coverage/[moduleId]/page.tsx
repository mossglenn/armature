import Link from 'next/link';
import { notFound } from 'next/navigation';
import { app } from '@/lib/api/app';

/**
 * The Coverage View (plan §4 Phase 4; PROJECT_CONTEXT's demo payoff): a
 * read-only page over GET /api/v1/intelligence/coverage/:moduleId. It calls
 * the Hono app in-process, the same object the catch-all route serves, so
 * the page is a client of the API like any plugin and never reads the store.
 * `?branch=` reads another branch; `?fullyAssessedAt=&overAssessedAbove=`
 * change the cut (ADR-0029 decision 3); the commit the data came from is
 * shown. Nothing here is stored: coverage is computed at read time
 * (ADR-0056).
 */
export const dynamic = 'force-dynamic';

type Verdict = 'Uncovered' | 'PartiallyAssessed' | 'FullyAssessed' | 'OverAssessed';

interface Summary { id: string; type: string; label?: string; bloomsLevel?: string; status?: string }
interface Placement { id: string; assessment: string; status: string }
interface AssessedBy extends Summary { eligibility: 'delivered' | 'projected' | 'none'; placements: Placement[] }
interface Figure { status: Verdict; items: number }
interface Declaration {
  id: string;
  role: string;
  sequence?: number;
  roleRationale?: string;
  objective: Summary;
  coverage: Figure;
  projected: Figure;
  assessedBy: AssessedBy[];
}
interface Coverage {
  module: Summary;
  thresholds: { fullyAssessedAt: number; overAssessedAbove: number };
  summary: { declared: number; coverage: Record<Verdict, number>; projected: Record<Verdict, number>; undeclared: number };
  objectives: Declaration[];
  undeclared: Array<{ objective: Summary; assessedBy: AssessedBy[] }>;
}

const VERDICTS: Verdict[] = ['Uncovered', 'PartiallyAssessed', 'FullyAssessed', 'OverAssessed'];
const VERDICT_LABEL: Record<Verdict, string> = {
  Uncovered: 'Uncovered',
  PartiallyAssessed: 'Partially assessed',
  FullyAssessed: 'Fully assessed',
  OverAssessed: 'Over-assessed',
};
const VERDICT_CLASS: Record<Verdict, string> = {
  Uncovered: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  PartiallyAssessed: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  FullyAssessed: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  OverAssessed: 'bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-200',
};
const ELIGIBILITY_LABEL = {
  delivered: 'counts now',
  projected: 'counts once approved',
  none: 'retired',
} as const;

function Badge({ verdict }: { verdict: Verdict }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${VERDICT_CLASS[verdict]}`}>
      {VERDICT_LABEL[verdict]}
    </span>
  );
}

function Counts({ title, counts }: { title: string; counts: Record<Verdict, number> }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="mb-2 text-sm font-medium text-zinc-500 dark:text-zinc-400">{title}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {VERDICTS.map((v) => (
          <div key={v} className="flex items-baseline justify-between gap-2">
            <dt className="text-zinc-600 dark:text-zinc-400">{VERDICT_LABEL[v]}</dt>
            <dd className="font-mono tabular-nums">{counts[v]}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Items({ items }: { items: AssessedBy[] }) {
  if (items.length === 0) return <p className="text-sm text-zinc-500 dark:text-zinc-400">No items placed in this module assess it.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{item.label ?? item.id}</span>
          {item.bloomsLevel && <span className="text-zinc-500 dark:text-zinc-400">{item.bloomsLevel}</span>}
          <span className="text-zinc-500 dark:text-zinc-400">item {item.status}</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            placement {item.placements.map((p) => p.status).join(', ')}
          </span>
          <span className={item.eligibility === 'delivered' ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-500 dark:text-zinc-400'}>
            {ELIGIBILITY_LABEL[item.eligibility]}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default async function CoveragePage({
  params,
  searchParams,
}: {
  params: Promise<{ moduleId: string }>;
  searchParams: Promise<{ branch?: string; fullyAssessedAt?: string; overAssessedAbove?: string }>;
}) {
  const { moduleId } = await params;
  const { branch, fullyAssessedAt, overAssessedAbove } = await searchParams;
  const params_ = new URLSearchParams();
  if (branch) params_.set('branch', branch);
  if (fullyAssessedAt) params_.set('fullyAssessedAt', fullyAssessedAt);
  if (overAssessedAbove) params_.set('overAssessedAbove', overAssessedAbove);
  const query = params_.size ? `?${params_.toString()}` : '';
  const branchQuery = branch ? `?branch=${encodeURIComponent(branch)}` : '';
  const res = await app.request(`/api/v1/intelligence/coverage/${encodeURIComponent(moduleId)}${query}`);
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`The coverage read failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as Coverage;
  const commit = res.headers.get('etag')?.replace(/"/g, '');

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 font-sans">
      <nav className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/${branchQuery}`} className="hover:underline">Modules</Link>
        <span className="mx-2">/</span>
        <span>{data.module.label ?? data.module.id}</span>
      </nav>

      <header className="mb-8">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Coverage View</p>
        <h1 className="text-2xl font-semibold tracking-tight">{data.module.label ?? data.module.id}</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {data.summary.declared} declared objective{data.summary.declared === 1 ? '' : 's'} on branch{' '}
          <span className="font-mono">{branch ?? 'main'}</span>
          {commit && <> at commit <span className="font-mono">{commit.slice(0, 12)}</span></>}.
          Fully assessed at {data.thresholds.fullyAssessedAt} item{data.thresholds.fullyAssessedAt === 1 ? '' : 's'}, over-assessed above {data.thresholds.overAssessedAbove}.
        </p>
      </header>

      <section className="mb-10 grid gap-4 sm:grid-cols-2">
        <Counts title="Coverage (approved items, approved placements)" counts={data.summary.coverage} />
        <Counts title="Projected (everything not retired)" counts={data.summary.projected} />
      </section>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold">Declared objectives</h2>
        <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {data.objectives.map((d) => (
            <li key={d.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-base font-medium">
                  {d.objective.label ?? d.objective.id}
                  {d.objective.bloomsLevel && (
                    <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">{d.objective.bloomsLevel}</span>
                  )}
                </h3>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">{d.role}</span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-zinc-500 dark:text-zinc-400">coverage</span>
                <Badge verdict={d.coverage.status} />
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{d.coverage.items}</span>
                <span className="text-zinc-500 dark:text-zinc-400">projected</span>
                <Badge verdict={d.projected.status} />
                <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{d.projected.items}</span>
              </div>
              {d.roleRationale && <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{d.roleRationale}</p>}
              <div className="mt-3">
                <Items items={d.assessedBy} />
              </div>
            </li>
          ))}
        </ol>
      </section>

      {data.undeclared.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-1 text-lg font-semibold">Assessed but not declared</h2>
          <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
            Items placed in this module&apos;s assessments test these objectives, but the module does not declare them. Declare the objective or move the item.
          </p>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {data.undeclared.map((u) => (
              <li key={u.objective.id} className="py-4">
                <h3 className="text-base font-medium">
                  {u.objective.label ?? u.objective.id}
                  {u.objective.bloomsLevel && (
                    <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">{u.objective.bloomsLevel}</span>
                  )}
                </h3>
                <div className="mt-3">
                  <Items items={u.assessedBy} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Verdicts are computed by the API at read time from the placements and items as they stand; nothing is stored (ADR-0056). Raw data:{' '}
        <a className="font-mono hover:underline" href={`/api/v1/intelligence/coverage/${encodeURIComponent(moduleId)}${query}`}>
          /api/v1/intelligence/coverage/{moduleId}
        </a>
      </footer>
    </main>
  );
}
