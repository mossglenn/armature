#!/usr/bin/env node
// Checks the context files against their budgets (docs/context-files-plan.md §3 and §4).
//
// CLAUDE.md is injected into every turn of every AI-assisted session and SESSION.md
// is read at the start of each one, so their size is a cost paid constantly; the
// budgets keep state and rules in these files and move history and narrative out
// (to HISTORY.md, the ADRs and the documents). Over budget means move, not shorten.
//
// Runs in CI's app job beside the generated-types drift check, and from the root:
//   npm run check:context
// No dependencies; Node 22 or later.

import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BUDGETS = {
  '.claude/CLAUDE.md': 42 * 1024,
  '.claude/SESSION.md': 32 * 1024,
  '.claude/PROJECT_CONTEXT.md': 20 * 1024,
};

let failed = false;
for (const [file, budget] of Object.entries(BUDGETS)) {
  const size = statSync(join(root, file)).size;
  const kb = (n) => (n / 1024).toFixed(1);
  if (size > budget) {
    failed = true;
    console.error(`OVER  ${file}: ${kb(size)} KB against a budget of ${kb(budget)} KB. Move something out (prompts/update-session.md, step 5), do not shorten words.`);
  } else {
    console.log(`ok    ${file}: ${kb(size)} KB of ${kb(budget)} KB`);
  }
}
process.exit(failed ? 1 : 0);
