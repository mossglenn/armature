import type { TerminusDocument } from '../store';
import type { WriteContext } from './index';

/**
 * Constraint 7: ModuleObjective.coverageStatus must be recomputed after any
 * change to AssessmentItem.assesses, ItemInstance membership, an item's or a
 * placement's status, or ModuleObjective.role (ADR-0007, ADR-0019).
 *
 * This is the afterWrite hook those three types register. Phase 4 brings the
 * coverage algorithm (ADR-0029) and writes the recomputed statuses as a
 * follow-on commit by the same author; until then the hook only names the
 * modules a recompute would touch, so the shape is in place and the Phase 4
 * change is a body, not a wiring job.
 */
export async function afterWriteCoverage(docs: TerminusDocument[], ctx: WriteContext): Promise<void> {
  void (await affectedModules(docs, ctx));
}

/** The Module ids whose coverage the write may have changed. */
export async function affectedModules(docs: TerminusDocument[], ctx: WriteContext): Promise<string[]> {
  const modules = new Set<string>();
  for (const doc of docs) {
    if (doc['@type'] === 'ModuleObjective' && typeof doc.module === 'string') modules.add(doc.module);
    if (doc['@type'] === 'ItemInstance' && typeof doc.assessment === 'string') {
      const assessment = await ctx.resolve(doc.assessment);
      if (assessment && typeof assessment.module === 'string') modules.add(assessment.module);
    }
    // An AssessmentItem change reaches every module whose assessment places
    // it; resolving that needs the placements, which Phase 4 reads when it
    // computes coverage. Nothing to collect here yet.
  }
  return [...modules];
}
