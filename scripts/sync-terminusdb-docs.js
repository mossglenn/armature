#!/usr/bin/env node
/**
 * sync-terminusdb-docs.js
 * Vendors the TerminusDB documentation as markdown so it is available offline,
 * version-stamped, and usable for AI-assisted development and for verifying
 * ADRs (architecture decision records).
 *
 * Why this exists
 * ---------------
 * TerminusDB publishes no llms.txt and no MCP (Model Context Protocol) server,
 * and its old GitHub docs repository is explicitly out of date. The repo
 * previously carried one
 * hand-copied page (docs/terminusdb-schema-doc.md, March 2026) that went stale
 * across four server releases without anyone noticing. This script replaces
 * that practice with a reproducible, dated, pinned sync.
 *
 * Where the content comes from
 * ----------------------------
 * The live site (terminusdb.org/docs) is rendered from a public GitHub
 * repository of Markdoc sources: dfrnt-labs/terminusdb-docs-static, Apache-2.0.
 * Each page lives at src/app/docs/<slug>/page.md. This script:
 *
 *   1. Lists pages from that repository's git tree, unioned with the site's
 *      sitemap (so a page that exists only as a rendered route is not missed).
 *   2. Fetches each page's raw markdown and converts its Markdoc tags
 *      ({% table %}, {% callout %}, {% http-example %}, ...) to plain
 *      CommonMark/GFM (GitHub Flavored Markdown).
 *   3. Falls back to fetching the rendered HTML and converting it with
 *      turndown when no page.md exists. The `javascript` and `python` API
 *      references are generated pages and always take this path.
 *   4. Writes CURATED pages (the ones Armature's plan and ADRs rely on) to
 *        docs/vendor/terminusdb/<slug>.md          (committed)
 *      and every other page to
 *        docs/vendor/terminusdb/_all/<slug>.md     (gitignored)
 *   5. Writes INDEX.md (every page: title, description, upstream last-updated
 *      date, local file, source URL) and VERSION.json (fetch date, docs repo
 *      commit, latest server release, counts, failures).
 *
 * Usage (from repo root or scripts/):
 *   node scripts/sync-terminusdb-docs.js                 # full sync
 *   node scripts/sync-terminusdb-docs.js --curated-only  # skip _all/
 *   node scripts/sync-terminusdb-docs.js --only merge-howto,branch-howto
 *   node scripts/sync-terminusdb-docs.js --dry-run       # list, no writes
 *
 * When to run it
 * --------------
 * After a TerminusDB server or client release, when VERSION.json's docsCommit
 * is behind the docs repository's main branch, and before relying on the
 * vendored copy for a version-sensitive decision. The .claude/skills/terminusdb
 * skill describes how the vendored pages are meant to be used.
 *
 * Conversion notes
 * ----------------
 * Markdoc is a superset of CommonMark; the tags are the only thing to translate.
 * Known block tags are converted (see convertMarkdoc). Unknown block tags are
 * stripped while their content is kept; unknown self-closing tags are dropped.
 * Any residual "{%" in an output file is reported at the end of the run so a
 * new upstream tag is noticed rather than silently passed through.
 */

import { mkdirSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import TurndownService from 'turndown';
import gfmPlugin from '@joplin/turndown-plugin-gfm';

const { gfm } = gfmPlugin;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const OUT_DIR = join(REPO_ROOT, 'docs', 'vendor', 'terminusdb');
const ALL_DIR = join(OUT_DIR, '_all');

const SITE = 'https://terminusdb.org';
const SITEMAP = `${SITE}/sitemap-0.xml`;
const DOCS_REPO = 'dfrnt-labs/terminusdb-docs-static';
const DOCS_BRANCH = 'main';
const DOCS_PATH_PREFIX = 'src/app/docs/';
const RAW_BASE = `https://raw.githubusercontent.com/${DOCS_REPO}`;
const GITHUB_API = 'https://api.github.com';
const RELEASES_API = `${GITHUB_API}/repos/terminusdb/terminusdb/releases/latest`;
const CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 30_000;

// ── CLI flags ─────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const flagValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : undefined;
};
const DRY_RUN = flag('--dry-run');
const CURATED_ONLY = flag('--curated-only');
const ONLY = flagValue('--only')?.split(',').map((s) => s.trim()).filter(Boolean);

