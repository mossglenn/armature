/**
 * The operator tools' entry point (ADR-0062): repair outside the plugin API,
 * with the store's credentials, as new commits.
 *
 * `npm run build:operator` bundles this file with the hub's own modules (the
 * adapter, the invariants engine, the write pipeline) into one
 * `dist/operator.mjs`, as `build:hub` bundles the hub, so "consistent" means
 * one thing in the API and at the operator's desk. The hub's image carries the
 * bundle beside `server.mjs`, so on a server the tools run where the
 * credentials already are: `docker compose exec hub node operator.mjs check`.
 * On the host, `npm run operator --workspace app -- <command>` builds and runs
 * it with `.env.local`, as the hub reads it.
 *
 * Environment: TERMINUS_URL, TERMINUS_USER, TERMINUS_PASS, TERMINUS_DB.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { ApiError } from './lib/api/errors';
import { InvariantError } from './lib/api/invariants';
import { createStore, StoreError } from './lib/api/store';
import { loadEnvLocal } from './lib/envLocal';
import { checkBranch } from './lib/operator/check';
import { deleteDocument, deleteScratchBranch, OperatorError, putDocuments } from './lib/operator/repair';

const USAGE = `Usage: node operator.mjs <command> [options]

  check [--branch <name> | --commit <id>] [--json]
      Every rule over every document at the ref (default: --branch main).
      Read-only. Exits 1 when anything is violated.

  delete <id> --branch <name> --as <externalId> --reason <text>
      Deletes one document as a commit by the operator's User. The store
      refuses a document another document references.

  delete --scratch-branch <name> --as <externalId>
      Deletes a branch whose name starts with test-, warmup-, anon-, future-
      or operator- (a repair's own, left by a crash). Its commits stay
      readable by id; the head is printed.

  put <file.json | -> --branch <name> --as <externalId> --reason <text> [--unchecked]
      Writes one document or an array of them through the API's pipeline.
      --unchecked skips the hub's rules (never the store's) and says so in the
      commit message; run check afterward.
`;

class UsageError extends Error {}

function need(value: string | undefined, flag: string): string {
  if (!value) throw new UsageError(`${flag} is required`);
  return value;
}

async function check(values: Record<string, unknown>): Promise<number> {
  if (values.branch && values.commit) throw new UsageError('give --branch or --commit, not both');
  const ref = values.commit ? { commit: String(values.commit) } : { branch: String(values.branch ?? 'main') };
  const report = await checkBranch(createStore(ref));
  if (values.json) {
    console.log(JSON.stringify({ ref, ...report }, null, 2));
    return report.violations.length ? 1 : 0;
  }
  const where = 'branch' in ref ? ` on branch ${ref.branch}` : '';
  console.log(`Checked ${report.documents} documents${where} at commit ${report.commit}`);
  console.log('Skipped, as rules about a write rather than a state:');
  for (const { code, reason } of report.skipped) console.log(`  ${code}: ${reason}`);
  if (!report.violations.length) {
    console.log('No violations.');
    return 0;
  }
  console.log(`${report.violations.length} violation(s):`);
  for (const v of report.violations) {
    const where = v.id ?? (v.index >= 0 ? `(document ${v.index})` : '(the branch list)');
    console.log(`  ${v.code}  ${where}${v.field ? `  ${v.field}` : ''}\n    ${v.message}`);
  }
  return 1;
}

async function remove(positionals: string[], values: Record<string, unknown>): Promise<number> {
  if (values['scratch-branch']) {
    if (positionals.length) throw new UsageError('delete --scratch-branch takes no document id');
    const name = String(values['scratch-branch']);
    const { head, revoked } = await deleteScratchBranch(name, { as: need(values.as as string | undefined, '--as') });
    if (revoked.length) console.log(`Revoked ${revoked.length} grant(s) on ${name}`);
    console.log(`Deleted branch ${name}; its head ${head?.id ?? '(none)'} stays readable by id`);
    return 0;
  }
  const [id] = positionals;
  const { commit, before } = await deleteDocument({
    id: need(id, 'a document id'),
    branch: need(values.branch as string | undefined, '--branch'),
    as: need(values.as as string | undefined, '--as'),
    reason: need(values.reason as string | undefined, '--reason'),
  });
  console.log(`Deleted ${id} in commit ${commit}; it stays readable at ${before?.id ?? 'the commit before'}`);
  return 0;
}

async function put(positionals: string[], values: Record<string, unknown>): Promise<number> {
  const file = need(positionals[0], 'a file (or - for standard input)');
  const parsed: unknown = JSON.parse(readFileSync(file === '-' ? 0 : file, 'utf8'));
  const result = await putDocuments({
    documents: Array.isArray(parsed) ? parsed : [parsed],
    branch: need(values.branch as string | undefined, '--branch'),
    as: need(values.as as string | undefined, '--as'),
    reason: need(values.reason as string | undefined, '--reason'),
    unchecked: values.unchecked === true,
  });
  console.log(`Wrote ${result.ids.join(', ')} in commit ${result.commit}`);
  if (values.unchecked) console.log("The hub's rules were skipped; run check on the branch now.");
  return 0;
}

async function main(): Promise<number> {
  loadEnvLocal();
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      branch: { type: 'string' },
      commit: { type: 'string' },
      as: { type: 'string' },
      reason: { type: 'string' },
      'scratch-branch': { type: 'string' },
      unchecked: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  if (command === 'check') return check(values);
  if (command === 'delete') return remove(rest, values);
  if (command === 'put') return put(rest, values);
  throw new UsageError(`unknown command ${command}`);
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    if (err instanceof UsageError || (err instanceof TypeError && 'code' in err && String(err.code).startsWith('ERR_PARSE_ARGS'))) {
      console.error(`${err.message}\n\n${USAGE}`);
      process.exit(2);
    }
    if (err instanceof InvariantError) {
      console.error(`Refused: ${err.message}`);
      for (const v of err.violations) console.error(`  ${v.code}  ${v.id ?? `(document ${v.index})`}  ${v.message}`);
    } else if (err instanceof ApiError) {
      console.error(`Refused: ${err.code}: ${err.message}${err.details ? `\n${JSON.stringify(err.details, null, 2)}` : ''}`);
    } else if (err instanceof StoreError) {
      console.error(`The store refused: ${err.status} ${err.type}\n${JSON.stringify(err.body, null, 2)}`);
    } else if (err instanceof OperatorError) {
      console.error(err.message);
    } else {
      console.error(err instanceof Error ? err.message : err);
    }
    process.exit(1);
  }
);
