/** The link the viewer offers (docs/desktop-program-plan.md §8): the program reads it back as a URL, so the address must survive as one parameter. */
import { describe, expect, it } from 'vitest';
import { connectLink } from './viewer';

describe('connectLink', () => {
  it('carries the address as the one parameter of armature://connect', () => {
    const link = new URL(connectLink('https://api.armature.example.edu'));
    expect(link.protocol).toBe('armature:');
    expect(link.host).toBe('connect');
    expect([...link.searchParams.keys()]).toEqual(['remote']);
    expect(link.searchParams.get('remote')).toBe('https://api.armature.example.edu');
  });

  it('keeps an address with a port and a path whole, adding nothing a crafted one could smuggle in', () => {
    const remote = 'http://100.70.195.100:3100/a?b=c&remote=https://elsewhere.example.org#d';
    const link = new URL(connectLink(remote));
    expect(link.searchParams.getAll('remote')).toEqual([remote]);
    expect(link.hash).toBe('');
  });
});
