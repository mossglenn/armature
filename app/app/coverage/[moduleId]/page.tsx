import {
  HubError,
  type CoverageItem,
  type CoverageVerdict as Verdict,
  type ItemStatistic,
  type ModuleContentReport,
  type PlacedActivity,
} from '@armature/client';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { focusPath } from '@/lib/graph/focus';
import { hubPublicUrl, viewerHub } from '@/lib/viewer';

/** A record's Focus page on the Design Graph, on the same branch (docs/graph-view-plan.md §3.2). */
const focusHref = (id: string, q: string) => `${focusPath({ id, cls: id.slice(0, id.indexOf('/')) })}${q}`;
const FOCUS_LINK = 'hover:underline';

/**
 * The Coverage View (plan §4 Phase 4; PROJECT_CONTEXT's demo payoff): a
 * read-only page over GET /api/v1/intelligence/coverage/:moduleId, read from
 * the hub over HTTP through @armature/client, so the page is a client of the
 * API like any plugin and never reads the store (lib/viewer.ts).
 * `?branch=` reads another branch; `?fullyAssessedAt=&overAssessedAbove=`
 * change the cut (architecture decision record ADR-0029, decision 3); the
 * commit the data came from is shown. Nothing here is stored: coverage is
 * computed at read time (ADR-0056).
 *
 * Beside each item, its statistics from GET /api/v1/intelligence/item-statistics
 * for the module, every administration newest first (ADR-0058 decision 3):
 * an approved, attested item that a cohort mostly got wrong is Narrative 1's
 * starting point, and the page shows it next to the coverage it counts toward.
 *
 * Below, the module's content in teaching order from
 * GET /api/v1/intelligence/module-content/:moduleId at the same commit
 * (ADR-0005): activities and lessons, each activity with the objectives it
 * targets and the items it asks formatively, which count toward no coverage
 * (ADR-0061).
 */
export const dynamic = 'force-dynamic';

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

type Statistics = Map<string, ItemStatistic[]>;

