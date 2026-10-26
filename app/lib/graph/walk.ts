/**
 * The Walkthrough (docs/graph-view-plan.md §3.3, §7.2): Narrative 1 as steps
 * over a trace, generic over its root. `buildWalk` orders the trace's records
 * along the lifecycle, one stage per step, from the root back to the
 * evidence: for a metric, the result, the administration, the assessment,
 * the item, the objective, the module's declaration, "adequate when?" (the
 * coverage read at the commit the cohort met), then and now (what changed
 * since), and the continuation to the need and the evidence. A root further
 * along the lifecycle starts further along. Each step's text is templated
 * from the classes crossed and the documents' fields, never from the seed.
 * `completeWalk` fills the two steps that need the hub's reads. Pure; the
 * Focus page runs it on the server.
 */
import type { CoverageReport, CoverageVerdict } from '@armature/client';
import type { DerivedGraph, Doc } from './derive';
import { localPart } from './derive';
import type { TraceLike } from './focus';

export type StepKind = 'root' | 'dataset' | 'assessment' | 'item' | 'objective' | 'module' | 'coverage' | 'changes' | 'need' | 'evidence';

export interface WalkStep {
  kind: StepKind;
  title: string;
  /** The records this step lights (the camera frames them). */
  nodes: string[];
  /** The drawn edges between this step's records and the walk so far. */
  edges: string[];
  /** Paragraphs; a coverage or changes step's are filled by `completeWalk`. */
  text: string[];
  /** The first step of the continuation ("why does this objective exist?"). */
  continuation?: boolean;
  /** The changes step: records added or changed since the commit, to outline. */
  added?: string[];
  changed?: string[];
  /** Records changed since the commit that the drawing does not hold (deleted). */
  gone?: string[];
  /** The assessment step: its placements (ItemInstance ids), so `completeWalk` can tell those made after the commit. */
  placements?: string[];
}

export interface Walk {
  root: string;
  steps: WalkStep[];
  /** The module and objective the coverage step asks about, when the walk reaches them. */
  module?: string;
  objective?: string;
  /** The commit the root (or its dataset) refers to, when it names one. */
  asOf?: string;
}

/** The trace with the edge data the walk reads (docs/api.md): `through`, `role`, `status` and `confidence` when present. */
export interface WalkTrace extends TraceLike {
  edges: Array<{ from: string; to: string; via: string; [key: string]: unknown }>;
}

const STAGE_ORDER: Array<{ cls: string; kind: StepKind }> = [
  { cls: 'LearningMetric', kind: 'root' },
  { cls: 'LearningDataset', kind: 'dataset' },
  { cls: 'Assessment', kind: 'assessment' },
  { cls: 'AssessmentItem', kind: 'item' },
  { cls: 'LearningObjective', kind: 'objective' },
  { cls: 'Module', kind: 'module' },
  { cls: 'LearningNeed', kind: 'need' },
  { cls: 'DescriptiveEvidence', kind: 'evidence' },
];

const VERDICT: Record<CoverageVerdict, string> = {
  Uncovered: 'uncovered', PartiallyAssessed: 'partially assessed', FullyAssessed: 'fully assessed', OverAssessed: 'over-assessed',
};

const TITLES: Record<StepKind, string> = {
  root: 'The record', dataset: 'The administration', assessment: 'The assessment', item: 'The item', objective: 'The objective',
  module: 'The declaration', coverage: 'Adequate when?', changes: 'Then and now', need: 'Why this objective?', evidence: 'The evidence',
};

const ROOT_TITLES: Partial<Record<string, string>> = {
  LearningMetric: 'The result', LearningDataset: 'The administration', Assessment: 'The assessment', AssessmentItem: 'The item',
  LearningObjective: 'The objective', Module: 'The module', LearningNeed: 'The need', DescriptiveEvidence: 'The evidence', LearningActivity: 'The activity',
};

const short = (commit: string) => commit.slice(0, 10);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

