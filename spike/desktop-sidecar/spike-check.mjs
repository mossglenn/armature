// The spike's measurements on one machine (docs/desktop-program-plan.md §14 step 1).
// Throwaway. Runs the built shell and reports, as JSON lines:
//   - three timed launches that quit themselves (SPIKE_AUTOQUIT=1)
//   - the shell killed outright (SIGKILL; TerminateProcess on Windows)
//   - the shell closed as the system closes it (SIGTERM; on Windows `taskkill` without /F, a WM_CLOSE)
//   - the core killed outright while the shell runs
// After each: whether the core and the shell are still alive, whether the folder's lock is left,
// and whether the next start succeeds. Reads the shell's events from the file SPIKE_LOG names,
// since a Windows release build has no console.
//
//   node spike-check.mjs "<path to the shell's executable>"
import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const bin = process.argv[2];
if (!bin || !existsSync(bin)) throw new Error(`Give the shell's executable; ${JSON.stringify(bin)} does not exist`);
const windows = process.platform === 'win32';
const logs = mkdtempSync(join(tmpdir(), 'armature-spike-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
let runs = 0;

function launch(env = {}) {
  const log = join(logs, `run-${++runs}.jsonl`);
  const began = Date.now();
  // The shell's own output, kept so a shell that never starts says why.
  const out = `${log}.out`;
  const fd = openSync(out, 'w');
  const shell = spawn(bin, [], { env: { ...process.env, SPIKE_LOG: log, ...env }, stdio: ['ignore', fd, fd] });
  closeSync(fd);
  const exited = new Promise((r) => shell.on('exit', (code, signal) => r({ code, signal, wallMs: Date.now() - began })));
  const events = () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const until = async (test, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(25)) {
      const found = events().find(test);
      if (found) return found;
    }
    const said = existsSync(out) ? readFileSync(out, 'utf8').split('\n').slice(-30).join('\n') : '';
    throw new Error(`timed out waiting in ${log}: ${JSON.stringify(events())}; the shell ${alive(shell.pid) ? 'is running' : 'has exited'} and said:\n${said}`);
  };
  return { shell, exited, events, until };
}

const lockOf = (started) => join(started.core.dir, 'lock');

async function timed() {
  const run = launch({ SPIKE_AUTOQUIT: '1' });
  const ready = await run.until((m) => m.event === 'ready');
  const started = await run.until((m) => m.event === 'started');
  const exit = await run.exited;
  const ended = run.events().find((m) => m.event === 'core_exited');
  return {
    case: 'timed launch',
    ok: started.core.ok === true,
    spawnToReadyMs: ready.spawnToReadyMs,
    coreBootMs: ready.core.bootMs,
    startToStartedMs: started.startToStartedMs,
    launchToListeningMs: started.sinceLaunchMs,
    coreRssMiB: started.core.rssMiB,
    stopToExitMs: ended?.stopToExitMs,
    coreExitCode: ended?.code,
    shellExit: exit,
    lockLeft: existsSync(lockOf(started)),
  };
}

async function hardExit(name, act) {
  const run = launch();
  const spawned = await run.until((m) => m.event === 'spawned');
  const started = await run.until((m) => m.event === 'started');
  const lock = lockOf(started);
  const report = await act(run, spawned.pid);
  await wait(2000);
  const after = { coreAlive: alive(spawned.pid), shellAlive: alive(run.shell.pid), lockLeft: existsSync(lock) };
  if (after.shellAlive) {
    run.shell.kill('SIGKILL');
    await wait(500);
  }
  if (alive(spawned.pid)) process.kill(spawned.pid, 'SIGKILL');
  const next = launch({ SPIKE_AUTOQUIT: '1' });
  const restarted = await next.until((m) => m.event === 'started');
  await next.exited;
  return { case: name, ...report, ...after, nextStartOk: restarted.core.ok === true, nextLaunchToListeningMs: restarted.sinceLaunchMs, lockAfterNext: existsSync(lock) };
}

const print = (o) => console.log(JSON.stringify(o));
print({ machine: { platform: process.platform, arch: process.arch, shell: bin, shellMiB: +(statSync(bin).size / 1048576).toFixed(1) } });
for (let i = 0; i < 3; i++) print(await timed());
print(await hardExit('shell killed outright', async (run) => (run.shell.kill('SIGKILL'), { shellExit: await run.exited })));
print(
  await hardExit(windows ? 'shell closed by taskkill (WM_CLOSE)' : 'shell sent SIGTERM', async (run) => {
    if (windows) execFileSync('taskkill', ['/PID', String(run.shell.pid)], { stdio: 'ignore' });
    else run.shell.kill('SIGTERM');
    const exit = await run.exited;
    const ended = run.events().find((m) => m.event === 'core_exited');
    return { shellExit: exit, shellStoppedTheCore: ended ? { expected: ended.expected, code: ended.code, stopToExitMs: ended.stopToExitMs } : null };
  })
);
print(
  await hardExit('core killed outright, shell running', async (run, corePid) => {
    process.kill(corePid, 'SIGKILL');
    const ended = await run.until((m) => m.event === 'core_exited');
    return { shellSaw: { code: ended.code, signal: ended.signal, expected: ended.expected } };
  })
);
print({ logs });
