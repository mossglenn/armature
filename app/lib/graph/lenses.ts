/**
 * The lenses (docs/graph-view-plan.md §8): a lens recolors the drawing by one
 * intelligence read, one at a time, so the figure asks one question. Each
 * lens maps the read's answer onto the drawn nodes as a mark (a tinted fill
 * or a ring, always with its word, so color never carries the meaning alone)
 * and reports a legend whose counts are the read's own numbers. Pure: the
 * reads are made by the server page (app/app/graph/lensReads.ts) and the
 * outcomes lens needs none, since the export holds the metrics.
 *
 * Colors: the verdict, state and change marks use the viewer's status tones
 * (the Coverage View's and the chips'), which the visual language reserves
 * for a status and never gives to a class; the outcomes lens uses the
 * dataviz palette's diverging pair, blue and red around a neutral midpoint,
 * two steps an arm.
 */
import type { AlignmentReport, ChangesResult, CourseCoverageReport, CoverageVerdict } from '@armature/client';
import type { DerivedGraph, Doc } from './derive';
import { localPart } from './derive';
import type { LensName } from './state';

export type LensReads =
  | { lens: 'coverage'; report: CourseCoverageReport }
  | { lens: 'alignment'; report: AlignmentReport }
  /** Attestation state by attestation id, from one attestations read per attested record. */
  | { lens: 'attestations'; states: Record<string, string>; subjects: number }
  | { lens: 'outcomes' }
  /** The changes on the branch since the commit; the deleted records as they were at it, drawn as ghosts. */
  | { lens: 'changes'; since: string; changes: ChangesResult; ghosts: Doc[] };

export type MarkStyle = 'fill' | 'ring' | 'ghost';

export interface LensMark {
  color: string;
  /** The word on the node's lens chip. */
  text: string;
  style: MarkStyle;
}

export interface LegendEntry {
  color: string;
  style: MarkStyle;
  label: string;
  count: number;
}

export interface LensView {
  lens: LensName;
  marks: Map<string, LensMark>;
  /** Junction edges the lens colors (a relationship added or changed), by edge id. */
  edgeMarks: Map<string, string>;
  /** Nodes outside the lens's attention; undefined dims nothing. */
  dim?: Set<string>;
  legend: LegendEntry[];
  /** Sentences under the legend: the scope, the parameters, what is not shown. */
  notes: string[];
  /** The outcomes lens: every unit among the metrics, and the one shown. */
  units?: string[];
  unit?: string;
}

export interface LensOptions {
  projected?: boolean;
  unit?: string;
  /** Every document the page holds, for the lenses that read records the drawing does not carry (metrics' datasets). */
  docs?: Doc[];
}

export const LENS_LABEL: Record<LensName, string> = {
  coverage: 'Coverage', alignment: 'Alignment', attestations: 'Attestations', outcomes: 'Outcomes', changes: 'Changes since',
};

export const LENS_TITLE: Record<LensName, string> = {
  coverage: 'How well each declared objective is assessed, by the coverage read',
  alignment: 'What is unaligned, by the alignment read',
  attestations: 'Whether each attestation still holds, by the attestations read',
  outcomes: "Each measured record tinted by its newest metric's value",
  changes: 'What the branch gained, changed and lost since a commit',
};

/** The viewer's status tones, as the Coverage View and the chips use them. */
export const TONE_COLORS = { ok: '#059669', warn: '#d97706', bad: '#dc2626', info: '#0284c7', neutral: '#71717a' } as const;

export const VERDICT_COLOR: Record<CoverageVerdict, string> = {
  Uncovered: TONE_COLORS.bad, PartiallyAssessed: TONE_COLORS.warn, FullyAssessed: TONE_COLORS.ok, OverAssessed: TONE_COLORS.info,
};
export const VERDICT_WORD: Record<CoverageVerdict, string> = {
  Uncovered: 'Uncovered', PartiallyAssessed: 'Partially assessed', FullyAssessed: 'Fully assessed', OverAssessed: 'Over-assessed',
};
const VERDICT_SEVERITY: Record<CoverageVerdict, number> = { FullyAssessed: 0, OverAssessed: 1, PartiallyAssessed: 2, Uncovered: 3 };
const VERDICTS: CoverageVerdict[] = ['Uncovered', 'PartiallyAssessed', 'FullyAssessed', 'OverAssessed'];

export const STATE_COLOR: Record<string, string> = {
  Current: TONE_COLORS.ok, Stale: TONE_COLORS.warn, FragmentRemoved: TONE_COLORS.bad, Unanchored: TONE_COLORS.neutral,
};
const STATE_SEVERITY: Record<string, number> = { Current: 0, Unanchored: 1, Stale: 2, FragmentRemoved: 3 };
const STATES = ['Current', 'Stale', 'FragmentRemoved', 'Unanchored'];

