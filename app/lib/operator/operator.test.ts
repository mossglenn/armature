/**
 * The operator tools (ADR-0062): `check` over a branch, `delete` and `put` as
 * commits by the operator's User. One scratch branch walks a repair end to
 * end: a state the rules refuse is written with `put --unchecked`, `check`
 * finds it, the checked `put` would have refused it, a checked `put` repairs
 * it, and `delete` removes the record, which stays readable at the commit
 * before. The seed on `main` is checked as a whole and must break no rule.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app } from '../api/app';
import { InvariantError } from '../api/invariants';
import { createStore, StoreError } from '../api/store';
import { checkBranch, WRITE_ONLY_RULES } from './check';
import { deleteDocument, deleteScratchBranch, OperatorError, operatorMetadata, putDocuments, UNCHECKED_NOTE } from './repair';

const stamp = Date.now().toString(36);
const BRANCH = `test-operator-${stamp}`;
const OPERATOR = 'demo-designer@example.edu';
const OBJECTIVE = 'LearningObjective/distinguish-ai-approaches';
const FINDING = `DesignFinding/operator-${stamp}`;

const dismissed = (extra: Record<string, unknown> = {}) => ({
  '@id': FINDING,
  '@type': 'DesignFinding',
  label: 'Overlaps another objective',
  finding: 'This objective restates part of its neighbor.',
  subject: [OBJECTIVE],
  status: 'Dismissed',
  ...extra,
});

describe('check', () => {
  it('finds no violation in the seed on main', async () => {
    const report = await checkBranch(createStore({ branch: 'main' }));
    expect(report.documents).toBeGreaterThan(0);
    expect(report.commit).toMatch(/^[a-z0-9]+$/);
    expect(report.violations).toEqual([]);
    expect(report.skipped.map((s) => s.code)).toEqual([...WRITE_ONLY_RULES.keys()]);
  });

  it('checks a commit as it checks a branch', async () => {
    const head = await createStore({ branch: 'main' }).head();
    const report = await checkBranch(createStore({ commit: head!.id }));
    expect(report.commit).toBe(head!.id);
    expect(report.violations).toEqual([]);
  });
});

describe('a repair on a scratch branch', () => {
  const branch = createStore({ branch: BRANCH });

  beforeAll(async () => {
    await createStore({ branch: 'main' }).createBranch(BRANCH, { branch: 'main' });
  });

  afterAll(async () => {
    await createStore({ branch: 'main' }).deleteBranch(BRANCH).catch(() => undefined);
  });

  it('refuses an operator who is not a registered User, a repair without a reason, and an empty write', async () => {
    await expect(putDocuments({ branch: BRANCH, documents: [], as: OPERATOR, reason: 'x' })).rejects.toBeInstanceOf(OperatorError);
    await expect(
      putDocuments({ branch: BRANCH, documents: [dismissed()], as: `nobody-${stamp}@example.edu`, reason: 'x' })
    ).rejects.toBeInstanceOf(OperatorError);
    await expect(putDocuments({ branch: BRANCH, documents: [dismissed()], as: OPERATOR, reason: '  ' })).rejects.toBeInstanceOf(
      OperatorError
    );
  });

  it('writes what the rules refuse only when told to skip them, and the commit says so', async () => {
    const refused = putDocuments({ branch: BRANCH, documents: [dismissed()], as: OPERATOR, reason: 'Record a dismissal' });
    await expect(refused).rejects.toBeInstanceOf(InvariantError);
    await expect(refused).rejects.toMatchObject({ violations: [{ code: 'rationale_required', id: FINDING }] });

    const { commit, ids } = await putDocuments({
      branch: BRANCH,
      documents: [dismissed()],
      as: OPERATOR,
      reason: 'Reproduce an imported dismissal',
      unchecked: true,
    });
    expect(ids).toEqual([FINDING]);
    const head = await branch.head();
    expect(head?.id).toBe(commit);
    expect(head?.message).toBe(`Reproduce an imported dismissal ${UNCHECKED_NOTE}`);
    expect(head?.author).toMatch(/^User\//);
    expect(head?.metadata).toEqual(operatorMetadata({ tool: 'put', rulesSkipped: true }));
    // Provenance still applied: createdBy and asOf are filled as on /api/v1.
    const { document } = await branch.getDocument(FINDING);
    expect(document.createdBy).toBe(head?.author);
    expect(document.asOf).toMatch(/^[a-z0-9]+$/);
  });

  it('finds the broken rule with check, and only that one', async () => {
    const report = await checkBranch(branch);
    expect(report.violations).toEqual([expect.objectContaining({ code: 'rationale_required', id: FINDING, field: 'resolutionRationale' })]);
  });

  it('repairs it with a checked put, after which check is clean', async () => {
    await putDocuments({
      branch: BRANCH,
      documents: [dismissed({ resolutionRationale: 'The neighbor is retired next term.' })],
      as: OPERATOR,
      reason: 'Give the dismissal its rationale',
    });
    expect((await branch.head())?.metadata).toEqual(operatorMetadata({ tool: 'put', rulesSkipped: false }));
    expect((await checkBranch(branch)).violations).toEqual([]);
  });

  it('deletes a document as a commit by the operator; it stays readable at the commit before', async () => {
    const { commit, before } = await deleteDocument({ branch: BRANCH, id: FINDING, as: OPERATOR, reason: 'Remove the test finding' });
    const head = await branch.head();
    expect(head?.id).toBe(commit);
    expect(head?.message).toBe('Remove the test finding');
    expect(head?.author).toMatch(/^User\//);
    expect(head?.metadata).toEqual(operatorMetadata({ tool: 'delete', rulesSkipped: false }));
    expect(head?.parent).toBe(before!.id);
    await expect(branch.getDocument(FINDING)).rejects.toMatchObject({ type: 'api:DocumentNotFound' });
    const atBefore = await createStore({ commit: before!.id }).getDocument(FINDING);
    expect(atBefore.document['@id']).toBe(FINDING);
  });

  it('leaves a deleted id absent to the API and free to write again', async () => {
    // The store answers a GET of a deleted document with HTTP 200 and the 404
    // as text in the body (check AC4); the adapter must read it as the 404.
    const res = await app.request(`/api/v1/documents/DesignFinding/operator-${stamp}?branch=${BRANCH}`);
    expect(res.status).toBe(404);
    // An id a delete cleared is the point of deleting it (constraint 12).
    const { ids } = await putDocuments({
      branch: BRANCH,
      documents: [dismissed({ resolutionRationale: 'Written again after the delete.' })],
      as: OPERATOR,
      reason: 'Write the cleared id again',
    });
    expect(ids).toEqual([FINDING]);
    await deleteDocument({ branch: BRANCH, id: FINDING, as: OPERATOR, reason: 'Remove it again' });
  });

  it('cannot delete a document another one references: the store refuses it', async () => {
    const head = await branch.head();
    const refused = deleteDocument({ branch: BRANCH, id: OBJECTIVE, as: OPERATOR, reason: 'Try to delete a referenced objective' });
    await expect(refused).rejects.toBeInstanceOf(StoreError);
    expect((await branch.head())?.id).toBe(head?.id);
  });

  it('leaves no transient branch behind, whether a repair lands or is refused', async () => {
    const names = await createStore({ branch: 'main' }).listBranches();
    expect(names.filter((n) => n.startsWith('operator-'))).toEqual([]);
  });
});

describe('scratch branches', () => {
  it('refuses a branch without a scratch prefix, main above all', async () => {
    await expect(deleteScratchBranch('main')).rejects.toBeInstanceOf(OperatorError);
    await expect(deleteScratchBranch(`round-${stamp}`)).rejects.toBeInstanceOf(OperatorError);
  });

  it('deletes a scratch branch and returns its head', async () => {
    const name = `test-operator-scratch-${stamp}`;
    const main = createStore({ branch: 'main' });
    await main.createBranch(name, { branch: 'main' });
    const { head } = await deleteScratchBranch(name);
    expect(head?.id).toBe((await main.head())?.id);
    expect(await main.listBranches()).not.toContain(name);
  });
});

describe('the skip stays operator-only', () => {
  it('no module of the API but the pipeline itself mentions skipping the invariants', () => {
    const root = join(__dirname, '..', 'api');
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter(
      (f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'write.ts'
    );
    const offenders = files.filter((f) => /invariants\s*:\s*['"]skip['"]/.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
