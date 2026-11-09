// The updater's manifest for one release (docs/desktop-program-plan.md §10), written by the release
// workflow's publish job from the signed artifacts in a folder:
//
//   node scripts/latest-json.mjs <folder> <tag> <version> <notes file>
//
// It prints the JSON tauri-plugin-updater reads (its `RemoteRelease`): the version, the notes, the
// publication time, and under `platforms` one entry per target the program is built for, each the
// asset's download address on the tag's release and the content of its `.sig` file (a minisign
// signature bound to the version by `tauri signer sign --app-version`). A release that lacks any of
// the four targets is refused here rather than published with a hole, since an installed program
// on the missing platform would then read the manifest and find nothing for itself.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [folder, tag, version, notesFile] = process.argv.slice(2);
if (!folder || !tag || !version || !notesFile) {
  console.error('usage: node scripts/latest-json.mjs <folder> <tag> <version> <notes file>');
  process.exit(2);
}
const repository = process.env.GITHUB_REPOSITORY ?? 'mossglenn/armature';

/** The updater's target names and the artifact each installs: the macOS app as a gzipped tar, the NSIS installer itself, the AppImage itself. */
const TARGETS = {
  'darwin-aarch64': /_aarch64\.app\.tar\.gz$/,
  'darwin-x86_64': /_x64\.app\.tar\.gz$/,
  'windows-x86_64': /-setup\.exe$/,
  'linux-x86_64': /\.AppImage$/,
};

const files = readdirSync(folder);
const platforms = {};
const missing = [];
for (const [target, pattern] of Object.entries(TARGETS)) {
  const found = files.filter((name) => pattern.test(name) && !name.endsWith('.sig'));
  if (found.length !== 1 || !files.includes(`${found[0]}.sig`)) {
    missing.push(`${target} (${found.length === 0 ? 'no artifact' : found.length > 1 ? `several: ${found.join(', ')}` : `no signature for ${found[0]}`})`);
    continue;
  }
  const [name] = found;
  platforms[target] = {
    signature: readFileSync(join(folder, `${name}.sig`), 'utf8').trim(),
    url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`,
  };
}
if (missing.length) {
  console.error(`latest.json would lack ${missing.join('; ')}; the release is not published with a platform missing`);
  process.exit(1);
}

process.stdout.write(
  `${JSON.stringify({ version, notes: readFileSync(notesFile, 'utf8').trim(), pub_date: new Date().toISOString(), platforms }, null, 2)}\n`
);