/** The diverging pair (dataviz palette): blue below the median, red above, gray at it; two steps an arm. */
export const DIVERGING = {
  farBelow: '#256abf', below: '#6da7ec', median: '#a1a1aa', above: '#f09a99', farAbove: '#e34948',
} as const;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const idOf = (x: unknown): string | undefined => (x && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : undefined);

function coverageLens(graph: DerivedGraph, report: CourseCoverageReport, projected: boolean): LensView {
  const marks = new Map<string, LensMark>();
  const counts: Record<CoverageVerdict, number> = { Uncovered: 0, PartiallyAssessed: 0, FullyAssessed: 0, OverAssessed: 0 };
  let declared = 0;
  for (const m of report.modules) {
    for (const d of m.objectives) {
      const verdict = (projected ? d.projected : d.coverage).status;
      counts[verdict] += 1;
      declared += 1;
      const id = d.objective.id;
      const current = marks.get(id);
      // An objective declared by two modules wears the weaker of its verdicts.
      if (!current || VERDICT_SEVERITY[verdict] > severityOf(current)) {
        marks.set(id, { color: VERDICT_COLOR[verdict], text: VERDICT_WORD[verdict], style: 'fill' });
      }
    }
  }
  let undeclared = 0;
  for (const n of graph.nodes) {
    if (n.cls === 'LearningObjective' && !marks.has(n.id)) {
      marks.set(n.id, { color: TONE_COLORS.neutral, text: 'Not declared', style: 'ring' });
      undeclared += 1;
    }
  }
  const legend: LegendEntry[] = VERDICTS.map((v) => ({ color: VERDICT_COLOR[v], style: 'fill', label: VERDICT_WORD[v], count: counts[v] }));
  legend.push({ color: TONE_COLORS.neutral, style: 'ring', label: 'Declared by no module', count: undeclared });
  const t = report.thresholds;
  return {
    lens: 'coverage', marks, edgeMarks: new Map(), legend,
    notes: [
      `${plural(declared, 'declaration')} across ${plural(report.modules.length, 'module')}, the ${projected ? 'projected figure (every item and placement not retired)' : 'delivered figure (approved items in approved placements)'}; fully assessed at ${t.fullyAssessedAt} distinct items, over-assessed above ${t.overAssessedAbove}.`,
      'An objective declared by two modules wears the weaker verdict.',
    ],
  };
}

const severityOf = (mark: LensMark): number => {
  const verdict = (Object.keys(VERDICT_WORD) as CoverageVerdict[]).find((v) => VERDICT_WORD[v] === mark.text);
  return verdict ? VERDICT_SEVERITY[verdict] : -1;
};

function alignmentLens(graph: DerivedGraph, report: AlignmentReport): LensView {
  const marks = new Map<string, LensMark>();
  const drawn = new Set(graph.nodes.map((n) => n.id));
  const add = (id: string | undefined, text: string, color: string) => {
    if (!id || !drawn.has(id)) return;
    const current = marks.get(id);
    if (current) marks.set(id, { ...current, text: `${current.text} · ${text}`, color: current.color === TONE_COLORS.bad ? current.color : color });
    else marks.set(id, { color, text, style: 'ring' });
  };
  for (const x of report.itemsWithoutObjective) add(idOf(x), 'No objective', TONE_COLORS.warn);
  for (const x of report.objectivesWithoutActivity) add(idOf(x), 'No activity', TONE_COLORS.warn);
  for (const x of report.objectivesWithoutItemAtLevel) add(idOf(x), 'No item at its level', TONE_COLORS.warn);
  for (const x of report.itemsBelowObjective) add(idOf(x.item), 'Below its objective', TONE_COLORS.bad);
  const dim = new Set(graph.nodes.map((n) => n.id).filter((id) => !marks.has(id)));
  const scope = report.scope as { objectives?: number; items?: number; activities?: number } | undefined;
  return {
    lens: 'alignment', marks, edgeMarks: new Map(), dim,
    legend: [
      { color: TONE_COLORS.warn, style: 'ring', label: 'Item assessing no objective', count: report.itemsWithoutObjective.length },
      { color: TONE_COLORS.warn, style: 'ring', label: 'Objective no activity targets', count: report.objectivesWithoutActivity.length },
      { color: TONE_COLORS.warn, style: 'ring', label: "Objective with no item at its Bloom's level", count: report.objectivesWithoutItemAtLevel.length },
      { color: TONE_COLORS.bad, style: 'ring', label: "Item below its objective's level", count: report.itemsBelowObjective.length },
    ],
    notes: [
      scope ? `Scope: ${plural(scope.objectives ?? 0, 'objective')}, ${plural(scope.items ?? 0, 'item')}, ${plural(scope.activities ?? 0, 'activity').replace('activitys', 'activities')}. Everything aligned is dimmed.` : 'Everything aligned is dimmed.',
      ...(report.unleveled.objectives.length + report.unleveled.items.length ? [`Without a Bloom's level, so not judged: ${plural(report.unleveled.objectives.length, 'objective')}, ${plural(report.unleveled.items.length, 'item')}.`] : []),
    ],
  };
}

