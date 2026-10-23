/**
 * Which form of a column header fits its column (2026-10-23). The headers are
 * screen-sized text over columns that scale with the zoom, so a name that
 * reads at one zoom is wider than its column at another. A header is drawn
 * in full, wrapped to two lines at the best single break, while that fits
 * the column's box; below that it is drawn in its short form. The widths are
 * estimated from the header's font (11px uppercase, tracking 0.05em; the
 * per-glyph figures were measured in the browser and err slightly wide, the
 * safe direction) so the choice is pure and testable.
 */
import type { ColumnName } from './stages';

const WIDE = 10.6; // M, W
const ROUND = 8.8; // C, D, G, O, Q, U
const NARROW = 3.6; // I, space, period
const SLIM = 7.0; // T, J
const LETTER = 8.1;

/** The width on screen, in pixels, of a header's text on one line. */
export function headerWidth(text: string): number {
  let width = 0;
  for (const c of text.toUpperCase()) {
    width += 'MW'.includes(c) ? WIDE : 'CDGOQU'.includes(c) ? ROUND : 'I .'.includes(c) ? NARROW : 'TJ'.includes(c) ? SLIM : LETTER;
  }
  return width;
}

/** The width a header needs when wrapped to at most two lines at a space: the longest line at the best break. */
export function twoLineWidth(text: string): number {
  const words = text.split(' ');
  let best = headerWidth(text);
  for (let i = 1; i < words.length; i++) {
    const lines = Math.max(headerWidth(words.slice(0, i).join(' ')), headerWidth(words.slice(i).join(' ')));
    best = Math.min(best, lines);
  }
  return best;
}

/** The form to draw in a box of a width on screen: the name while it fits in two lines, else the short form (which may wrap too: "Assess." over "Lessons"). */
export function headerFor(column: ColumnName, box: number): { text: string; short: boolean } {
  return twoLineWidth(column.header) <= box ? { text: column.header, short: false } : { text: column.short, short: true };
}
