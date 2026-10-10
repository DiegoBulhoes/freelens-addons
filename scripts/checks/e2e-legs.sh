#!/usr/bin/env bash
# Fails unless the e2e matrix legs in ci.yaml, the packages and the keys of cluster.sh's
# per-package map are the same names: a package without its leg would never run its suites in CI.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

WORKFLOW=.github/workflows/ci.yaml
CLUSTER=dev/cluster/cluster.sh
FAIL=0

legs=$(sed -nE 's/^ +leg: \[(.*)\]$/\1/p' "${WORKFLOW}" | tr ',' '\n' | tr -d ' ' | sed '/^$/d')
packages=$(for dir in packages/*/; do basename "${dir}"; done)
entries=$(sed -nE '/^declare -A [A-Z_]+=\($/,/\)[[:space:]]*$/ s/^[[:space:]]*\[([^]]+)\]=.*/\1/p' "${CLUSTER}")

missing_from() { # name list where
  grep -qxF "$1" <<<"$2" || { printf '  \033[31m✗\033[0m %s is not in %s\n' "$1" "$3"; FAIL=1; }
}

for name in $(printf '%s\n' "${legs}" "${packages}" "${entries}" | sort -u); do
  missing_from "${name}" "${packages}" "packages/"
  missing_from "${name}" "${legs}" "the e2e matrix of ${WORKFLOW}"
  missing_from "${name}" "${entries}" "the per-package map of ${CLUSTER}"
done

if [[ ${FAIL} -eq 0 ]]; then
  printf '  \033[32m✓\033[0m every package has its e2e leg and its cluster.sh entry\n'
fi
exit ${FAIL}
