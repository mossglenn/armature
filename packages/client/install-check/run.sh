#!/usr/bin/env bash
# Installs @armature/client and @armature/types the way another repository does,
# outside this npm workspace and with pnpm, then compiles and runs them under the
# tools CoQui uses: tsc with a Next app's options, Vitest, tsx and a Next build.
# The packages are packed from this checkout, so the manifests under test are the
# ones a git reference would fetch (a dependency on an unpublished package fails
# here as it fails there). Usage: packages/client/install-check/run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cp -R "$here/." "$work/"
rm -f "$work/run.sh"
(cd "$root" && npm pack --silent --workspace packages/types --workspace packages/client --pack-destination "$work" > /dev/null)
cd "$work"
pnpm install
pnpm add ./armature-types-0.1.0.tgz ./armature-client-0.1.0.tgz
pnpm exec tsc -p .
echo "tsc:    ok"
pnpm exec vitest run --reporter=dot
out="$(pnpm exec tsx check.ts)"
echo "tsx:    $out"
pnpm exec next build > next.log 2>&1 || { cat next.log; exit 1; }
echo "next:   ok"
