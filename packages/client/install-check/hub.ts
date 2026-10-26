import { createClient, HubError } from '@armature/client';
import type { LearningObjective } from '@armature/types';

// A hub answered by a stub, so the check needs no server: a list read and a refused write.
export function stubHub() {
  return createClient({
    baseUrl: 'http://hub.test',
    user: 'demo-designer@example.edu',
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'PUT') {
        return Response.json({ error: 'invariant_violation', message: 'refused', violations: [] }, { status: 422 });
      }
      const objective: LearningObjective = { '@id': 'LearningObjective/x', '@type': 'LearningObjective', label: 'Distinguish bias types', state: 'Active', externalRefs: [], attachments: [] };
      return Response.json(url.pathname.endsWith('/documents/LearningObjective') ? [objective] : {}, { headers: { ETag: '"c1"', 'Armature-Version': '2026-10-22' } });
    },
  });
}

export async function check(): Promise<string> {
  const hub = stubHub();
  const { data, commit } = await hub.documents.list('LearningObjective');
  try {
    await hub.documents.put('DesignNote', 'n', { message: 'm', document: { label: 'n', rationale: 'r', subject: ['Module/m'] } });
    return 'a refused write did not throw';
  } catch (err) {
    if (!(err instanceof HubError) || err.code !== 'invariant_violation') throw err;
  }
  return `ok: ${data.length} objective at ${commit}, a refused write is a HubError`;
}
