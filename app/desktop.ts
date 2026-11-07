/**
 * The desktop program's core (docs/desktop-program-plan.md §3 and §5;
 * ADR-0069): the host of a workspace hub, driven by the shell over its
 * standard input and output, one JSON object per line (lib/desktop/protocol.ts).
 *
 * `npm run build:desktop` bundles this file and everything it imports into
 * one `dist/desktop.mjs`, which the shell starts with the Node executable it
 * ships (`armature-node desktop.mjs`). Run in a terminal, it is its own
 * command-line driver: type a request, read the reply. For example, with a
 * remote under `header` and a data folder of your choosing:
 *
 *   {"id":1,"type":"start","dataDir":"/tmp/armature-dev"}
 *   {"id":2,"type":"connect","remote":"http://100.70.195.100:3100"}
 *   {"id":3,"type":"settings","set":{"user":"demo-designer@example.edu"}}
 *   {"id":4,"type":"start","dataDir":"/tmp/armature-dev"}
 *   {"id":5,"type":"create","name":"unit-3"}
 *
 * The requests, their fields and their answers are listed in
 * lib/desktop/core.ts and the plan's §5. The core reads no environment
 * variable and takes no argument: a credential in either would be readable by
 * other processes (plan §5), so everything comes over the channel.
 *
 * Standard output is the channel, so `console` becomes `log` events; nothing
 * else may write there. The input's end (the shell gone, or Ctrl-D in a
 * terminal) stops the hub and releases the folder's lock, then exits
 * (ADR-0069 decision 4); so do SIGTERM and SIGINT.
 */
import { format } from 'node:util';
import { runCore } from './lib/desktop/core';

const core = runCore({ input: process.stdin, output: process.stdout });

for (const [method, level] of [
  ['log', 'info'],
  ['info', 'info'],
  ['debug', 'debug'],
  ['warn', 'warn'],
  ['error', 'error'],
] as const) {
  console[method] = (...args: unknown[]) => core.emit({ event: 'log', level, line: format(...args) });
}

/** Exits once what was written to the shell has left the process: a pipe's writes are asynchronous on macOS, and an exit would drop the last reply. */
const exit = (code: number) => process.stdout.write('', () => process.exit(code));

let quitting = false;
const quit = () => {
  if (quitting) process.exit(1);
  quitting = true;
  core.stop().then(() => exit(0), () => exit(1));
};
process.on('SIGTERM', quit);
process.on('SIGINT', quit);

core.closed.then(() => exit(0), () => exit(1));
