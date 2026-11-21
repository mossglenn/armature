/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are read loosely: the assertions name the fields that matter */
/**
 * The ICICLE demo seed (scripts/seed_icicle_demo.js, Version C) held to the
 * hub, over the in-memory file store: the operator's check passes, and every
 * read the demo's script (docs/icicle-demo-script.md) relies on answers as the
 * script says, before and after the beat-3 change. The seed's own COMMITS are
 * loaded, so the authors the history shows are the ones the seed writes.
 * Needs no store server, so it is one of the `files` suites.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkBranch } from '../operator/check';
import { createApp } from './app';
import { configFromEnv } from './config';
import { memoryFiles } from './filestore/files';
import { openFileStore } from './filestore/store';
import { createOperatorStore, type StoreConfig, type TerminusDocument } from './store';
import { IDS, CHANGE, COMMITS } from '../../../scripts/seed_icicle_demo.js';

const DESIGNER = { 'Content-Type': 'application/json', 'Armature-User': 'demo-designer@example.edu' };
/** The design assistant acting for the designer, as the MCP server sends a write (its plan's §7). */
const ASSISTANT = { ...DESIGNER, 'Armature-Agent': 'agent:armature-mcp' };
const local = (id: string) => id.slice(id.indexOf('/') + 1);

let files: StoreConfig;
let hub: ReturnType<typeof createApp>;
const get = async (path: string) => {
  const res = await hub.request(`/api/v1${path}`, { headers: DESIGNER });
  return { status: res.status, body: (await res.json()) as any };
};
const send = async (method: string, path: string, body: unknown, headers: Record<string, string> = DESIGNER) => {
  const res = await hub.request(`/api/v1${path}`, { method, headers, body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
};

beforeAll(async () => {
  const schema = JSON.parse(readFileSync(new URL('../../../schema/schema.json', import.meta.url), 'utf8'));
  files = { files: openFileStore(memoryFiles()) };
  const main = createOperatorStore({ branch: 'main' }, files);
  await main.ensureDatabase();
  await main.replaceSchema(schema, { author: 'admin', message: 'Load Armature schema from schema.json' });
  const written: string[] = [];
  for (const commit of COMMITS) {
    const { commit: id } = await main.insertDocuments(commit.documents(written) as unknown as TerminusDocument[], { author: commit.author, message: commit.message });
    written.push(id);
  }
  hub = createApp(() => ({ ...configFromEnv(), store: () => files }));
});

describe('the seed', () => {
  it('passes the operator check on main, over 50 documents', async () => {
    const report = await checkBranch(createOperatorStore({ branch: 'main' }, files));
    expect(report.violations).toEqual([]);
    expect(report.documents).toBe(50);
  });

  it("beat 1: main's history is the former designer's two commits and the reviewer's, each with its message", async () => {
    const log = await get('/branches/main/log');
    expect(log.body.commits.slice(0, 3).map((c: any) => [c.author, c.message])).toEqual([
      ['User/demo-reviewer', "SME review: the .org item's key affirmed"],
      ['User/former-designer', "Module 2 sketched: tracing claims, built on Module 1's quick lateral check"],
      ['User/former-designer', 'Module 1 designed: checking sources online'],
    ]);
  });

  it('Module 1 is FullyAssessed on every objective; Module 2 is PartiallyAssessed', async () => {
    const m1 = await get(`/intelligence/coverage/${local(IDS.module1)}`);
    expect(m1.status).toBe(200);
    expect(m1.body.objectives.map((o: any) => o.coverage.status)).toEqual(['FullyAssessed', 'FullyAssessed', 'FullyAssessed']);
    const m2 = await get(`/intelligence/coverage/${local(IDS.module2)}`);
    expect(m2.body.objectives.map((o: any) => o.coverage.status)).toEqual(['PartiallyAssessed']);
  });

  it('has no alignment gaps before the change', async () => {
    const a = await get(`/intelligence/alignment?module=${local(IDS.module1)}`);
    expect(a.body.itemsBelowObjective).toEqual([]);
  });

  it("beat 2: the .org item's trace carries its reason, the level note and a current SME verdict", async () => {
    const t = await get(`/intelligence/trace/AssessmentItem/${local(IDS.orgItem)}`);
    expect(t.status).toBe(200);
    // The trace carries each note's summary (its label); the rationale is one more read.
    const note = t.body.annotations.find((a: any) => a.type === 'DesignNote' && a.subject.includes(IDS.orgItem));
    expect(note.label).toBe('Why C is the key of the .org item');
    const doc = await get(`/documents/DesignNote/${local(note.id)}`);
    expect(doc.body.rationale).toContain('Fact-checkers leave a page');
    // The note beat 3 overturns is on the item's objective, so the trace carries it too.
    expect(t.body.annotations.map((a: any) => a.label)).toContain('Apply, not Evaluate, on purpose');
    const att = await get(`/intelligence/attestations/AssessmentItem/${local(IDS.orgItem)}`);
    expect(att.body.summary.byState.Current).toBe(1);
  });

  it('beat 3 (before): the impact read on the lateral-reading objective is six records, the prerequisite from Module 2 among them', async () => {
    const i = await get(`/intelligence/impact/LearningObjective/${local(IDS.o1)}`);
    expect(i.body.references.map((r: any) => `${r.type}.${r.field}`).sort()).toEqual([
      'AssessmentItem.assesses',
      'AssessmentItem.assesses',
      'DesignNote.subject',
      'LearningActivity.targets',
      'ModuleObjective.references',
      'PrerequisiteRecord.prerequisite',
    ]);
  });
});

describe('the demo, on a branch', () => {
  let prereqId = '';

  it('beat 3: the change lands on a branch, keeps its createdBy, and the alignment read flags the two items two levels below', async () => {
    expect((await send('POST', '/branches', { name: 'demo-change', from: { branch: 'main' } })).status).toBe(201);
    const put = await send('PUT', `/documents/LearningObjective/${local(IDS.o1)}?branch=demo-change`, CHANGE);
    expect(put.status).toBe(200);
    expect((await get(`/documents/LearningObjective/${local(IDS.o1)}?branch=demo-change`)).body.createdBy).toBe('User/former-designer');
    const a = await get(`/intelligence/alignment?module=${local(IDS.module1)}&branch=demo-change`);
    expect(a.body.itemsBelowObjective.map((x: any) => [x.item.id, x.levelsBelow]).sort()).toEqual([
      ['AssessmentItem/healthy-living-post', 2],
      ['AssessmentItem/org-site-first-step', 2],
    ]);
  });

  it('beat 3: impact still finds the prerequisite, whose rationale carries the conflicting assumption and whose history names it', async () => {
    const i = await get(`/intelligence/impact/LearningObjective/${local(IDS.o1)}?branch=demo-change`);
    prereqId = i.body.references.find((r: any) => r.type === 'PrerequisiteRecord').id;
    const doc = await get(`/documents/PrerequisiteRecord/${local(prereqId)}?branch=demo-change`);
    expect(doc.body.rationale).toContain('two minutes per hop');
    expect(doc.body.objective).toBe(IDS.o4);
    const history = await get(`/documents/PrerequisiteRecord/${local(prereqId)}/history?branch=demo-change&diff=false`);
    expect(history.body.entries.map((e: any) => e.message)).toEqual(["Module 2 sketched: tracing claims, built on Module 1's quick lateral check"]);
    const sprint = await get(`/intelligence/impact/LearningObjective/${local(IDS.o4)}?branch=demo-change`);
    expect(sprint.body.references.map((r: any) => r.id)).toContain(IDS.tracingSprint);
  });

  it('beat 4: the assistant, acting for the designer, files a finding on the relationship on a proposal branch; both are on the record', async () => {
    expect((await send('POST', '/branches', { name: 'agent-split-objective', from: { branch: 'demo-change' } })).status).toBe(201);
    const f = await send(
      'POST',
      '/documents?branch=agent-split-objective',
      {
        message: 'The raised objective conflicts with the prerequisite Module 2 was built on',
        documents: [{
          '@type': 'DesignFinding',
          '@id': 'DesignFinding/lateral-check-no-longer-quick',
          label: 'Module 2 depends on the quick check this change removes',
          finding: 'Lateral reading is now an Evaluate objective, taught as slow, deliberate weighing. Module 2 tracing chains several quick checks at about two minutes per hop and does not reteach the check, so its prerequisite no longer holds. Consider splitting the objective: keep a quick lateral check at Apply for Module 2, and add the Evaluate objective beside it.',
          subject: [prereqId],
          regarding: IDS.o1,
          confidence: 'High',
          status: 'Open',
        }],
      },
      ASSISTANT
    );
    expect(f.status).toBe(200);
    // The agent is the author and the finding's creator; the hub names the person it acted for.
    const head = (await get('/branches/agent-split-objective')).body.head;
    expect(head.author).toBe(IDS.assistant);
    expect(head.message).toContain('Armature-On-Behalf-Of: demo-designer@example.edu');
    expect((await get('/documents/DesignFinding/lateral-check-no-longer-quick?branch=agent-split-objective')).body.createdBy).toBe(IDS.assistant);
    const i = await get(`/intelligence/impact/PrerequisiteRecord/${local(prereqId)}?branch=agent-split-objective`);
    expect(i.body.references.map((r: any) => r.type)).toContain('DesignFinding');
  });

  it('the branch still passes the operator check after the change and the finding', async () => {
    const report = await checkBranch(createOperatorStore({ branch: 'agent-split-objective' }, files));
    expect(report.violations).toEqual([]);
  });
});
