/**
 * The column headers' two forms: the width estimate against widths measured in
 * the browser, every name wrapped in two lines at a laptop's fit zoom, every
 * short form in a compact column, and the choice between them by the box.
 */
import { describe, expect, it } from 'vitest';
import { headerFor, headerWidth, twoLineWidth } from './headers';
import { COLUMNS } from './stages';

/** Rendered widths of the header font (11px uppercase, tracking-wider), measured in Chromium on 2026-10-23. */
const MEASURED: Record<string, number> = {
  Evidence: 60.6, Needs: 40.7, Objectives: 74, Items: 36.4, Activities: 65.4, 'Assessments and lessons': 175.9,
  Modules: 58.3, Course: 50.4, Datasets: 60.8, Metrics: 53.4, 'Notes and findings': 129.1,
  'Evid.': 31.5, 'Obj.': 26.7, 'Activ.': 37.8, 'Assess.': 50.9, 'Mod.': 30.9, Data: 29.9, 'Metr.': 37, Notes: 40.7, Lessons: 57.4,
  Assessments: 88.6, 'And lessons': 84.3, 'Notes and': 68.5, Findings: 57,
};

/** The header's box at the fit zoom of a 1700px window (a pitch of 102px less the gutter), and a narrow box every short form must fit. */
const FIT_BOX = 97;
const COMPACT_BOX = 60;

describe('the column headers\' forms', () => {
  it('estimates widths within a tenth of the measured ones, wide for most and never narrow by more than a fiftieth', () => {
    let wide = 0;
    for (const [text, measured] of Object.entries(MEASURED)) {
      const estimate = headerWidth(text);
      const error = (estimate - measured) / measured;
      expect(error, text).toBeLessThan(0.1);
      expect(error, text).toBeGreaterThan(-0.02);
      if (error >= 0) wide++;
    }
    expect(wide).toBeGreaterThan((Object.keys(MEASURED).length * 3) / 4);
  });

  it('wraps a name at its best break', () => {
    expect(twoLineWidth('Assessments and lessons')).toBeCloseTo(Math.max(headerWidth('Assessments'), headerWidth('and lessons')), 6);
    expect(twoLineWidth('Notes and findings')).toBeCloseTo(Math.max(headerWidth('Notes and'), headerWidth('findings')), 6);
    expect(twoLineWidth('Objectives')).toBe(headerWidth('Objectives'));
  });

  it('draws every name in full at a wide fit and every short form within a narrow one, in two lines at most', () => {
    for (const column of COLUMNS) {
      expect(headerFor(column, FIT_BOX), column.header).toEqual({ text: column.header, short: false });
      expect(twoLineWidth(column.short), column.short).toBeLessThanOrEqual(COMPACT_BOX);
      expect(headerFor(column, COMPACT_BOX).short, column.header).toBe(twoLineWidth(column.header) > COMPACT_BOX);
    }
  });

  it('keeps both ideas of the shared column in its short form, one per line', () => {
    const shared = COLUMNS.find((c) => c.header === 'Assessments and lessons')!;
    expect(shared.short).toBe('Assess. lessons');
    expect(twoLineWidth(shared.short)).toBeCloseTo(Math.max(headerWidth('Assess.'), headerWidth('lessons')), 6);
  });

  it('switches to the short form once, as the box narrows', () => {
    const column = { header: 'Assessments and lessons', short: 'Assess. lessons' };
    let shortSeen = false;
    for (let box = 200; box >= 20; box -= 1) {
      const { short } = headerFor(column, box);
      if (short) shortSeen = true;
      else expect(shortSeen, `box ${box}`).toBe(false);
    }
    expect(shortSeen).toBe(true);
  });
});
