/**
 * The Design Graph's derivation (docs/graph-view-plan.md §4, §9.2): documents
 * at a ref plus the schema as data → the nodes and edges the page draws, and the
 * two relations the detail panel lists (what is about a record, what references
 * it). Pure: no React, no DOM, no network, so it runs on the server and is
 * tested on fixtures.
 *
 * The schema decides the drawing, not a list of classes:
 * - A class's reference fields come from CLASS_FIELDS, its ancestors' folded in
 *   (CLASS_ANCESTORS), so a new class with references is drawn without a change
 *   here. Fields whose target is a User are never drawn: nothing is drawn per
 *   person (ADR-0021); `createdBy` and `attestedBy` are text in the panel.
 *   Only design records are drawn: a document outside DesignRecord (a User, a
 *   Grant of authority, ADR-0068) is counted, never a node.
 * - A document in the schema's `relationship` category (ADR-0027) with two
 *   references to non-person records is a *junction* (ADR-0003) and becomes a
 *   labeled edge between them carrying the document; with one reference (an
 *   Attestation, whose other end is a person) it becomes a chip on its subject.
 *   With `junctionsAsEdges: false` a junction is a node with its own edges, the
 *   store's view.
 * - A reference field on an artifact is a plain edge. A note's or finding's
 *   reference is an annotation edge (dashed on the page).
 * - Every edge points along the lifecycle, from the earlier stage to the later
 *   one (stages.ts), whichever document holds the reference (ADR-0004 puts it
 *   on the child). An edge between two records of one stage (a prerequisite
 *   between objectives) is marked `sameStage` so the layout can leave it out
 *   of the ranking.
 */
import { CLASS_ANCESTORS, CLASS_CATEGORY, CLASS_FIELDS, type ClassName, type TerminusDocument } from '@armature/types';
import { JUNCTION_STAGE_OFFSET, isAnnotationClass, stageOf, toneOf, type Tone } from './stages';

/** A document as the export returns it: the store's shape, fields unknown here. */
export type Doc = TerminusDocument & Record<string, unknown>;

export interface Chip {
  text: string;
  tone?: Tone;
  /** Hover text. */
  title?: string;
  /** The commit a `asOf` chip names, for the page to turn into a link. */
  ref?: string;
  /** The annotation the chip stands for (an attestation's id), so a read can add its state. */
  source?: string;
  /** Set by the page: where the chip leads (a `ref` chip to the design at that commit). */
  href?: string;
}

export interface GraphNode {
  id: string;
  cls: string;
  label: string;
  /** Lifecycle stage (stages.ts); fractional for a junction drawn as a node. */
  stage: number;
  chips: Chip[];
  /** Drawn with a dashed border: a note or finding about the design. */
  annotation: boolean;
  doc: Doc;
}

export type EdgeKind = 'junction' | 'reference' | 'annotation';

export interface GraphEdge {
  /** A junction edge's id is the junction document's id, which the trace read's `through` also names. */
  id: string;
  source: string;
  target: string;
  kind: EdgeKind;
  /** The junction's data as text ("Primary · #2", "Approved"), or the field name. */
  label: string;
  /** Which document holds the reference, and in which field. */
  via: { from: string; field: string };
  /** The junction document, on a junction edge. */
  junction?: Doc;
  /** Both ends in one stage: drawn, but withheld from the layout's ranking. */
  sameStage: boolean;
}

export interface Reference {
  field: string;
  target: string;
  /** The field's declared target class. */
  type: string;
}

export interface DerivedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Records about a record (notes, findings, attestations), by subject id. */
  about: Map<string, Doc[]>;
  /** Every document referencing a record, by target id, with the field. */
  referencedBy: Map<string, Array<{ id: string; field: string }>>;
  /** Documents per class, people included, hidden or not: the filter rail's counts. */
  counts: Map<string, number>;
  /** References to ids not in the documents (a slice's `unresolved`, or a class the export left out). */
  unresolved: Array<{ id: string; field: string; target: string }>;
}

export interface DeriveOptions {
  /** Classes not drawn; their documents still count and still appear in `about` and `referencedBy`. */
  hidden?: Iterable<string>;
  /** Default true: junctions as edges. False draws them as nodes. */
  junctionsAsEdges?: boolean;
}

const PERSON = 'User';

/** Under DesignRecord (ADR-0017): what the graph draws. A User or a Grant is not. */
const isDesignRecord = (cls: string): boolean =>
  cls === 'DesignRecord' || ((CLASS_ANCESTORS as Record<string, readonly string[]>)[cls]?.includes('DesignRecord') ?? false);

