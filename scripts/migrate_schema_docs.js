/**
 * migrate_schema_docs.js
 *
 * Migrates schema.json @documentation entries to TerminusDB-compliant
 * multi-language array format:
 *
 *   "@documentation": [
 *     {
 *       "@language": "en",
 *       "@label": "TypeName",
 *       "@comment": "Type description.",
 *       "@properties": { "field": "Field description." }
 *       "@values": { "VALUE": "" }
 *     }
 *   ]
 *
 * Sources consolidated in priority order:
 *   1. Type-level @documentation["@comment"]
 *   2. Existing @documentation["@properties"] (already present on ItemInstance/Assessment)
 *   3. Field-level @documentation["@comment"] embedded in field definitions
 *
 * Strips all field-level @documentation from field definitions.
 * Strips all top-level @comment keys (rejected by TerminusDB).
 * Passes @context through unchanged.
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../schema/schema.json');

function extractComment(doc) {
  if (!doc) return null;
  if (Array.isArray(doc)) {
    const en = doc.find(d => d['@language'] === 'en') || doc[0];
    return en?.['@comment'] || null;
  }
  return doc['@comment'] || null;
}

function extractProperties(doc) {
  if (!doc) return null;
  if (Array.isArray(doc)) {
    const en = doc.find(d => d['@language'] === 'en') || doc[0];
    return en?.['@properties'] || null;
  }
  return doc['@properties'] || null;
}

function collectFieldDocs(entry) {
  const fieldDocs = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key.startsWith('@')) continue;
    if (typeof value === 'object' && value !== null && '@documentation' in value) {
      const comment = extractComment(value['@documentation']);
      if (comment) fieldDocs[key] = comment;
    }
  }
  return fieldDocs;
}

function stripFieldDocs(entry) {
  const clean = {};
  for (const [key, value] of Object.entries(entry)) {
    if (key.startsWith('@')) {
      clean[key] = value;
      continue;
    }
    if (typeof value === 'object' && value !== null && '@documentation' in value) {
      const { '@documentation': _doc, ...rest } = value;
      clean[key] = rest;
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

function buildDoc({ label, comment, properties, values }) {
  const doc = { '@language': 'en', '@label': label };
  if (comment) doc['@comment'] = comment;
  if (properties && Object.keys(properties).length > 0) doc['@properties'] = properties;
  if (values && Object.keys(values).length > 0) doc['@values'] = values;
  return [doc];
}

function migrate(schema) {
  return schema.map(entry => {
    const type = entry['@type'];

    if (type === '@context') return entry;

    const { '@comment': _topComment, ...rest } = entry;
    const id = rest['@id'] || '';

    if (type === 'Enum') {
      const comment = extractComment(rest['@documentation']);
      const valuesMap = Object.fromEntries((rest['@value'] || []).map(v => [v, '']));
      return {
        ...rest,
        '@documentation': buildDoc({ label: id, comment, values: valuesMap }),
      };
    }

    if (type === 'Class') {
      const comment = extractComment(rest['@documentation']);
      const existingProps = extractProperties(rest['@documentation']) || {};
      const fieldDocs = collectFieldDocs(rest);
      // existingProps wins where both define the same field
      const properties = { ...fieldDocs, ...existingProps };
      const cleanEntry = stripFieldDocs(rest);
      return {
        ...cleanEntry,
        '@documentation': buildDoc({
          label: id,
          comment,
          properties: Object.keys(properties).length > 0 ? properties : undefined,
        }),
      };
    }

    return rest;
  });
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'));
const migrated = migrate(schema);
const outputPath = resolve(__dirname, '../schema/schema.migrated.json');
writeFileSync(outputPath, JSON.stringify(migrated, null, 2));

console.log('Migration complete.');
console.log('Review:  schema/schema.migrated.json');
console.log('Apply:   cp schema/schema.migrated.json schema/schema.json');
