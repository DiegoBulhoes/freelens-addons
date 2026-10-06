#!/usr/bin/env bash
# Fails when a supply-chain control is weakened or removed. Do not edit it to make a build pass.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# 15 days, in minutes.
readonly REQUIRED_RELEASE_AGE=21600

FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }

printf '\033[1mDependency age policy\033[0m\n'

age=$(grep -oP '^minimumReleaseAge:\s*\K[0-9]+' pnpm-workspace.yaml || true)
if [[ -z "${age}" ]]; then
  bad "minimumReleaseAge is not set in pnpm-workspace.yaml"
elif (( age < REQUIRED_RELEASE_AGE )); then
  bad "minimumReleaseAge=${age} is below the agreed floor of ${REQUIRED_RELEASE_AGE} minutes (15 days)"
else
  ok "minimumReleaseAge=${age} minutes ($(( age / 1440 )) days)"
fi

if grep -qE '^minimumReleaseAgeStrict:\s*true' pnpm-workspace.yaml; then
  ok "minimumReleaseAgeStrict is on — an install fails rather than resolving something younger"
else
  bad "minimumReleaseAgeStrict is not true; a resolution could silently fall below the floor"
fi

if grep -qE '^minimumReleaseAgeIgnoreMissingTime:\s*false' pnpm-workspace.yaml; then
  ok "the check is not waived for packages lacking a publish date"
else
  bad "minimumReleaseAgeIgnoreMissingTime should be false"
fi

if grep -qE '^\s*minimumReleaseAgeExclude:' pnpm-workspace.yaml; then
  bad "minimumReleaseAgeExclude is present — exemptions defeat the policy; remove it or justify it in review"
else
  ok "no package is exempted from the age floor"
fi

printf '\n\033[1mLifecycle scripts\033[0m\n'

if grep -qE '^allowBuilds:' pnpm-workspace.yaml; then
  allowed=$(sed -n '/^allowBuilds:/,/^[^ #]/p' pnpm-workspace.yaml | grep -cE '^\s+\S+:\s*true' || true)
  ok "dependency build scripts are opt-in (${allowed} allowed)"
else
  ok "no dependency is allowed to run build scripts"
fi

printf '\n\033[1mPinning\033[0m\n'

if grep -qE '"packageManager":\s*"pnpm@[0-9.]+\+sha' package.json; then
  ok "pnpm is pinned with an integrity hash"
else
  bad "packageManager should pin pnpm with its integrity hash, so corepack verifies the download"
fi

if [[ $(grep -cE '^FROM ' dev/freelens/Dockerfile) -eq $(grep -cE '^FROM .+@sha256:' dev/freelens/Dockerfile) ]]; then
  ok "container base images are pinned by digest"
else
  bad "a base image is referenced by tag; a tag can be moved to different content"
fi

if grep -qE 'sha256sum -c' dev/freelens/Dockerfile; then
  ok "the downloaded Freelens package is checksummed"
else
  bad "the Freelens download is not verified against a checksum"
fi

if grep -rqE 'curl[^|]*\|\s*(ba)?sh' dev/ scripts/ 2>/dev/null; then
  bad "something pipes a downloaded script straight into a shell"
else
  ok "no downloaded script is piped into a shell"
fi