function attestationsLens(graph: DerivedGraph, states: Record<string, string>, subjects: number): LensView {
  const marks = new Map<string, LensMark>();
  const counts = new Map<string, number>();
  let unread = 0;
  for (const [subject, about] of graph.about) {
    for (const a of about) {
      if (a['@type'] !== 'Attestation') continue;
      const state = states[a['@id']];
      if (!state) { unread += 1; continue; }
      counts.set(state, (counts.get(state) ?? 0) + 1);
      const current = marks.get(subject);
      if (!current || (STATE_SEVERITY[state] ?? 0) > (STATE_SEVERITY[current.text] ?? 0)) {
        marks.set(subject, { color: STATE_COLOR[state] ?? TONE_COLORS.neutral, text: state, style: 'ring' });
      }
    }
  }
  const legend: LegendEntry[] = STATES.map((s) => ({ color: STATE_COLOR[s], style: 'ring', label: s === 'FragmentRemoved' ? 'Fragment removed' : s, count: counts.get(s) ?? 0 }));
  if (unread) legend.push({ color: TONE_COLORS.neutral, style: 'ring', label: 'State unread', count: unread });
  return {
    lens: 'attestations', marks, edgeMarks: new Map(), legend,
    notes: [
      `${plural(subjects, 'attested record')}; a record with several attestations wears the weakest state. Unattested records are unchanged.`,
      'Current: the judged part is as it was at the commit attested. Stale: it differs. Fragment removed: the record no longer has the part.',
    ],
  };
}

function outcomesLens(graph: DerivedGraph, docs: Doc[], chosen: string | undefined): LensView {
  const drawn = new Set(graph.nodes.map((n) => n.id));
  const byId = new Map(docs.map((d) => [d['@id'], d]));
  const metrics = docs.filter((d) => d['@type'] === 'LearningMetric' && typeof d.value === 'number' && typeof d.subject === 'string' && drawn.has(d.subject));
  const unitCounts = new Map<string, number>();
  for (const m of metrics) {
    const unit = typeof m.unit === 'string' ? m.unit : '(no unit)';
    unitCounts.set(unit, (unitCounts.get(unit) ?? 0) + 1);
  }
  const units = [...unitCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([u]) => u);
  const unit = chosen && unitCounts.has(chosen) ? chosen : units[0];
  // The newest administration per subject: the dataset's date, else the metric's collection time.
  const when = (m: Doc): string => {
    const dataset = typeof m.derivedFrom === 'string' ? byId.get(m.derivedFrom) : undefined;
    const date = dataset && typeof dataset.administrationDate === 'string' ? dataset.administrationDate : undefined;
    return date ?? (typeof m.collectedAt === 'string' ? m.collectedAt : '');
  };
  const newest = new Map<string, Doc>();
  for (const m of metrics) {
    if ((typeof m.unit === 'string' ? m.unit : '(no unit)') !== unit) continue;
    const subject = m.subject as string;
    const current = newest.get(subject);
    if (!current || when(m) > when(current)) newest.set(subject, m);
  }
  const values = [...newest.values()].map((m) => m.value as number).sort((a, b) => a - b);
  const median = values.length ? (values.length % 2 ? values[(values.length - 1) / 2] : (values[values.length / 2 - 1] + values[values.length / 2]) / 2) : 0;
  const spread = Math.max(...values.map((v) => Math.abs(v - median)), 0);
  const bins = [
    { key: 'farBelow', label: 'Well below the median', test: (t: number) => t <= -0.5 },
    { key: 'below', label: 'Below the median', test: (t: number) => t < -0.1 },
    { key: 'median', label: `At the median (${median})`, test: (t: number) => t <= 0.1 },
    { key: 'above', label: 'Above the median', test: (t: number) => t < 0.5 },
    { key: 'farAbove', label: 'Well above the median', test: () => true },
  ] as const;
  const counts = new Map<string, number>();
  const marks = new Map<string, LensMark>();
  for (const [subject, m] of newest) {
    const value = m.value as number;
    const t = spread ? (value - median) / spread : 0;
    const bin = bins.find((b) => b.test(t))!;
    counts.set(bin.key, (counts.get(bin.key) ?? 0) + 1);
    marks.set(subject, { color: DIVERGING[bin.key], text: `${value}${unit && unit !== '(no unit)' ? ` ${unit}` : ''}`, style: 'fill' });
  }
  const kept = new Set<string>([...newest.keys()]);
  for (const n of graph.nodes) if (n.cls === 'LearningMetric' || n.cls === 'LearningDataset') kept.add(n.id);
  const dim = new Set(graph.nodes.map((n) => n.id).filter((id) => !kept.has(id)));
  return {
    lens: 'outcomes', marks, edgeMarks: new Map(), dim,
    legend: bins.map((b) => ({ color: DIVERGING[b.key], style: 'fill', label: b.label, count: counts.get(b.key) ?? 0 })),
    notes: [
      metrics.length
        ? `${plural(newest.size, 'measured record')} in ${unit}, each tinted by its newest administration's value around the median of those values; ${plural(metrics.length, 'metric')} about drawn records in all. Datasets and metrics stay bright; the rest is dimmed.`
        : 'No metric names a drawn record as its subject.',
    ],
    units, unit,
  };
}