function Performance({ statistics, q }: { statistics?: ItemStatistic[]; q: string }) {
  if (!statistics?.length) return null;
  return (
    <ul className="w-full pl-4 text-xs text-zinc-600 dark:text-zinc-400">
      {statistics.map((s) => (
        <li key={s.metric.id}>
          {s.dataset?.cohort ?? s.dataset?.label ?? 'Imported'}
          {s.dataset?.administrationDate && <> ({s.dataset.administrationDate})</>}:{' '}
          <span className="font-mono tabular-nums text-zinc-900 dark:text-zinc-100">{s.metric.value}</span> {s.metric.unit}
          {' · '}
          <Link href={focusHref(s.metric.id, q)} className="text-blue-700 hover:underline dark:text-blue-300" title="This result traced back through the design (the Focus page)">
            trace this result
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Items({ items, statistics, q }: { items: CoverageItem[]; statistics: Statistics; q: string }) {
  if (items.length === 0) return <p className="text-sm text-zinc-500 dark:text-zinc-400">No items placed in this module assess it.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-baseline gap-x-2">
          <Link href={focusHref(item.id, q)} className={`font-medium ${FOCUS_LINK}`}>{item.label ?? item.id}</Link>
          {item.bloomsLevel && <span className="text-zinc-500 dark:text-zinc-400">{item.bloomsLevel}</span>}
          <span className="text-zinc-500 dark:text-zinc-400">item {item.status}</span>
          <span className="text-zinc-500 dark:text-zinc-400">
            placement {item.placements.map((p) => p.status).join(', ')}
          </span>
          <span className={item.eligibility === 'delivered' ? 'text-emerald-700 dark:text-emerald-300' : 'text-zinc-500 dark:text-zinc-400'}>
            {ELIGIBILITY_LABEL[item.eligibility]}
          </span>
          <Performance statistics={statistics.get(item.id)} q={q} />
        </li>
      ))}
    </ul>
  );
}

/** An objective's label where the coverage report names it, else its id. */
type Labels = Map<string, string>;

function Sequence({ value }: { value?: number }) {
  return <span className="w-6 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">{value ?? '·'}</span>;
}

function Activity({ placed, labels }: { placed: PlacedActivity; labels: Labels }) {
  const { activity, items } = placed;
  return (
    <li className="flex gap-3 py-2">
      <Sequence value={placed.sequence} />
      <div className="min-w-0 text-sm">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{activity.label ?? activity.id}</span>
          {activity.activityType && <span className="text-zinc-500 dark:text-zinc-400">{activity.activityType}</span>}
        </div>
        <p className="text-zinc-600 dark:text-zinc-400">
          Targets {activity.targets.map((t) => labels.get(t) ?? t).join('; ')}
        </p>
        {items.length > 0 && (
          <ul className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            {items.map((u) => (
              <li key={u.link}>
                Asks <span className="text-zinc-900 dark:text-zinc-100">{u.item.label ?? u.item.id}</span> formatively (item {u.item.status})
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function Content({ report, labels }: { report: ModuleContentReport; labels: Labels }) {
  if (report.content.length === 0) return <p className="text-sm text-zinc-500 dark:text-zinc-400">No activities are placed in this module.</p>;
  return (
    <>
      <ol className="divide-y divide-zinc-200 dark:divide-zinc-800">
        {report.content.map((entry) =>
          entry.kind === 'activity' ? (
            <Activity key={entry.link} placed={entry} labels={labels} />
          ) : (
            <li key={entry.link} className="flex gap-3 py-2">
              <Sequence value={entry.sequence} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {entry.lesson.label ?? entry.lesson.id}
                  <span className="ml-2 font-normal text-zinc-500 dark:text-zinc-400">lesson</span>
                </p>
                <ol className="mt-1 border-l border-zinc-200 pl-2 dark:border-zinc-800">
                  {entry.members.map((m) => (
                    <Activity key={m.link} placed={m} labels={labels} />
                  ))}
                </ol>
              </div>
            </li>
          )
        )}
      </ol>
      {report.repeated.length > 0 && (
        <p className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">
          Placed more than once: {report.repeated.map((r) => `${r.activity.label ?? r.activity.id} (${r.placements.length} times)`).join('; ')}.
        </p>
      )}
    </>
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
  // A threshold is passed through as given; the hub answers bad_query for one
  // it cannot read, and that refusal is shown rather than hidden.
  const threshold = (value?: string) => (value === undefined ? undefined : Number(value));
  const hub = viewerHub();
  const result = await hub
    .intelligence.coverage(moduleId, { branch, fullyAssessedAt: threshold(fullyAssessedAt), overAssessedAbove: threshold(overAssessedAbove) })
    .catch((err: unknown) => {
      if (err instanceof HubError && err.status === 404) notFound();
      throw err;
    });
  const { data, commit } = result;
  // At the commit the coverage was read at, so both describe one state.
  const sameState = commit ? { ref: commit } : { branch };
  const [stats, content] = await Promise.all([
    hub.intelligence.itemStatistics({ module: moduleId, ...sameState }),
    hub.intelligence.moduleContent(moduleId, sameState),
  ]);
  const statistics: Statistics = new Map(stats.data.items.map((x) => [x.item.id, x.statistics]));
  const labels: Labels = new Map(
    [...data.objectives, ...data.undeclared].flatMap(({ objective }) => (objective.label ? [[objective.id, objective.label] as const] : []))
  );
  const publicHub = hubPublicUrl();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 font-sans">
      <nav className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        <Link href={`/${branchQuery}`} className="hover:underline">Modules</Link>
        <span className="mx-2">/</span>
        <span>{data.module.label ?? data.module.id}</span>
      </nav>

      <header className="mb-8">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Coverage View</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          <Link href={focusHref(data.module.id, branchQuery)} className={FOCUS_LINK} title="This module on the Design Graph">{data.module.label ?? data.module.id}</Link>
        </h1>
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
                  <Link href={focusHref(d.objective.id, branchQuery)} className={FOCUS_LINK}>{d.objective.label ?? d.objective.id}</Link>
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
                <Items items={d.assessedBy} statistics={statistics} q={branchQuery} />
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
                  <Link href={focusHref(u.objective.id, branchQuery)} className={FOCUS_LINK}>{u.objective.label ?? u.objective.id}</Link>
                  {u.objective.bloomsLevel && (
                    <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">{u.objective.bloomsLevel}</span>
                  )}
                </h3>
                <div className="mt-3">
                  <Items items={u.assessedBy} statistics={statistics} q={branchQuery} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mb-10">
        <h2 className="mb-1 text-lg font-semibold">Module content</h2>
        <p className="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
          Activities and lessons in teaching order. Items asked inside an activity are formative and count toward no coverage.
        </p>
        <Content report={content.data} labels={labels} />
      </section>

      <footer className="border-t border-zinc-200 pt-4 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        Verdicts are computed by the hub at read time from the placements and items as they stand; nothing is stored (ADR-0056).
        Item statistics are imported measurements, one per administration, newest first (ADR-0058).
        {publicHub && (
          <>
            {' '}Raw data:{' '}
            <a className="font-mono hover:underline" href={`${publicHub}/api/v1/intelligence/coverage/${encodeURIComponent(moduleId)}${query}`}>
              /api/v1/intelligence/coverage/{moduleId}
            </a>
            {', '}
            <a className="font-mono hover:underline" href={`${publicHub}/api/v1/intelligence/module-content/${encodeURIComponent(moduleId)}${branchQuery}`}>
              /api/v1/intelligence/module-content/{moduleId}
            </a>
          </>
        )}
      </footer>
    </main>
  );
}
