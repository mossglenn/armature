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
import { canonical, fragmentsOf } from '../fragments';
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
 *                                              objectives no activity targets; items that
 *                                              assess nothing (ADR-0060)
 *   GET /trace/:type/:id?branch=|ref=          the provenance chain through the design
 *                                              lifecycle, both ways from any document on it,
 *                                              with the notes, findings and attestations about
 *                                              what it reaches
 *   GET /impact/:type/:id?branch=|ref=         every document that references this one, with
 *                                              the artifact each junction sits in
 *   GET /attestations/:type/:id?branch=|ref=   the attestations about this record, each with
 *                                              whether the part it judged has changed since
 *                                              its asOf (ADR-0028 decision 7)
 *   GET /item-statistics?module=&unit=         the item statistics in the bank or a module:
 *       &branch=|ref=                          each item with every metric about it and the
 *                                              administration it came from (ADR-0058)
 *   GET /module-content/:moduleId              a module's activities and groups in teaching
 *       ?branch=|ref=                          order, each group's members in theirs, each
 *                                              activity's formative items in theirs (ADR-0005)
 *
 * All seven are reads at a ref with the commit in ETag, the entity tag
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
  const bank = await graph.list('AssessmentItem');
  const items = bank.filter((i) => idsIn(i.assesses).some((o) => scope.has(o)));
  // An item may exist before anyone aligns it (ADR-0060). It covers nothing and
  // is in no objective's scope, so it is listed on its own: every such item in
  // the bank, or, within a module, those placed in the module's assessments.
  const unaligned = (i: TerminusDocument) => idsIn(i.assesses).length === 0;
  const itemsWithoutObjective = scopeModule
    ? [...(await assessmentOf(graph, scopeModule['@id'])).items.values()].filter(unaligned)
    : bank.filter(unaligned);
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
    itemsWithoutObjective: itemsWithoutObjective.map(summarize),
    unleveled: {
      objectives: objectives.filter((o) => bloomsRank(o.bloomsLevel) < 0).map(summarize),
      items: items.filter((i) => bloomsRank(i.bloomsLevel) < 0).map(summarize),
    },
  });
});

// ── Item statistics ───────────────────────────────────────────────────────────

/**
 * An item statistic is a `LearningMetric` whose `subject` is the item
 * (ADR-0058). This read groups them by item, each with the administration it
 * came from, and summarizes nothing: which figure is "the" difficulty (the
 * latest administration, one cohort, the mean across cohorts, the one at a
 * given design state) is the client's choice, so every observation is
 * returned, newest administration first, with what a client needs to choose.
 * The viewer's Coverage View is the first client (ADR-0058 decision 3).
 *
 * Scope: the whole bank, or with `?module=` the items placed in the module's
 * assessments. `?unit=` keeps the metrics in one unit (free text, ADR-0058
 * decision 1); `units` lists every unit in scope before that filter.
 */
interface ItemStatistic {
  metric: Summary;
  collectedAt?: string;
  dataset?: Summary & { cohort?: string; administrationDate?: string };
}

/** Newest administration first, then newest collection, then id; a metric with no dataset sorts by collection. */
function newestFirst(a: ItemStatistic, b: ItemStatistic): number {
  const when = (s: ItemStatistic) => s.dataset?.administrationDate ?? '';
  return when(b).localeCompare(when(a)) || (b.collectedAt ?? '').localeCompare(a.collectedAt ?? '') || a.metric.id.localeCompare(b.metric.id);
}

