import { ApiError } from '../errors';
import { StoreError, type Store, type TerminusDocument } from '../store';
import { validateAssessmentItem } from './assessmentItem';
import { validateDesignFinding } from './designFinding';
import { validateItemInstance } from './itemInstance';
import { validateActivityGroupMember, validateModuleContentLink } from './moduleContent';
import { checkReferences } from './references';
import { afterWriteCoverage } from './recompute';

/**
 * The invariants engine (ADR-0006, plan §4 Phase 3).
 *
 * TerminusDB enforces field types, required fields, @min_cardinality, enum
 * values and that a referenced document exists. It does not check the class
 * of a referenced document, and it cannot express cross-document or
 * conditional rules. Those are the constraints in CLAUDE.md, enforced here on
 * every write regardless of route:
 *
 *   0  reference class            references.ts (generic, every type)
 *   1  AssessmentItem.assesses    Zod .min(1) from @min_cardinality (schemas.ts)
 *   2  LearningActivity.targets   Zod .min(1)
 *   3  module content sequence    moduleContent.ts (one namespace for both link types)
 *   4  group member sequence      moduleContent.ts
 *   5  ItemInstance sequence      itemInstance.ts
 *   6  ActivityGroup flatness     constraint 0: a member's activity is typed LearningActivity
 *   7  coverageStatus recompute   recompute.ts (afterWrite; Phase 4 fills it in)
 *   8  fragmentId unique          assessmentItem.ts
 *   9  option text, correct count assessmentItem.ts
 *  10  placement not ahead of item itemInstance.ts and assessmentItem.ts (both sides)
 *  11  dismissal needs rationale  designFinding.ts
 *  12  id held by another type    the write pipeline, 409 (ADR-0024)
 *
 * A validator sees the whole batch and the branch being written, never main
 * by default. Every violation is collected and reported at once as a 422.
 */

export interface Violation {
  /** A stable code a client can act on. */
  code: string;
  /** The offending document's id, when it has one; else its index in the batch. */
  id?: string;
  index: number;
  field?: string;
  message: string;
}

export class InvariantError extends ApiError {
  constructor(readonly violations: Violation[]) {
    super(422, 'invariant_violation', `${violations.length} invariant violation(s)`, { violations });
    this.name = 'InvariantError';
  }
}

/** What a validator may ask about the write it is checking. */
export interface WriteContext {
  /** The branch being written. */
  branch: Store;
  /** Every document in the write, after the pipeline filled @id and @type. */
  batch: TerminusDocument[];
  /** Batch documents by @capture. */
  byCapture: Map<string, TerminusDocument>;
  /** Ids of documents on the branch this write replaces. */
  replacing: Set<string>;
  /**
   * The document a reference names: a batch document first (by id, or by
   * capture for `{ "@ref" }`), then the branch. Undefined when it is nowhere.
   */
  resolve(ref: unknown): Promise<TerminusDocument | undefined>;
  /**
   * Documents of `type` whose fields match `template`, as the branch will
   * look after the write: branch documents not being replaced, plus the
   * batch documents of that type that match. `template` values are ids.
   */
  siblings(type: string, template: Record<string, string>): Promise<TerminusDocument[]>;
}

export type Validator = (doc: TerminusDocument, index: number, ctx: WriteContext) => Promise<Violation[]>;

/** Per-type validators, keyed by @type. Types absent here have only the generic checks. */
const VALIDATORS: Record<string, Validator> = {
  AssessmentItem: validateAssessmentItem,
  ItemInstance: validateItemInstance,
  ModuleActivityLink: validateModuleContentLink,
  ModuleActivityGroupLink: validateModuleContentLink,
  ActivityGroupMember: validateActivityGroupMember,
  DesignFinding: validateDesignFinding,
};

/** Hooks run after the commit, keyed by @type (constraint 7). */
const AFTER_WRITE: Record<string, (docs: TerminusDocument[], ctx: WriteContext) => Promise<void>> = {
  AssessmentItem: afterWriteCoverage,
  ItemInstance: afterWriteCoverage,
  ModuleObjective: afterWriteCoverage,
};

/** Runs every check over the batch; throws a 422 carrying all violations. */
export async function checkInvariants(ctx: WriteContext): Promise<void> {
  const violations: Violation[] = [];
  for (const [index, doc] of ctx.batch.entries()) {
    violations.push(...(await checkReferences(doc, index, ctx)));
    const validator = VALIDATORS[doc['@type']];
    if (validator) violations.push(...(await validator(doc, index, ctx)));
  }
  if (violations.length) throw new InvariantError(violations);
}

export async function runAfterWrite(ctx: WriteContext): Promise<void> {
  const seen = new Set<(docs: TerminusDocument[], ctx: WriteContext) => Promise<void>>();
  for (const doc of ctx.batch) {
    const hook = AFTER_WRITE[doc['@type']];
    if (hook && !seen.has(hook)) {
      seen.add(hook);
      await hook(ctx.batch, ctx);
    }
  }
}

/** A reference value's id when it is a plain id, else undefined (`{ "@ref" }` has none yet). */
export const refId = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/**
 * Builds the context the validators read from. `alongside` are documents
 * the same commit will carry without their being part of the client's write,
 * such as the `User` copy of ADR-0032 decision 5: resolvable, not validated.
 */
export function createWriteContext(
  branch: Store,
  batch: TerminusDocument[],
  replacing: Set<string>,
  alongside: TerminusDocument[] = []
): WriteContext {
  const byId = new Map<string, TerminusDocument>();
  const byCapture = new Map<string, TerminusDocument>();
  for (const doc of [...alongside, ...batch]) {
    if (typeof doc['@id'] === 'string' && doc['@id']) byId.set(doc['@id'], doc);
    if (typeof doc['@capture'] === 'string') byCapture.set(doc['@capture'], doc);
  }
  const fromBranch = new Map<string, Promise<TerminusDocument | undefined>>();
  const read = (id: string): Promise<TerminusDocument | undefined> => {
    let p = fromBranch.get(id);
    if (!p) {
      p = branch
        .getDocument(id)
        .then((r) => r.document)
        .catch((err: unknown) => {
          if (err instanceof StoreError && err.type === 'api:DocumentNotFound') return undefined;
          throw err;
        });
      fromBranch.set(id, p);
    }
    return p;
  };
  return {
    branch,
    batch,
    byCapture,
    replacing,
    async resolve(ref) {
      if (typeof ref === 'string') return byId.get(ref) ?? read(ref);
      if (ref && typeof ref === 'object' && typeof (ref as Record<string, unknown>)['@ref'] === 'string') {
        return byCapture.get((ref as Record<string, string>)['@ref']);
      }
      return undefined;
    },
    async siblings(type, template) {
      const { documents } = await branch.queryDocuments(type, template);
      const kept = documents.filter((d) => !replacing.has(d['@id']));
      const added = batch.filter(
        (d) => d['@type'] === type && Object.entries(template).every(([k, v]) => d[k] === v)
      );
      return [...kept, ...added];
    },
  };
}
