// A workspace branch's handle (ADR-0065; docs/api.md, Workspace; decided 2026-11-08 after the
// Keycloak rehearsal of the desktop program found a branch named for a UUID): taken from the
// person's email when the record has one, else from the external identifier, and rewritten in
// either form by the pseudonymous export. Pure: no store, no hub.

import { describe, expect, it } from 'vitest';
import { applyProfile } from './export/exporter';
import { handleFor, handleOf } from './identity';
import type { TerminusDocument } from './store';

const SUB = 'fcf303f1-4194-485e-b8e7-4e4ca72ca809';

describe("a workspace branch's handle", () => {
  it("is the email's local part when the record has one, so a provider's opaque sub stays out of the name", () => {
    expect(handleFor({ externalId: SUB, email: 'designer@example.edu' })).toBe('designer');
    expect(handleFor({ externalId: SUB, email: 'Pat.O+Brien@example.edu' })).toBe('Pat.O-Brien');
  });

  it('falls back on the external identifier when there is no email, or an empty one', () => {
    expect(handleFor({ externalId: SUB })).toBe(SUB);
    expect(handleFor({ externalId: SUB, email: '  ' })).toBe(SUB);
    expect(handleFor({ externalId: 'agent:quiver-drafter', email: null })).toBe(handleOf('agent:quiver-drafter'));
  });

  it('is unchanged under header, where the email is the identifier', () => {
    expect(handleFor({ externalId: 'demo-designer@example.edu', email: 'demo-designer@example.edu' })).toBe('demo-designer');
    expect(handleFor({ externalId: 'demo-designer@example.edu' })).toBe(handleOf('demo-designer@example.edu'));
  });
});

describe('the pseudonymous export rewrites either handle in a grant\'s branch', () => {
  const grant = (id: string, branch: string): TerminusDocument => ({
    '@type': 'Grant',
    '@id': `Grant/${id}`,
    user: 'User/kc-designer',
    role: 'Owner',
    branch,
    status: 'Active',
    rationale: 'r',
  });
  const documents: TerminusDocument[] = [
    { '@type': 'User', '@id': 'User/kc-designer', displayName: 'Demo Designer', externalId: SUB, email: 'designer@example.edu' },
    grant('new', 'designer_unit-3'),
    grant('old', `${SUB}_unit-2`),
    grant('other', 'someone-else_unit-1'),
  ];

  it("replaces the email's handle and the identifier's with the person's token, and keeps nothing of a name that begins with neither", async () => {
    const out = (await applyProfile(documents, 'pseudonymous', 'a key')).documents;
    const token = (out.find((d) => d['@type'] === 'User')!['@id'] as string).slice('User/'.length);
    const branchOf = (id: string) => out.find((d) => d['@id'] === `Grant/${id}`)!.branch;
    expect(branchOf('new')).toBe(`${token}_unit-3`);
    expect(branchOf('old')).toBe(`${token}_unit-2`);
    // Owned by the designer and beginning with no handle of theirs: an earlier email's, for all the export can tell.
    expect(branchOf('other')).toMatch(new RegExp(`^${token}_[0-9a-f]{16}$`));
    expect(JSON.stringify(out)).not.toContain('someone-else');
    expect(JSON.stringify(out)).not.toContain('designer@');
    expect(JSON.stringify(out)).not.toContain(SUB);
  });

  it("does the same in a check requirement's branch and fromPrefix, and leaves its params as stored (ADR-0070 decision 5)", async () => {
    const requirement = (id: string, fields: Record<string, unknown>): TerminusDocument => ({
      '@type': 'CheckRequirement',
      '@id': `CheckRequirement/${id}`,
      check: 'lint/team',
      reporter: 'User/lint',
      level: 'Required',
      locked: false,
      params: { severity: 'error' },
      status: 'Active',
      ...fields,
    });
    const withRequirements: TerminusDocument[] = [
      ...documents,
      { '@type': 'User', '@id': 'User/lint', displayName: 'Lint', externalId: 'agent:lint/team' },
      requirement('mine', { branch: 'designer_unit-3', fromPrefix: `${SUB}_` }),
      requirement('rounds', { fromPrefix: 'coqui-' }),
    ];
    const out = (await applyProfile(withRequirements, 'pseudonymous', 'a key')).documents;
    const token = (out[0]['@id'] as string).slice('User/'.length); // the designer, first in `documents`
    const mine = out.find((d) => d['@id'] === 'CheckRequirement/mine')!;
    expect(mine.branch).toBe(`${token}_unit-3`);
    expect(mine.fromPrefix).toBe(`${token}_`);
    expect(mine.reporter).toMatch(/^User\/[0-9a-f]{32}$/);
    expect(mine.params).toEqual({ severity: 'error' });
    const rounds = out.find((d) => d['@id'] === 'CheckRequirement/rounds')!;
    expect(rounds.fromPrefix).toBe('coqui-');
    expect(rounds.branch).toBeUndefined();
    expect(JSON.stringify(out)).not.toContain(SUB);
  });
});

