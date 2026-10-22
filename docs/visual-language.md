# The visual language

How Armature draws a design record, a relationship and a lifecycle, so that a figure in a paper, a slide drawn by hand and the Design Graph page all read the same way. The page is the reference implementation (`app/app/graph/`, planned in `docs/graph-view-plan.md` §4); the values here are the ones it uses, kept in `app/lib/graph/stages.ts` and `glyphs.ts`, so a change there is a change here.

Abbreviations: ADR (Architecture Decision Record), CVD (color-vision deficiency), SVG (Scalable Vector Graphics).

## Principles

1. **Every encoding is redundant.** A class is carried by a hue, a glyph and its name; a status by a chip's tone and its word. A black-and-white print, a projector and a reader with a color-vision deficiency each lose one channel and keep the others.
2. **The lifecycle is the layout, in the order of backward design.** Desired results first, then the evidence that would show them, then the experiences that produce them: evidence → needs → objectives → items → activities → assessments and lessons → modules → course, then the outcome records (datasets, metrics), then notes and findings. Every edge points from an earlier column to a later one, whichever document holds the reference (ADR-0004 puts it on the child). The reading direction is the design's, not the data model's.
3. **A relationship is an edge.** A relationship document (the schema's `relationship` category, ADR-0027) with two ends is drawn as a labeled edge between them, carrying its data; one with a single non-person end (an attestation) is a chip on that record. The store's view, every junction as a node, is one toggle away but is not the default.
4. **A container and what it holds are one family.** Items and assessments are two purples; activities and lessons two greens. The darker shade is the container.
5. **People are not drawn.** No node, no edge, no color for a person (ADR-0021); `createdBy` and `attestedBy` are text in a detail panel.
6. **Status tones are reserved.** Green, amber and red mean good, pending and bad on a chip and are never used for a class.
7. **A figure names its commit.** A drawing is the graph at a ref; an exported figure carries the branch, the commit and the view's query, so it can be reproduced from the export.

## Stages, hues and glyphs

| Stage | Column | Class | Hue | Light | Dark | Glyph (Lucide) |
|---|---|---|---|---|---|---|
| 0 | Evidence | `DescriptiveEvidence` | aqua | `#1baf7a` | `#199e70` | file-text |
| 1 | Needs | `LearningNeed` | orange | `#eb6834` | `#d95926` | target |
| 2 | Objectives | `LearningObjective` | blue | `#2a78d6` | `#3987e5` | flag |
| 3 | Items | `AssessmentItem` | plum | `#9a3f8f` | `#b35aa8` | circle-help |
| 4 | Activities | `LearningActivity` | leaf | `#3bb360` | `#2ea957` | play |
| 5 | Assessments and lessons | `Assessment` | violet | `#6250d6` | `#9085e9` | clipboard-check |
| 5 | | `Lesson` | forest | `#2b641d` | `#3a732c` | layers |
| 6 | Modules | `Module` | magenta | `#e87ba4` | `#d55181` | box |
| 7 | Course | `Course` | yellow | `#eda100` | `#c98500` | book-open |
| 8 | Datasets | `LearningDataset` | cyan | `#0e8fb0` | `#1aa3c4` | table |
| 9 | Metrics | `LearningMetric` | brown | `#a3622a` | `#b9733a` | gauge |
| 10 | Notes and findings | `DesignNote` | gray | `#898781` | `#898781` | pencil |
| 10 | | `DesignFinding` | gray | `#898781` | `#898781` | triangle-alert |
| | (edges; junctions as nodes) | any relationship | gray | `#898781` | `#898781` | link |

Why this order (decided 2026-10-22 on reviewing the first build, which had items and activities in one column with the group first): items before activities is backward design's order, the evidence before the experiences; the two containers a module holds share one column after both, so that every edge in that part of the drawing spans at most one column (a placement skips the activities, an activity's `targets` skips the items, a formative use and a lesson's member are adjacent). An assessment is referenced by `Assessment.module` without a sequence and is not module content in ADR-0005's sense, while a lesson is sequenced content; the shared header says what the column is visually, what a module holds, without claiming they are the same kind of thing. The outcome records sit after the course so the header reads as the loop the project describes (PROJECT_CONTEXT, Narrative 1); a metric's `subject` edge reaches back across to the item it measures. Notes and findings trail everything: they are about the design, not in it, and are drawn with a dashed border.

**How the hues were chosen (2026-10-22).** The eleven slots are categorical colors in a fixed order, so the pairs that sit beside each other on the page, neighboring columns and the two classes that share column 5, are the pairs that must be told apart. The assignment was found by enumerating candidate hues (the dataviz skill's validated reference instance, plus greens and teals generated in OKLCH) over the slots under three constraints, objective blue, items and assessments one family, activities and lessons one family, keeping only assignments whose every adjacent pair passes the skill's six checks in both themes: lightness band, chroma floor, adjacent-pair CVD separation (ΔE ≥ 8, or ≥ 6 with a secondary encoding), adjacent-pair normal-vision separation (ΔE ≥ 15) and contrast against the surface. The chosen assignment's worst adjacent pair is normal-vision ΔE 15.7 and CVD ΔE 9.2, clear of both floors. Two facts the enumeration established: no green of any shade can sit beside orange and pass the CVD check, which is why modules are magenta rather than orange; and two shades of one family in neighboring columns pass only when they differ strongly in lightness (leaf and forest), since the lightness band for the dark theme is narrow. Re-run the enumeration before changing a hue; the method is the dataviz skill's.

## A node

A fixed-size card, 232 by 72 pixels at zoom 1:

```
┃ ◆ ASSESSMENTITEM
┃ Identifying training data bias
┃ [Approved] [Analyze] [Affirmed · one part]
```

- a 3-pixel **stripe** on the left in the class hue;
- the class **glyph** and name as a small-caps eyebrow in muted text;
- the **label** on one line, ellipsized (the full text on hover and in the panel);
- up to three **chips**: the record's `status`, its Bloom's level, `activityType` or `priority`, a metric's value and unit, a dataset's cohort, `as of <commit>` for a record that names a commit (ADR-0057), and what annotations add: an attestation's verdict (and "one part" when it judges a fragment), a finding's status, "Note".

Below zoom 0.6 the card shows its label alone, large, two lines at most, with a 6-pixel stripe, so the overview of a whole store stays legible; edge labels hide at the same point.

States: **selected**, a 2-pixel ring in the accent (blue); **root** of a Focus page, a ring in the class hue; **dimmed**, 30% opacity, for everything outside the lit relation; **annotation** (a note or finding), a dashed border.

## Chips

| Tone | Words | Light | Dark |
|---|---|---|---|
| ok | Approved, Affirmed, Addressed, Current | emerald 100 on 900 | emerald 950 on 200 |
| warn | Draft, InReview, Open, Stale | amber 100 on 900 | amber 950 on 200 |
| bad | Declined, FragmentRemoved | red 100 on 900 | red 950 on 200 |
| neutral | Retired, Dismissed, Unanchored, and every other word | zinc 100 on 700 | zinc 800 on 300 |
| mono | a value, a commit | zinc, monospace | zinc, monospace |

The steps are the viewer's Tailwind scale. A tone never stands alone: the word is always on the chip.

## Edges

| Kind | What | Weight | Label |
|---|---|---|---|
| junction | a relationship document with two ends (`ModuleObjective`, `ItemInstance`, `PrerequisiteRecord`, `NeedEvidenceLink`, the activity and lesson links) | 1.5 px | its data: "Primary · #2", "Approved · #1", "High", "Required" |
| reference | a reference field on an artifact (`assesses`, `targets`, `course`, `module`, `subject`, `derivedFrom`, `producedBy`, `generatedBy`) | 1.25 px | the field name, shown when an end is selected |
| annotation | a note's or finding's `subject` | 1.25 px, dashed | the field name, when an end is selected |

All edges are a muted gray (`#a1a1aa` light, `#52525b` dark) with a small closed arrowhead of the same gray pointing along the lifecycle; the edges of a lit relation turn the accent. An edge between two records of one column (a prerequisite between objectives) is drawn but not ranked, so it never moves a record out of its column.

## Type and surfaces

The viewer's faces: Geist for text, Geist Mono for ids, commits, sequences and values (tabular numerals). The light surface is white on `#fafaf9`, the dark `#18181b` on `#0a0a0a`; the zinc neutrals throughout. Light is the theme figures are exported in.

## Using the language elsewhere

A slide or a hand-drawn figure follows the same rules: columns in lifecycle order, class hues from the table, the glyphs from Lucide (ISC license) at the names given, relationships as labeled edges, people absent, status in words. When the page can export a figure (plan §11), prefer the export: it carries the commit.
