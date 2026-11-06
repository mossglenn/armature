/**
 * The spike's core (docs/desktop-program-plan.md §5, §14 step 1): the hub's
 * host as app/server.ts is, driven by JSON lines on standard input instead of
 * the environment, answering on standard output. Throwaway; only its
 * measurements are kept.
 *
 *   in:  {"id":1,"op":"start","settings":{"dir","port","remote","localToken"}}
 *        {"id":2,"op":"ping"}
 *        {"id":3,"op":"stop"}
 *   out: {"event":"ready","pid","bootMs","node"}           once, at load
 *        {"id","op","ok":true,...} or {"id","op","ok":false,"error"}
 *
 * Standard input closing is a stop too: a shell killed outright cannot send
 * one, and the child must not outlive it holding the port and the lock.
 */
import { createInterface } from 'node:readline';
import { configFromEnv } from '../../app/lib/api/config';
import { openFileStore } from '../../app/lib/api/filestore/store';
import { startHub, type RunningHub } from '../../app/lib/hub';
import { folderFiles, folderRecords, lockFolder } from '../../app/lib/workspaceFolder';

interface Settings {
  dir: string;
  port: number;
  remote: string;
  localToken: string;
}

let hub: RunningHub | undefined;
let unlock: (() => Promise<void>) | undefined;
let stopping: Promise<void> | undefined;

const send = (message: unknown): Promise<void> =>
  new Promise((done) => process.stdout.write(`${JSON.stringify(message)}\n`, () => done()));

const rssMiB = () => Math.round(process.memoryUsage().rss / 1048576);

async function start(settings: Settings) {
  if (hub) throw new Error('already started');
  const began = performance.now();
  const config = configFromEnv({
    ARMATURE_ROLE: 'workspace',
    ARMATURE_REMOTE_URL: settings.remote,
    ARMATURE_WORKSPACE_DIR: settings.dir,
    ARMATURE_LOCAL_TOKEN: settings.localToken,
  });
  unlock = await lockFolder(settings.dir);
  const files = openFileStore(folderFiles(settings.dir));
  hub = await startHub({ port: settings.port, hostname: '127.0.0.1', config: { ...config, workspaces: folderRecords(settings.dir), store: () => ({ files }) } });
  return { url: hub.url, revision: hub.revision, dir: settings.dir, ms: Math.round(performance.now() - began), rssMiB: rssMiB() };
}

function stop(): Promise<void> {
  stopping ??= (async () => {
    await hub?.close();
    await unlock?.();
  })();
  return stopping;
}

async function handle(message: { op?: string; settings?: Settings }) {
  switch (message.op) {
    case 'start':
      return start(message.settings as Settings);
    case 'ping':
      return { pid: process.pid, uptimeMs: Math.round(process.uptime() * 1000), rssMiB: rssMiB(), listening: hub?.url ?? null };
    case 'stop': {
      const began = performance.now();
      await stop();
      return { ms: Math.round(performance.now() - began) };
    }
    default:
      throw new Error(`unknown op ${JSON.stringify(message.op)}`);
  }
}

await send({ event: 'ready', pid: process.pid, bootMs: Math.round(process.uptime() * 1000), node: process.version, rssMiB: rssMiB() });

const lines = createInterface({ input: process.stdin });
lines.on('line', async (line) => {
  let message: { id?: number; op?: string; settings?: Settings };
  try {
    message = JSON.parse(line);
  } catch {
    await send({ event: 'error', error: 'not a JSON line', line });
    return;
  }
  try {
    const answer = await handle(message);
    await send({ id: message.id, op: message.op, ok: true, ...answer });
    if (message.op === 'stop') process.exit(0);
  } catch (err) {
    await send({ id: message.id, op: message.op, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});
// The shell gone (closed its end, or killed outright): stop as if told to.
lines.on('close', () => {
  void stop().then(
    () => process.exit(0),
    () => process.exit(1)
  );
});