// ── Curated pages ─────────────────────────────────────────────────────────────

/**
 * Pages Armature's development plan and ADRs rely on, grouped by the question
 * they answer. Keep this list in step with .claude/skills/terminusdb/SKILL.md.
 * Slugs are the path segment after https://terminusdb.org/docs/.
 */
const CURATED = {
  'Schema language and migration': [
    'schema-reference-guide',
    'schema-migration-reference-guide',
    'what-is-schema-weakening',
    'document-types-comparison',
    'woql-subdocument-handling',
    'document-unfolding-reference',
    'xsd-data-types',
    'numeric-precision-reference',
    'troubleshooting-schema',
    'troubleshooting-document-id-migration',
  ],
  'Document API (read, write, replace, paging)': [
    'document-insertion',
    'http-documents-api',
    'get-documents',
    'add-a-document',
    'edit-a-document',
    'delete-a-document',
    'graph-spec-db-spec-database-path-identifiers',
    'enterprise-document-formats',
  ],
  'Version control (branch, merge, history, time travel)': [
    'version-control-operations',
    'git-for-data-reference',
    'branch-howto',
    'merge-howto',
    'time-travel-howto',
    'undo-reset-howto',
    'recovery-tutorial',
    'audit-tutorial',
    'commit-message-howto',
    'squash-projects',
    'reset-a-project',
    'change-request-workflows',
    'collaboration-with-javascript-client',
  ],
  'Diff and patch': [
    'json-diff-and-patch',
    'patch-endpoint',
    'diff-and-patch-operations',
    'version-controlled-json',
  ],
  'Concurrency and immutability': [
    'immutability-and-concurrency',
    'immutability-explanation',
    'acid-transactions-explanation',
  ],
  'Access control': [
    'access-control',
    'capabilities-api-modes',
    'access-control-with-javascript',
  ],
  'JavaScript client': [
    'javascript',
    'use-the-javascript-client',
    'install-terminusdb-js-client',
  ],
  'GraphQL': [
    'how-to-query-with-graphql',
    'graphql-mutations',
  ],
  'Installation and configuration': [
    'install-terminusdb-as-a-docker-container',
    'docker-advanced-configuration',
    'enterprise-configuration',
    'terminusdb-cli-commands',
  ],
};

const CURATED_SLUGS = new Map();
for (const [topic, slugs] of Object.entries(CURATED)) {
  for (const slug of slugs) CURATED_SLUGS.set(slug, topic);
}

// ── Small helpers ─────────────────────────────────────────────────────────────

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

