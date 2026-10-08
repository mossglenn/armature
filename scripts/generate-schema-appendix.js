#!/usr/bin/env node
/**
 * generate-schema-appendix.js
 * Generates docs/SCHEMA_APPENDIX.md from Armature's schema.json
 *
 * Usage:
 *   node scripts/generate-schema-appendix.js [schema-path] [output-path]
 *
 * Defaults:
 *   schema: ./schema/schema.json
 *   output: ./docs/SCHEMA_APPENDIX.md
 *
 * Grouping follows the schema's own self-description (ADR-0027): every class
 * carries @metadata.armature.category (infrastructure, fragment, artifact,
 * relationship). Domain sections below list artifact ids for readability;
 * any class not named in a domain is still rendered, under its category, so a
 * new type never silently drops out of the appendix.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const schemaPath = process.argv[2] || join(__dirname, '../schema/schema.json');
const outputPath = process.argv[3] || join(__dirname, '../docs/SCHEMA_APPENDIX.md');

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

// ── Helpers ───────────────────────────────────────────────────────────────────

function getComment(entry) {
  const doc = entry['@documentation'];
  if (!doc) return null;
  if (Array.isArray(doc)) return doc[0]?.['@comment'] || null;
  return doc['@comment'] || null;
}

function xsdShort(t) {
  if (!t) return '—';
  return String(t).replace('xsd:', '').replace('sys:', '');
}

function resolveFieldType(val) {
  if (typeof val === 'string') return xsdShort(val);
  if (!val || typeof val !== 'object') return '—';
  switch (val['@type']) {
    case 'Optional': return `${xsdShort(val['@class'])}?`;
    case 'Set':      return `Set<${xsdShort(val['@class'])}>`;
    case 'List':     return `List<${xsdShort(val['@class'])}>`;
    default:         return xsdShort(val['@class'] || JSON.stringify(val));
  }
}

const SKIP_KEYS = new Set([
  '@type', '@id', '@inherits', '@abstract', '@subdocument', '@documentation',
  '@comment', '@key', '@metadata', '@min_cardinality',
]);

function getFields(entry) {
  return Object.entries(entry)
    .filter(([k]) => !SKIP_KEYS.has(k))
    .map(([k, v]) => ({ name: k, type: resolveFieldType(v), min: v?.['@min_cardinality'] }));
}

const categoryOf = (entry) => entry['@metadata']?.armature?.category ?? 'uncategorised';
const isSubdoc   = (entry) => entry['@subdocument'] !== undefined;

// ── Collect entries ───────────────────────────────────────────────────────────

const classes = {};
const enums = {};

for (const entry of schema) {
  if (entry['@type'] === '@context') continue;
  if (entry['@type'] === 'Class') classes[entry['@id']] = entry;
  if (entry['@type'] === 'Enum')  enums[entry['@id']] = entry;
}

const classIds  = new Set(Object.keys(classes));
const subdocIds = new Set(Object.values(classes).filter(isSubdoc).map((c) => c['@id']));

// ── Domain grouping ───────────────────────────────────────────────────────────

const DOMAINS = [
  {
    label: 'Infrastructure',
    description: 'Non-artifact types that underpin the design process: the user, and the abstract roots every record inherits.',
    ids: ['User', 'DesignRecord', 'ArmatureDocument'],
  },
  {
    label: 'Evidence & Needs Analysis',
    description: 'Evidence of learning gaps and the needs they inform. The upstream entry point into the artifact graph.',
    ids: ['LearningEvidence', 'LearningMetric', 'DescriptiveEvidence', 'LearningDataset', 'LearningNeed', 'NeedEvidenceLink'],
  },
  {
    label: 'Objectives',
    description: 'The central node of the Armature graph. All upstream artifacts trace forward to objectives; all downstream artifacts trace back to them.',
    ids: ['LearningObjective', 'PrerequisiteRecord'],
  },
  {
    label: 'Assessment',
    description: 'Reusable items in an item bank, each a tree of addressable fragments, assembled into assessments via instance documents. Produces datasets that close the evidence loop.',
    ids: ['Fragment', 'TextFragment', 'ItemOption', 'AssessmentItem', 'ItemInstance', 'Assessment'],
  },
  {
    label: 'Learning Activities & Course Structure',
    description: 'Instructional activities and the hierarchical containers that organize them into deliverable courses.',
    ids: ['LearningActivity', 'ActivityGroup', 'ActivityGroupMember', 'ModuleObjective', 'Module', 'ModuleActivityLink', 'ModuleActivityGroupLink', 'Course'],
  },
  {
    label: 'Design Rationale',
    description: 'Rationale and review records that attach to any design record: why something was done, and what someone judged to be a problem.',
    ids: ['DesignNote', 'DesignFinding'],
  },
];

// Anything not placed in a domain is rendered at the end under its category.
const placed = new Set(DOMAINS.flatMap((d) => d.ids));
const unplaced = Object.keys(classes).filter((id) => !placed.has(id));

// ── Mermaid Class Diagram ─────────────────────────────────────────────────────

function buildClassDiagram() {
  const lines = ['```mermaid', 'classDiagram'];

  for (const [id, entry] of Object.entries(classes)) {
    const badges = [];
    if (entry['@abstract'] !== undefined) badges.push('    <<abstract>>');
    if (isSubdoc(entry)) badges.push('    <<subdocument>>');
    if (categoryOf(entry) === 'relationship') badges.push('    <<relationship>>');
    const fields = getFields(entry);

    // Mermaid errors on empty class bodies — only emit braces if there's content
    if (badges.length === 0 && fields.length === 0) {
      lines.push(`  class ${id}`);
    } else {
      lines.push(`  class ${id} {`);
      for (const b of badges) lines.push(b);
      for (const { name, type } of fields) {
        lines.push(`    +${type} ${name}`);
      }
      lines.push('  }');
    }
    lines.push('');
  }

  lines.push('  %% Inheritance');
  for (const [id, entry] of Object.entries(classes)) {
    if (!entry['@inherits']) continue;
    const parents = Array.isArray(entry['@inherits']) ? entry['@inherits'] : [entry['@inherits']];
    for (const p of parents) {
      lines.push(`  ${p} <|-- ${id} : inherits`);
    }
  }
  lines.push('');

  lines.push('  %% Relationships (solid: reference; dotted: optional; diamond: embedded subdocument)');
  for (const [id, entry] of Object.entries(classes)) {
    for (const [field, val] of Object.entries(entry)) {
      if (SKIP_KEYS.has(field)) continue;
      let target = null;
      let arrow = ' --> ';

      if (typeof val === 'string' && classIds.has(val)) {
        target = val;
      } else if (val?.['@type'] === 'Optional' && classIds.has(val['@class'])) {
        target = val['@class'];
        arrow = ' ..> ';
      } else if ((val?.['@type'] === 'Set' || val?.['@type'] === 'List') && classIds.has(val['@class'])) {
        target = val['@class'];
        arrow = ' "0..*" --> ';
      }

      if (target && subdocIds.has(target)) arrow = ' *-- ';
      if (target) lines.push(`  ${id}${arrow}${target} : ${field}`);
    }
  }

  lines.push('```');
  return lines.join('\n');
}

// ── Type Reference ────────────────────────────────────────────────────────────

function fieldTable(entry) {
  const fields = getFields(entry);
  if (fields.length === 0) return '_No additional fields._\n';
  const rows = fields.map((f) => {
    const optional = f.type.endsWith('?');
    const notes = [optional ? 'optional' : 'required'];
    if (f.min) notes.push(`min ${f.min}`);
    const inner = f.type.replace(/^(Set|List)<(.*)>$/, '$2').replace(/\?$/, '');
    if (subdocIds.has(inner)) notes.push('embedded subdocument');
    return `| \`${f.name}\` | \`${f.type}\` | ${notes.join(', ')} |`;
  });
  return ['| Field | Type | Notes |', '|-------|------|-------|', ...rows].join('\n') + '\n';
}

function renderClass(entry) {
  const id = entry['@id'];
  const comment = getComment(entry);
  const inherits = entry['@inherits'];
  const isAbstract = entry['@abstract'] !== undefined;
  const lines = [];
  lines.push(`### \`${id}\``);
  const meta = [];
  meta.push(`category: ${categoryOf(entry)}`);
  if (isAbstract) meta.push('**abstract**');
  if (isSubdoc(entry)) meta.push('**subdocument**');
  if (inherits) {
    const parents = Array.isArray(inherits) ? inherits : [inherits];
    meta.push(`extends \`${parents.join(', ')}\``);
  }
  if (entry['@key']) {
    const k = entry['@key'];
    meta.push(`key: ${k['@type']}${k['@fields'] ? `(${k['@fields'].join(', ')})` : ''}`);
  }
  if (meta.length) lines.push(`_${meta.join(' · ')}_`);
  lines.push('');
  if (comment) lines.push(`> ${comment}\n`);
  lines.push(fieldTable(entry));
  return lines.join('\n');
}

function renderEnum(id) {
  const entry = enums[id];
  const comment = getComment(entry);
  const values = entry['@value'] || [];
  const lines = [];
  lines.push(`### \`${id}\``);
  lines.push('');
  if (comment) lines.push(`> ${comment}\n`);
  lines.push(values.map((v) => `- \`${v}\``).join('\n'));
  lines.push('');
  return lines.join('\n');
}

// ── Enum grouping ─────────────────────────────────────────────────────────────

const ENUM_GROUPS = [
  { label: 'Objectives', ids: ['BloomsLevel', 'ObjectiveState', 'ObjectiveRole', 'PrerequisiteType'] },
  { label: 'Assessment', ids: ['ItemType', 'ItemStatus'] },
  { label: 'Evidence & Needs', ids: ['EvidenceMethod', 'ConfidenceLevel', 'NeedPriority'] },
  { label: 'Coverage & Activities', ids: ['CoverageStatus', 'ActivityType'] },
  { label: 'Design Rationale', ids: ['DesignNoteCategory', 'FindingStatus'] },
];
const placedEnums = new Set(ENUM_GROUPS.flatMap((g) => g.ids));
const unplacedEnums = Object.keys(enums).filter((id) => !placedEnums.has(id));

// ── Assemble document ─────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];
const out = [];

out.push(`# Armature Schema Reference

_Schema snapshot · Generated ${today}_

---

## Overview

Armature models the full instructional design artifact graph from problem definition through outcome evaluation. The schema is implemented in TerminusDB using its document interface for closed-world assumptions, native version control, and graph traversal.

**Key architectural patterns:**

- **Abstract roots** — \`DesignRecord\` is the root of every record of design; \`ArmatureDocument\` adds label, description and createdBy for the primary artifacts; \`LearningEvidence\` and \`Fragment\` are abstract within their families. None is directly instantiated.
- **Self-description** — every class declares \`@metadata.armature.category\` (infrastructure, fragment, artifact, relationship); tools and generators read the taxonomy from the schema, not from a hand-maintained list (ADR-0027).
- **Relationships as documents** — many-to-many relationships are reified as first-class graph nodes that carry data about the relationship itself (rationale, role, sequence, confidence) and can themselves be the subject of a \`DesignNote\` or \`DesignFinding\` (ADR-0003, ADR-0017).
- **Fragments** — an item is a tree of embedded subdocuments (stem, options, feedbacks), each with a client-assigned \`fragmentId\` so a part can be addressed without having document identity (ADR-0022, ADR-0023, ADR-0033).
- **Back-reference pattern** — child documents hold foreign keys to their parents (e.g., \`Assessment.module\`, \`Module.course\`), keeping parent documents lean regardless of child count (ADR-0004).
- **API constraints** — TerminusDB checks that a referenced document exists but not its class, and cannot express cross-document or conditional rules. Those constraints (reference class, unique sequences, conditional requirements, coverage recompute) are enforced by the API and are noted inline (ADR-0006).

---

## Class Diagram

${buildClassDiagram()}

---

## Type Reference

`);

for (const domain of DOMAINS) {
  out.push(`## ${domain.label}\n`);
  if (domain.description) out.push(`_${domain.description}_\n`);
  for (const id of domain.ids) {
    if (classes[id]) out.push(renderClass(classes[id]));
  }
}
if (unplaced.length) {
  out.push(`## Other classes\n`);
  out.push(`_Classes not yet placed in a domain section above; add them to DOMAINS in the generator._\n`);
  for (const id of unplaced) out.push(renderClass(classes[id]));
}

out.push(`---\n\n## Enumerations\n`);
for (const group of ENUM_GROUPS) {
  out.push(`### ${group.label}\n`);
  for (const id of group.ids) {
    if (enums[id]) out.push(renderEnum(id));
  }
}
if (unplacedEnums.length) {
  out.push(`### Other\n`);
  for (const id of unplacedEnums) out.push(renderEnum(id));
}

// Write output
const content = out.join('\n');
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, content, 'utf8');

console.log(`✓ Schema appendix written to ${outputPath}`);
console.log(`  Classes: ${Object.keys(classes).length}${unplaced.length ? ` (${unplaced.length} unplaced: ${unplaced.join(', ')})` : ''}`);
console.log(`  Enums:   ${Object.keys(enums).length}${unplacedEnums.length ? ` (${unplacedEnums.length} unplaced)` : ''}`);
