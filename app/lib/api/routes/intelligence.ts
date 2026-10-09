import { Hono, type Context } from 'hono';
import { isKnownType } from '../classes';
import { ApiError } from '../errors';
import { intQuery, refFromQuery, requireCommit, setEtag } from '../http';
import {
  COVERAGE_STATUSES,
  DEFAULT_THRESHOLDS,
  coverageOf,
  isDelivered,
  isProjected,
  type CoverageStatus,
  type ItemLike,
  type PlacementLike,
  type Thresholds,
} from '../intelligence/coverage';
import { Graph, bloomsRank, idsIn, otherReferences, summarize, type Summary } from '../intelligence/graph';
import { createStore, type TerminusDocument } from '../store';

/**
 * /api/v1/intelligence (plan §4 Phase 4; the paper's §4 as read endpoints).
 *
 *   GET /coverage/:moduleId?branch=|ref=       a module's declarations with both coverage
 *       &fullyAssessedAt=&overAssessedAbove=   figures (counts and verdicts), the items behind
 *                                              each, and the objectives its assessments test
 *                                              without declaring
 *   GET /coverage?course=&branch=|ref=         the same for every module of a course (or all)
 *   GET /alignment?module=&branch=|ref=        Bloom's mismatches: items below an objective
 *                                              they assess; objectives no item reaches at level;
 *                                              objectives no activity targets
 *   GET /trace/:type/:id?branch=|ref=          the provenance chain through the design
 *                                              lifecycle, both ways from any document on it,
 *                                              with the notes and findings about what it reaches
 *   GET /impact/:type/:id?branch=|ref=         every document that references this one, with
 *                                              the artifact each junction sits in
 *
 * All four are reads at a ref with the commit in ETag, the entity tag
 * (architecture decision record ADR-0025, decision 7). They derive
 * everything from structure (plan principle P4): no text similarity, no model.
 * Redundancy detection ("a new item duplicates one in the bank") needs text
 * similarity and is deferred; it is not a structural question.
 *
 * Coverage is computed here, at the requested ref, from the placements and
 * items as they stand; nothing is stored (ADR-0056). The verdict thresholds
 * are the hub's default cut unless the query names others, and the counts
 * are returned beside the verdicts so a client can apply its own.
 */
export const intelligence = new Hono();

async function graphAt(c: Context): Promise<Graph> {
  const ref = refFromQuery(c);
  const store = createStore(ref);
  if ('commit' in ref) await requireCommit(store, ref.commit);
  return new Graph(store);
}

async function requireDocument(graph: Graph, type: string, id: string): Promise<TerminusDocument> {
  if (!isKnownType(type)) throw new ApiError(404, 'unknown_type', `No type ${type}`);
  const docId = `${type}/${id}`;
  const doc = await graph.get(docId);
  if (!doc || doc['@type'] !== type) throw new ApiError(404, 'not_found', `No ${type} with id ${docId}`);
  return doc;
}

// ── Coverage ──────────────────────────────────────────────────────────────────

interface ModuleAssessment {
  placements: TerminusDocument[];
  placementLikes: PlacementLike[];
  items: Map<string, TerminusDocument>;
  itemLikes: Map<string, ItemLike>;
}

/** Everything placed in a module's assessments, in the shape the algorithm reads. */
async function assessmentOf(graph: Graph, moduleId: string): Promise<ModuleAssessment> {
  const assessments = await graph.list('Assessment', { module: moduleId });
  const placements = (await Promise.all(assessments.map((a) => graph.list('ItemInstance', { assessment: a['@id'] })))).flat();
  const items = new Map((await graph.getMany(placements.map((p) => String(p.implements)))).map((d) => [d['@id'], d]));
  const itemLikes = new Map<string, ItemLike>();
  for (const [id, item] of items) {
    itemLikes.set(id, { '@id': id, status: item.status as ItemLike['status'], assesses: idsIn(item.assesses) });
  }
  const placementLikes = placements
    .filter((p) => items.has(String(p.implements)))
    .map((p) => ({ implements: String(p.implements), status: p.status as PlacementLike['status'] }));
  return { placements, placementLikes, items, itemLikes };
}

