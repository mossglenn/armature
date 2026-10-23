/**
 * The multi-scale dot grid: at every zoom the viewer allows, one layer reads
 * fully at a spacing the eye can use, the dots keep their size on screen, and
 * the layers align so a coarser one's dots fall on a finer one's.
 */
import { describe, expect, it } from 'vitest';
import { GRID_DOTS, GRID_FADE_IN, GRID_FADE_OUT, GRID_GAPS, dotPhase, gridLayers, layerOpacity } from './grid';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 2;

function zooms(): number[] {
  const out: number[] = [];
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z += 0.01) out.push(Number(z.toFixed(2)));
  return out;
}

describe('the dot grid at several scales', () => {
  it('fades a layer in and out by its spacing on screen', () => {
    expect(layerOpacity(0)).toBe(0);
    expect(layerOpacity(GRID_FADE_IN[0])).toBe(0);
    expect(layerOpacity((GRID_FADE_IN[0] + GRID_FADE_IN[1]) / 2)).toBe(0.5);
    expect(layerOpacity(GRID_FADE_IN[1])).toBe(1);
    expect(layerOpacity(GRID_FADE_OUT[0])).toBe(1);
    expect(layerOpacity(GRID_FADE_OUT[1])).toBe(0);
    expect(layerOpacity(1000)).toBe(0);
  });

  it('has one layer fully drawn at a usable spacing at every zoom', () => {
    for (const zoom of zooms()) {
      const full = gridLayers(zoom).filter((l) => l.opacity === 1);
      expect(full.length, `zoom ${zoom}`).toBeGreaterThanOrEqual(1);
      for (const l of full) {
        const screenGap = l.gap * zoom;
        expect(screenGap).toBeGreaterThanOrEqual(GRID_FADE_IN[1]);
        expect(screenGap).toBeLessThanOrEqual(GRID_FADE_OUT[0]);
      }
    }
  });

  it('never draws more than two layers at once, and every opacity is within 0 and 1', () => {
    for (const zoom of zooms()) {
      const layers = gridLayers(zoom);
      expect(layers.filter((l) => l.opacity > 0).length, `zoom ${zoom}`).toBeLessThanOrEqual(2);
      for (const l of layers) {
        expect(l.opacity).toBeGreaterThanOrEqual(0);
        expect(l.opacity).toBeLessThanOrEqual(1);
      }
    }
  });

  it('keeps each dot at its size on screen whatever the zoom', () => {
    for (const zoom of [MIN_ZOOM, 0.42, 1, MAX_ZOOM]) {
      gridLayers(zoom).forEach((l, i) => {
        expect((l.size * zoom) / 2).toBeCloseTo(GRID_DOTS[i], 10);
      });
    }
  });

  it('is finest at the maximum zoom and coarsest at the minimum, the neighbor nearly gone', () => {
    const atMax = gridLayers(MAX_ZOOM);
    expect(atMax.map((l) => l.opacity)).toEqual([1, 0, 0]);
    const atMin = gridLayers(MIN_ZOOM);
    expect(atMin[0].opacity).toBe(0);
    expect(atMin[1].opacity).toBeLessThan(0.15);
    expect(atMin[2].opacity).toBe(1);
  });

  it('hands over quickly: at each handover both layers show over a zoom factor under 1.6', () => {
    // A handover is a contiguous run of zooms at which two layers are visible:
    // the finer fading in below its band while the coarser is full, then the
    // coarser fading out above its band while the finer is full.
    const runs: number[][] = [];
    for (const z of zooms()) {
      const visible = gridLayers(z).filter((l) => l.opacity > 0).length;
      if (visible < 2) continue;
      const last = runs[runs.length - 1];
      if (last && Math.abs(last[last.length - 1] - z) < 0.011) last.push(z);
      else runs.push([z]);
    }
    expect(runs.length).toBe(GRID_GAPS.length - 1);
    for (const run of runs) expect(Math.max(...run) / Math.min(...run)).toBeLessThan(1.6);
  });

  it('draws the finest layer in the near tone and the rest far', () => {
    expect(gridLayers(1).map((l) => l.tone)).toEqual(['near', 'far', 'far']);
  });

  it('aligns the layers: each gap is a multiple of the finer one, with distinct ids', () => {
    for (let i = 1; i < GRID_GAPS.length; i++) expect(GRID_GAPS[i] % GRID_GAPS[i - 1]).toBe(0);
    const ids = gridLayers(1).map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('lands every coarser dot on a finer one, at any zoom and translation', () => {
    for (const zoom of [MIN_ZOOM, 0.42, 0.864, 1, MAX_ZOOM]) {
      for (const translation of [0, 31.65, -200.5, 1234.5]) {
        const layers = gridLayers(zoom);
        const phases = layers.map((l) => dotPhase(l, zoom, translation));
        for (const phase of phases.slice(1)) expect(phase, `zoom ${zoom}, translation ${translation}`).toBeCloseTo(phases[0], 6);
      }
    }
  });
});
