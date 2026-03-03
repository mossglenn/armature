#!/usr/bin/env node
/**
 * generate-schema-appendix.js
 * Generates SCHEMA_APPENDIX.md from Armature's schema.json
 *
 * Usage:
 *   node scripts/generate-schema-appendix.js [schema-path] [output-path]
 *
 * Defaults:
 *   schema: ./schema/schema.json
 *   output: ./docs/SCHEMA_APPENDIX.md
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const fs = { readFileSync, writeFileSync, mkdirSync };
const path = { join, dirname };

const schemaPath = process.argv[2] || path.join(__dirname, '../schema/schema.json');
const outputPath = process.argv[3] || path.join(__dirname, '../docs/SCHEMA_APPENDIX.md');

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));

// ── Helpers ───────────────────────────────────────────────────────────────────

function getComment(entry) {
  const doc = entry['@documentation'];
  if (!doc) return null;
  if (Array.isArray(doc)) return doc[0]?.['@comment'] || null;
  return doc['@comment'] || null;
}

function xsdShort(t) {
  if (!t) return '—';
  return String(t).replace('xsd:', '');
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
  '@type', '@id', '@inherits', '@abstract', '@documentation',
  '@comment', '@key', '@metadata', '@min_cardinality',
]);

function getFields(entry) {
  return Object.entries(entry)
    .filter(([k]) => !SKIP_KEYS.has(k))
    .map(([k, v]) => ({ name: k, type: resolveFieldType(v) }));
}

// ── Collect entries ───────────────────────────────────────────────────────────

const classes = {};
const enums = {};

for (const entry of schema) {
  if (entry['@type'] === '@context') continue;
  if (entry['@type'] === 'Class') classes[entry['@id']] = entry;
  if (entry['@type'] === 'Enum')  enums[entry['@id']] = entry;
}

const classIds = new Set(Object.keys(classes));

// ── Domain grouping ───────────────────────────────────────────────────────────

const DOMAINS = [
  {
    label: 'Infrastructure',
    description: 'Non-artifact types that underpin the design process without being instructional design artifacts themselves.',
    ids: ['User', 'ArmatureDocument'],
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
    description: 'Reusable items in an item bank, assembled into assessments via instance documents. Produces datasets that close the evidence loop.',
    ids: ['AssessmentItem', 'Response', 'ItemInstance', 'Assessment'],
  },
  {
    label: 'Learning Activities & Course Structure',
    description: 'Instructional activities and the hierarchical containers that organize them into deliverable courses.',
    ids: ['LearningActivity', 'ActivityGroup', 'Module', 'Course'],
  },
  {
    label: 'Junction Documents',
    description: 'Reified many-to-many relationships. Each is a first-class graph node that carries metadata about the relationship itself.',
    ids: ['ActivityGroupMember', 'ModuleObjective', 'ModuleActivityLink', 'ModuleActivityGroupLink'],
  },
  {
    label: 'Design Rationale',
    description: 'Free-form rationale records that attach design decisions to any primary artifact.',
    ids: ['DesignNote'],
  },
];

const JUNCTION_IDS = new Set([
  'NeedEvidenceLink', 'ActivityGroupMember', 'ModuleObjective',
  'ModuleActivityLink', 'ModuleActivityGroupLink', 'ItemInstance',
  'PrerequisiteRecord', 'Response',
]);

// ── Mermaid Class Diagram ─────────────────────────────────────────────────────

function buildClassDiagram() {
  const lines = ['```mermaid', 'classDiagram'];

  for (const [id, entry] of Object.entries(classes)) {
    const badges = [];
    if (entry['@abstract'] !== undefined) badges.push('    <<abstract>>');
    if (JUNCTION_IDS.has(id)) badges.push('    <<junction>>');
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

  lines.push('  %% Relationships');
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
  const rows = fields.map(f => {
    const optional = f.type.endsWith('?');
    return `| \`${f.name}\` | \`${f.type}\` | ${optional ? 'optional' : 'required'} |`;
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
  if (isAbstract) meta.push('**abstract**');
  if (inherits) {
    const parents = Array.isArray(inherits) ? inherits : [inherits];
    meta.push(`extends \`${parents.join(', ')}\``);
  }
  if (JUNCTION_IDS.has(id)) meta.push('**junction**');
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
  lines.push(values.map(v => `- \`${v}\``).join('\n'));
  lines.push('');
  return lines.join('\n');
}

// ── Enum grouping ─────────────────────────────────────────────────────────────

const ENUM_GROUPS = [
  { label: 'Objectives', ids: ['BloomsLevel', 'ObjectiveState', 'ObjectiveRole', 'PrerequisiteType'] },
  { label: 'Assessment', ids: ['ItemType', 'ItemStatus'] },
  { label: 'Evidence & Needs', ids: ['EvidenceMethod', 'ConfidenceLevel', 'NeedPriority'] },
  { label: 'Coverage & Activities', ids: ['CoverageStatus', 'ActivityType'] },
  { label: 'Design Rationale', ids: ['DesignNoteCategory'] },
];

// ── Assemble document ─────────────────────────────────────────────────────────

const today = new Date().toISOString().split('T')[0];
const out = [];

out.push(`# Armature Schema Reference

_Schema snapshot · Generated ${today}_

---

## Overview

Armature models the full instructional design artifact graph from problem definition through outcome evaluation. The schema is implemented in TerminusDB using its document interface for closed-world assumptions, native version control, and graph traversal.

**Key architectural patterns:**

- **Abstract base types** — \`ArmatureDocument\` and \`LearningEvidence\` enforce shared field contracts across subtypes. Neither is directly instantiated.
- **Junction documents** — many-to-many relationships are reified as first-class graph nodes. The relationship itself carries metadata (rationale, role, sequence, confidence) rather than being a bare edge.
- **Back-reference pattern** — child documents hold foreign keys to their parents (e.g., \`Response.item\`, \`Assessment.module\`), keeping parent documents lean regardless of child count.
- **API constraints** — some constraints (unique sequence values, required fields on creation) are enforced at the API level rather than the schema level and are noted inline.

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

out.push(`---\n\n## Enumerations\n`);
for (const group of ENUM_GROUPS) {
  out.push(`### ${group.label}\n`);
  for (const id of group.ids) {
    if (enums[id]) out.push(renderEnum(id));
  }
}

// Write output
const content = out.join('\n');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, content, 'utf8');

console.log(`✓ Schema appendix written to ${outputPath}`);
console.log(`  Classes: ${Object.keys(classes).length}`);
console.log(`  Enums:   ${Object.keys(enums).length}`);
