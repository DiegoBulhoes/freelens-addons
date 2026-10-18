#!/usr/bin/env bash
# Resolves every dependency again, transitive ones too, to the newest its range and the 15-day floor
# admit; only the lockfile changes. Monthly, and how a transitive advisory gets fixed.
# Not pnpm update: under minimumReleaseAgeStrict it asks to write minimumReleaseAgeExclude.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

OSV_SCANNER=$(grep -oE 'ghcr\.io/google/osv-scanner@sha256:[0-9a-f]{64}' scripts/security/scan.sh)
dev() {
  docker compose -p freelens-addons -f dev/docker-compose.yml --project-directory . \
    run --rm --no-deps --entrypoint sh -w /workspace freelens -lc "$1"
}

make -s .env

# A throwaway copy, promoted only if the gate passes, so a rejected lockfile never reaches an install.
rm -rf .deps-refresh
mkdir -p .deps-refresh
cp package.json pnpm-workspace.yaml .deps-refresh/
[[ -f osv-scanner.toml ]] && cp osv-scanner.toml .deps-refresh/
for manifest in build/package.json packages/*/package.json; do
  mkdir -p ".deps-refresh/$(dirname "${manifest}")"
  cp "${manifest}" ".deps-refresh/${manifest}"
done

dev "cd .deps-refresh && pnpm install --lockfile-only"
bash scripts/security/osv-direct.sh "${OSV_SCANNER}" .deps-refresh
cp .deps-refresh/pnpm-lock.yaml pnpm-lock.yaml
rm -rf .deps-refresh
dev "pnpm install --frozen-lockfile"
