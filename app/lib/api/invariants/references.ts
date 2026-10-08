import { CLASS_FIELDS, type FieldShape } from '@/lib/types';
import { inheritsFrom } from '../classes';
import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * Constraint 0: every reference field's target must exist and be an instance
 * of the declared class or a subclass of it (ADR-0014, ADR-0017 amended;
 * platform check L found the store checks existence only). Walks into
 * subdocuments, since a fragment could carry a reference. A `{ "@ref" }`
 * must name a capture in the same batch; its class is the captured
 * document's.
 */
export async function checkReferences(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const out: Violation[] = [];
  await walk(doc, doc['@type'], '', index, ctx, out);
  return out;
}

const fieldsOf = (type: string): Record<string, FieldShape> =>
  (CLASS_FIELDS as Record<string, Record<string, FieldShape>>)[type] ?? {};

async function walk(
  node: Record<string, unknown>,
  type: string,
  prefix: string,
  index: number,
  ctx: WriteContext,
  out: Violation[]
): Promise<void> {
  const id = typeof ctx.batch[index]['@id'] === 'string' ? ctx.batch[index]['@id'] : undefined;
  for (const [field, shape] of Object.entries(fieldsOf(type))) {
    const raw = node[field];
    if (raw === undefined) continue;
    const values = shape.many ? (Array.isArray(raw) ? raw : []) : [raw];
    const path = prefix ? `${prefix}.${field}` : field;
    if (shape.kind === 'subdocument') {
      for (const [i, value] of values.entries()) {
        if (value && typeof value === 'object' && typeof (value as Record<string, unknown>)['@type'] === 'string') {
          const sub = value as Record<string, unknown>;
          await walk(sub, sub['@type'] as string, shape.many ? `${path}[${i}]` : path, index, ctx, out);
        }
      }
      continue;
    }
    if (shape.kind !== 'reference') continue;
    for (const [i, value] of values.entries()) {
      const at = shape.many ? `${path}[${i}]` : path;
      const target = await ctx.resolve(value);
      if (!target) {
        const isRef = value && typeof value === 'object';
        out.push({
          code: isRef ? 'unknown_capture' : 'unknown_reference',
          id,
          index,
          field: at,
          message: isRef
            ? `${at} names capture ${String((value as Record<string, unknown>)['@ref'])}, which no document in this write declares`
            : `${at} names ${String(value)}, which does not exist on this branch or in this write`,
        });
        continue;
      }
      if (!inheritsFrom(target['@type'], shape.type)) {
        out.push({
          code: 'reference_class',
          id,
          index,
          field: at,
          message: `${at} must name a ${shape.type}; ${target['@id']} is a ${target['@type']}`,
        });
      }
    }
  }
}