/** The local part of a document id: `AssessmentItem/bias-type-mc` → `bias-type-mc`. */
export const localPart = (id: string): string => (id.includes('/') ? id.slice(id.indexOf('/') + 1) : id);

/** A class's reference fields, its own and its ancestors', as field → declared target class. */
export function referenceFields(cls: string): Record<string, string> {
  const own = (c: string): Record<string, string> => {
    const fields = (CLASS_FIELDS as Record<string, Record<string, { kind: string; type: string }>>)[c] ?? {};
    return Object.fromEntries(Object.entries(fields).filter(([, f]) => f.kind === 'reference').map(([name, f]) => [name, f.type]));
  };
  const ancestors = (CLASS_ANCESTORS as Record<string, readonly string[]>)[cls] ?? [];
  return Object.assign({}, ...[...ancestors].reverse().map(own), own(cls));
}

/** Every reference a document makes, as the schema declares them; people included (callers filter). */
export function references(doc: Doc): Reference[] {
  const out: Reference[] = [];
  for (const [field, type] of Object.entries(referenceFields(doc['@type']))) {
    const value = doc[field];
    if (value === undefined || value === null) continue;
    for (const target of Array.isArray(value) ? value : [value]) {
      if (typeof target === 'string') out.push({ field, target, type });
    }
  }
  return out;
}

export const isPersonField = (ref: Reference): boolean => ref.type === PERSON;

export const isJunctionClass = (cls: string): boolean =>
  (CLASS_CATEGORY as Record<string, string>)[cls] === 'relationship';

/** What a junction says about its relationship, as a short label: "Primary · #2", "Approved", "High". */
export function junctionLabel(doc: Doc): string {
  const parts: string[] = [];
  for (const key of ['role', 'status', 'prerequisiteType', 'confidence', 'verdict']) {
    const value = doc[key];
    if (typeof value === 'string' && value) parts.push(value);
  }
  if (typeof doc.sequence === 'number') parts.push(`#${doc.sequence}`);
  return parts.length ? parts.join(' · ') : doc['@type'];
}

const shortCommit = (commit: string): string => commit.slice(0, 10);

/** The chips a record's own fields give it (an annotation's chips are added by `derive`). */
export function chipsFor(doc: Doc): Chip[] {
  const chips: Chip[] = [];
  const cls = doc['@type'];
  if (typeof doc.status === 'string') chips.push({ text: doc.status, tone: toneOf(doc.status) });
  if (typeof doc.bloomsLevel === 'string') chips.push({ text: doc.bloomsLevel });
  if (typeof doc.activityType === 'string') chips.push({ text: doc.activityType });
  if (typeof doc.priority === 'string') chips.push({ text: doc.priority });
  if (cls === 'Module' && typeof doc.sequence === 'number') chips.push({ text: `Module ${doc.sequence}` });
  if (cls === 'LearningMetric' && typeof doc.value === 'number') {
    chips.push({ text: `${doc.value}${typeof doc.unit === 'string' ? ` ${doc.unit}` : ''}`, tone: 'mono' });
  }
  if (cls === 'LearningDataset' && typeof doc.cohort === 'string') chips.push({ text: doc.cohort });
  if (typeof doc.asOf === 'string') {
    chips.push({ text: `as of ${shortCommit(doc.asOf)}`, tone: 'mono', title: 'Read the design at this commit', ref: doc.asOf });
  }
  return chips;
}

/** A chip for an annotation on its subject: an attestation's verdict, a finding's status, a note. */
export function annotationChip(doc: Doc): Chip {
  const cls = doc['@type'];
  if (typeof doc.verdict === 'string') {
    const part = typeof doc.fragmentId === 'string' ? ' · one part' : '';
    return { text: `${doc.verdict}${part}`, tone: toneOf(doc.verdict), title: `${cls} ${localPart(doc['@id'])}`, source: doc['@id'] };
  }
  if (cls === 'DesignFinding') {
    const status = typeof doc.status === 'string' ? ` · ${doc.status}` : '';
    return { text: `Finding${status}`, tone: typeof doc.status === 'string' ? toneOf(doc.status) : 'warn' };
  }
  return { text: cls === 'DesignNote' ? 'Note' : cls };
}

function labelOf(doc: Doc): string {
  if (typeof doc.label === 'string' && doc.label) return doc.label;
  return isJunctionClass(doc['@type']) ? junctionLabel(doc) : localPart(doc['@id']);
}

