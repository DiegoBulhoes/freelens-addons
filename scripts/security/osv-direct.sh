#!/usr/bin/env bash
# The OSV scan of a pnpm lockfile, before anything installs it. Blocks on known malware at any
# depth, which no osv-scanner.toml exception can hide, and on a known vulnerability in a version
# this repository chooses: declared in a package.json, set by an override, pnpm itself, or the
# bundlers that write code into the shipped bundles. A finding in another transitive development
# dependency is a warning; docs/security.md says why and how it gets fixed.
# Usage: osv-direct.sh <digest-pinned osv-scanner image> [directory, default the repository]
set -uo pipefail

IMAGE=${1:?usage: osv-direct.sh <osv-scanner image> [directory]}
cd "${2:-$(dirname "${BASH_SOURCE[0]}")/../..}" || exit 2

# Bundlers whose generated code ships inside every bundle, beside the extension's own src/.
readonly CODEGEN=(rollup esbuild)

fail() { echo "osv-direct: $*" >&2; exit 2; }

command -v jq >/dev/null || fail "jq is required"
[[ -f pnpm-lock.yaml ]] || fail "no pnpm-lock.yaml in ${PWD}"

# Only the lockfile's directory is mounted: a daemon that is not this host (act) cannot see /tmp.
stderr_file=$(mktemp)
stderr_unfiltered=$(mktemp)
trap 'rm -f "${stderr_file}" "${stderr_unfiltered}"' EXIT

# Prints the scanner's JSON report; its stderr goes to $2. Returns the scanner's status.
scan() { # config-flag-or-empty stderr-file
  docker run --rm -v "${PWD}:/repo:ro" -w /repo \
    "${IMAGE}" scan source --lockfile=/repo/pnpm-lock.yaml --format json ${1:+"$1"} 2>"$2"
}

check_report() { # status report stderr-file what
  # 0: nothing found, 1: findings; anything else is the scanner failing.
  (( $1 <= 1 )) || { sed 's/^/  /' "$3" >&2; fail "osv-scanner exited $1 on $4"; }
  jq -e '.results | type == "array"' >/dev/null 2>&1 <<<"$2" || fail "osv-scanner printed no JSON report on $4"
}

report=$(scan "" "${stderr_file}")
status=$?
sed 's/^/  /' "${stderr_file}"
check_report "${status}" "${report}" "${stderr_file}" "the lockfile"

# A parser that reads nothing reports nothing, which must not read as clean.
scanned=$(grep -oE 'found [0-9]+ packages?' "${stderr_file}" | grep -oE '[0-9]+' | head -1)
(( ${scanned:-0} > 0 )) || fail "osv-scanner read no package from pnpm-lock.yaml"

# Malware is judged without osv-scanner.toml: an exception for a version must not hide it.
unfiltered=$(scan "--config=/dev/null" "${stderr_unfiltered}")
check_report $? "${unfiltered}" "${stderr_unfiltered}" "the lockfile, without exceptions"

# Declared versions, as name@version, from every importer of the lockfile (pnpm included, through
# packageManagerDependencies). An npm: alias records its real name@version as the version.
declared=$(awk '
  /^importers:/ { in_importers = 1; next }
  /^[^ #]/ { in_importers = 0 }
  in_importers && /^      [^ ]/ { name = $1; sub(/:$/, "", name); gsub(/\047/, "", name) }
  in_importers && /^        version: / {
    version = $2; gsub(/\047/, "", version); sub(/\(.*/, "", version); sub(/^npm:/, "", version)
    if (version ~ /^link:/) next
    print (version ~ /^@?[^@]+@[0-9]/ ? version : name "@" version)
  }
' pnpm-lock.yaml)
[[ -n "${declared}" ]] || fail "read no declared dependency from the lockfile's importers"

# Override targets, by name, from the lockfile, which pnpm writes the same way every time. A key
# is a selector, "parent>child" or "name@range"; a ">" right after a space, "|", "@", "<" or "="
# belongs to a range, not to the parent>child split.
overridden=$(awk '
  /^overrides:/ { in_overrides = 1; next }
  /^[^ #]/ { in_overrides = 0 }
  in_overrides && /^  [^ #]/ {
    key = $0; sub(/^  /, "", key)
    if (key ~ /^["\047]/) { quote = substr(key, 1, 1); key = substr(key, 2); sub(quote ".*", "", key) }
    else sub(/:.*/, "", key)
    cut = 0
    for (i = 2; i <= length(key); i++)
      if (substr(key, i, 1) == ">" && substr(key, i - 1, 1) !~ /[ |@<=]/) cut = i
    if (cut) key = substr(key, cut + 1)
    if (match(key, /^@?[^@]+/)) print substr(key, RSTART, RLENGTH)
  }
' pnpm-lock.yaml)

by_name=$(printf '%s\n' ${overridden} "${CODEGEN[@]}")

classify='
  ($declared | split("\n") | map(select(length > 0))) as $declared
  | ($by_name | split("\n") | map(select(length > 0))) as $by_name
  | .results[]?.packages[]?
  | select((.vulnerabilities // []) | length > 0)
  | "\(.package.name)@\(.package.version)" as $package
  | [ (if any(.vulnerabilities[]; ([.id] + (.aliases // [])) | any(startswith("MAL-")))
          or any(.vulnerabilities[]; (.database_specific.cwe_ids // []) | index("CWE-506"))
       then "malware"
       elif ($package | IN($declared[])) or (.package.name | IN($by_name[])) then "chosen"
       else "transitive" end),
      $package,
      ([.vulnerabilities[].id] | join(" ")) ]
  | @tsv'

findings=$(jq -r --arg declared "${declared}" --arg by_name "${by_name}" "${classify}" <<<"${report}") \
  || fail "could not read the scanner's findings"
malware=$(jq -r --arg declared "${declared}" --arg by_name "${by_name}" "${classify}" <<<"${unfiltered}") \
  || fail "could not read the scanner's findings without exceptions"
malware=$(awk -F'\t' '$1 == "malware"' <<<"${malware}")

(( status == 1 )) && [[ -z "${findings}" ]] && fail "osv-scanner reported findings this script could not read"

blocking=0
while IFS=$'\t' read -r kind package ids; do
  [[ -z "${kind}" ]] && continue
  case "${kind}" in
    malware) echo "  ✗ ${package} is known malware: ${ids}"; blocking=1 ;;
    chosen) echo "  ✗ ${package}: ${ids}"; blocking=1 ;;
    *) echo "  ! ${package} (transitive development dependency, not blocking): ${ids}" ;;
  esac
done < <(printf '%s\n%s\n' "${malware}" "$(awk -F'\t' '$1 != "malware"' <<<"${findings}")")

if (( blocking )); then
  echo "Known malware, or a known vulnerability in a version this repository chooses." >&2
else
  echo "  ✓ ${scanned} packages: no malware, and no known vulnerability in a version chosen here"
fi

exit "${blocking}"
