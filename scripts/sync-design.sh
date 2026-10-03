#!/usr/bin/env bash
# The skill owns the standard and its checks; this applies them to packages/ and guards build/e2e's copies.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

SKILL=.claude/skills/freelens-extension
FAIL=0

bash "${SKILL}/scripts/sync-design.sh" "$@" packages || FAIL=1

for file in cdp.ts design.ts; do
  if cmp -s "${SKILL}/harness/${file}" "build/e2e/${file}"; then
    printf '  \033[32m✓\033[0m build/e2e/%s is the skill'"'"'s\n' "${file}"
  else
    printf '  \033[31m✗\033[0m build/e2e/%s differs from %s/harness/%s; change both\n' "${file}" "${SKILL}" "${file}"
    FAIL=1
  fi
done

exit ${FAIL}
