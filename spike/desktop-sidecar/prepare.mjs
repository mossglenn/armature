// The spike's build step: bundles core.ts into core/core.mjs, as build:hub bundles
// app/server.ts, and puts Node for this machine's target triple where Tauri's
// externalBin expects it (src-tauri/binaries/armature-node-<triple>[.exe]; not `node`, which a Linux
// package would install as /usr/bin/node beside the system's), verified against
// nodejs.org's SHASUMS256.txt. Run from anywhere: node spike/desktop-sidecar/prepare.mjs
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const NODE = 'v22.23.4';
const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, 'core.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outfile: join(here, 'core', 'core.mjs'),
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
console.log(`core/core.mjs: ${(statSync(join(here, 'core', 'core.mjs')).size / 1048576).toFixed(2)} MiB`);

const triple = execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
const dists = {
  'aarch64-apple-darwin': { name: 'darwin-arm64', ext: 'tar.gz', inner: 'bin/node' },
  'x86_64-apple-darwin': { name: 'darwin-x64', ext: 'tar.gz', inner: 'bin/node' },
  'x86_64-pc-windows-msvc': { name: 'win-x64', ext: 'zip', inner: 'node.exe' },
  'aarch64-pc-windows-msvc': { name: 'win-arm64', ext: 'zip', inner: 'node.exe' },
  'x86_64-unknown-linux-gnu': { name: 'linux-x64', ext: 'tar.gz', inner: 'bin/node' },
  'aarch64-unknown-linux-gnu': { name: 'linux-arm64', ext: 'tar.gz', inner: 'bin/node' },
};
const dist = dists[triple];
if (!dist) throw new Error(`No Node distribution mapped for ${triple}`);
const exe = triple.includes('windows') ? '.exe' : '';
const target = join(here, 'src-tauri', 'binaries', `armature-node-${triple}${exe}`);
if (existsSync(target)) {
  console.log(`${target} present (${(statSync(target).size / 1048576).toFixed(1)} MiB)`);
} else {
  const base = `node-${NODE}-${dist.name}`;
  const file = `${base}.${dist.ext}`;
  const cache = join(here, '.cache', 'node-download');
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, file);
  if (!existsSync(archive)) {
    const res = await fetch(`https://nodejs.org/dist/${NODE}/${file}`);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  }
  const sums = await (await fetch(`https://nodejs.org/dist/${NODE}/SHASUMS256.txt`)).text();
  const expected = sums.split('\n').find((l) => l.endsWith(`  ${file}`))?.split(' ')[0];
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (!expected || expected !== actual) throw new Error(`${file}: checksum ${actual} is not nodejs.org's ${expected}`);
  const out = join(cache, 'x');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // bsdtar reads zip as well as tar, on macOS and on Windows 10 and later; on Windows by its
  // own path, since Git's GNU tar comes first under Git Bash and reads `D:` as a host name.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', out, `${base}/${dist.inner}`]);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(out, base, dist.inner), target);
  if (!exe) chmodSync(target, 0o755);
  console.log(`${target}: Node ${NODE}, ${(statSync(target).size / 1048576).toFixed(1)} MiB, checksum verified`);
}
