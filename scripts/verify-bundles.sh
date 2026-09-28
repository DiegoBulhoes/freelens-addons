#!/usr/bin/env bash
# Asserts the things the Freelens loader requires of a built extension.
#
# Every check here corresponds to a failure that is silent at runtime: the
# extension is skipped, or loads and then breaks somewhere unrelated. Catching
# them in CI is the difference between a red build and an afternoon in the
# Freelens console.
set -uo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

FAIL=0
ok()  { printf '  \033[32m✓\033[0m %s\n' "$*"; }
bad() { printf '  \033[31m✗\033[0m %s\n' "$*"; FAIL=1; }

# Modules the host supplies as globals. A `require` for any of them in the
# output means a second copy of React or MobX would be loaded, breaking the
# singletons Freelens shares with extensions.
HOST_MODULES='@freelensapp/extensions|react|react-dom|react/jsx-runtime|mobx|mobx-react|react-router|react-router-dom'

shopt -s nullglob
manifests=(packages/*/package.json)

if [[ ${#manifests[@]} -eq 0 ]]; then
  echo "No extensions found under packages/" >&2
  exit 1
fi

for manifest in "${manifests[@]}"; do
  dir=$(dirname "${manifest}")
  name=$(node -p "require('./${manifest}').name" 2>/dev/null || echo "?")
  printf '\n\033[1m%s\033[0m (%s)\n' "${name}" "${dir}"

  # Freelens calls .match() on engines.freelens without checking it exists, so
  # a missing field throws during discovery and takes out every extension.
  engine=$(node -p "require('./${manifest}').engines?.freelens ?? ''" 2>/dev/null)
  if [[ -z "${engine}" ]]; then
    bad "engines.freelens is missing"
  elif [[ ! "${engine}" =~ ^[\^0-9][0-9]*\.[0-9]+ ]]; then
    bad "engines.freelens=\"${engine}\" must start with ^ or a digit and name MAJOR.MINOR"
  else
    ok "engines.freelens ${engine}"
  fi

  # Distribution is release tarballs only. private:true is what makes
  # an accidental `npm publish` fail; it does not affect `pnpm pack`.
  if [[ "$(node -p "require('./${manifest}').private === true" 2>/dev/null)" == "true" ]]; then
    ok "private: true — cannot be published to a registry by accident"
  else
    bad "package.json is missing \"private\": true; this repo does not publish to a registry"
  fi

  # npm automatically includes whatever "main" points at, but knows nothing
  # about "renderer". With out/ in .gitignore and no "files" field, a packed
  # tarball ships the main half and silently omits the entire UI.
  files=$(node -p "JSON.stringify(require('./${manifest}').files ?? [])" 2>/dev/null)
  if [[ "${files}" == *'"out"'* ]]; then
    ok "files includes out/ — the packed tarball will carry both entrypoints"
  else
    bad "package.json has no \"files\": [\"out\"] — a packed tarball would omit the renderer bundle"
  fi

  for slot in main renderer; do
    rel=$(node -p "require('./${manifest}').${slot} ?? ''" 2>/dev/null)

    if [[ -z "${rel}" ]]; then
      ok "${slot}: not declared (optional)"
      continue
    fi

    file="${dir}/${rel}"
    if [[ ! -f "${file}" ]]; then
      bad "${slot}: ${rel} was not built"
      continue
    fi

    # The loader does require(path).default and calls new on it. Rollup's
    # "auto" export mode emits `module.exports = Class`, leaving .default
    # undefined — and an undefined class is skipped without an error.
    if grep -q '^exports\.default' "${file}"; then
      ok "${slot}: exports.default present"
    else
      bad "${slot}: no top-level 'exports.default' — the loader would skip this silently"
    fi

    if grep -qE "require\(\"(${HOST_MODULES})\"\)" "${file}"; then
      offenders=$(grep -oE "require\(\"(${HOST_MODULES})\"\)" "${file}" | sort -u | tr '\n' ' ')
      bad "${slot}: requires host-provided modules instead of reading globals — ${offenders}"
    else
      ok "${slot}: no require() of host-provided modules"
    fi

    if grep -q 'globalThis\[' "${file}"; then
      globals=$(grep -oE 'globalThis\["[A-Za-z]+"\]' "${file}" | sort -u | tr -d '\n')
      ok "${slot}: reads host globals ${globals}"
    fi
  done
done

echo
if [[ ${FAIL} -eq 0 ]]; then
  echo "All extension bundles satisfy the loader's requirements."
else
  echo "One or more bundles would fail to load in Freelens." >&2
fi
exit "${FAIL}"
