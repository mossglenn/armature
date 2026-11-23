/**
 * The names the pages use to reach the shell, held to the shell's own (the 2026-11-09 review's T8).
 * The page tests run against the fake core, so nothing exercises `backend.ts`'s Tauri branch: a
 * command renamed in Rust, an argument renamed on either side or the event's name changed would pass
 * every page test and fail only in the program. This reads both sources and compares them: each
 * `invoke` in `backend.ts` names a `#[tauri::command]` registered in `generate_handler!`, with the
 * arguments the function takes, and the event the pages listen for is the one the shell emits.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const backend = readFileSync(join(desktop, 'src', 'lib', 'backend.ts'), 'utf8');
const rustDir = join(desktop, 'src-tauri', 'src');
const rust = Object.fromEntries(readdirSync(rustDir).filter((f) => f.endsWith('.rs')).map((f) => [f, readFileSync(join(rustDir, f), 'utf8')]));
const allRust = Object.values(rust).join('\n');

/** Each `invoke('name', { a, b: c })` in backend.ts: the command and the argument names it sends. */
const invoked = [...backend.matchAll(/invoke\('(\w+)'(?:,\s*\{([^}]*)\})?\)/g)].map(([, name, args]) => ({
  name: name!,
  args: (args ?? '')
    .split(',')
    .map((part) => part.split(':')[0]!.trim())
    .filter(Boolean),
}));

/** The commands the shell registers, from `generate_handler![...]`. */
const registered = (/generate_handler!\[([^\]]*)\]/.exec(rust['lib.rs'] ?? '')?.[1] ?? '').split(',').map((s) => s.trim()).filter(Boolean);

/** A command's own parameters, in Tauri's camelCase, leaving out what Tauri supplies (the app handle, state, the window). */
function parameters(name: string): string[] | undefined {
  const found = new RegExp(`#\\[tauri::command\\][^\\n]*\\n(?:\\s*#\\[[^\\n]*\\n)*\\s*(?:pub\\s+)?(?:async\\s+)?fn\\s+${name}\\s*\\(([^)]*)\\)`).exec(allRust);
  if (!found) return undefined;
  return found[1]!
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !/:\s*(AppHandle|State<|Window|WebviewWindow|tauri::)/.test(p))
    .map((p) => p.split(':')[0]!.trim().replace(/_(\w)/g, (_, c: string) => c.toUpperCase()));
}

test.describe('the pages’ names for the shell are the shell’s own', () => {
  test('backend.ts invokes commands, and the shell registers every one', () => {
    expect(invoked.length).toBeGreaterThan(0);
    for (const { name } of invoked) expect(registered, `${name} is invoked by backend.ts`).toContain(name);
  });

  test('each command is sent the arguments its function takes, by name', () => {
    for (const { name, args } of invoked) {
      const params = parameters(name);
      expect(params, `${name} is a #[tauri::command]`).toBeDefined();
      expect([...args].sort(), `the arguments of ${name}`).toEqual([...params!].sort());
    }
  });

  test('the event the pages listen for is the one the shell emits', () => {
    const listened = [...backend.matchAll(/listen<\w+>\('([\w-]+)'/g)].map(([, name]) => name!);
    expect(listened).toHaveLength(1);
    const emitted = new Set([...allRust.matchAll(/\.emit\("([\w-]+)"/g)].map(([, name]) => name!));
    for (const name of listened) expect([...emitted], `${name} is listened for in backend.ts`).toContain(name);
  });
});
