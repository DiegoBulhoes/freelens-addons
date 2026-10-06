#!/usr/bin/env bash
# Runs CI's scanners locally. Keep these digests in step with .github/workflows/ci.yaml and
# release.yaml; verify-supply-chain.sh compares the OSV one, and the Makefile reads it from here.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

GITLEAKS="ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f"      # v8.30.1
OSV_SCANNER="ghcr.io/google/osv-scanner@sha256:afd838850ac1a0fcc15ff4a041dc9ba11123c3f0d2666217a5f0fcf9222b55fa"  # v2.6.0
HADOLINT="hadolint/hadolint@sha256:27086352fd5e1907ea2b934eb1023f217c5ae087992eb59fde121dce9c9ff21e"              # v2.14.0

FAIL=0
section() { printf '\n\033[1m%s\033[0m\n' "$*"; }
result()  { if [[ $1 -eq 0 ]]; then printf '  \033[32m✓ passed\033[0m\n'; else printf '  \033[31m✗ failed\033[0m\n'; FAIL=1; fi; }

section "Secrets"
docker run --rm -v "${PWD}:/repo:ro" "${GITLEAKS}" \
  detect --source=/repo --redact --no-banner 2>&1 | sed 's/^/  /'
result "${PIPESTATUS[0]}"

section "Dependencies"
bash scripts/security/osv-direct.sh "${OSV_SCANNER}"
result "$?"

section "Dockerfiles"
status=0
for dockerfile in dev/freelens/Dockerfile dev/act/Dockerfile; do
  docker run --rm -i "${HADOLINT}" hadolint --ignore DL3008 - < "${dockerfile}" || status=1
done
result "${status}"

printf '\n'
[[ ${FAIL} -eq 0 ]] && echo "All scanners passed." || echo "A scanner reported findings." >&2
exit "${FAIL}"
