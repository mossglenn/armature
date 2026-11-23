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
 *
 * The bundle is made by `npm run build:desktop` itself, only its output
 * moved, so the suite runs what the program ships and not a copy of the
 * options (the 2026-11-09 review's T7). It runs on this process's Node, or
 * on the one `ARMATURE_TEST_NODE` names: desktop.yml points it at the Node
 * `prepare.mjs` fetched for the program, so the shipped runtime is tested too.
 */
import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DRAIN_MS } from './protocol';

const APP = fileURLToPath(new URL('../..', import.meta.url));
const NODE = process.env.ARMATURE_TEST_NODE || process.execPath;
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
  // `npm run build:desktop` as package.json has it; esbuild takes the last `--outfile`, so app/dist is left alone.
  execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:desktop', '--silent', '--', `--outfile=${bundle}`], {
    cwd: APP,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  // The script's own options came with it: its source map is beside the bundle.
  expect(existsSync(`${bundle}.map`)).toBe(true);
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
  const child = spawn(NODE, [bundle], { env, stdio: ['pipe', 'pipe', 'pipe'] });
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
    // Nothing but the channel's lines on standard output, and the pairing key in none of the log lines.
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

  it('hosts the hub for a remote that signs people in, offline of the provider and signed out, and exits when its input ends (T7)', async () => {
    const dataDir = join(work, 'data-oidc');
    const port = await freePort();
    await mkdir(dataDir, { recursive: true });
    // A loopback remote and a provider this test never calls: a start asks neither, and with no refresh token kept there is nothing to refresh.
    await writeFile(
      join(dataDir, 'settings.json'),
      JSON.stringify({ remote: 'http://127.0.0.1:9', identity: { resolver: 'oidc', issuer: 'https://login.example.edu/realms/armature', clientId: 'armature-desktop' }, port })
    );
    const core = launch();
    core.child.stdin.write(`${JSON.stringify({ id: 1, type: 'start', dataDir })}\n`);
    expect(await core.next((m) => m.id === 1)).toMatchObject({
      status: 200,
      body: { started: true, resolver: 'oidc', signedIn: false, issuer: 'https://login.example.edu/realms/armature', clientId: 'armature-desktop' },
    });
    const discover = (await (await fetch(`http://127.0.0.1:${port}/api/v1/discover`)).json()) as { role: string };
    expect(discover.role).toBe('workspace');
    core.child.stdin.write(`${JSON.stringify({ id: 2, type: 'whoAmI' })}\n`);
    expect(await core.next((m) => m.id === 2)).toMatchObject({ status: 401, body: { error: 'signed_out' } });
    core.child.stdin.end();
    expect(await core.exited).toBe(0);
    expect(existsSync(join(dataDir, 'workspaces', 'lock'))).toBe(false);
  }, 30_000);

  it('exits when its input ends with a request still in flight, within its drain bound, and releases the lock (T7)', async () => {
    // A remote that takes the connection and never answers: the profile read would wait its own fifteen seconds.
    const held: Socket[] = [];
    // The core's exit resets its end on Windows (ECONNRESET here), which is the point, not a failure.
    const silent = createServer((socket) => {
      socket.on('error', () => undefined);
      held.push(socket);
    });
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    const remote = `http://127.0.0.1:${(silent.address() as { port: number }).port}`;
    try {
      const dataDir = join(work, 'data-inflight');
      const port = await freePort();
      await mkdir(dataDir, { recursive: true });
      await writeFile(join(dataDir, 'settings.json'), JSON.stringify({ remote: 'http://127.0.0.1:9', identity: { resolver: 'header' }, user: 'u', port }));
      const core = launch();
      core.child.stdin.write(`${JSON.stringify({ id: 1, type: 'start', dataDir })}\n`);
      await core.next((m) => m.id === 1);
      core.child.stdin.write(`${JSON.stringify({ id: 2, type: 'profile', remote })}\n`);
      // The read has reached the remote before the shell goes.
      for (let i = 0; i < 100 && !held.length; i++) await new Promise((resolve) => setTimeout(resolve, 20));
      expect(held.length).toBeGreaterThan(0);
      const ended = Date.now();
      core.child.stdin.end();
      expect(await core.exited).toBe(0);
      // Bounded by the drain, not by the remote call's own deadline.
      expect(Date.now() - ended).toBeLessThan(DRAIN_MS + 3_000);
      expect(existsSync(join(dataDir, 'workspaces', 'lock'))).toBe(false);
    } finally {
      held.forEach((socket) => socket.destroy());
      await new Promise((resolve) => silent.close(resolve));
    }
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
