#!/usr/bin/env bash
# Copies the design standard into every extension, or with --check, fails if
# any copy has drifted from it.
#
# The standard is one stylesheet in the freelens-extension skill, written with
# the skill's placeholders. Each extension carries it as
# src/renderer/styles/design.css with its own class prefix and token prefix
# filled in: extensions are installed separately, so two sharing class names
# would restyle each other whenever their versions differ. A copy per package
# avoids that, and this check is what keeps the copies one design.
#
# The prefix is read from the package's own <Name>Styles component, so a new
# extension needs no entry here.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

TEMPLATE=.claude/skills/freelens-extension/templates/src/renderer/styles/design.css
CHECK=0
[[ "${1:-}" == "--check" ]] && CHECK=1

FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }

shopt -s nullglob

for manifest in packages/*/package.json; do
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
      bad "${name}: design.css differs from the standard — edit ${TEMPLATE}, then run scripts/sync-design.sh"
      diff <(printf '%s\n' "${expected}") "${target}" | head -20
    fi
  else
    printf '%s\n' "${expected}" > "${target}"
    ok "${name}: design.css written, prefix ${prefix}"
  fi
done

exit ${FAIL}
