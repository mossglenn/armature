// Prepares what the shell carries besides itself (docs/desktop-program-plan.md §5; ADR-0069
// decision 2), as the spike's prepare.mjs did:
//
//   src-tauri/core/desktop.mjs                      the core, bundled by app's `build:desktop`
//   src-tauri/binaries/armature-node-<triple>[.exe] Node for the target, where Tauri's externalBin
//                                                   looks; named armature-node, not node, since a Linux
//                                                   package installs a sidecar under its own name in
//                                                   /usr/bin, beside the system's node
//
// Node is fetched from nodejs.org once per version and target and checked against the checksum
// pinned beside the version below, taken from the release's SHASUMS256.txt when the version was
// chosen; so a changed binary at the origin is refused, and a new Node is a reviewed diff of six
// hashes (the code review of 2026-11-09, S6). The root's workspace must be installed (`npm ci` at
// the repository root), since the core is built there. Run by `npm run sidecar`, and by tauri.conf.json before dev and build.
//
//   node scripts/prepare.mjs [--target <rust target triple>]
//
// The target is the flag's, else the build's: Tauri names it to its hook commands as
// TAURI_ENV_TARGET_TRIPLE, so `tauri build --target x86_64-apple-darwin` on an Apple silicon runner
// carries Intel Node, not the runner's (the release workflow, .github/workflows/desktop-release.yml);
// else the host's.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The Node the program carries: the line CI runs the suites on (ADR-0069 decision 2), the spike's release. Its checksums are in `dists`; change both together. */
const NODE = 'v22.23.4';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = join(here, '..');
const root = join(desktop, '..');
const tauri = join(desktop, 'src-tauri');

// The core, bundled by the same script CI runs, so the program carries what the suites test.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:desktop', '--workspace', 'app', '--silent'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
mkdirSync(join(tauri, 'core'), { recursive: true });
copyFileSync(join(root, 'app', 'dist', 'desktop.mjs'), join(tauri, 'core', 'desktop.mjs'));
console.log(`src-tauri/core/desktop.mjs: ${(statSync(join(tauri, 'core', 'desktop.mjs')).size / 1048576).toFixed(2)} MiB`);

const flag = process.argv.indexOf('--target');
const triple = flag >= 0 ? process.argv[flag + 1] : process.env.TAURI_ENV_TARGET_TRIPLE || execFileSync('rustc', ['--print', 'host-tuple'], { encoding: 'utf8' }).trim();
// `sha256` is the archive's line in https://nodejs.org/dist/<NODE>/SHASUMS256.txt.
const dists = {
  'aarch64-apple-darwin': { name: 'darwin-arm64', ext: 'tar.gz', inner: 'bin/node', sha256: 'c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428' },
  'x86_64-apple-darwin': { name: 'darwin-x64', ext: 'tar.gz', inner: 'bin/node', sha256: 'efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819' },
  'x86_64-pc-windows-msvc': { name: 'win-x64', ext: 'zip', inner: 'node.exe', sha256: 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20' },
  'aarch64-pc-windows-msvc': { name: 'win-arm64', ext: 'zip', inner: 'node.exe', sha256: 'a8b8cd79cbbb3062435f449591d98dd63730bbbf30ce2d7cc3a6376c236cb111' },
  'x86_64-unknown-linux-gnu': { name: 'linux-x64', ext: 'tar.gz', inner: 'bin/node', sha256: 'b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406' },
  'aarch64-unknown-linux-gnu': { name: 'linux-arm64', ext: 'tar.gz', inner: 'bin/node', sha256: 'f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9' },
};
const dist = dists[triple];
if (!dist) throw new Error(`No Node distribution is mapped for ${triple}`);
const exe = triple.includes('windows') ? '.exe' : '';
const target = join(tauri, 'binaries', `armature-node-${triple}${exe}`);
const stamp = `${target}.version`;

if (existsSync(target) && existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === NODE) {
  console.log(`${target}: Node ${NODE}, present`);
} else {
  const base = `node-${NODE}-${dist.name}`;
  const file = `${base}.${dist.ext}`;
  const cache = join(desktop, '.cache', 'node');
  mkdirSync(cache, { recursive: true });
  const archive = join(cache, file);
  if (!existsSync(archive)) {
    const res = await fetch(`https://nodejs.org/dist/${NODE}/${file}`);
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  }
  const actual = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (actual !== dist.sha256) {
    rmSync(archive, { force: true });
    throw new Error(`${file}: its checksum ${actual} is not the pinned ${dist.sha256}; the download was removed`);
  }
  const out = join(cache, 'x');
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // bsdtar reads zip as well as tar, on macOS and on Windows 10 and later; on Windows by its own
  // path, since Git's GNU tar comes first under Git Bash and reads `D:` as a host name.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(tar, ['-xf', archive, '-C', out, `${base}/${dist.inner}`]);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(out, base, dist.inner), target);
  if (!exe) chmodSync(target, 0o755);
  writeFileSync(stamp, `${NODE}\n`);
  console.log(`${target}: Node ${NODE}, ${(statSync(target).size / 1048576).toFixed(1)} MiB, checksum as pinned`);
}
