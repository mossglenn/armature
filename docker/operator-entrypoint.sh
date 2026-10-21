#!/bin/sh
# The entrypoint of the `operator` service (docker-compose.yml): runs one of the
# operator scripts in scripts/ against the store on the private network.
#
# The repository is mounted read-only at /repo, so the scripts' dependencies are
# installed in the `operator-modules` volume at /deps, again only when the lock
# file has changed, and linked as /node_modules, where Node's resolution finds
# them from /repo/scripts (it walks up to the root). Nothing is written into the
# checkout, which on a fresh clone has no scripts/node_modules at all.
set -e
cd /deps
if ! cmp -s /repo/scripts/package-lock.json package-lock.json; then
  rm -f package-lock.json
  cp /repo/scripts/package.json /repo/scripts/package-lock.json .
  npm ci --no-audit --no-fund --loglevel=error || { rm -f package-lock.json; exit 1; }
fi
ln -sfn /deps/node_modules /node_modules
cd /repo/scripts
exec "$@"