type Eligibility = 'delivered' | 'projected' | 'none';

/** The items placed in the module that assess `objective`, each with how it counts. */
function assessedBy(objective: string, a: ModuleAssessment): Array<Summary & { eligibility: Eligibility; placements: Array<{ id: string; assessment: string; status: string }> }> {
  const out = [];
  for (const [id, item] of a.items) {
    const like = a.itemLikes.get(id)!;
    if (!like.assesses.includes(objective)) continue;
    const placements = a.placements.filter((p) => p.implements === id);
    const likes = a.placementLikes.filter((p) => p.implements === id);
    const eligibility: Eligibility = likes.some((p) => isDelivered(p, like)) ? 'delivered'
      : likes.some((p) => isProjected(p, like)) ? 'projected'
      : 'none';
    out.push({
      ...summarize(item),
      eligibility,
      placements: placements.map((p) => ({ id: p['@id'], assessment: String(p.assessment), status: String(p.status) })),
    });
  }
  return out;
}

const emptyCounts = (): Record<CoverageStatus, number> =>
  Object.fromEntries(COVERAGE_STATUSES.map((v) => [v, 0])) as Record<CoverageStatus, number>;

/** `?fullyAssessedAt=&overAssessedAbove=`, the hub's defaults when absent (ADR-0029 decision 3). */
function thresholdsFrom(c: Context): Thresholds {
  const fullyAssessedAt = intQuery(c, 'fullyAssessedAt', DEFAULT_THRESHOLDS.fullyAssessedAt);
  const overAssessedAbove = intQuery(c, 'overAssessedAbove', DEFAULT_THRESHOLDS.overAssessedAbove);
  if (fullyAssessedAt < 1) throw new ApiError(400, 'bad_query', 'fullyAssessedAt must be at least 1');
  if (overAssessedAbove < fullyAssessedAt) {
    throw new ApiError(400, 'bad_query', 'overAssessedAbove must be at least fullyAssessedAt');
  }
  return { fullyAssessedAt, overAssessedAbove };
}

/** One module's coverage block: the shape both coverage routes return per module. */
async function moduleCoverage(graph: Graph, mod: TerminusDocument, thresholds: Thresholds) {
  const moduleId = mod['@id'];
  const declarations = await graph.list('ModuleObjective', { module: moduleId });
  const a = await assessmentOf(graph, moduleId);
  const declared = new Set(declarations.map((d) => String(d.references)));
  const assessedObjectives = new Set([...a.itemLikes.values()].flatMap((i) => i.assesses));
  const objectives = new Map(
    (await graph.getMany([...declared, ...assessedObjectives])).map((d) => [d['@id'], d])
  );
  const objectiveSummary = (id: string): Summary => {
    const target = objectives.get(id);
    return target ? summarize(target) : { id, type: 'LearningObjective' };
  };

  const coverage = emptyCounts();
  const projected = emptyCounts();
  const rows = declarations
    .slice()
    .sort((x, y) => Number(x.sequence ?? Infinity) - Number(y.sequence ?? Infinity))
    .map((d) => {
      const objective = String(d.references);
      const c = coverageOf(objective, a.placementLikes, a.itemLikes, thresholds);
      coverage[c.coverageStatus] += 1;
      projected[c.projectedCoverageStatus] += 1;
      return {
        id: d['@id'],
        role: d.role,
        sequence: d.sequence,
        roleRationale: d.roleRationale,
        objective: objectiveSummary(objective),
        coverage: { status: c.coverageStatus, items: c.deliveredItems.length },
        projected: { status: c.projectedCoverageStatus, items: c.projectedItems.length },
        assessedBy: assessedBy(objective, a),
      };
    });

  const undeclared = [...assessedObjectives]
    .filter((o) => !declared.has(o))
    .sort()
    .map((o) => ({ objective: objectiveSummary(o), assessedBy: assessedBy(o, a) }));

  return {
    module: summarize(mod),
    summary: { declared: declarations.length, coverage, projected, undeclared: undeclared.length },
    objectives: rows,
    undeclared,
  };
}