/** Derives the drawing from the documents at a ref. */
export function derive(docs: Doc[], options: DeriveOptions = {}): DerivedGraph {
  const hidden = new Set(options.hidden ?? []);
  const junctionsAsEdges = options.junctionsAsEdges ?? true;
  const byId = new Map(docs.map((d) => [d['@id'], d]));
  const counts = new Map<string, number>();
  const about = new Map<string, Doc[]>();
  const referencedBy = new Map<string, Array<{ id: string; field: string }>>();
  const unresolved: DerivedGraph['unresolved'] = [];
  const chipsExtra = new Map<string, Chip[]>();
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  const push = <K, V>(map: Map<K, V[]>, key: K, value: V) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  const visible = (doc: Doc | undefined): doc is Doc => doc !== undefined && !hidden.has(doc['@type']);
  const stageFor = (doc: Doc): number => stageOf(doc['@type']) ?? 0;

  // Pass 1: counts, the two relations, and which documents are drawn as nodes.
  for (const doc of docs) {
    const cls = doc['@type'];
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
    if (!isDesignRecord(cls)) continue;
    const refs = references(doc).filter((r) => !isPersonField(r));
    for (const r of refs) {
      if (!byId.has(r.target)) {
        unresolved.push({ id: doc['@id'], field: r.field, target: r.target });
        continue;
      }
      push(referencedBy, r.target, { id: doc['@id'], field: r.field });
    }
    const resolved = refs.filter((r) => byId.has(r.target));
    const annotation = isAnnotationClass(cls);
    const junction = isJunctionClass(cls);

    if (annotation || (junction && resolved.length === 1)) {
      // What this record is about: its subject(s). A note names one or more; a
      // finding names one (and `regarding`, which is context, not a subject).
      const subjects = resolved.filter((r) => r.field === 'subject');
      for (const s of subjects) push(about, s.target, doc);
    }

    if (junction && junctionsAsEdges) {
      if (resolved.length === 1) {
        // One non-person end: a chip on it (an Attestation), never a node.
        if (visible(doc)) push(chipsExtra, resolved[0].target, annotationChip(doc));
      }
      continue; // Edges are made in pass 2, once every node is known.
    }
    if (!visible(doc)) continue;
    let stage = stageFor(doc);
    if (junction) {
      // Drawn as a node: between its ends.
      const ends = resolved.map((r) => byId.get(r.target)!).filter(visible);
      const stages = ends.map(stageFor);
      stage = stages.length ? Math.max(...stages) - JUNCTION_STAGE_OFFSET : stage;
    }
    nodes.push({ id: doc['@id'], cls, label: labelOf(doc), stage, chips: chipsFor(doc), annotation, doc });
  }

  // Pass 2: edges between drawn nodes.
  const drawn = new Map(nodes.map((n) => [n.id, n]));
  const oriented = (a: GraphNode, b: GraphNode): [GraphNode, GraphNode, boolean] =>
    a.stage === b.stage ? [a, b, true] : a.stage < b.stage ? [a, b, false] : [b, a, false];

  for (const doc of docs) {
    const cls = doc['@type'];
    if (!isDesignRecord(cls)) continue;
    const refs = references(doc).filter((r) => !isPersonField(r) && byId.has(r.target));
    const junction = isJunctionClass(cls);

    if (junction && junctionsAsEdges) {
      if (hidden.has(cls) || refs.length !== 2) continue;
      const [a, b] = refs.map((r) => drawn.get(r.target));
      if (!a || !b) continue;
      const [source, target, sameStage] = oriented(a, b);
      edges.push({
        id: doc['@id'], source: source.id, target: target.id, kind: 'junction', label: junctionLabel(doc),
        via: { from: doc['@id'], field: refs.map((r) => r.field).join('+') }, junction: doc, sameStage,
      });
      continue;
    }

    const from = drawn.get(doc['@id']);
    if (!from) continue;
    for (const r of refs) {
      const to = drawn.get(r.target);
      if (!to) continue;
      const [source, target, sameStage] = oriented(from, to);
      edges.push({
        id: `${doc['@id']}|${r.field}|${r.target}`, source: source.id, target: target.id,
        kind: from.annotation ? 'annotation' : 'reference', label: r.field, via: { from: doc['@id'], field: r.field }, sameStage,
      });
    }
  }

  for (const node of nodes) {
    const extra = chipsExtra.get(node.id);
    if (extra) node.chips.push(...extra);
  }

  return { nodes, edges, about, referencedBy, counts, unresolved };
}

/** The classes the documents contain, for a legend: name, count, category, stage. */
export function classesIn(counts: Map<string, number>): Array<{ cls: string; count: number; category: string; stage: number }> {
  return [...counts]
    .filter(([cls]) => isDesignRecord(cls))
    .map(([cls, count]) => ({
      cls,
      count,
      category: (CLASS_CATEGORY as Record<string, string>)[cls] ?? 'artifact',
      stage: stageOf(cls as ClassName) ?? Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.stage - b.stage || a.cls.localeCompare(b.cls));
}
