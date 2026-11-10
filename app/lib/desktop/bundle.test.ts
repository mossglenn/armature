/**
 * The core as the shell runs it (ADR-0069 decisions 2 to 4;
 * docs/desktop-program-plan.md §12): `desktop.ts` bundled as
 * `npm run build:desktop` bundles it, started as a child of this process
 * with nothing in its arguments or environment, spoken to over its pipes.
 * The hub listens, holds the folder's lock and refuses the action routes;
 * standard output carries nothing but JSON lines; and the input's end, the
 * shell gone, stops the hub and releases the lock before the process exits.
 * The remote is never called, so no store and no remote are needed; this
 * suite runs in the files config, on Windows too.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP = fileURLToPath(new URL('../..', import.meta.url));
let work: string;
let bundle: string;

/** A port free a moment ago; the hub's settings take a fixed port, as a person's do. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), 'armature-bundle-'));
  bundle = join(work, 'desktop.mjs');
  // The options of `npm run build:desktop` (package.json).
  await build({
    entryPoints: [join(APP, 'desktop.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile: bundle,
    banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
    logLevel: 'silent',
  });
}, 60_000);

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

/** The core started as the shell starts it, and its standard output read as lines. */
function launch(): { child: ChildProcessWithoutNullStreams; lines: string[]; next: (match: (m: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>; exited: Promise<number | null> } {
  // Nothing in its environment but what Windows needs to open a socket: no credential travels there (plan §5),
  // and the shell itself passes only the folders the core reads and `SystemRoot` (`KEPT_ENVIRONMENT` in core.rs).
  // (Cast: the project's types make NODE_ENV required in an environment, which this one deliberately lacks.)
  const env = (process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {}) as NodeJS.ProcessEnv;
  const child = spawn(process.execPath, [bundle], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines: string[] = [];
  const waiting: Array<() => void> = [];
  let buffered = '';
  child.stdout.on('data', (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    let end: number;
    while ((end = buffered.indexOf('\n')) >= 0) {
      lines.push(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
    }
    waiting.splice(0).forEach((wake) => wake());
  });
  const exited = new Promise<number | null>((resolve) => child.once('exit', (code) => resolve(code)));
  const next = async (match: (m: Record<string, unknown>) => boolean) => {
    for (;;) {
      const found = lines.map((line) => JSON.parse(line) as Record<string, unknown>).find(match);
      if (found) return found;
      await new Promise<void>((wake) => waiting.push(wake));
    }
  };
  return { child, lines, next, exited };
}

describe('the core’s bundle, run as the shell runs it', () => {
  it('hosts the hub over the folder, then stops it and releases the lock when its input ends', async () => {
    const dataDir = join(work, 'data');
    const port = await freePort();
    await mkdir(dataDir, { recursive: true });
    // A remote this test never calls: starting the hub asks the remote nothing.
    await writeFile(
      join(dataDir, 'settings.json'),
      JSON.stringify({ remote: 'http://127.0.0.1:9', identity: { resolver: 'header' }, user: 'demo-designer@example.edu', port })
    );
    const core = launch();
    core.child.stdin.write(`${JSON.stringify({ id: 1, type: 'start', dataDir })}\n`);
    const started = await core.next((m) => m.id === 1);
    expect(started).toMatchObject({ status: 200, body: { started: true, url: `http://127.0.0.1:${port}`, resolver: 'header' } });
    const { localToken } = started.body as { localToken: string };
    expect(localToken).toMatch(/^[0-9a-f]{64}$/);
    const lock = join(dataDir, 'workspaces', 'lock');
    expect(existsSync(lock)).toBe(true);

    const hub = `http://127.0.0.1:${port}/api/v1`;
    const discover = (await (await fetch(`${hub}/discover`)).json()) as { role: string; capabilities: Record<string, { actions?: string }> };
    expect(discover.role).toBe('workspace');
    expect(discover.capabilities['armature/workspace'].actions).toBe('program');
    const refused = await fetch(`${hub}/workspace/any/push`, { method: 'POST', headers: { 'Armature-User': 'demo-designer@example.edu', 'Armature-Local-Token': localToken } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ reason: 'program_action' });

    // The shell gone: its end of the pipe closes.
    core.child.stdin.end();
    expect(await core.exited).toBe(0);
    expect(existsSync(lock)).toBe(false);
    await expect(fetch(`${hub}/discover`)).rejects.toThrow();
    // Nothing but the channel's lines on standard output, and the local token in none of the log lines.
    const messages = core.lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(messages.some((m) => m.event === 'log')).toBe(true);
    expect(messages.filter((m) => m.event === 'log').every((m) => !String(m.line).includes(localToken))).toBe(true);
  }, 30_000);

  it('stops on `stop` and stays, then exits when its input ends', async () => {
    const dataDir = join(work, 'data-stop');
    const port = await freePort();
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ remote: 'http://127.0.0.1:9', identity: { resolver: 'header' }, user: 'u', port }));
    const core = launch();
    core.child.stdin.write(`${JSON.stringify({ id: 'a', type: 'start', dataDir, localToken: 'kept-by-the-keychain' })}\n`);
    const started = await core.next((m) => m.id === 'a');
    // A kept token is used as it is and not sent back.
    expect(started.body).not.toHaveProperty('localToken');
    core.child.stdin.write(`${JSON.stringify({ id: 'b', type: 'stop' })}\n`);
    expect(await core.next((m) => m.id === 'b')).toMatchObject({ status: 200, body: { stopped: true } });
    expect(existsSync(join(dataDir, 'workspaces', 'lock'))).toBe(false);
    expect(core.child.exitCode).toBeNull();
    core.child.stdin.end();
    expect(await core.exited).toBe(0);
  }, 30_000);

  it.skipIf(process.platform === 'win32')('stops and releases the lock on SIGTERM, as when the system ends it', async () => {
    const dataDir = join(work, 'data-term');
    const port = await freePort();
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ remote: 'http://127.0.0.1:9', identity: { resolver: 'header' }, user: 'u', port }));
    const core = launch();
    core.child.stdin.write(`${JSON.stringify({ id: 1, type: 'start', dataDir })}\n`);
    await core.next((m) => m.id === 1);
    core.child.kill('SIGTERM');
    expect(await core.exited).toBe(0);
    expect(existsSync(join(dataDir, 'workspaces', 'lock'))).toBe(false);
  }, 30_000);
});