intelligence.get('/coverage/:moduleId', async (c) => {
  const graph = await graphAt(c);
  const thresholds = thresholdsFrom(c);
  const mod = await requireDocument(graph, 'Module', c.req.param('moduleId'));
  const block = await moduleCoverage(graph, mod, thresholds);
  setEtag(c, graph.commit);
  return c.json({ ...block, thresholds });
});

intelligence.get('/coverage', async (c) => {
  const graph = await graphAt(c);
  const thresholds = thresholdsFrom(c);
  const courseQuery = c.req.query('course');
  let course: TerminusDocument | undefined;
  if (courseQuery) course = await requireDocument(graph, 'Course', courseQuery.replace(/^Course\//, ''));
  const modules = (course ? await graph.list('Module', { course: course['@id'] }) : await graph.list('Module'))
    .slice()
    .sort((x, y) => Number(x.sequence ?? Infinity) - Number(y.sequence ?? Infinity) || x['@id'].localeCompare(y['@id']));
  const blocks = [];
  for (const mod of modules) blocks.push(await moduleCoverage(graph, mod, thresholds));
  setEtag(c, graph.commit);
  return c.json({ ...(course ? { course: summarize(course) } : {}), thresholds, modules: blocks });
});

// ── Alignment ─────────────────────────────────────────────────────────────────

intelligence.get('/alignment', async (c) => {
  const graph = await graphAt(c);
  const moduleQuery = c.req.query('module');
  let scopeModule: TerminusDocument | undefined;
  let objectives: TerminusDocument[];
  if (moduleQuery) {
    // Accept `Module/x` or bare `x`.
    scopeModule = await requireDocument(graph, 'Module', moduleQuery.replace(/^Module\//, ''));
    const declarations = await graph.list('ModuleObjective', { module: scopeModule['@id'] });
    objectives = await graph.getMany(declarations.map((d) => String(d.references)));
  } else {
    objectives = await graph.list('LearningObjective');
  }
  const scope = new Set(objectives.map((o) => o['@id']));
  const items = (await graph.list('AssessmentItem')).filter((i) => idsIn(i.assesses).some((o) => scope.has(o)));
  const activities = (await graph.list('LearningActivity')).filter((x) => idsIn(x.targets).some((o) => scope.has(o)));

  const itemsBelowObjective = [];
  const reachedAtLevel = new Set<string>();
  for (const item of items) {
    const itemRank = bloomsRank(item.bloomsLevel);
    for (const objectiveId of idsIn(item.assesses)) {
      const objective = objectives.find((o) => o['@id'] === objectiveId);
      if (!objective) continue;
      const objectiveRank = bloomsRank(objective.bloomsLevel);
      if (itemRank < 0 || objectiveRank < 0) continue;
      if (itemRank < objectiveRank) {
        itemsBelowObjective.push({ item: summarize(item), objective: summarize(objective), levelsBelow: objectiveRank - itemRank });
      } else {
        reachedAtLevel.add(objectiveId);
      }
    }
  }
  const targeted = new Set(activities.flatMap((x) => idsIn(x.targets)));

  setEtag(c, graph.commit);
  return c.json({
    scope: { ...(scopeModule ? { module: summarize(scopeModule) } : {}), objectives: objectives.length, items: items.length, activities: activities.length },
    itemsBelowObjective,
    objectivesWithoutItemAtLevel: objectives
      .filter((o) => bloomsRank(o.bloomsLevel) >= 0 && !reachedAtLevel.has(o['@id']))
      .map(summarize),
    objectivesWithoutActivity: objectives.filter((o) => !targeted.has(o['@id'])).map(summarize),
    unleveled: {
      objectives: objectives.filter((o) => bloomsRank(o.bloomsLevel) < 0).map(summarize),
      items: items.filter((i) => bloomsRank(i.bloomsLevel) < 0).map(summarize),
    },
  });
});

// ── Trace ─────────────────────────────────────────────────────────────────────

/**
 * The design lifecycle the trace walks, evidence first:
 *
 *   LearningEvidence ← NeedEvidenceLink → LearningNeed ← LearningObjective ← AssessmentItem
 *     ← ItemInstance → Assessment ← LearningDataset ← LearningMetric
 *
 * with Module reached from an objective's declarations and an assessment's
 * `module` as context. `upstream` follows the chain toward evidence (why does
 * this exist), `downstream` toward outcomes (what came of it, Narrative 1).
 * Each hop records the field it followed and the junction it went through.
 */
interface Edge {
  from: string;
  to: string;
  via: string;
  through?: string;
  confidence?: string;
  status?: string;
  role?: string;
}

const TRACEABLE = new Set([
  'LearningMetric', 'LearningDataset', 'Assessment', 'AssessmentItem', 'LearningObjective',
  'LearningNeed', 'DescriptiveEvidence', 'Module', 'LearningActivity',
]);

async function upstream(graph: Graph, doc: TerminusDocument): Promise<Array<{ next: TerminusDocument; edge: Edge }>> {
  const from = doc['@id'];
  const hops: Array<{ next: TerminusDocument; edge: Edge }> = [];
  const follow = async (field: string) => {
    const id = doc[field];
    if (typeof id !== 'string') return;
    const next = await graph.get(id);
    if (next) hops.push({ next, edge: { from, to: id, via: field } });
  };
  switch (doc['@type']) {
    case 'LearningMetric': await follow('derivedFrom'); break;
    case 'LearningDataset': await follow('producedBy'); break;
    case 'Assessment':
      for (const p of await graph.where('ItemInstance', 'assessment', from)) {
        const next = await graph.get(String(p.implements));
        if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'implements', through: p['@id'], status: String(p.status) } });
      }
      break;
    case 'AssessmentItem':
    case 'LearningActivity':
      for (const id of idsIn(doc[doc['@type'] === 'AssessmentItem' ? 'assesses' : 'targets'])) {
        const next = await graph.get(id);
        if (next) hops.push({ next, edge: { from, to: id, via: doc['@type'] === 'AssessmentItem' ? 'assesses' : 'targets' } });
      }
      break;
    case 'Module':
      for (const d of await graph.where('ModuleObjective', 'module', from)) {
        const next = await graph.get(String(d.references));
        if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'references', through: d['@id'], role: String(d.role) } });
      }
      break;
    case 'LearningObjective': await follow('generatedBy'); break;
    case 'LearningNeed':
      for (const link of await graph.where('NeedEvidenceLink', 'need', from)) {
        const next = await graph.get(String(link.evidence));
        if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'evidence', through: link['@id'], ...(typeof link.confidence === 'string' ? { confidence: link.confidence } : {}) } });
      }
      break;
  }
  return hops;
}

