import { coverageOf, type ItemLike, type PlacementLike } from '../intelligence/coverage';
import type { TerminusDocument } from '../store';
import type { WriteContext } from './index';

/**
 * Constraint 7: ModuleObjective.coverageStatus and projectedCoverageStatus
 * are computed by the hub, in the same commit as the write that changes
 * their inputs (ADR-0007, ADR-0019, ADR-0029 decisions 5 and 6).
 *
 * The write pipeline calls `deriveCoverage` after the invariants pass and
 * before the one PUT. It collects the modules the batch affects, recomputes
 * every declaration of each over the branch as it will look after the write,
 * fills the two fields on the declarations in the batch (a client may not
 * send them; the generated schema rejects them with 400) and returns the
 * declarations on the branch whose values change, which the pipeline appends
 * to the list so they ride in the caller's commit under the caller's reason.
 *
 * A reference may name a document minted in this write by `{ "@ref" }`, so
 * documents are matched by key: an id, or `@ref:<capture>` for a batch
 * document that has no id yet. Only batch documents can match a capture key.
 */

/** A reference's key: its id, or `@ref:<capture>` for a document captured in this write. */
const keyOf = (ref: unknown): string | undefined => {
  if (typeof ref === 'string') return ref || undefined;
  if (ref && typeof ref === 'object' && typeof (ref as Record<string, unknown>)['@ref'] === 'string') {
    return `@ref:${(ref as Record<string, string>)['@ref']}`;
  }
  return undefined;
};

/** A document's key: its id, or its capture when the store has not minted an id yet. */
const docKey = (doc: TerminusDocument): string | undefined =>
  (typeof doc['@id'] === 'string' && doc['@id']) ? doc['@id']
  : typeof doc['@capture'] === 'string' ? `@ref:${doc['@capture']}`
  : undefined;

const isStoredId = (key: string): boolean => !key.startsWith('@ref:');

/**
 * Documents of `type` whose `field` names `key`, as the branch will look
 * after the write. For an id this is `ctx.siblings`; a capture key can only
 * be named by batch documents.
 */
async function matching(ctx: WriteContext, type: string, field: string, key: string): Promise<TerminusDocument[]> {
  if (isStoredId(key)) return ctx.siblings(type, { [field]: key });
  return ctx.batch.filter((d) => d['@type'] === type && keyOf(d[field]) === key);
}

/** The branch's current version of a document this write replaces, for what it is leaving. */
async function previous(ctx: WriteContext, doc: TerminusDocument): Promise<TerminusDocument | undefined> {
  const id = doc['@id'];
  if (typeof id !== 'string' || !ctx.replacing.has(id)) return undefined;
  return (await ctx.branch.getDocument(id)).document;
}

/**
 * The keys of the modules whose coverage this write may change (ADR-0029
 * decision 6): a declaration's module; a placement's assessment's module and
 * the one it leaves; every module whose assessments place a written item;
 * an assessment's module and the one it leaves.
 */
export async function affectedModules(ctx: WriteContext): Promise<string[]> {
  const modules = new Set<string>();
  const add = (key: string | undefined) => { if (key) modules.add(key); };
  const moduleOfAssessment = async (ref: unknown): Promise<string | undefined> => {
    const assessment = await ctx.resolve(ref);
    return assessment ? keyOf(assessment.module) : undefined;
  };

  for (const doc of ctx.batch) {
    switch (doc['@type']) {
      case 'ModuleObjective':
        add(keyOf(doc.module));
        break;
      case 'Assessment': {
        add(keyOf(doc.module));
        const before = await previous(ctx, doc);
        if (before) add(keyOf(before.module));
        break;
      }
      case 'ItemInstance': {
        add(await moduleOfAssessment(doc.assessment));
        const before = await previous(ctx, doc);
        if (before) add(await moduleOfAssessment(before.assessment));
        break;
      }
      case 'AssessmentItem': {
        const key = docKey(doc);
        if (!key) break;
        for (const placement of await matching(ctx, 'ItemInstance', 'implements', key)) {
          add(await moduleOfAssessment(placement.assessment));
        }
        break;
      }
    }
  }
  return [...modules];
}

/**
 * Recomputes every declaration of every affected module. Declarations in the
 * batch are filled in place; declarations on the branch whose values change
 * are returned as the documents to write beside the batch.
 */
export async function deriveCoverage(ctx: WriteContext): Promise<TerminusDocument[]> {
  const derived: TerminusDocument[] = [];
  for (const moduleKey of await affectedModules(ctx)) {
    const declarations = await matching(ctx, 'ModuleObjective', 'module', moduleKey);
    if (declarations.length === 0) continue;

    const placements: PlacementLike[] = [];
    const items = new Map<string, ItemLike>();
    for (const assessment of await matching(ctx, 'Assessment', 'module', moduleKey)) {
      const assessmentKey = docKey(assessment);
      if (!assessmentKey) continue;
      for (const placement of await matching(ctx, 'ItemInstance', 'assessment', assessmentKey)) {
        const itemKey = keyOf(placement.implements);
        if (!itemKey) continue;
        if (!items.has(itemKey)) {
          const item = await ctx.resolve(placement.implements);
          if (!item) continue;
          const assesses = Array.isArray(item.assesses) ? item.assesses.map(keyOf).filter((k): k is string => !!k) : [];
          items.set(itemKey, { '@id': itemKey, status: item.status as ItemLike['status'], assesses });
        }
        placements.push({ implements: itemKey, status: placement.status as PlacementLike['status'] });
      }
    }

    for (const declaration of declarations) {
      const objective = keyOf(declaration.references);
      if (!objective) continue;
      const { coverageStatus, projectedCoverageStatus } = coverageOf(objective, placements, items);
      if (ctx.batch.includes(declaration)) {
        declaration.coverageStatus = coverageStatus;
        declaration.projectedCoverageStatus = projectedCoverageStatus;
      } else if (
        declaration.coverageStatus !== coverageStatus ||
        declaration.projectedCoverageStatus !== projectedCoverageStatus
      ) {
        derived.push({ ...declaration, coverageStatus, projectedCoverageStatus });
      }
    }
  }
  return derived;
}