if grep -rhoE 'uses:\s*[^@]+@[^ ]+' .github/workflows/*.y*ml 2>/dev/null | grep -qvE '@[0-9a-f]{40}'; then
  offenders=$(grep -rhoE 'uses:\s*[^@]+@[^ ]+' .github/workflows/*.y*ml | grep -vE '@[0-9a-f]{40}' | tr -d ' ' | sort -u | tr '\n' ' ')
  bad "workflow actions not pinned to a commit SHA — ${offenders}"
else
  ok "every workflow action is pinned to a commit SHA"
fi

if grep -rhoE 'ghcr\.io/[^ "]+|[a-z0-9-]+/[a-z0-9-]+@sha256|docker run [^|]*' .github/workflows/*.y*ml 2>/dev/null \
     | grep -oE '(^|[ "])((ghcr\.io/)?[a-z0-9./-]+):[a-zA-Z0-9._-]+' | grep -qvE '@sha256'; then
  bad "a scanner image in a workflow is referenced by tag rather than by digest"
else
  ok "scanner images in workflows are pinned by digest"
fi

printf '\n\033[1mDependency scan gate\033[0m\n'

# The gate is scripts/security/osv-direct.sh. Workflows are read as data, through a pinned yq, so
# indentation, comments and YAML forms cannot hide a weakened gate from these checks.
readonly YQ="mikefarah/yq@sha256:cfc4eee658595834ef304eadb0c3ea721f3b7cb6404ad8b7cb909cc5b5145b23" # 4.53.6
readonly GATE='bash scripts/security/osv-direct.sh "${OSV_SCANNER}"'
osv_image=$(grep -oE 'ghcr\.io/google/osv-scanner@sha256:[0-9a-f]{64}' scripts/security/scan.sh | head -1)

if [[ -z "${osv_image}" ]]; then
  bad "scripts/security/scan.sh pins no OSV-Scanner digest"
fi
if grep -qxF "${GATE}" scripts/security/scan.sh; then
  ok "scripts/security/scan.sh runs the gate"
else
  bad "scripts/security/scan.sh does not run the gate"
fi

for workflow in .github/workflows/*.y*ml; do
  if ! json=$(docker run --rm -i "${YQ}" -o=json '.' <"${workflow}" 2>/dev/null); then
    bad "${workflow} could not be read as YAML"
    continue
  fi
  problems=$(jq -r --arg gate "${GATE}" --arg image "${osv_image}" '
    def trimmed: gsub("^\\s+|\\s+$"; "");
    def needs_of($wf; $job): ($wf.jobs[$job].needs // []) | if type == "string" then [.] else . end;
    def upstream($wf; $job): [needs_of($wf; $job)[] as $up | $up, upstream($wf; $up)[]];
    . as $wf
    | ([.jobs | to_entries[] | select(any(.value.steps[]?; (.run // "" | trimmed) == $gate)) | .key]) as $gated
    | ([.. | strings | select(test("\\b(pnpm|npm|npx)\\s"))] | length > 0) as $installs
    | if ($gated | length) == 0 then
        (if $installs then "installs dependencies without running the gate" else empty end)
      elif ($gated | length) > 1 then "runs the gate in more than one job"
      else
        $gated[0] as $g | .jobs[$g] as $job
        | ($job.steps | map((.run // "" | trimmed) == $gate) | index(true)) as $at
        | ($job.steps[$at] | keys - ["name", "run"]) as $extra
        | (if ($extra | length) > 0 then "the gate step also sets \($extra | join(", "))" else empty end),
          ([("if", "continue-on-error", "defaults", "container")] - ($job | keys) | length < 4
            | if . then "the gate job \($g) sets if, continue-on-error, defaults or container" else empty end),
          ($job.steps[0:$at][] | select((.uses // "") | test("^actions/checkout@[0-9a-f]{40}$") | not)
            | "a step other than actions/checkout runs before the gate"),
          ($wf.jobs | keys[] | select(. != $g) as $other
            | if (upstream($wf; $other) | index($g)) == null then "job \($other) does not wait on the gate job \($g)"
              elif (($wf.jobs[$other]["if"] // "") | tostring | test("always\\(|failure\\(|cancelled\\(")) then "job \($other) can run after the gate failed"
              else empty end)
      end,
      (if $installs then
         (if (.env.OSV_SCANNER // "") != $image then "OSV_SCANNER in its top-level env is not \($image)" else empty end),
         ([.jobs[] | (.env.OSV_SCANNER?, (.steps[]?.env.OSV_SCANNER?))] | map(select(. != null)) | length > 0
           | if . then "a job or step redefines OSV_SCANNER" else empty end)
       else empty end),
      ([.. | objects | .uses? // empty | select(startswith("docker://") and (test("@sha256:[0-9a-f]{64}$") | not))][]
        | "\(.) is not pinned by digest")
  ' <<<"${json}") || { bad "${workflow} could not be checked"; continue; }
  if [[ -n "${problems}" ]]; then
    while read -r problem; do bad "${workflow}: ${problem}"; done <<<"${problems}"
  else
    ok "${workflow}: the gate runs first, unguarded, before every job that installs"
  fi
done

unpinned=$(grep -hE '^[[:space:]]+[A-Z_]+:[[:space:]]+[a-z0-9.-]+(/[a-z0-9._-]+)+' .github/workflows/*.y*ml \
  | grep -vE '@sha256:[0-9a-f]{64}' | tr -s ' ' | tr '\n' ' ')
if [[ -n "${unpinned}" ]]; then
  bad "a workflow names an image without a full digest: ${unpinned}"
else
  ok "every image a workflow names carries a full digest"
fi

# Behaviour, not text. The probe lockfiles live in the repository, where a daemon that is not this
# host (make ci-local) can mount them too.
rm -rf .osv-probe
probe_lock() { # dir importer-name importer-version extra-yaml package...
  mkdir -p ".osv-probe/$1"
  {
    printf "lockfileVersion: '9.0'\n\n%s\nimporters:\n\n  .:\n    devDependencies:\n      %s:\n        specifier: %s\n        version: %s\n\npackages:\n\n" "$4" "$2" "$3" "$3"
    for package in "${@:5}"; do printf "  %s:\n    resolution: {integrity: sha512-AAAA}\n\n" "${package}"; done
  } >".osv-probe/$1/pnpm-lock.yaml"
}
probe_lock malware typescript 5.9.3 "" typescript@5.9.3 flatmap-stream@0.1.1
probe_lock malware-excepted typescript 5.9.3 "" typescript@5.9.3 flatmap-stream@0.1.1
printf '[[IgnoredVulns]]\nid = "%s"\nreason = "probe"\n\n' MAL-2025-20690 GHSA-9x64-5r7x-2q53 GHSA-mh6f-8j2x-4483 \
  >.osv-probe/malware-excepted/osv-scanner.toml
probe_lock declared lodash 4.17.20 "" lodash@4.17.20
probe_lock overridden typescript 5.9.3 $'overrides:\n  lodash: 4.17.20\n' typescript@5.9.3 lodash@4.17.20
probe_lock codegen typescript 5.9.3 "" typescript@5.9.3 rollup@4.20.0
probe_lock transitive typescript 5.9.3 "" typescript@5.9.3 minimist@1.2.5
for case in malware:1 malware-excepted:1 declared:1 overridden:1 codegen:1 transitive:0; do
  bash scripts/security/osv-direct.sh "${osv_image}" ".osv-probe/${case%%:*}" >/dev/null 2>&1
  status=$?
  if [[ "${status}" == "${case#*:}" ]]; then
    ok "the gate exits ${status} on the ${case%%:*} probe, as it should"
  else
    bad "the gate exits ${status} on the ${case%%:*} probe, not ${case#*:}"
  fi
done
rm -rf .osv-probe

printf '\n\033[1mAssessed exceptions\033[0m\n'

# A closed grammar, not a TOML parser: anything but one [[IgnoredVulns]] per advisory, each with
# exactly an id, an ignoreUntil and a reason, fails. osv-scanner reads more forms than these.
if [[ ! -f osv-scanner.toml ]]; then
  ok "no vulnerability findings are excepted"
else
  today=$(date -u +%Y-%m-%d)
  checked=$(awk -v today="${today}" '
    function close_table() {
      if (open && (keys != "id,ignoreUntil,reason," && keys != "id,reason,ignoreUntil," && keys != "ignoreUntil,id,reason," \
          && keys != "ignoreUntil,reason,id," && keys != "reason,id,ignoreUntil," && keys != "reason,ignoreUntil,id,"))
        print "bad an exception needs exactly an id, an ignoreUntil and a reason (line " start ")"
      open = 0; keys = ""
    }
    /^[[:space:]]*(#.*)?$/ { next }
    /^\[\[IgnoredVulns\]\]$/ { close_table(); open = 1; start = NR; tables++; next }
    open && /^id = "[A-Za-z0-9-]+"$/ {
      keys = keys "id,"
      if ($3 ~ /^"MAL-/) print "bad an exception names known malware: " $3
      next
    }
    open && /^ignoreUntil = [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]$/ {
      keys = keys "ignoreUntil,"
      if (!($3 > today)) print "bad an exception expired on " $3 "; reassess it or extend it deliberately"
      else print "ok exception valid until " $3
      next
    }
    open && /^reason = ".+"$/ { keys = keys "reason,"; next }
    { print "bad osv-scanner.toml line " NR " is not allowed: " $0 }
    END { close_table(); print "count " tables + 0 }
  ' osv-scanner.toml)
  while read -r verdict detail; do
    case "${verdict}" in
      ok) ok "${detail}" ;;
      bad) bad "${detail}" ;;
      count) ok "${detail} exception(s), one per advisory" ;;
    esac
  done <<<"${checked}"
fi

printf '\n'
if [[ ${FAIL} -eq 0 ]]; then
  echo "Supply-chain controls are intact."
else
  echo "A supply-chain control has been weakened or removed." >&2
fi
exit "${FAIL}"
