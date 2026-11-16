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

  it("replaces the email's handle and the identifier's with the person's token, and leaves a branch no handle begins", async () => {
    const out = (await applyProfile(documents, 'pseudonymous', 'a key')).documents;
    const token = (out.find((d) => d['@type'] === 'User')!['@id'] as string).slice('User/'.length);
    const branchOf = (id: string) => out.find((d) => d['@id'] === `Grant/${id}`)!.branch;
    expect(branchOf('new')).toBe(`${token}_unit-3`);
    expect(branchOf('old')).toBe(`${token}_unit-2`);
    expect(branchOf('other')).toBe('someone-else_unit-1');
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