async function fetchText(url, { json = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'armature-docs-sync (+https://github.com/mossglenn)' },
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return json ? res.json() : res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function withRetry(fn, attempts = 2) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw err; // not transient
      lastErr = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

/** Run `fn` over `items` with bounded concurrency, preserving order of results. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Turn a slug into a safe filename (no directories, no leading dash). */
function slugToFilename(slug) {
  const cleaned = slug
    .replace(/\/index$/, '')
    .replace(/\//g, '__')
    .replace(/^-+/, '')
    .replace(/[^A-Za-z0-9_.-]/g, '-');
  return (cleaned || 'index') + '.md';
}

// ── Markdoc → markdown ────────────────────────────────────────────────────────

/**
 * Split a page.md into its YAML frontmatter block and body. The frontmatter is
 * read with a deliberately small parser: we only need title, description,
 * lastUpdated and tags, and the upstream files are regular enough for that.
 */
function splitFrontmatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: src };
  const fm = {};
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    const kv = line.match(/^\s*([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, raw] = kv;
    const val = raw.trim().replace(/^["']|["']$/g, '');
    // Keep first occurrence of top-level keys; nested nextjs.metadata.* keys
    // appear indented and we read description/title from them if top-level
    // values are absent.
    if (!(key in fm) && val !== '') fm[key] = val;
  }
  // tags are a YAML list under "tags:"; collect "- x" lines until next key
  const tagsIdx = lines.findIndex((l) => /^tags:\s*$/.test(l));
  if (tagsIdx >= 0) {
    const tags = [];
    for (let i = tagsIdx + 1; i < lines.length; i++) {
      const t = lines[i].match(/^\s+-\s+(.+)$/);
      if (!t) break;
      tags.push(t[1].trim());
    }
    fm.tags = tags;
  }
  return { fm, body: src.slice(m[0].length) };
}

/** Parse Markdoc tag attributes: type="note" title="Foo" bar=3 → object. */
function parseAttrs(s) {
  const attrs = {};
  for (const m of s.matchAll(/([A-Za-z_][\w-]*)=("([^"]*)"|'([^']*)'|[^\s%]+)/g)) {
    attrs[m[1]] = m[3] ?? m[4] ?? m[2];
  }
  return attrs;
}

/**
 * Convert a Markdoc {% table %} body to a GFM table.
 *
 * Markdoc table syntax: rows are separated by a line of three or more dashes;
 * each row is a list whose items ("- cell" or "* cell") are the cells. A cell
 * may continue on indented lines. The first row is the header.
 */
function markdocTableToGfm(body) {
  const rows = [];
  let cells = [];
  let current = null;
  const flushCell = () => {
    if (current !== null) cells.push(current.trim());
    current = null;
  };
  const flushRow = () => {
    flushCell();
    if (cells.length) rows.push(cells);
    cells = [];
  };
  for (const line of body.split('\n')) {
    if (/^\s*-{3,}\s*$/.test(line)) {
      flushRow();
      continue;
    }
    // A cell starts with "- " or "* "; an empty cell is a bare "-" or "*".
    const item = line.match(/^[-*](?:\s+(.*))?$/);
    if (item) {
      flushCell();
      current = item[1] ?? '';
      continue;
    }
    if (current !== null) {
      // continuation line for the current cell
      current += ' ' + line.trim();
    }
  }
  flushRow();
  if (rows.length === 0) return '';
  const esc = (c) => c.replace(/\|/g, '\\|').replace(/\s+/g, ' ');
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r) => [...r, ...Array(width - r.length).fill('')];
  const [header, ...data] = rows.map(pad);
  const out = [];
  out.push(`| ${header.map(esc).join(' | ')} |`);
  out.push(`|${header.map(() => '---').join('|')}|`);
  for (const r of data) out.push(`| ${r.map(esc).join(' | ')} |`);
  return out.join('\n');
}

// Attributes may themselves contain "%" (URL-encoded paths), so the attribute
// capture is lazy and anchored on the closing "%}" at end of line.
const TAG_OPEN = /^\s*\{%\s*([a-zA-Z][\w-]*)(.*?)(\/?)\s*%\}\s*$/;
const TAG_CLOSE = /^\s*\{%\s*\/([a-zA-Z][\w-]*)\s*%\}\s*$/;

/**
 * Translate Markdoc tags to plain markdown. Works line by line with a stack so
 * nested tags (a table inside a callout, a code block inside an http-example)
 * are handled in order. Fenced code blocks are passed through untouched.
 */
function convertMarkdoc(body) {
  const lines = body.split('\n');
  const out = [];
  const stack = []; // { name, attrs, start: index into out }
  let inFence = false;
  let fenceMarker = '';

  for (const line of lines) {
    const fence = line.match(/^(\s*)(`{3,}|~{3,})/);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceMarker = fence[2];
      } else if (line.trim().startsWith(fenceMarker)) {
        inFence = false;
      }
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    const close = line.match(TAG_CLOSE);
    if (close) {
      const name = close[1];
      const open = stack.pop();
      if (!open || open.name !== name) {
        // Unbalanced; drop the line and carry on.
        continue;
      }
      const inner = out.splice(open.start).join('\n');
      out.push(...renderBlockTag(name, open.attrs, inner).split('\n'));
      continue;
    }

    const open = line.match(TAG_OPEN);
    if (open) {
      const [, name, attrText, selfClosing] = open;
      const attrs = parseAttrs(attrText);
      if (selfClosing) {
        out.push(...renderSelfClosingTag(name, attrs).split('\n'));
      } else {
        stack.push({ name, attrs, start: out.length });
      }
      continue;
    }

    // Inline tags such as {% $variable %} or {% partial /%} mid-line: drop them.
    out.push(line.replace(/\{%[^%]*%\}/g, ''));
  }

  // Unclosed tags: render whatever was collected.
  while (stack.length) {
    const open = stack.pop();
    const inner = out.splice(open.start).join('\n');
    out.push(...renderBlockTag(open.name, open.attrs, inner).split('\n'));
  }
  return out.join('\n');
}

function renderBlockTag(name, attrs, inner) {
  const content = inner.replace(/^\n+|\n+$/g, '');
  switch (name) {
    case 'table':
      return '\n' + markdocTableToGfm(content) + '\n';
    case 'callout': {
      const title = attrs.title ? `**${attrs.title}**` : attrs.type ? `**${capitalise(attrs.type)}**` : '';
      const quoted = content.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
      return `\n${title ? `> ${title}\n>\n` : ''}${quoted}\n`;
    }
    case 'http-example':
      return `\n${attrs.title ? `**${attrs.title}**\n\n` : ''}${content}\n`;
    case 'http-expected':
      return `\n**Expected response${attrs.status ? ` (${attrs.status})` : ''}:**\n\n${content}\n`;
    case 'tabs':
    case 'tab':
      return `\n${attrs.label || attrs.title ? `**${attrs.label || attrs.title}**\n\n` : ''}${content}\n`;
    default:
      // Unknown block tag: keep the content, drop the wrapper.
      return `\n${content}\n`;
  }
}

function renderSelfClosingTag(name, attrs) {
  switch (name) {
    case 'prerequisites-clone':
    case 'quickstart-clone':
      return '\n> **Prerequisite:** this guide assumes a TerminusDB instance and the example database used throughout the TerminusDB docs (see the live page for the clone snippet).\n';
    case 'figure':
    case 'image':
      return attrs.src ? `\n![${attrs.alt || attrs.caption || ''}](${absolutise(attrs.src)})\n` : '';
    case 'http-example':
      // Self-closing form carries the request itself as attributes.
      return attrs.method || attrs.path
        ? `\n\`\`\`http\n${[attrs.method, attrs.path].filter(Boolean).join(' ')}\n\`\`\`\n`
        : '';
    default:
      return '';
  }
}

function capitalise(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function absolutise(href) {
  return href.startsWith('/') ? SITE + href : href;
}

/** Make site-relative links absolute so they stay clickable in the vendored copy. */
function absolutiseLinks(md) {
  return md.replace(/\]\((\/[^)\s]*)\)/g, (_, path) => `](${SITE}${path})`);
}

function tidy(md) {
  return md
    .replace(/ /g, ' ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── HTML → markdown (fallback) ────────────────────────────────────────────────

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});
turndown.use(gfm);
turndown.remove(['button', 'svg', 'nav', 'aside', 'script', 'style', 'noscript']);

turndown.addRule('prismCodeBlock', {
  filter: (node) => node.nodeName === 'PRE',
  replacement: (_content, node) => {
    const cls = node.getAttribute('class') || '';
    const lang = (cls.match(/language-([A-Za-z0-9_+-]+)/) || [])[1] || '';
    const text = node.textContent.replace(/\n+$/, '');
    const fence = text.includes('```') ? '````' : '```';
    return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
  },
});

turndown.addRule('absoluteLinks', {
  filter: (node) => node.nodeName === 'A' && node.getAttribute('href'),
  replacement: (content, node) => {
    const href = node.getAttribute('href');
    if (href.startsWith('#')) return content;
    // The "Open in ChatGPT / Claude / View raw" toolbar renders as empty links.
    if (!content.trim()) return '';
    const title = node.getAttribute('title');
    return `[${content}](${absolutise(href)}${title ? ` "${title}"` : ''})`;
  },
});

function extractArticle(html) {
  const start = html.indexOf('<article');
  const end = html.lastIndexOf('</article>');
  if (start >= 0 && end > start) return html.slice(start, end + '</article>'.length);
  const m = html.match(/<main[\s\S]*?<\/main>/);
  return m ? m[0] : null;
}

function extractHtmlMeta(html) {
  const head = html.slice(0, html.indexOf('</head>') + 7);
  const title = (head.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
  const desc =
    (head.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [])[1] ||
    (head.match(/<meta\s+content="([^"]*)"\s+name="description"/) || [])[1] ||
    '';
  return { title: decodeEntities(title).trim(), description: decodeEntities(desc).trim() };
}

function htmlToMarkdown(articleHtml) {
  return tidy(
    turndown
      .turndown(articleHtml)
      // Residue of the "Open in ..." toolbar once its empty links are removed.
      .replace(/^Open in\s*$/gm, '')
  );
}

// ── Page acquisition ──────────────────────────────────────────────────────────

/**
 * Fetch one page, preferring the raw Markdoc source. Returns the converted
 * markdown body plus metadata and the method used.
 */
async function acquirePage(slug, docsCommit) {
  const rawUrl = `${RAW_BASE}/${docsCommit}/${DOCS_PATH_PREFIX}${slug}/page.md`;
  try {
    const src = await withRetry(() => fetchText(rawUrl));
    const { fm, body } = splitFrontmatter(src);
    const md = tidy(absolutiseLinks(convertMarkdoc(body)));
    return {
      method: 'markdown',
      sourceMarkdown: `https://github.com/${DOCS_REPO}/blob/${docsCommit}/${DOCS_PATH_PREFIX}${slug}/page.md`,
      title: fm.title || slug,
      description: fm.description || '',
      lastUpdated: fm.lastUpdated || '',
      tags: fm.tags || [],
      body: md,
    };
  } catch (err) {
    if (!(err instanceof HttpError && err.status === 404)) throw err;
  }
  // Fallback: rendered HTML.
  const html = await withRetry(() => fetchText(`${SITE}/docs/${slug}/`));
  const article = extractArticle(html);
  if (!article) throw new Error('no page.md upstream and no <article> in rendered page');
  const meta = extractHtmlMeta(html);
  return {
    method: 'html',
    sourceMarkdown: '',
    title: meta.title || slug,
    description: meta.description,
    lastUpdated: '',
    tags: [],
    body: htmlToMarkdown(article),
  };
}

function frontmatter(p) {
  const q = (s) => JSON.stringify(s);
  const lines = [
    '---',
    `title: ${q(p.title)}`,
    `source: ${p.url}`,
    p.sourceMarkdown ? `source_markdown: ${p.sourceMarkdown}` : null,
    p.description ? `description: ${q(p.description)}` : null,
    p.lastUpdated ? `upstream_last_updated: ${p.lastUpdated}` : null,
    p.tags.length ? `upstream_tags: [${p.tags.join(', ')}]` : null,
    `fetched: ${p.fetched}`,
    `docs_commit: ${p.docsCommit}`,
    `terminusdb_release: ${p.release.tag} (published ${p.release.date})`,
    `conversion: ${p.method}`,
    `curated: ${p.curated}`,
    p.topic ? `topic: ${q(p.topic)}` : null,
    '---',
    '',
    '> **Vendored copy.** Generated by `scripts/sync-terminusdb-docs.js`; do not edit by hand.',
    `> Re-run the script to refresh. Live page: ${p.url}`,
    '',
  ].filter((l) => l !== null);
  return lines.join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const fetched = new Date().toISOString().slice(0, 10);

  // 1. Docs repository head and page list.
  console.log(`Reading docs repository: ${DOCS_REPO}@${DOCS_BRANCH}`);
  const head = await fetchText(`${GITHUB_API}/repos/${DOCS_REPO}/commits/${DOCS_BRANCH}`, { json: true });
  const docsCommit = head.sha;
  const docsCommitDate = (head.commit?.committer?.date || '').slice(0, 10);
  console.log(`  → head ${docsCommit.slice(0, 12)} (${docsCommitDate})`);

  const tree = await fetchText(`${GITHUB_API}/repos/${DOCS_REPO}/git/trees/${docsCommit}?recursive=1`, { json: true });
  if (tree.truncated) console.warn('  ! git tree response was truncated; page list may be incomplete');
  const repoSlugs = tree.tree
    .map((e) => e.path)
    .filter((p) => p.startsWith(DOCS_PATH_PREFIX) && p.endsWith('/page.md'))
    .map((p) => p.slice(DOCS_PATH_PREFIX.length, -'/page.md'.length));
  console.log(`  → ${repoSlugs.length} page.md sources in repository`);

  // 2. Sitemap, for routes that exist without a page.md.
  console.log(`Reading sitemap: ${SITEMAP}`);
  const sitemap = await fetchText(SITEMAP);
  const siteSlugs = [...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(`${SITE}/docs/`))
    .map((u) => u.slice(`${SITE}/docs/`.length).replace(/\/$/, ''))
    .filter((s) => s.length > 0 && !s.endsWith('/index'));
  console.log(`  → ${siteSlugs.length} documentation routes in sitemap`);

  const slugs = [...new Set([...repoSlugs, ...siteSlugs])].sort();
  const onlyInSite = siteSlugs.filter((s) => !repoSlugs.includes(s));
  if (onlyInSite.length) console.log(`  → ${onlyInSite.length} route(s) without page.md will use HTML conversion: ${onlyInSite.join(', ')}`);

  const missingCurated = [...CURATED_SLUGS.keys()].filter((s) => !slugs.includes(s));
  if (missingCurated.length) {
    console.warn('  ! Curated slugs not found upstream (renamed or removed?):');
    for (const s of missingCurated) console.warn(`      ${s}`);
  }

  // 3. Latest server release, for the version stamp.
  let release = { tag: 'unknown', date: 'unknown' };
  try {
    const rel = await fetchText(RELEASES_API, { json: true });
    release = { tag: rel.tag_name, date: (rel.published_at || '').slice(0, 10) };
  } catch (err) {
    console.warn(`  ! Could not read latest release from GitHub: ${err.message}`);
  }
  console.log(`  → Latest TerminusDB server release: ${release.tag} (${release.date})`);

  // 4. Select and fetch.
  let targets = slugs;
  if (ONLY) targets = slugs.filter((s) => ONLY.includes(s));
  else if (CURATED_ONLY) targets = slugs.filter((s) => CURATED_SLUGS.has(s));
  console.log(`\nFetching ${targets.length} page(s)${DRY_RUN ? ' (dry run)' : ''}  [* curated  . other  x failed]`);

  if (!DRY_RUN) {
    mkdirSync(OUT_DIR, { recursive: true });
    mkdirSync(ALL_DIR, { recursive: true });
  }

  const failures = [];
  const residue = [];
  const entries = await pool(targets, CONCURRENCY, async (slug) => {
    const url = `${SITE}/docs/${slug}/`;
    const curated = CURATED_SLUGS.has(slug);
    const topic = CURATED_SLUGS.get(slug);
    const file = slugToFilename(slug);
    try {
      const page = await acquirePage(slug, docsCommit);
      if (page.body.includes('{%')) residue.push(slug);
      if (!DRY_RUN) {
        const out =
          frontmatter({ ...page, url, fetched, docsCommit, release, curated, topic }) + '\n' + page.body + '\n';
        writeFileSync(join(curated ? OUT_DIR : ALL_DIR, file), out);
      }
      process.stdout.write(curated ? '*' : '.');
      return { slug, url, file, curated, topic, ok: true, ...page };
    } catch (err) {
      failures.push({ slug, error: err.message });
      process.stdout.write('x');
      return { slug, url, file, curated, topic, ok: false, title: slug, description: '', lastUpdated: '', method: '' };
    }
  });
  console.log('\n');

  if (!DRY_RUN) {
    if (!ONLY && !CURATED_ONLY) {
      // Remove curated files whose slug left the curated list or upstream.
      const expected = new Set(entries.filter((e) => e.curated && e.ok).map((e) => e.file));
      for (const f of readdirSync(OUT_DIR)) {
        if (f.endsWith('.md') && f !== 'INDEX.md' && f !== 'README.md' && !expected.has(f)) {
          unlinkSync(join(OUT_DIR, f));
          console.log(`  removed stale curated page: ${f}`);
        }
      }
    }
    if (!ONLY) {
      writeFileSync(join(OUT_DIR, 'INDEX.md'), buildIndex(entries, slugs, { fetched, release, docsCommit, docsCommitDate, curatedOnly: CURATED_ONLY }));
      writeFileSync(
        join(OUT_DIR, 'VERSION.json'),
        JSON.stringify(
          {
            fetched,
            docsRepo: DOCS_REPO,
            docsCommit,
            docsCommitDate,
            terminusdbRelease: release,
            pagesUpstream: slugs.length,
            curatedPages: entries.filter((e) => e.curated && e.ok).length,
            vendoredPages: entries.filter((e) => e.ok).length,
            htmlFallbackPages: entries.filter((e) => e.ok && e.method === 'html').map((e) => e.slug),
            markdocResidue: residue,
            failures,
            generator: 'scripts/sync-terminusdb-docs.js',
          },
          null,
          2
        ) + '\n'
      );
    }
  }

  const okCount = entries.filter((e) => e.ok).length;
  const viaHtml = entries.filter((e) => e.ok && e.method === 'html').length;
  console.log(`Done. ${okCount}/${targets.length} page(s) written to ${OUT_DIR} (${viaHtml} via HTML fallback)`);
  if (residue.length) {
    console.log(`\n${residue.length} page(s) still contain "{%" after conversion (new upstream Markdoc tag?):`);
    for (const s of residue) console.log(`  ${s}`);
  }
  if (failures.length) {
    console.log(`\n${failures.length} page(s) failed:`);
    for (const f of failures) console.log(`  ${f.slug}: ${f.error}`);
    process.exitCode = 1;
  }
}

function buildIndex(entries, allSlugs, { fetched, release, docsCommit, docsCommitDate, curatedOnly }) {
  const bySlug = new Map(entries.map((e) => [e.slug, e]));
  const L = [];
  L.push('# TerminusDB documentation index');
  L.push('');
  L.push(`Generated by \`scripts/sync-terminusdb-docs.js\` on ${fetched}. Do not edit by hand.`);
  L.push('');
  L.push(`- Source: [${DOCS_REPO}](https://github.com/${DOCS_REPO}) at commit \`${docsCommit.slice(0, 12)}\` (${docsCommitDate}); rendered at ${SITE}/docs/`);
  L.push(`- TerminusDB server release at sync time: **${release.tag}** (${release.date})`);
  L.push('- Curated pages are committed in this directory. Every other page is written to `_all/`, which is gitignored; if a file is missing locally, run the script or open the source URL.');
  L.push('- "Updated" is the upstream page\'s own `lastUpdated` field where it has one.');
  L.push('');

  L.push('## Curated pages');
  L.push('');
  for (const [topic, slugs] of Object.entries(CURATED)) {
    L.push(`### ${topic}`);
    L.push('');
    L.push('| Page | Local file | Updated | Description |');
    L.push('|---|---|---|---|');
    for (const slug of slugs) {
      const e = bySlug.get(slug);
      if (!e) {
        L.push(`| ${slug} | *(not found upstream)* | | |`);
        continue;
      }
      const local = e.ok ? `\`${e.file}\`` : '*(fetch failed)*';
      L.push(`| [${esc(e.title)}](${e.url}) | ${local} | ${e.lastUpdated || ''} | ${esc(e.description)} |`);
    }
    L.push('');
  }

  L.push('## All pages');
  L.push('');
  if (curatedOnly) {
    L.push('*(Run without `--curated-only` to populate titles and descriptions for the full set.)*');
    L.push('');
  }
  L.push('| Page | Local file | Updated | Description |');
  L.push('|---|---|---|---|');
  for (const slug of allSlugs) {
    const e = bySlug.get(slug);
    const url = `${SITE}/docs/${slug}/`;
    if (!e) {
      L.push(`| [${esc(slug)}](${url}) | *(not fetched)* | | |`);
      continue;
    }
    const dir = e.curated ? '' : '_all/';
    const local = e.ok ? `\`${dir}${e.file}\`` : '*(fetch failed)*';
    L.push(`| [${esc(e.title)}](${e.url}) | ${local} | ${e.lastUpdated || ''} | ${esc(e.description)} |`);
  }
  L.push('');
  return L.join('\n');
}

function esc(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

main().catch((err) => {
  console.error('\nError:', err.message || err);
  process.exit(1);
});
