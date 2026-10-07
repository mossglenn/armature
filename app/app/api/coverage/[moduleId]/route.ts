import type { ModuleObjective, LearningObjective } from '@/lib/types';
import { NextRequest, NextResponse } from 'next/server';
import client from '@/lib/terminusdb';
import { handleTerminusError } from '@/lib/routeHelpers';

/**
 * GET /api/coverage/:moduleId
 *
 * Returns the ModuleObjective junctions for one module, each joined to the
 * label of the LearningObjective it declares. This is the interim Coverage
 * View read; Phase 4 of docs/development-plan.md replaces it with
 * GET /api/v1/intelligence/coverage/:moduleId, which adds the summary block
 * and the items behind each verdict (ADR-0029).
 *
 * Two round trips regardless of module size:
 *   1. ModuleObjectives filtered server-side by a document template query
 *   2. All LearningObjectives in one list read, joined in memory
 *
 * The HTTP document API also accepts an `ids` list parameter, which would
 * make the second read exact; it is not used until verified on the running
 * store, since the client passes URL parameters through unvalidated.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ moduleId: string }> }
) {
    const { moduleId } = await params;
    const moduleRef = `Module/${moduleId}`;

    try {
        const moduleObjectives = (await client.getDocument({
            as_list: true,
            query: { '@type': 'ModuleObjective', module: moduleRef },
        })) as ModuleObjective[];

        if (moduleObjectives.length === 0) {
            return NextResponse.json([]);
        }

        const objectives = (await client.getDocument({
            type: 'LearningObjective',
            as_list: true,
        })) as LearningObjective[];
        const labelById = new Map(objectives.map((o) => [o['@id'], o.label]));

        const results = moduleObjectives.map((mo) => ({
            id: mo.references,
            label: labelById.get(mo.references) ?? null,
            coverageStatus: mo.coverageStatus,
            role: mo.role,
            sequence: mo.sequence,
        }));

        return NextResponse.json(results);
    } catch (error) {
        return handleTerminusError(error, `fetch coverage for ${moduleRef}`);
    }
}
