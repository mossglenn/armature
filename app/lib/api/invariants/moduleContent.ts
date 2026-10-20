import type { TerminusDocument } from '../store';
import { refId, type Violation, type WriteContext } from './index';

/**
 * Module content sequencing (ADR-0005):
 *
 *   3  ModuleActivityLink.sequence and ModuleActivityGroupLink.sequence share
 *      one integer namespace per Module, so a value may appear once across
 *      both types
 *   4  ActivityGroupMember.sequence is unique within its ActivityGroup
 *  17  ActivityItemLink.sequence is unique within its LearningActivity
 *      (formative use of items, ADR-0061)
 *   6  flatness is constraint 0's doing: a member's activity is typed
 *      LearningActivity, which an ActivityGroup is not
 */
export async function validateModuleContentLink(
  doc: TerminusDocument,
  index: number,
  ctx: WriteContext
): Promise<Violation[]> {
  const moduleId = refId(doc.module);
  if (!moduleId || typeof doc.sequence !== 'number') return [];
  const [activities, groups] = await Promise.all([
    ctx.siblings('ModuleActivityLink', { module: moduleId }),
    ctx.siblings('ModuleActivityGroupLink', { module: moduleId }),
  ]);
  const clash = [...activities, ...groups].find((d) => d !== doc && d.sequence === doc.sequence);
  if (!clash) return [];
  return [
    {
      code: 'duplicate_sequence',
      id: typeof doc['@id'] === 'string' ? doc['@id'] : undefined,
      index,
      field: 'sequence',
      message: `sequence ${doc.sequence} is already used in ${moduleId} by ${clash['@id'] ?? 'another link in this write'} (${clash['@type']}); activity and group links share one namespace (ADR-0005)`,
    },
  ];
}

export async function validateActivityGroupMember(
  doc: TerminusDocument,
  index: number,
  ctx: WriteContext
): Promise<Violation[]> {
  const group = refId(doc.group);
  if (!group || typeof doc.sequence !== 'number') return [];
  const members = await ctx.siblings('ActivityGroupMember', { group });
  const clash = members.find((d) => d !== doc && d.sequence === doc.sequence);
  if (!clash) return [];
  return [
    {
      code: 'duplicate_sequence',
      id: typeof doc['@id'] === 'string' ? doc['@id'] : undefined,
      index,
      field: 'sequence',
      message: `sequence ${doc.sequence} is already used in ${group} by ${clash['@id'] ?? 'another member in this write'}`,
    },
  ];
}

export async function validateActivityItemLink(
  doc: TerminusDocument,
  index: number,
  ctx: WriteContext
): Promise<Violation[]> {
  const activity = refId(doc.activity);
  if (!activity || typeof doc.sequence !== 'number') return [];
  const uses = await ctx.siblings('ActivityItemLink', { activity });
  const clash = uses.find((d) => d !== doc && d.sequence === doc.sequence);
  if (!clash) return [];
  return [
    {
      code: 'duplicate_sequence',
      id: typeof doc['@id'] === 'string' ? doc['@id'] : undefined,
      index,
      field: 'sequence',
      message: `sequence ${doc.sequence} is already used in ${activity} by ${clash['@id'] ?? 'another use in this write'}`,
    },
  ];
}
