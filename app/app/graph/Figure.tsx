'use client';

import { Glyph } from './ArmatureNode';
import { Legend } from './LensRail';
import type { LegendClass } from './FilterRail';
import type { LensView } from '@/lib/graph/lenses';
import { hueOf } from '@/lib/graph/stages';

/**
 * Figure mode (docs/graph-view-plan.md §3.4, §11): a state of the Graph, the
 * Focus page and the Walkthrough for a figure in a paper or a slide. The
 * canvas turns light whatever the viewer's theme, loses its grid, controls
 * and minimap, sets its labels a size larger, and carries a stamp naming the
 * branch, the commit, the view's query and the date, so the figure can be
 * reproduced from the export at that commit (the visual language's seventh
 * principle). An optional legend tile lists the classes drawn and, under a
 * lens, the lens's legend. The export is what the canvas shows, as PNG at 2×
 * or 3× device pixels through html-to-image, React Flow's documented path;
 * the stamp and the tile are inside the canvas and so inside the picture.
 */
export function figureStamp(opts: { branch: string; atRef?: string; commit?: string; path: string; query: URLSearchParams; date?: Date }): string {
  const q = new URLSearchParams(opts.query);
  q.delete('figure');
  q.delete('legend');
  const where = opts.atRef ? `@ ${opts.atRef.slice(0, 8)}` : `${opts.branch}${opts.commit ? ` @ ${opts.commit.slice(0, 8)}` : ''}`;
  const view = `${opts.path}${q.size ? `?${q}` : ''}`;
  // The reader's own date, not UTC's.
  const d = opts.date ?? new Date();
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `Armature · ${where} · ${view} · ${date}`;
}

export function FigureStamp({ text }: { text: string }) {
  return (
    <div className="gfigure-stamp pointer-events-none absolute bottom-2 left-3 z-10 max-w-[80%] truncate font-mono text-[11px] text-zinc-500" aria-label="Figure stamp">
      {text}
    </div>
  );
}

export function FigureLegend({ classes, view }: { classes: LegendClass[]; view?: LensView }) {
  const artifacts = classes.filter((c) => c.category === 'artifact');
  return (
    <div className="gfigure-legend absolute top-10 right-3 z-10 w-56 rounded border border-zinc-200 bg-white/95 p-2.5 text-zinc-800" aria-label="Figure legend">
      <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Records</div>
      <ul className="space-y-0.5">
        {artifacts.map((c) => (
          <li key={c.cls} className="flex items-center gap-2 text-[11.5px]">
            <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm text-white" style={{ background: hueOf(c.cls).light }}>
              <Glyph cls={c.cls} className="h-2.5 w-2.5" />
            </span>
            <span>{c.cls}</span>
            <span className="ml-auto font-mono text-[10.5px] tabular-nums text-zinc-500">{c.count}</span>
          </li>
        ))}
      </ul>
      {view && (
        <div className="mt-2 border-t border-zinc-200 pt-2">
          <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Lens · {view.lens}</div>
          <Legend view={{ ...view, notes: [] }} />
        </div>
      )}
    </div>
  );
}

/**
 * The properties the stylesheet gives SVG content (edge paths, labels, the
 * arrowheads, the glyphs). html-to-image 1.11 deep-clones an `<svg>` and
 * inlines computed styles on the `<svg>` element alone, not on its children,
 * so a stroke that comes from a stylesheet is lost and every edge vanishes
 * from the picture (seen 2026-10-23). The capture inlines them first.
 */
const SVG_STYLE_PROPERTIES = ['stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'fill', 'fill-opacity', 'opacity', 'font-family', 'font-size', 'font-weight', 'color', 'visibility'];

function inlineSvgStyles(root: HTMLElement): () => void {
  const touched: Array<[Element, string | null]> = [];
  for (const el of root.querySelectorAll<SVGElement>('svg *:not(defs *)')) {
    const computed = getComputedStyle(el);
    touched.push([el, el.getAttribute('style')]);
    for (const name of SVG_STYLE_PROPERTIES) el.style.setProperty(name, computed.getPropertyValue(name));
  }
  // The arrowheads live in <defs>, where nothing is rendered and the computed
  // style reads "none"; they take the edge color the stylesheet gives them
  // unless React Flow colored one inline (a lens's marked edge).
  const edgeColor = getComputedStyle(root).getPropertyValue('--graph-edge').trim() || '#a1a1aa';
  for (const el of root.querySelectorAll<SVGElement>('marker polyline')) {
    touched.push([el, el.getAttribute('style')]);
    if (!el.style.stroke) el.style.stroke = edgeColor;
    if (!el.style.fill) el.style.fill = edgeColor;
  }
  return () => {
    for (const [el, style] of touched) {
      if (style === null) el.removeAttribute('style');
      else el.setAttribute('style', style);
    }
  };
}

/** Captures an element as PNG at the pixel ratio and hands the browser the file. */
export async function exportPng(element: HTMLElement, pixelRatio: number, filename: string): Promise<void> {
  const { toPng } = await import('html-to-image');
  const restore = inlineSvgStyles(element);
  let dataUrl: string;
  try {
    dataUrl = await toPng(element, {
      pixelRatio,
      backgroundColor: '#ffffff',
      cacheBust: true,
      // The controls and the minimap are hidden in figure mode; this keeps a stray one out of the picture.
      filter: (node) => !(node instanceof HTMLElement && (node.classList.contains('react-flow__controls') || node.classList.contains('react-flow__minimap'))),
    });
  } finally {
    restore();
  }
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = filename;
  a.click();
}

const BTN = 'rounded border border-zinc-300 px-2 py-0.5 text-[12px] hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-800';

export function FigureBar({
  ratio, onRatio, legend, onLegend, onFit, onExport, exporting, onExit,
}: {
  ratio: number;
  onRatio: (r: number) => void;
  legend: boolean;
  onLegend: (on: boolean) => void;
  onFit: () => void;
  onExport: () => void;
  exporting: boolean;
  onExit: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Figure">
      <span className="text-[11px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Figure</span>
      <label className="flex cursor-pointer items-center gap-1 text-[12px]">
        <input type="checkbox" checked={legend} onChange={(e) => onLegend(e.target.checked)} className="h-3.5 w-3.5 accent-zinc-700 dark:accent-zinc-300" />
        Legend tile
      </label>
      <select value={ratio} aria-label="Pixel ratio" onChange={(e) => onRatio(Number(e.target.value))} className="rounded border border-zinc-300 bg-transparent px-1 py-0.5 text-[12px] dark:border-zinc-700">
        <option value={2}>2×</option>
        <option value={3}>3×</option>
      </select>
      <button type="button" className={BTN} onClick={onFit} title="Frame the whole drawing (f)">Fit</button>
      <button type="button" className={BTN} onClick={onExport} disabled={exporting}>{exporting ? 'Exporting…' : 'Download PNG'}</button>
      <button type="button" className={BTN} onClick={onExit}>Exit figure mode</button>
    </div>
  );
}
