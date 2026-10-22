'use client';

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { Chip } from '@/lib/graph/derive';
import { GLYPHS } from '@/lib/graph/glyphs';
import { glyphOf, hueOf } from '@/lib/graph/stages';

/**
 * A node: the card of docs/graph-view-plan.md §4.1. A class stripe and glyph,
 * the class name as an eyebrow, the label on one line, up to three chips.
 * Fixed size (lib/graph/layout.ts), so the layout needs no measurement. The
 * hue comes from the stage table as CSS variables for both themes; the
 * selection ring, the root ring and dimming are classes the canvas sets.
 */
export type ArmatureNodeData = {
  cls: string;
  label: string;
  chips: Chip[];
  annotation: boolean;
  /** Not in the lit relation: drawn at reduced opacity. */
  dim: boolean;
  /** The Focus page's root. */
  root: boolean;
};

export type ArmatureNodeType = Node<ArmatureNodeData, 'armature'>;

const TONE_CLASS: Record<NonNullable<Chip['tone']>, string> = {
  ok: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200',
  bad: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  neutral: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  mono: 'bg-zinc-100 text-zinc-700 font-mono dark:bg-zinc-800 dark:text-zinc-300',
};

export function Glyph({ cls, className = 'h-3 w-3' }: { cls: string; className?: string }) {
  // The markup is lib/graph/glyphs.ts's constants, copied from Lucide's icon
  // files at build time and never read from a document or a request, so
  // setting it as inner HTML draws trusted, static SVG.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: GLYPHS[glyphOf(cls)] }}
    />
  );
}

export function ArmatureNode({ data, selected }: NodeProps<ArmatureNodeType>) {
  const hue = hueOf(data.cls);
  const chipText = data.chips.map((c) => c.text).join(', ');
  return (
    <div
      className={[
        'gnode',
        selected ? 'gnode-selected' : '',
        data.root ? 'gnode-root' : '',
        data.dim ? 'gnode-dim' : '',
        data.annotation ? 'gnode-annotation' : '',
      ].join(' ')}
      style={{ '--c-light': hue.light, '--c-dark': hue.dark } as CSSProperties}
      role="button"
      aria-label={`${data.cls}, ${data.label}${chipText ? `, ${chipText}` : ''}`}
      title={data.label}
    >
      <Handle type="target" position={Position.Left} className="gnode-handle" isConnectable={false} />
      <div className="gnode-eyebrow flex items-center gap-1 text-[10px] uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
        <Glyph cls={data.cls} />
        <span className="truncate">{data.cls}</span>
      </div>
      <div className="gnode-label truncate text-[13px] font-medium leading-tight">{data.label}</div>
      {data.chips.length > 0 && (
        <div className="gnode-chips flex gap-1 overflow-hidden whitespace-nowrap">
          {data.chips.slice(0, 3).map((c, i) => (
            <span key={i} className={`shrink-0 rounded px-1.5 text-[10.5px] ${TONE_CLASS[c.tone ?? 'neutral']}`} title={c.title}>
              {c.text}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="gnode-handle" isConnectable={false} />
    </div>
  );
}
