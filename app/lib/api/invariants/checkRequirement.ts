import { isAgentExternalId } from '../identity';
import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * CheckRequirement (ADR-0070 decision 5), constraint 24: the reporter is an
 * agent. A run counts toward a requirement only when its reporter is the
 * agent the requirement names (decision 4), and on a remote hub that is a
 * service holding its own credential (ADR-0067 decision 4), which reads and
 * posts runs and never writes the graph. A person named as the reporter would
 * make a person's own verdict the gate, which is an override with a reason
 * (decision 6), not a check.
 *
 * Where the record is (`main`, constraint 23) is the pipeline's; the
 * reporter's class is constraint 0; who may write a requirement is ADR-0068
 * decision 4's table as ADR-0070 decision 5 extends it.
 */
export async function validateCheckRequirement(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const reporter = await ctx.resolve(doc.reporter);
  if (!reporter || reporter['@type'] !== 'User' || isAgentExternalId(reporter.externalId)) return [];
  return [
    {
      code: 'reporter_not_agent',
      id: typeof doc['@id'] === 'string' ? doc['@id'] : undefined,
      index,
      field: 'reporter',
      message: `A requirement's reporter is the agent whose runs count; ${reporter['@id']} is a person (ADR-0070 decision 5)`,
    },
  ];
}
