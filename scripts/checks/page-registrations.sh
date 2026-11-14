#!/usr/bin/env bash
# Fails if a renderer index registers a cluster page as a bare component or an observer: Freelens 2
# wraps components.Page in observer itself, and an observer passed in never mounts.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

FAIL=0

for file in packages/*/src/renderer/index.tsx .claude/skills/freelens-extension/templates/src/renderer/index.tsx; do
  [[ -f "${file}" ]] || continue
  hits=$(perl -0777 -ne '
    while (/\bPage\s*:\s*(observer\s*\(|[A-Za-z_\$][\w\$.]*\s*[,}\n])|[{,]\s*\KPage\s*[,}]/g) {
      my $line = 1 + (substr($_, 0, $-[0]) =~ tr/\n//);
      print "$line ";
    }' "${file}")
  for line in ${hits}; do
    printf '  \033[31m✗\033[0m %s:%s registers Page without an arrow; write Page: (props: Common.Types.PageComponentProps) => <X {...props} />\n' "${file}" "${line}"
    FAIL=1
  done
done

if [[ ${FAIL} -eq 0 ]]; then
  printf '  \033[32m✓\033[0m every cluster page is registered through an arrow component\n'
fi
exit ${FAIL}
