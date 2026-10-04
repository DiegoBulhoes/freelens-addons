#!/usr/bin/env bash
# Writes the skill's design.css into every extension under the given directory; --check fails on drift.
# The prefix comes from each extension's <Name>Styles component.
# Usage: copy-design-standard.sh [--check] <directory holding the extensions>
set -uo pipefail

SKILL=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TEMPLATE="${SKILL}/templates/src/renderer/styles/design.css"
CHECK=0
[[ "${1:-}" == "--check" ]] && { CHECK=1; shift; }
ROOT=${1:?usage: copy-design-standard.sh [--check] <directory holding the extensions>}

FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }

shopt -s nullglob

for manifest in "${ROOT}"/*/package.json; do
  grep -q '"renderer"' "${manifest}" || continue
  dir=$(dirname "${manifest}")
  name=$(basename "${dir}")
  styles="${dir}/src/renderer/components/styles.tsx"
  target="${dir}/src/renderer/styles/design.css"

  prefix=$(grep -oP 'export function \K\w+(?=Styles\b)' "${styles}" 2>/dev/null | head -1)

  if [[ -z "${prefix}" ]]; then
    bad "${name}: no <Name>Styles component in ${styles}, so no class prefix to fill in"
    continue
  fi

  expected=$(sed "s/__Name__/${prefix}/g; s/__NAME__/${name}/g" "${TEMPLATE}")

  if [[ ${CHECK} -eq 1 ]]; then
    if [[ "$(cat "${target}" 2>/dev/null)" == "${expected}" ]]; then
      ok "${name}: design.css is the standard"
    else
      bad "${name}: design.css differs from the standard; edit ${TEMPLATE}, then run this script"
      diff <(printf '%s\n' "${expected}") "${target}" | head -20
    fi
  else
    printf '%s\n' "${expected}" > "${target}"
    ok "${name}: design.css written, prefix ${prefix}"
  fi
done

exit ${FAIL}
