import { describe, expect, it } from 'vitest';
import { historyEntries, parseMessage } from './history';

const people = [
  { '@id': 'User/former-designer', displayName: 'Former Designer', externalId: 'former-designer@example.edu' },
  { '@id': 'User/demo-designer', displayName: 'Demo Designer', externalId: 'demo-designer@example.edu' },
  { '@id': 'User/design-assistant', displayName: 'Design assistant (AI)', externalId: 'agent:armature-mcp' },
];
const commit = (author: string, message: string, extra: Record<string, unknown> = {}) => ({ commit: `c-${message.length}`, author, message, timestamp: 1_790_000_000, ...extra });

describe('parseMessage', () => {
  it('splits the first line, the body and the trailers of the last paragraph', () => {
    expect(parseMessage('Raise the objective\n\nThe liaison asked.\nSecond line.\n\nArmature-On-Behalf-Of: demo-designer@example.edu\nArmature-Check: lint pass run=1 params=sha256:ab')).toEqual({
      title: 'Raise the objective',
      body: 'The liaison asked.\nSecond line.',
      trailers: [
        { key: 'Armature-On-Behalf-Of', value: 'demo-designer@example.edu' },
        { key: 'Armature-Check', value: 'lint pass run=1 params=sha256:ab' },
      ],
    });
  });

  it('takes no trailers from a one-paragraph message, or from a last paragraph that is prose', () => {
    expect(parseMessage('Note: a first line that reads like a trailer')).toEqual({ title: 'Note: a first line that reads like a trailer', trailers: [] });
    expect(parseMessage('Title\n\nA closing paragraph: with a colon, and more words after it.\nand a second line')).toEqual({
      title: 'Title',
      body: 'A closing paragraph: with a colon, and more words after it.\nand a second line',
      trailers: [],
    });
  });
});

describe('historyEntries', () => {
  it('names each author from the registry, an agent as an agent, and the person it acted for', () => {
    const [entry] = historyEntries([commit('User/design-assistant', 'File a finding\n\nArmature-On-Behalf-Of: demo-designer@example.edu')], people);
    expect(entry.author).toEqual({ id: 'User/design-assistant', name: 'Design assistant (AI)', agent: true, setUp: false });
    expect(entry.onBehalfOf).toBe('Demo Designer');
    expect(entry.title).toBe('File a finding');
  });

  it("names an author the registry lacks by the id's local part, and the store's own user as setting up", () => {
    const [unknown, store] = historyEntries([commit('User/someone-else', 'Edit'), commit('admin', 'Load Armature schema from schema.json')], people);
    expect(unknown.author).toEqual({ id: 'User/someone-else', name: 'someone-else', agent: false, setUp: false });
    expect(store.author).toEqual({ id: 'admin', name: 'admin', agent: false, setUp: true });
  });

  it("keeps an on-behalf-of person the registry lacks by their externalId, and reads a merge's source from its metadata", () => {
    const [entry] = historyEntries([commit('User/demo-designer', 'Merge a round\n\nArmature-On-Behalf-Of: gone@example.edu', { metadata: { armature: { mergeSource: 'src123' } } })], people);
    expect(entry.onBehalfOf).toBe('gone@example.edu');
    expect(entry.mergeSource).toBe('src123');
  });
});
