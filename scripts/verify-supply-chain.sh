#!/usr/bin/env bash
# Fails when a supply-chain control is weakened or removed. Do not edit it to make a build pass.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

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

printf '\n\033[1mAssessed exceptions\033[0m\n'

if [[ ! -f osv-scanner.toml ]]; then
  ok "no vulnerability findings are excepted"
else
  overrides=$(grep -c '^\[\[PackageOverrides\]\]' osv-scanner.toml || true)
  expiries=$(grep -cE '^effectiveUntil\s*=' osv-scanner.toml || true)
  reasons=$(grep -cE '^reason\s*=' osv-scanner.toml || true)

  if (( overrides != expiries )) || (( overrides != reasons )); then
    bad "every excepted finding needs both a reason and an effectiveUntil (${overrides} overrides, ${reasons} reasons, ${expiries} expiries)"
  else
    ok "${overrides} excepted finding(s), each with a reason and an expiry"
  fi

  today=$(date -u +%Y-%m-%d)
  while read -r date; do
    if [[ "${date}" < "${today}" ]]; then
      bad "an exception expired on ${date} — reassess it or extend it deliberately"
    else
      ok "exception valid until ${date}"
    fi
  done < <(grep -oP '^effectiveUntil\s*=\s*\K[0-9-]+' osv-scanner.toml || true)
fi

printf '\n'
if [[ ${FAIL} -eq 0 ]]; then
  echo "Supply-chain controls are intact."
else
  echo "A supply-chain control has been weakened or removed." >&2
fi
exit "${FAIL}"