function labelOf(byId: ReadonlyMap<string, Doc>, id: string): string {
  return str(byId.get(id)?.label) ?? localPart(id);
}

const throughId = (through: unknown): string | undefined =>
  typeof through === 'string' ? through : through && typeof through === 'object' ? str((through as { id?: unknown }).id) : undefined;

/** The drawn edge between two records, by the junction passed through or by its ends. */
function drawnEdge(graph: DerivedGraph, e: WalkTrace['edges'][number]): string | undefined {
  const through = throughId(e.through);
  if (through && graph.edges.some((d) => d.id === through)) return through;
  const found = graph.edges.find((d) => (d.source === e.from && d.target === e.to) || (d.source === e.to && d.target === e.from));
  return found?.id;
}

export function buildWalk(graph: DerivedGraph, trace: WalkTrace, byId: ReadonlyMap<string, Doc>): Walk {
  const types = new Map(trace.nodes.map((n) => [n.id, (byId.get(n.id)?.['@type'] as string | undefined) ?? n.id.slice(0, n.id.indexOf('/'))]));
  const adjacent = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    (adjacent.get(a) ?? adjacent.set(a, new Set()).get(a)!).add(b);
    (adjacent.get(b) ?? adjacent.set(b, new Set()).get(b)!).add(a);
  };
  for (const e of trace.edges) link(e.from, e.to);

  const root = trace.root.id;
  const rootType = types.get(root) ?? '';
  const start = STAGE_ORDER.findIndex((s) => s.cls === rootType);
  const steps: WalkStep[] = [];
  const walked = new Set<string>([root]);
  const edgesBetween = (nodes: string[]): string[] => {
    const ids: string[] = [];
    for (const e of trace.edges) {
      const inStep = nodes.includes(e.from) ? e.to : nodes.includes(e.to) ? e.from : undefined;
      if (inStep === undefined || !walked.has(inStep) || nodes.includes(inStep)) continue;
      const id = drawnEdge(graph, e);
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };
  const edgesOf = (a: string, b: string) => trace.edges.filter((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

  // The root itself.
  const rootDoc: Doc = byId.get(root) ?? { '@id': root, '@type': rootType };
  steps.push({ kind: 'root', title: ROOT_TITLES[rootType] ?? TITLES.root, nodes: [root], edges: [], text: rootText(rootType, rootDoc, byId) });

  let previous = [root];
  let subject: string | undefined;
  if (rootType === 'LearningMetric') subject = str(rootDoc.subject);
  // The root stands for its own stage: an objective root is the objective the
  // coverage step asks about and the one the needs are adjacent to.
  const chosen: Partial<Record<StepKind, string[]>> = {};
  if (start >= 0) chosen[STAGE_ORDER[start].kind] = [root];

  for (let i = (start >= 0 ? start : -1) + 1; i < STAGE_ORDER.length; i++) {
    const { cls, kind } = STAGE_ORDER[i];
    let nodes = [...new Set(previous.flatMap((p) => [...(adjacent.get(p) ?? [])]))].filter((id) => types.get(id) === cls && !walked.has(id));
    if (kind === 'item' && subject && nodes.includes(subject)) nodes = [subject];
    if (kind === 'module' && chosen.assessment) {
      const viaAssessment = nodes.filter((m) => chosen.assessment!.some((a) => adjacent.get(a)?.has(m)));
      if (viaAssessment.length) nodes = viaAssessment;
    }
    if (nodes.length === 0) continue;
    const edges = edgesBetween(nodes);
    const text = stepText(kind, nodes, previous, trace, byId, edgesOf);
    const step: WalkStep = { kind, title: TITLES[kind], nodes, edges, text };
    if (kind === 'need') step.continuation = true;
    if (kind === 'assessment') {
      step.placements = trace.edges.filter((e) => nodes.includes(e.from) && e.via === 'implements').map((e) => str(e.through)).filter((id): id is string => !!id);
    }
    steps.push(step);
    chosen[kind] = nodes;
    for (const n of nodes) walked.add(n);
    previous = nodes;

    // After the module: the two steps that ask the hub.
    if (kind === 'module') {
      const asOf = str(rootDoc.asOf) ?? chosen.dataset?.map((d) => str(byId.get(d)?.asOf)).find(Boolean);
      if (chosen.objective) {
        steps.push({ kind: 'coverage', title: TITLES.coverage, nodes: [...nodes, ...chosen.objective], edges: [], text: [] });
      }
      if (asOf) steps.push({ kind: 'changes', title: TITLES.changes, nodes: [], edges: [], text: [] });
      previous = chosen.objective ?? nodes;
    }
  }

  const asOf = str(rootDoc.asOf) ?? chosen.dataset?.map((d) => str(byId.get(d)?.asOf)).find(Boolean);
  return { root, steps, module: chosen.module?.[0], objective: chosen.objective?.[0], asOf };
}

function rootText(cls: string, doc: Doc, byId: ReadonlyMap<string, Doc>): string[] {
  const label = str(doc.label) ?? localPart(String(doc['@id'] ?? ''));
  if (cls === 'LearningMetric') {
    const subject = str(doc.subject);
    const dataset = str(doc.derivedFrom) ? byId.get(str(doc.derivedFrom)!) : undefined;
    const where = [str(dataset?.cohort), str(dataset?.administrationDate)].filter(Boolean).join(', ');
    return [
      `${num(doc.value) ?? '?'} ${str(doc.unit) ?? ''}${subject ? ` on ${labelOf(byId, subject)}` : ''}${where ? `, ${where}` : ''}.`,
      'A metric names what it measures (subject) and where it came from (derivedFrom); it is never a field on the item (ADR-0058).',
    ];
  }
  const sentence = `${cls.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()}: ${label}.`;
  const detail = str(doc.description) ?? str(doc.rationale);
  return detail ? [sentence[0].toUpperCase() + sentence.slice(1), detail] : [sentence[0].toUpperCase() + sentence.slice(1)];
}

function stepText(
  kind: StepKind, nodes: string[], previous: string[], trace: WalkTrace, byId: ReadonlyMap<string, Doc>,
  edgesOf: (a: string, b: string) => WalkTrace['edges'],
): string[] {
  const docs = nodes.map((id) => byId.get(id) ?? ({ '@id': id, '@type': id.slice(0, id.indexOf('/')) } as Doc));
  const names = nodes.map((id) => labelOf(byId, id)).join(' and ');
  switch (kind) {
    case 'dataset': {
      const d = docs[0];
      const asOf = str(d.asOf);
      // The cohort, unless the label already names it.
      const cohort = str(d.cohort) && !names.toLowerCase().includes(d.cohort!.toString().toLowerCase()) ? `, ${d.cohort}` : '';
      return [
        `${names}${cohort}${str(d.administrationDate) ? `, ${d.administrationDate}` : ''}: ${str(d.description) ?? 'the results of one administration.'}`,
        asOf
          ? `The dataset records which assessment produced it and the commit the cohort met: as of ${short(asOf)}. Everything after this step can be read at that commit.`
          : 'The dataset records which assessment produced it.',
      ];
    }
    case 'assessment': {
      const placements = trace.edges.filter((e) => nodes.includes(e.from) && e.via === 'implements');
      const approved = placements.filter((e) => str(e.status) === 'Approved').length;
      return [
        `${plural(placements.length, 'item')} ${placements.length === 1 ? 'was' : 'were'} placed in ${names}; ${approved} placement${approved === 1 ? '' : 's'} ${approved === 1 ? 'was' : 'were'} approved.`,
        'A placement is a document of its own (ItemInstance): the item is reusable, its use here carries points and clearance (ADR-0018).',
      ];
    }
    case 'item': {
      const d = docs[0];
      const facts = [str(d.status), str(d.bloomsLevel)].filter(Boolean).join(', ');
      const annotations = trace.annotations.filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
        .filter((a) => (Array.isArray(a.subject) ? a.subject : [a.subject]).includes(nodes[0]));
      const attestations = annotations.filter((a) => a.type === 'Attestation');
      const others = annotations.length - attestations.length;
      const lines = [`${names}${facts ? `, ${facts}` : ''}.`];
      for (const a of attestations) {
        const part = str(a.fragmentId) ? `part ${a.fragmentId}` : 'the whole item';
        const by = str(a.attestedBy) ? ` by ${localPart(a.attestedBy as string)}` : '';
        lines.push(`Attested ${str(a.verdict) ?? ''} on ${part}${by}${str(a.claimText) ? `: "${a.claimText}"` : ''}. The verdict is ${str(a.state) ?? 'unread'} against the part as it stands now (ADR-0028).`);
      }
      if (attestations.length === 0) lines.push('No one has attested it.');
      if (others > 0) lines.push(`${plural(others, 'note or finding')} ${others === 1 ? 'is' : 'are'} about it.`);
      return lines;
    }
    case 'objective': {
      const d = docs[0];
      return [
        `${previous.map((p) => labelOf(byId, p)).join(' and ')} assess${previous.length === 1 ? 'es' : ''} ${names}${str(d.bloomsLevel) ? ` (${d.bloomsLevel})` : ''}.`,
        str(d.description) ?? 'An objective is the central record: items assess it, activities target it, modules declare it.',
      ];
    }
    case 'module': {
      const lines: string[] = [];
      for (const m of nodes) {
        for (const o of previous) {
          for (const e of edgesOf(o, m)) {
            const through = throughId(e.through);
            const decl = through ? byId.get(through) : undefined;
            const role = str(decl?.role) ?? str(e.role);
            const seq = num(decl?.sequence);
            lines.push(`${labelOf(byId, m)} declares ${labelOf(byId, o)}${role ? ` as ${role}` : ''}${seq !== undefined ? ` (#${seq})` : ''}${str(decl?.roleRationale) ? `: ${decl!.roleRationale}` : '.'}`);
          }
        }
      }
      if (lines.length === 0) lines.push(`${names}.`);
      lines.push('A declaration is a document (ModuleObjective, ADR-0007); its role and rationale are design decisions kept as data.');
      return lines;
    }
    case 'need': {
      const d = docs[0];
      return [`${names}${str(d.priority) ? `, ${d.priority} priority` : ''}${str(d.rationale) ? `: ${d.rationale}` : '.'}`, 'An objective names the need that generated it (generatedBy); the need is where the design began.'];
    }
    case 'evidence': {
      const lines: string[] = [];
      for (const ev of nodes) {
        const d = byId.get(ev);
        const conf = previous.flatMap((p) => edgesOf(p, ev)).map((e) => str(e.confidence)).find(Boolean);
        lines.push(`${labelOf(byId, ev)}${str(d?.method) ? ` (${d!.method}${conf ? `, ${conf.toLowerCase()} confidence` : ''})` : conf ? ` (${conf.toLowerCase()} confidence)` : ''}${str(d?.description) ? `: ${d!.description}` : '.'}`);
      }
      lines.push('The loop closes: a measurement led back to the evidence that justified the design.');
      return lines;
    }
    default:
      return [names];
  }
}

export interface WalkReads {
  coverageThen?: CoverageReport;
  coverageNow?: CoverageReport;
  changes?: { from: string; to: string; changes: Array<{ id: string; op: 'insert' | 'delete' | 'update' }> };
  branch?: string;
}

/**
 * Fills the coverage and changes steps from the hub's reads, and restates the
 * assessment step when the changes read shows placements made after the
 * commit, since the trace describes the assessment as it stands, not as the
 * cohort met it; the walk is unchanged otherwise.
 */
export function completeWalk(walk: Walk, reads: WalkReads, byId: ReadonlyMap<string, Doc>): Walk {
  const steps = walk.steps.map((step) => {
    if (step.kind === 'assessment' && reads.changes && walk.asOf) {
      const inserted = new Set(reads.changes.changes.filter((x) => x.op === 'insert').map((x) => x.id));
      const placements = step.placements ?? [];
      const later = placements.filter((id) => inserted.has(id)).length;
      if (later === 0) return step;
      const approved = placements.filter((id) => str(byId.get(id)?.status) === 'Approved').length;
      const names = step.nodes.map((id) => labelOf(byId, id)).join(' and ');
      return {
        ...step,
        text: [
          `${plural(placements.length, 'item')} ${placements.length === 1 ? 'is' : 'are'} placed in ${names} today, ${approved} of them approved. ${later} ${later === 1 ? 'was' : 'were'} placed after the cohort's commit (${short(walk.asOf)}), so the cohort met ${placements.length - later}.`,
          ...step.text.slice(1),
        ],
      };
    }
    if (step.kind === 'coverage') {
      const objective = walk.objective;
      const find = (r?: CoverageReport) => r?.objectives.find((d) => d.objective.id === objective);
      const then = find(reads.coverageThen), now = find(reads.coverageNow);
      const name = objective ? labelOf(byId, objective) : 'the objective';
      const text: string[] = [];
      if (then && walk.asOf) {
        text.push(`When the cohort met the design (commit ${short(walk.asOf)}), ${name} was ${VERDICT[then.coverage.status]} in ${labelOf(byId, walk.module ?? '')}: ${plural(then.coverage.items, 'eligible item')}${then.projected.items !== then.coverage.items ? `, ${then.projected.items} counting what was still in review` : ''}.`);
      } else if (walk.asOf) {
        text.push(`At commit ${short(walk.asOf)} the module did not declare ${name}, or the coverage read could not be made there.`);
      }
      if (now) {
        text.push(`${then ? 'Today' : 'Now'} it is ${VERDICT[now.coverage.status]}: ${plural(now.coverage.items, 'eligible item')}${now.assessedBy.length > 1 ? ` (${now.assessedBy.map((i) => i.label ?? i.id).join(', ')})` : ''}.`);
      } else if (!then) {
        text.push(`The coverage read for ${name} is not available at this ref.`);
      }
      text.push('Coverage is computed at a ref, never stored (ADR-0056); the dataset names the commit, so "adequate when" has an exact answer (ADR-0057).');
      return { ...step, text };
    }
    if (step.kind === 'changes') {
      const c = reads.changes;
      if (!c) {
        return { ...step, text: [reads.branch ? 'What changed since that commit could not be read.' : 'What changed since that commit is read on a branch; this view is at a commit.'] };
      }
      const added = c.changes.filter((x) => x.op === 'insert').map((x) => x.id);
      const changed = c.changes.filter((x) => x.op === 'update').map((x) => x.id);
      const gone = c.changes.filter((x) => x.op === 'delete').map((x) => x.id);
      const byClass = (ids: string[]) => {
        const counts = new Map<string, number>();
        for (const id of ids) { const cls = id.slice(0, id.indexOf('/')); counts.set(cls, (counts.get(cls) ?? 0) + 1); }
        return [...counts].map(([cls, n]) => `${n} ${cls}`).join(', ');
      };
      const text = [
        `Since commit ${short(c.from)} on ${reads.branch ?? 'the branch'}: ${added.length ? `${plural(added.length, 'record')} added (${byClass(added)})` : 'nothing added'}${changed.length ? `, ${plural(changed.length, 'record')} changed (${byClass(changed)})` : ''}${gone.length ? `, ${plural(gone.length, 'record')} deleted` : ''}. Added records are outlined green, changed ones amber.`,
        'The design history is the commit graph (ADR-0025): a result, an attestation and a revision each arrive as a commit, and the design the cohort met is still readable at its own.',
      ];
      return { ...step, text, added: added.filter((id) => byId.has(id)), changed: changed.filter((id) => byId.has(id)), gone, nodes: [...added, ...changed].filter((id) => byId.has(id)) };
    }
    return step;
  });
  return { ...walk, steps };
}