async function downstream(graph: Graph, doc: TerminusDocument): Promise<Array<{ next: TerminusDocument; edge: Edge }>> {
  const from = doc['@id'];
  const hops: Array<{ next: TerminusDocument; edge: Edge }> = [];
  const direct = async (type: string, field: string) => {
    for (const next of await graph.where(type, field, from)) hops.push({ next, edge: { from, to: next['@id'], via: field } });
  };
  switch (doc['@type']) {
    case 'DescriptiveEvidence':
    case 'LearningMetric':
      for (const link of await graph.where('NeedEvidenceLink', 'evidence', from)) {
        const next = await graph.get(String(link.need));
        if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'need', through: link['@id'], ...(typeof link.confidence === 'string' ? { confidence: link.confidence } : {}) } });
      }
      break;
    case 'LearningNeed': await direct('LearningObjective', 'generatedBy'); break;
    case 'LearningObjective':
      await direct('AssessmentItem', 'assesses');
      await direct('LearningActivity', 'targets');
      break;
    case 'AssessmentItem':
      for (const p of await graph.where('ItemInstance', 'implements', from)) {
        const next = await graph.get(String(p.assessment));
        if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'assessment', through: p['@id'], status: String(p.status) } });
      }
      break;
    case 'Assessment': await direct('LearningDataset', 'producedBy'); break;
    case 'LearningDataset': await direct('LearningMetric', 'derivedFrom'); break;
  }
  return hops;
}

