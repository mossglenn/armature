import type { ItemStatus } from '../../types';

/**
 * The coverage algorithm (ADR-0029 decisions 1 to 3; eligibility from
 * ADR-0019), computed on read and never stored (ADR-0056).
 *
 * Coverage is a property of a module's declaration of an objective, counted
 * over the items placed in that module's assessments: an item contributes
 * only when an ItemInstance places it in an Assessment of the module and the
 * item's `assesses` names the objective. The count is of distinct items, so
 * one item placed twice counts once. Two populations share one verdict:
 *
 *   coverage   placements Approved and items Approved: delivered, or cleared to be
 *   projected  neither the placement nor the item Retired: where review is heading
 *
 * The verdict's thresholds are the hub's default cut, provisional (ADR-0029
 * decision 3); the coverage read takes them as parameters and returns the
 * counts beside the verdicts so any client can apply its own. The vocabulary
 * lives here, not in the schema: nothing in the graph stores a verdict.
 */

export const COVERAGE_STATUSES = ['Uncovered', 'PartiallyAssessed', 'FullyAssessed', 'OverAssessed'] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

export interface Thresholds {
  /** Distinct eligible items at which a declaration is FullyAssessed (below it, one item is PartiallyAssessed). */
  fullyAssessedAt: number;
  /** Distinct eligible items above which a declaration is OverAssessed. */
  overAssessedAbove: number;
}

/** The hub's default cut: 0 Uncovered, 1 PartiallyAssessed, 2 to 4 FullyAssessed, 5 or more OverAssessed. */
export const DEFAULT_THRESHOLDS: Thresholds = { fullyAssessedAt: 2, overAssessedAbove: 4 };

/** The verdict for a number of distinct eligible items. */
export function verdict(eligibleItems: number, thresholds: Thresholds = DEFAULT_THRESHOLDS): CoverageStatus {
  if (eligibleItems <= 0) return 'Uncovered';
  if (eligibleItems > thresholds.overAssessedAbove) return 'OverAssessed';
  if (eligibleItems >= thresholds.fullyAssessedAt) return 'FullyAssessed';
  return 'PartiallyAssessed';
}

/** What the algorithm needs from an ItemInstance placed in one of the module's assessments. */
export interface PlacementLike {
  implements: string;
  status: ItemStatus;
}

/** What the algorithm needs from an AssessmentItem. */
export interface ItemLike {
  '@id': string;
  status: ItemStatus;
  assesses: string[];
}

export interface Coverage {
  coverageStatus: CoverageStatus;
  projectedCoverageStatus: CoverageStatus;
  /** Distinct items counted for coverageStatus, in first-placement order. */
  deliveredItems: string[];
  /** Distinct items counted for projectedCoverageStatus, in first-placement order. */
  projectedItems: string[];
}

/** ADR-0029 decision 2: eligible for the delivered figure. */
export const isDelivered = (placement: PlacementLike, item: ItemLike): boolean =>
  placement.status === 'Approved' && item.status === 'Approved';

/** ADR-0029 decision 2: eligible for the projected figure. */
export const isProjected = (placement: PlacementLike, item: ItemLike): boolean =>
  placement.status !== 'Retired' && item.status !== 'Retired';

/**
 * Coverage of `objective` by `placements`, which must be every ItemInstance
 * placed in the module's assessments; `items` resolves a placement's
 * `implements`. A placement whose item is missing from `items` is skipped.
 */
export function coverageOf(
  objective: string,
  placements: readonly PlacementLike[],
  items: ReadonlyMap<string, ItemLike>,
  thresholds: Thresholds = DEFAULT_THRESHOLDS
): Coverage {
  const delivered = new Set<string>();
  const projected = new Set<string>();
  for (const placement of placements) {
    const item = items.get(placement.implements);
    if (!item || !item.assesses.includes(objective)) continue;
    if (isDelivered(placement, item)) delivered.add(item['@id']);
    if (isProjected(placement, item)) projected.add(item['@id']);
  }
  return {
    coverageStatus: verdict(delivered.size, thresholds),
    projectedCoverageStatus: verdict(projected.size, thresholds),
    deliveredItems: [...delivered],
    projectedItems: [...projected],
  };
}
