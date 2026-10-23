/**
 * The canvas's dot grid at several scales (docs/visual-language.md § "Type and
 * surfaces", 2026-10-23). React Flow draws a dot pattern in canvas units, so
 * one grid reads only in a narrow band of zoom: too fine below it, too
 * sparse above. Three grids at a ratio of 4 cover the viewer's zoom range
 * (0.15 to 2): a layer is fully drawn while its spacing on screen is between
 * 18 and 72 pixels, a ratio of 4, so at every zoom exactly one layer reads
 * fully; it fades in over the 4 pixels below that band and out over the 16
 * above it, so the handover is quick and a neighbor shows only briefly. The
 * gaps are multiples of one another, so a coarser layer's dots sit on the
 * finer layer's, slightly larger, as major marks; the coarser layers are
 * drawn a tone lighter, since they stand on an emptier canvas. Every dot is
 * drawn at a fixed size on screen, whatever the zoom, since a dot in canvas
 * units vanishes when zoomed out.
 *
 * React Flow draws each layer's dot at the corner of a tile it has shifted
 * back by half the layer's gap (and by `offset`), so two layers with
 * different gaps land half a fine gap apart. Each layer's offset undoes
 * its own half-gap shift relative to the finest layer's, and the quarter
 * pixel between dot radii, so every coarser dot falls on a finer one.
 */

/** The layers' spacing in canvas units, finest first. */
export const GRID_GAPS = [24, 96, 384] as const;

/** Each layer's dot radius on screen, in pixels, finest first. */
export const GRID_DOTS = [1, 1.25, 1.5] as const;

/** Each layer's tone, finest first: the viewer maps it to a color. */
export const GRID_TONES = ['near', 'far', 'far'] as const;
export type GridTone = (typeof GRID_TONES)[number];

/** Spacing on screen, in pixels, over which a layer appears and disappears. */
export const GRID_FADE_IN: readonly [number, number] = [14, 18];
export const GRID_FADE_OUT: readonly [number, number] = [72, 88];

export interface GridLayer {
  /** Distinct per layer, for React Flow's pattern ids. */
  id: string;
  /** Spacing in canvas units. */
  gap: number;
  /** Dot diameter in canvas units, chosen so the dot keeps its size on screen. */
  size: number;
  /** Shift in canvas units that lines the layer's dots up with the finest layer's. */
  offset: number;
  /** The layer's tone: the finest is drawn darker than the rest. */
  tone: GridTone;
  /** 0 to 1, by the layer's spacing on screen. */
  opacity: number;
}

function ramp(value: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (value - from) / (to - from)));
}

/** A layer's opacity at a spacing on screen: in over GRID_FADE_IN, out over GRID_FADE_OUT. */
export function layerOpacity(screenGap: number): number {
  return ramp(screenGap, GRID_FADE_IN[0], GRID_FADE_IN[1]) * (1 - ramp(screenGap, GRID_FADE_OUT[0], GRID_FADE_OUT[1]));
}

/** The layers to draw at a zoom, finest first; every layer is listed, at its opacity. */
export function gridLayers(zoom: number): GridLayer[] {
  const fine = GRID_GAPS[0];
  return GRID_GAPS.map((gap, i) => ({
    id: `grid-${gap}`,
    gap,
    size: (2 * GRID_DOTS[i]) / zoom,
    offset: (((fine - gap) / 2) % fine + fine) % fine + (GRID_DOTS[i] - GRID_DOTS[0]) / zoom,
    tone: GRID_TONES[i],
    opacity: layerOpacity(gap * zoom),
  }));
}

/**
 * Where a layer's dots fall on screen along one axis, modulo the finest
 * layer's spacing, given the viewport's translation: React Flow's tile
 * starts at `translation % gap`, is moved back by `offset * zoom + gap / 2`,
 * and holds its dot at `radius`. The test uses it to show the layers align;
 * the browser test checks the same against the drawn pattern.
 */
export function dotPhase(layer: GridLayer, zoom: number, translation: number): number {
  const screenGap = layer.gap * zoom;
  const radius = (layer.size * zoom) / 2;
  const position = (translation % screenGap) - (layer.offset * zoom + screenGap / 2) + radius;
  const fine = GRID_GAPS[0] * zoom;
  return ((position % fine) + fine) % fine;
}