function changesLens(graph: DerivedGraph, reads: Extract<LensReads, { lens: 'changes' }>, branch: string): LensView {
  const changes = reads.changes.changes.filter((c) => !c.id.startsWith('User/'));
  const added = new Set(changes.filter((c) => c.op === 'insert').map((c) => c.id));
  const changed = new Set(changes.filter((c) => c.op === 'update').map((c) => c.id));
  const deleted = new Set(changes.filter((c) => c.op === 'delete').map((c) => c.id));
  const marks = new Map<string, LensMark>();
  const edgeMarks = new Map<string, string>();
  for (const n of graph.nodes) {
    if (deleted.has(n.id)) marks.set(n.id, { color: TONE_COLORS.neutral, text: 'Deleted since', style: 'ghost' });
    else if (added.has(n.id)) marks.set(n.id, { color: TONE_COLORS.ok, text: 'Added since', style: 'ring' });
    else if (changed.has(n.id)) marks.set(n.id, { color: TONE_COLORS.warn, text: 'Changed since', style: 'ring' });
  }
  for (const e of graph.edges) {
    if (added.has(e.id)) edgeMarks.set(e.id, TONE_COLORS.ok);
    else if (changed.has(e.id)) edgeMarks.set(e.id, TONE_COLORS.warn);
  }
  const dim = new Set(graph.nodes.map((n) => n.id).filter((id) => !marks.has(id)));
  const ghostsUndrawn = reads.changes.changes.filter((c) => c.op === 'delete' && !c.id.startsWith('User/') && !graph.nodes.some((n) => n.id === c.id) && !reads.ghosts.some((g) => g['@id'] === c.id)).length;
  return {
    lens: 'changes', marks, edgeMarks, dim,
    legend: [
      { color: TONE_COLORS.ok, style: 'ring', label: 'Added since', count: added.size },
      { color: TONE_COLORS.warn, style: 'ring', label: 'Changed since', count: changed.size },
      { color: TONE_COLORS.neutral, style: 'ghost', label: 'Deleted since (drawn as it was)', count: deleted.size },
    ],
    notes: [
      `On ${branch} since commit ${reads.since.slice(0, 10)}: records and relationships, people left out; a relationship added or changed colors its edge. Everything unchanged is dimmed.`,
      ...(ghostsUndrawn ? [`${plural(ghostsUndrawn, 'deleted record')} could not be read at that commit and ${ghostsUndrawn === 1 ? 'is' : 'are'} not drawn.`] : []),
    ],
  };
}

/** The lens's view of the drawing: marks on nodes, colored edges, what to dim, the legend with the read's numbers. */
export function applyLens(graph: DerivedGraph, reads: LensReads, options: LensOptions & { branch?: string } = {}): LensView {
  switch (reads.lens) {
    case 'coverage': return coverageLens(graph, reads.report, options.projected ?? false);
    case 'alignment': return alignmentLens(graph, reads.report);
    case 'attestations': return attestationsLens(graph, reads.states, reads.subjects);
    case 'outcomes': return outcomesLens(graph, options.docs ?? graph.nodes.map((n) => n.doc), options.unit);
    case 'changes': return changesLens(graph, reads, options.branch ?? 'main');
  }
}

/** The commits the graph's own records name (`asOf` on datasets, metrics, findings, attestations): the natural "since" choices. */
export function namedCommits(docs: Doc[]): Array<{ commit: string; label: string }> {
  const seen = new Map<string, string[]>();
  for (const d of docs) {
    if (typeof d.asOf !== 'string') continue;
    const name = typeof d.label === 'string' ? d.label : `${d['@type']} ${localPart(d['@id']).slice(0, 8)}`;
    (seen.get(d.asOf) ?? seen.set(d.asOf, []).get(d.asOf)!).push(name);
  }
  return [...seen].map(([commit, names]) => ({ commit, label: names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(', ') }));
}