/**
 * Module is context, not a stage: whichever way the walk went, every
 * objective it reached is shown with the modules that declare it (and the
 * declaration's role and verdict), and every assessment with its module.
 */
async function moduleContext(graph: Graph, doc: TerminusDocument): Promise<Array<{ next: TerminusDocument; edge: Edge }>> {
  const from = doc['@id'];
  const hops: Array<{ next: TerminusDocument; edge: Edge }> = [];
  if (doc['@type'] === 'LearningObjective') {
    for (const d of await graph.where('ModuleObjective', 'references', from)) {
      const next = await graph.get(String(d.module));
      if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'module', through: d['@id'], role: String(d.role) } });
    }
  } else if (doc['@type'] === 'Assessment' && typeof doc.module === 'string') {
    const next = await graph.get(doc.module);
    if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'module' } });
  }
  return hops;
}

intelligence.get('/trace/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  const graph = await graphAt(c);
  const root = await requireDocument(graph, type, id);
  if (!TRACEABLE.has(type)) {
    throw new ApiError(400, 'untraceable_type', `${type} is not on the design lifecycle the trace walks: ${[...TRACEABLE].join(', ')}`);
  }

  const nodes = new Map<string, TerminusDocument>([[root['@id'], root]]);
  const edges: Edge[] = [];
  const seen = new Set<string>();
  const record = (next: TerminusDocument, edge: Edge) => {
    const key = `${edge.from}>${edge.to}>${edge.via}>${edge.through ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(edge);
    }
    nodes.set(next['@id'], next);
  };
  const walk = async (direction: 'upstream' | 'downstream') => {
    const queue = [root];
    const visited = new Set<string>([root['@id']]);
    while (queue.length) {
      const doc = queue.shift()!;
      const hops = direction === 'upstream' ? await upstream(graph, doc) : await downstream(graph, doc);
      for (const { next, edge } of hops) {
        record(next, edge);
        if (!visited.has(next['@id'])) {
          visited.add(next['@id']);
          queue.push(next);
        }
      }
    }
  };
  await walk('upstream');
  await walk('downstream');
  for (const doc of [...nodes.values()]) {
    for (const { next, edge } of await moduleContext(graph, doc)) record(next, edge);
  }

  // Notes and findings about anything the trace reached: the recorded "why".
  const reached = new Set(nodes.keys());
  const annotations = [];
  for (const type of ['DesignNote', 'DesignFinding']) {
    for (const d of await graph.list(type)) {
      const about = idsIn(d.subject).filter((s) => reached.has(s));
      if (about.length) annotations.push({ ...summarize(d), subject: about, ...(d.regarding ? { regarding: d.regarding } : {}) });
    }
  }

  setEtag(c, graph.commit);
  return c.json({
    root: summarize(root),
    nodes: [...nodes.values()].map(summarize),
    edges,
    annotations,
  });
});

// ── Impact ────────────────────────────────────────────────────────────────────

intelligence.get('/impact/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  const graph = await graphAt(c);
  const root = await requireDocument(graph, type, id);

  const refs = await graph.referencing(root['@id'], type);
  const byType: Record<string, number> = {};
  const references = [];
  for (const { document, field } of refs) {
    byType[document['@type']] = (byType[document['@type']] ?? 0) + 1;
    // A junction's other references say what it sits in: the assessment a
    // placement belongs to, the module a declaration is for.
    const within = otherReferences(document, field);
    const context = within.length ? await graph.getMany(within.map((w) => w.id)) : [];
    references.push({
      ...summarize(document),
      field,
      ...(within.length
        ? { within: within.map((w) => ({ field: w.field, ...(summarize(context.find((d) => d['@id'] === w.id) ?? { '@id': w.id, '@type': '' })) })) }
        : {}),
    });
  }
  references.sort((x, y) => x.type.localeCompare(y.type) || x.field.localeCompare(y.field) || x.id.localeCompare(y.id));

  setEtag(c, graph.commit);
  return c.json({ document: summarize(root), summary: { references: references.length, byType }, references });
});