describe("whose a branch is comes from its Owner grant, not from its name (the 2026-11-09 review's E1; ADR-0031, note of 2026-11-16)", () => {
  const owner = (id: string, user: string, branch: string): TerminusDocument => ({ '@type': 'Grant', '@id': `Grant/${id}`, user, role: 'Owner', branch, status: 'Active', rationale: 'r' });
  const tokenOf = (out: TerminusDocument[], index: number) => (out[index]['@id'] as string).slice('User/'.length);
  const branchOf = (out: TerminusDocument[], id: string) => out.find((d) => d['@id'] === `Grant/${id}`)!.branch as string;

  it("keeps an earlier email's local part out of the export after the email was corrected", async () => {
    const documents: TerminusDocument[] = [
      // Registered as pat.obrien@, the branch made, then the email corrected.
      { '@type': 'User', '@id': 'User/pat', displayName: 'Pat', externalId: SUB, email: 'pat.o-brien@example.edu' },
      owner('before', 'User/pat', 'pat.obrien_unit-1'),
      owner('after', 'User/pat', 'pat.o-brien_unit-2'),
      { '@type': 'Grant', '@id': 'Grant/shared', user: 'User/pat', role: 'Maintainer', branch: 'pat.obrien_unit-1', status: 'Active', rationale: 'r' },
    ];
    const out = (await applyProfile(documents, 'pseudonymous', 'a key')).documents;
    const token = tokenOf(out, 0);
    expect(branchOf(out, 'after')).toBe(`${token}_unit-2`);
    expect(branchOf(out, 'before')).toMatch(new RegExp(`^${token}_[0-9a-f]{16}$`));
    // Every record naming the branch names it alike, so the grants on one branch still read as one branch's.
    expect(branchOf(out, 'shared')).toBe(branchOf(out, 'before'));
    expect(JSON.stringify(out)).not.toContain('obrien');
    // The same key, the same names: a corpus compares across exports.
    expect((await applyProfile(documents, 'pseudonymous', 'a key')).documents).toEqual(out);
  });

  it("gives each of two people whose emails share a local part their own branches", async () => {
    const documents: TerminusDocument[] = [
      { '@type': 'User', '@id': 'User/alice-a', displayName: 'Alice A', externalId: 'sub-a', email: 'alice@a.example.edu' },
      { '@type': 'User', '@id': 'User/alice-b', displayName: 'Alice B', externalId: 'sub-b', email: 'alice@b.example.edu' },
      owner('a', 'User/alice-a', 'alice_unit-1'),
      owner('b', 'User/alice-b', 'alice_unit-2'),
      // A requirement's fromPrefix has no owner: a handle two people share is nobody's in particular.
      { '@type': 'CheckRequirement', '@id': 'CheckRequirement/r', check: 'lint/x', reporter: 'User/alice-a', level: 'Required', locked: false, status: 'Active', fromPrefix: 'alice_' },
    ];
    const out = (await applyProfile(documents, 'pseudonymous', 'a key')).documents;
    expect(branchOf(out, 'a')).toBe(`${tokenOf(out, 0)}_unit-1`);
    expect(branchOf(out, 'b')).toBe(`${tokenOf(out, 1)}_unit-2`);
    expect(tokenOf(out, 0)).not.toBe(tokenOf(out, 1));
    expect(out.find((d) => d['@type'] === 'CheckRequirement')!.fromPrefix).toMatch(/^branch-[0-9a-f]{16}$/);
    expect(JSON.stringify(out)).not.toContain('alice');
  });

  it('leaves a name that is no workspace\'s as it is, and keeps none of an unowned one that may begin with a handle', async () => {
    const documents: TerminusDocument[] = [
      { '@type': 'User', '@id': 'User/pat', displayName: 'Pat', externalId: SUB, email: 'pat@example.edu' },
      owner('plain', 'User/pat', 'spring-pilot'),
      { '@type': 'Grant', '@id': 'Grant/unowned', user: 'User/pat', role: 'Maintainer', branch: 'former.colleague_unit-9', status: 'Active', rationale: 'r' },
      { '@type': 'Grant', '@id': 'Grant/every', user: 'User/pat', role: 'Maintainer', status: 'Active', rationale: 'r' },
    ];
    const out = (await applyProfile(documents, 'pseudonymous', 'a key')).documents;
    expect(branchOf(out, 'plain')).toBe('spring-pilot');
    expect(branchOf(out, 'unowned')).toMatch(/^branch-[0-9a-f]{16}$/);
    expect(out.find((d) => d['@id'] === 'Grant/every')!.branch).toBeUndefined();
    // The full profile changes nothing.
    expect((await applyProfile(documents, 'full', undefined)).documents).toBe(documents);
  });
});
