import type { CoverageStatus, ItemStatus } from '../../types';

/**
 * The coverage algorithm (ADR-0029; eligibility from ADR-0019).
 *
 * Coverage is a property of a module's declaration of an objective, counted
 * over the items placed in that module's assessments: an item contributes
 * only when an ItemInstance places it in an Assessment of the module and the
 * item's `assesses` names the objective. The count is of distinct items, so
 * one item placed twice counts once. Two populations share one verdict:
 *
 *   coverageStatus           placements Approved and items Approved
 *   projectedCoverageStatus  neither the placement nor the item Retired
 *
 * This module is dependency-free on purpose: `scripts/seed_data.js` imports
 * it to compute the seed's coverage with the hub's own rule (ADR-0029
 * decision 7), so it must stay importable by plain Node, which strips the
 * type annotations but resolves nothing but relative type-only imports.
 */

/**
 * `OverAssessed` is more distinct eligible items than this. Provisional
 * (ADR-0029 decision 3): item statistics from the outcomes importer are the
 * first evidence that could move it, and a per-module threshold enters the
 * schema only when two clients need modules to differ.
 */
export const OVER_ASSESSED_ABOVE = 4;

/** The verdict for a number of distinct eligible items (ADR-0029 decision 3). */
export function verdict(eligibleItems: number): CoverageStatus {
  if (eligibleItems <= 0) return 'Uncovered';
  if (eligibleItems === 1) return 'PartiallyAssessed';
  if (eligibleItems > OVER_ASSESSED_ABOVE) return 'OverAssessed';
  return 'FullyAssessed';
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

/** ADR-0029 decision 2: eligible for `coverageStatus`. */
export const isDelivered = (placement: PlacementLike, item: ItemLike): boolean =>
  placement.status === 'Approved' && item.status === 'Approved';

/** ADR-0029 decision 2: eligible for `projectedCoverageStatus`. */
export const isProjected = (placement: PlacementLike, item: ItemLike): boolean =>
  placement.status !== 'Retired' && item.status !== 'Retired';

/**
 * Coverage of `objective` by `placements`, which must be every ItemInstance
 * placed in the module's assessments; `items` resolves a placement's
 * `implements`. A placement whose item is missing from `items` is skipped:
 * the invariants engine has already refused a dangling reference, and the
 * seed has every item in memory.
 */
export function coverageOf(
  objective: string,
  placements: readonly PlacementLike[],
  items: ReadonlyMap<string, ItemLike>
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
    coverageStatus: verdict(delivered.size),
    projectedCoverageStatus: verdict(projected.size),
    deliveredItems: [...delivered],
    projectedItems: [...projected],
  };
}
