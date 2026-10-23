/**
 * Ports: an edge attaches by where its other end sits, so edges leaving or
 * arriving at a node take distinct, ordered handles; checked on a small
 * graph and on the fixture laid out.
 */
import { describe, expect, it } from 'vitest';
import { derive } from './derive';
import { FIXTURE } from './fixture';
import { layout } from './layout';
import { assignPorts, portOffset, sourceHandle, targetHandle } from './ports';

const at = (x: number, y: number) => ({ x, y });

describe('ports', () => {
  it('orders a fan by the targets\' height and a bundle by the sources\'', () => {
    const positions = new Map([['o', at(0, 100)], ['top', at(300, 0)], ['mid', at(300, 100)], ['low', at(300, 200)], ['m', at(600, 100)]]);
    const edges = [
      { id: 'o-low', source: 'o', target: 'low' },
      { id: 'o-top', source: 'o', target: 'top' },
      { id: 'o-mid', source: 'o', target: 'mid' },
      { id: 'low-m', source: 'low', target: 'm' },
      { id: 'top-m', source: 'top', target: 'm' },
    ];
    const { edge, node } = assignPorts(edges, positions);
    expect(node.get('o')).toEqual({ sources: 3, targets: 0 });
    expect(edge.get('o-top')!.sourceHandle).toBe(sourceHandle(0));
    expect(edge.get('o-mid')!.sourceHandle).toBe(sourceHandle(1));
    expect(edge.get('o-low')!.sourceHandle).toBe(sourceHandle(2));
    expect(node.get('m')).toEqual({ sources: 0, targets: 2 });
    expect(edge.get('top-m')!.targetHandle).toBe(targetHandle(0));
    expect(edge.get('low-m')!.targetHandle).toBe(targetHandle(1));
    expect(edge.get('o-top')!.targetHandle).toBe(targetHandle(0));
  });

  it('skips an edge whose end is not laid out', () => {
    const { edge, node } = assignPorts([{ id: 'x', source: 'a', target: 'gone' }], new Map([['a', at(0, 0)]]));
    expect(edge.size).toBe(0);
    expect(node.size).toBe(0);
  });

  it('spaces ports evenly with margins, a single port at the center', () => {
    expect(portOffset(0, 1)).toBe(0.5);
    expect([0, 1, 2].map((i) => portOffset(i, 3))).toEqual([0.25, 0.5, 0.75]);
  });

  it('gives every fixture edge two handles within its nodes\' port counts, distinct per node side', () => {
    const graph = derive(FIXTURE);
    const laid = layout(graph.nodes, graph.edges);
    const { edge, node } = assignPorts(graph.edges, laid.positions);
    expect(edge.size).toBe(graph.edges.length);
    const seen = new Set<string>();
    for (const e of graph.edges) {
      const ports = edge.get(e.id)!;
      const out = Number(ports.sourceHandle.replace('out-', ''));
      const inn = Number(ports.targetHandle.replace('in-', ''));
      expect(out).toBeLessThan(node.get(e.source)!.sources);
      expect(inn).toBeLessThan(node.get(e.target)!.targets);
      for (const key of [`${e.source}/${ports.sourceHandle}`, `${e.target}/${ports.targetHandle}`]) {
        expect(seen.has(key), key).toBe(false);
        seen.add(key);
      }
    }
  });
});
