#!/usr/bin/env bash
# Turns each built extension into the .tgz Freelens installs, in dist/, with SHA256SUMS beside them.
set -euo pipefail

cd "$(dirname "$0")/../.."

rm -rf dist
mkdir dist

for dir in packages/*/; do
  (cd "${dir}" && pnpm pack --pack-destination ../../dist >/dev/null)
done

(cd dist && sha256sum ./*.tgz > SHA256SUMS)
ls -1 dist
