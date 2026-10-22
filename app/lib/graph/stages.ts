/**
 * The Design Graph's visual language as data (docs/graph-view-plan.md §4.2,
 * docs/visual-language.md): the one encoding the schema does not carry. Every
 * concrete artifact class has a lifecycle stage (its column), a hue and a
 * glyph; a test fails for a class without one, the way the generator fails on
 * a class without a category. Nothing else in the viewer names a class to
 * decide how it looks.
 *
 * Stages follow backward design (decided 2026-10-22 on reviewing the first
 * build): evidence → needs → objectives, then the evidence that would show an
 * objective is met (items) before the experiences that produce it
 * (activities), then the two containers a module holds (assessments and
 * lessons) in one column, then modules and the course, then the outcome
 * records in their own columns so the header reads as the loop, then notes
 * and findings, which are about the design rather than in it. Every edge in
 * the middle of the drawing spans at most one column: a placement skips the
 * activities, an activity's targets skip the items.
 *
 * Hues: eleven categorical slots whose adjacent pairs (neighboring columns,
 * and the two classes sharing a column) pass the dataviz skill's six checks
 * in both themes, found by enumeration on 2026-10-22 with three constraints:
 * objective blue; items and assessments one family (two purples); activities
 * and lessons one family (two greens, light and dark, since they sit in
 * neighboring columns and must stay 15 apart for everyone). Worst adjacent
 * pair: normal-vision ΔE 15.7, color-vision-deficiency ΔE 9.2. The dark steps
 * are the same hues re-stepped for the dark surface. Status tones (Approved,
 * Draft, Affirmed, Stale) are separate and never used for a class.
 */
import type { GlyphName } from './glyphs';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'mono';

export interface Hue {
  name: string;
  light: string;
  dark: string;
}

export const HUES = {
  aqua: { name: 'aqua', light: '#1baf7a', dark: '#199e70' },
  orange: { name: 'orange', light: '#eb6834', dark: '#d95926' },
  blue: { name: 'blue', light: '#2a78d6', dark: '#3987e5' },
  plum: { name: 'plum', light: '#9a3f8f', dark: '#b35aa8' },
  leaf: { name: 'leaf', light: '#3bb360', dark: '#2ea957' },
  violet: { name: 'violet', light: '#6250d6', dark: '#9085e9' },
  forest: { name: 'forest', light: '#2b641d', dark: '#3a732c' },
  magenta: { name: 'magenta', light: '#e87ba4', dark: '#d55181' },
  yellow: { name: 'yellow', light: '#eda100', dark: '#c98500' },
  cyan: { name: 'cyan', light: '#0e8fb0', dark: '#1aa3c4' },
  brown: { name: 'brown', light: '#a3622a', dark: '#b9733a' },
  gray: { name: 'gray', light: '#898781', dark: '#898781' },
} as const satisfies Record<string, Hue>;

export type HueName = keyof typeof HUES;

/** Column headers by integer stage. */
export const COLUMNS: readonly string[] = [
  'Evidence', 'Needs', 'Objectives', 'Items', 'Activities', 'Assessments and lessons', 'Modules', 'Course', 'Datasets', 'Metrics', 'Notes and findings',
];

export const columnOf = (stage: number): string => COLUMNS[Math.floor(stage)] ?? `Stage ${stage}`;

export interface StageEntry {
  stage: number;
  hue: HueName;
  glyph: GlyphName;
  /** Drawn with a dashed border, its edges dashed: commentary on the design. */
  annotation?: true;
}

export const STAGES: Readonly<Record<string, StageEntry>> = {
  DescriptiveEvidence: { stage: 0, hue: 'aqua', glyph: 'evidence' },
  LearningNeed: { stage: 1, hue: 'orange', glyph: 'need' },
  LearningObjective: { stage: 2, hue: 'blue', glyph: 'objective' },
  AssessmentItem: { stage: 3, hue: 'plum', glyph: 'item' },
  LearningActivity: { stage: 4, hue: 'leaf', glyph: 'activity' },
  Assessment: { stage: 5, hue: 'violet', glyph: 'assessment' },
  // ActivityGroup is renamed Lesson in a follow-up (plan §14, item 15).
  ActivityGroup: { stage: 5, hue: 'forest', glyph: 'group' },
  Module: { stage: 6, hue: 'magenta', glyph: 'module' },
  Course: { stage: 7, hue: 'yellow', glyph: 'course' },
  LearningDataset: { stage: 8, hue: 'cyan', glyph: 'dataset' },
  LearningMetric: { stage: 9, hue: 'brown', glyph: 'metric' },
  DesignNote: { stage: 10, hue: 'gray', glyph: 'note', annotation: true },
  DesignFinding: { stage: 10, hue: 'gray', glyph: 'finding', annotation: true },
};

/** A junction drawn as a node sits this far before the later of its two ends. */
export const JUNCTION_STAGE_OFFSET = 0.5;

export const stageOf = (cls: string): number | undefined => STAGES[cls]?.stage;
export const hueOf = (cls: string): Hue => HUES[STAGES[cls]?.hue ?? 'gray'];
export const glyphOf = (cls: string): GlyphName => STAGES[cls]?.glyph ?? 'junction';
export const isAnnotationClass = (cls: string): boolean => STAGES[cls]?.annotation === true;

/** The tone a status, verdict or attestation state wears on a chip. */
const TONES: Readonly<Record<string, Tone>> = {
  Approved: 'ok', Affirmed: 'ok', Addressed: 'ok', Current: 'ok',
  Draft: 'warn', InReview: 'warn', Open: 'warn', Stale: 'warn',
  Declined: 'bad', FragmentRemoved: 'bad',
  Retired: 'neutral', Dismissed: 'neutral', Unanchored: 'neutral',
};

export const toneOf = (word: string): Tone => TONES[word] ?? 'neutral';
