import { isAgentExternalId } from '../identity';
import type { TerminusDocument } from '../store';
import type { Violation, WriteContext } from './index';

/**
 * Grant (ADR-0068 decision 2 and its note of 2026-10-30), constraint 22: the
 * holder's kind suits the role.
 *
 *   - `Maintainer` and `Administrator` are held by persons only: an agent
 *     is one grant from `main` otherwise (ADR-0067 decision 10's reasons)
 *   - `Relay` is held by agents only: it lets a service deliver a person's
 *     earlier work, and a person needs no grant to write their own
 *   - `Owner` is either: an agent acting on its own owns the branch it made
 *   - `relayedUsers` narrows a `Relay` grant to the persons the service may
 *     speak for, so it is refused on any other role and may name no agent
 *
 * Where the holder is (`main`, constraint 21) and who may write a grant
 * (decision 4) are the pipeline's and the permission check's; the holder's
 * class is constraint 0.
 */
const PERSON_ROLES = new Set(['Maintainer', 'Administrator']);

export async function validateGrant(doc: TerminusDocument, index: number, ctx: WriteContext): Promise<Violation[]> {
  const out: Violation[] = [];
  const id = typeof doc['@id'] === 'string' ? doc['@id'] : undefined;
  const role = String(doc.role);

  const holder = await ctx.resolve(doc.user);
  if (holder && holder['@type'] === 'User') {
    const agent = isAgentExternalId(holder.externalId);
    if (PERSON_ROLES.has(role) && agent) {
      out.push({
        code: 'grant_holder_kind',
        id,
        index,
        field: 'user',
        message: `${role} is held by persons only; ${holder['@id']} is an agent (ADR-0068 decision 2)`,
      });
    }
    if (role === 'Relay' && !agent) {
      out.push({
        code: 'grant_holder_kind',
        id,
        index,
        field: 'user',
        message: `Relay is held by agents only, the services that deliver a person's earlier work; ${holder['@id']} is a person (ADR-0068 decision 2)`,
      });
    }
  }

  const relayed = Array.isArray(doc.relayedUsers) ? doc.relayedUsers : [];
  if (relayed.length && role !== 'Relay') {
    out.push({
      code: 'relayed_users_not_relay',
      id,
      index,
      field: 'relayedUsers',
      message: `relayedUsers names whom a Relay grant may speak for; this grant is ${role} (ADR-0068 decision 2, note)`,
    });
  }
  for (const [i, ref] of relayed.entries()) {
    const person = await ctx.resolve(ref);
    if (person && person['@type'] === 'User' && isAgentExternalId(person.externalId)) {
      out.push({
        code: 'grant_holder_kind',
        id,
        index,
        field: `relayedUsers[${i}]`,
        message: `a relay speaks for persons; ${person['@id']} is an agent (ADR-0067 decision 5)`,
      });
    }
  }
  return out;
}