intelligence.get('/item-statistics', async (c) => {
  const graph = await graphAt(c);
  const moduleQuery = c.req.query('module');
  const unit = c.req.query('unit');
  let scopeModule: TerminusDocument | undefined;
  let items: TerminusDocument[];
  if (moduleQuery) {
    scopeModule = await requireDocument(graph, 'Module', moduleQuery.replace(/^Module\//, ''));
    items = [...(await assessmentOf(graph, scopeModule['@id'])).items.values()];
  } else {
    items = await graph.list('AssessmentItem');
  }
  items = items.slice().sort((x, y) => x['@id'].localeCompare(y['@id']));
  const inScope = new Set(items.map((i) => i['@id']));

  const metrics = (await graph.list('LearningMetric')).filter((m) => typeof m.subject === 'string' && inScope.has(m.subject));
  const units = [...new Set(metrics.map((m) => m.unit).filter((u): u is string => typeof u === 'string'))].sort();
  const kept = unit === undefined ? metrics : metrics.filter((m) => m.unit === unit);
  const datasets = new Map(
    (await graph.getMany(kept.map((m) => m.derivedFrom).filter((d): d is string => typeof d === 'string'))).map((d) => [d['@id'], d])
  );

  const bySubject = new Map<string, ItemStatistic[]>();
  for (const m of kept) {
    const dataset = typeof m.derivedFrom === 'string' ? datasets.get(m.derivedFrom) : undefined;
    const statistic: ItemStatistic = {
      metric: summarize(m),
      ...(typeof m.collectedAt === 'string' ? { collectedAt: m.collectedAt } : {}),
      ...(dataset
        ? {
            dataset: {
              ...summarize(dataset),
              ...(typeof dataset.cohort === 'string' ? { cohort: dataset.cohort } : {}),
              ...(typeof dataset.administrationDate === 'string' ? { administrationDate: dataset.administrationDate } : {}),
            },
          }
        : {}),
    };
    const list = bySubject.get(String(m.subject)) ?? [];
    list.push(statistic);
    bySubject.set(String(m.subject), list);
  }

  setEtag(c, graph.commit);
  return c.json({
    scope: { ...(scopeModule ? { module: summarize(scopeModule) } : {}), items: items.length, metrics: kept.length },
    units,
    items: items
      .filter((i) => bySubject.has(i['@id']))
      .map((i) => ({ item: summarize(i), statistics: bySubject.get(i['@id'])!.sort(newestFirst) })),
    itemsWithoutStatistics: items.filter((i) => !bySubject.has(i['@id'])).map(summarize),
  });
});

// ── Module content ────────────────────────────────────────────────────────────

/**
 * A module's content in teaching order, the composed view ADR-0005 assigns
 * the API: its ModuleActivityLinks and ModuleActivityGroupLinks merged by
 * `sequence` (one namespace, constraint 3), each group's members by theirs
 * (constraint 4), each activity's formative items by theirs (ADR-0061,
 * constraint 17). The three integers are never combined. Every one is
 * Optional: an entry without one follows those with one, by link id, and the
 * entry carries no `sequence`.
 *
 * A tree of placements, not a set of activities (decided 2026-10-22): the
 * keys allow one activity standalone and in a group of the same module, or in
 * two of its groups, and it appears at each place with the link that put it
 * there; `repeated` names it, and nothing calls it wrong. A module's
 * assessments are not content in ADR-0005's sense; coverage reads them.
 */
const bySequence = (x: TerminusDocument, y: TerminusDocument): number =>
  Number(x.sequence ?? Infinity) - Number(y.sequence ?? Infinity) || x['@id'].localeCompare(y['@id']);

const sequenceOf = (link: TerminusDocument) => (typeof link.sequence === 'number' ? { sequence: link.sequence } : {});

/** A document the ref lacks is still shown by id, as coverage shows an objective. */
const summaryOr = (docs: Map<string, TerminusDocument>, id: string, type: string): Summary => {
  const doc = docs.get(id);
  return doc ? summarize(doc) : { id, type };
};

intelligence.get('/module-content/:moduleId', async (c) => {
  const graph = await graphAt(c);
  const mod = await requireDocument(graph, 'Module', c.req.param('moduleId'));
  const moduleId = mod['@id'];

  const links = [
    ...(await graph.list('ModuleActivityLink', { module: moduleId })),
    ...(await graph.list('ModuleActivityGroupLink', { module: moduleId })),
  ].sort(bySequence);
  const groupIds = links.filter((l) => l['@type'] === 'ModuleActivityGroupLink').map((l) => String(l.group));
  const members = new Map(
    await Promise.all(groupIds.map(async (g) => [g, (await graph.where('ActivityGroupMember', 'group', g)).sort(bySequence)] as const))
  );
  const activityIds = [
    ...links.filter((l) => l['@type'] === 'ModuleActivityLink').map((l) => String(l.activity)),
    ...[...members.values()].flat().map((m) => String(m.activity)),
  ];
  const uses = new Map(
    await Promise.all(
      [...new Set(activityIds)].map(async (a) => [a, (await graph.where('ActivityItemLink', 'activity', a)).sort(bySequence)] as const)
    )
  );
  const docs = new Map(
    (await graph.getMany([...groupIds, ...activityIds, ...[...uses.values()].flat().map((u) => String(u.item))])).map((d) => [d['@id'], d])
  );

  const placements = new Map<string, string[]>();
  const placed = (link: TerminusDocument) => {
    const activityId = String(link.activity);
    placements.set(activityId, [...(placements.get(activityId) ?? []), link['@id']]);
    const activity = docs.get(activityId);
    return {
      ...sequenceOf(link),
      link: link['@id'],
      activity: {
        ...summaryOr(docs, activityId, 'LearningActivity'),
        ...(typeof activity?.activityType === 'string' ? { activityType: activity.activityType } : {}),
        targets: idsIn(activity?.targets),
      },
      items: (uses.get(activityId) ?? []).map((u) => ({
        ...sequenceOf(u),
        link: u['@id'],
        item: summaryOr(docs, String(u.item), 'AssessmentItem'),
      })),
    };
  };
  const content = links.map((l) =>
    l['@type'] === 'ModuleActivityLink'
      ? { kind: 'activity' as const, ...placed(l) }
      : {
          kind: 'group' as const,
          ...sequenceOf(l),
          link: l['@id'],
          group: summaryOr(docs, String(l.group), 'ActivityGroup'),
          members: (members.get(String(l.group)) ?? []).map(placed),
        }
  );

  const memberLinks = [...members.values()].flat();
  const useLinks = [...uses.values()].flat();
  setEtag(c, graph.commit);
  return c.json({
    module: summarize(mod),
    summary: {
      entries: content.length,
      groups: groupIds.length,
      activities: placements.size,
      placements: activityIds.length,
      formativeUses: useLinks.length,
      unsequenced: [...links, ...memberLinks, ...useLinks].filter((l) => typeof l.sequence !== 'number').length,
    },
    content,
    repeated: [...placements]
      .filter(([, at]) => at.length > 1)
      .map(([id, at]) => ({ activity: summaryOr(docs, id, 'LearningActivity'), placements: at }))
      .sort((x, y) => x.activity.id.localeCompare(y.activity.id)),
  });
});

// ── Trace ─────────────────────────────────────────────────────────────────────

/**
 * The design lifecycle the trace walks, evidence first:
 *
 *   LearningEvidence ← NeedEvidenceLink → LearningNeed ← LearningObjective ← AssessmentItem
 *     ← ItemInstance → Assessment ← LearningDataset ← LearningMetric
 *
 * with an item's formative uses (ActivityItemLink → LearningActivity, ADR-0061)
 * as a downstream hop beside its placements, Module reached from an objective's
 * declarations, an assessment's `module` and an activity's links as context, and a metric's `subject` (the record it measures, such
 * as the item an item statistic is about; ADR-0058) as a direct hop. `upstream` follows the chain toward evidence (why does
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
    case 'LearningMetric':
      await follow('derivedFrom');
      await follow('subject');
      break;
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
  // Whatever the record, the metrics that measure it (ADR-0058).
  await direct('LearningMetric', 'subject');
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
      // Formative use: the activities that ask the item in passing (ADR-0061).
      for (const use of await graph.where('ActivityItemLink', 'item', from)) {
        const next = await graph.get(String(use.activity));
        if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'activity', through: use['@id'] } });
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
 * declaration's role and verdict), every assessment with its module, and
 * every activity with the modules it is placed in.
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
  } else if (doc['@type'] === 'LearningActivity') {
    for (const link of await graph.where('ModuleActivityLink', 'activity', from)) {
      const next = await graph.get(String(link.module));
      if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'module', through: link['@id'] } });
    }
    // Placed through a group, which is placement all the same (ADR-0005); the
    // edge names the group's link into the module.
    for (const member of await graph.where('ActivityGroupMember', 'activity', from)) {
      for (const link of await graph.where('ModuleActivityGroupLink', 'group', String(member.group))) {
        const next = await graph.get(String(link.module));
        if (next) hops.push({ next, edge: { from, to: next['@id'], via: 'module', through: link['@id'] } });
      }
    }
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

  // Notes, findings and attestations about anything the trace reached: the
  // recorded "why", and who has vouched for what since (ADR-0028).
  const reached = new Set(nodes.keys());
  const annotations: Array<Record<string, unknown>> = [];
  for (const type of ['DesignNote', 'DesignFinding']) {
    for (const d of await graph.list(type)) {
      const about = idsIn(d.subject).filter((s) => reached.has(s));
      if (about.length) {
        annotations.push({
          ...summarize(d),
          subject: about,
          ...(typeof d.fragmentId === 'string' ? { fragmentId: d.fragmentId } : {}),
          ...(d.regarding ? { regarding: d.regarding } : {}),
        });
      }
    }
  }
  for (const d of await graph.list('Attestation')) {
    const subject = nodes.get(String(d.subject));
    if (subject) annotations.push(await reportAttestation(graph, d, subject));
  }

  setEtag(c, graph.commit);
  return c.json({
    root: summarize(root),
    nodes: [...nodes.values()].map(summarize),
    edges,
    annotations,
  });
});

// ── Attestations ──────────────────────────────────────────────────────────────

/**
 * Whether an attestation still holds is derived here, never stored
 * (ADR-0028 decision 7, ADR-0056):
 *
 *   Current          the judged part reads the same at asOf and at the ref
 *   Stale            it reads differently
 *   FragmentRemoved  the subject no longer has the part at the ref
 *   Unanchored       no asOf (written outside the pipeline), or asOf names a
 *                    state without the subject: nothing to compare against
 *
 * The judged part is the fragment named by fragmentId, or the whole subject.
 * Both states are compared in canonical form, every `@id` dropped, fragments
 * matched by fragmentId (fragments.ts). Two reads, never a history walk:
 * after a merge the commit attested is not in the target's history (check
 * AB6), and a no-op replace is a commit (AB4). `Stale` is not a verdict: the
 * attester still affirmed the earlier state.
 */
type AttestationState = 'Current' | 'Stale' | 'FragmentRemoved' | 'Unanchored';
const ATTESTATION_STATES: readonly AttestationState[] = ['Current', 'Stale', 'FragmentRemoved', 'Unanchored'];

const judgedPart = (subject: TerminusDocument, fragmentId: unknown): unknown =>
  typeof fragmentId === 'string' ? fragmentsOf(subject).get(fragmentId) : subject;

async function attestationState(graph: Graph, attestation: TerminusDocument, subject: TerminusDocument): Promise<AttestationState> {
  const now = judgedPart(subject, attestation.fragmentId);
  if (now === undefined) return 'FragmentRemoved';
  if (typeof attestation.asOf !== 'string') return 'Unanchored';
  const then = await graph.getAt(attestation.asOf, subject['@id']);
  if (!then) return 'Unanchored';
  const before = judgedPart(then, attestation.fragmentId);
  return before !== undefined && canonical(before) === canonical(now) ? 'Current' : 'Stale';
}

/** An attestation as the reads report it: the verdict, what it is about, who gave it, and its state. */
async function reportAttestation(graph: Graph, d: TerminusDocument, subject: TerminusDocument) {
  return {
    id: d['@id'],
    type: d['@type'],
    subject: subject['@id'],
    ...(typeof d.fragmentId === 'string' ? { fragmentId: d.fragmentId } : {}),
    ...(typeof d.claimRef === 'string' ? { claimRef: d.claimRef, claimText: d.claimText } : {}),
    verdict: d.verdict,
    ...(typeof d.reason === 'string' ? { reason: d.reason } : {}),
    ...(typeof d.asOf === 'string' ? { asOf: d.asOf } : {}),
    attestedBy: d.attestedBy,
    state: await attestationState(graph, d, subject),
  };
}

/**
 * By subject only. No attester parameter and no count per person: an
 * attestation is provenance, not a measure of its attester (ADR-0021,
 * ADR-0028 decision 8). The counts are per state, for this subject.
 */
intelligence.get('/attestations/:type/:id', async (c) => {
  const { type, id } = c.req.param();
  const graph = await graphAt(c);
  const root = await requireDocument(graph, type, id);

  const attestations = await Promise.all(
    (await graph.where('Attestation', 'subject', root['@id'])).map((d) => reportAttestation(graph, d, root))
  );
  attestations.sort((x, y) =>
    (x.fragmentId ?? '').localeCompare(y.fragmentId ?? '') || (x.claimRef ?? '').localeCompare(y.claimRef ?? '') || x.id.localeCompare(y.id)
  );
  const byState = Object.fromEntries(ATTESTATION_STATES.map((st) => [st, attestations.filter((a) => a.state === st).length]));

  setEtag(c, graph.commit);
  return c.json({ subject: summarize(root), summary: { attestations: attestations.length, byState }, attestations });
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
