#!/usr/bin/env bash
# Checks what the Freelens loader requires of each built extension; it skips one silently otherwise.
set -uo pipefail

cd "$(dirname "$0")/../.."

# Host-provided globals: requiring one bundles a second React or MobX.
HOST_MODULES='@freelensapp/extensions|react|react-dom|react/jsx-runtime|mobx|mobx-react|react-router|react-router-dom'

FAIL=0
bad() { echo "  ✗ $*"; FAIL=1; }

for dir in packages/*; do
  echo "==> ${dir}"
  read -r engine private files main renderer < <(node -p "const p = require('./${dir}/package.json');
    [p.engines?.freelens || '-', p.private === true, (p.files ?? []).includes('out'), p.main || '-', p.renderer || '-'].join(' ')")

  # Freelens calls .match() on it unchecked; a bad one breaks discovery of every extension.
  [[ "${engine}" =~ ^[\^0-9][0-9]*\.[0-9]+ ]] || bad "engines.freelens \"${engine}\" must start with ^ or a digit and name MAJOR.MINOR"
  [[ "${private}" == true ]] || bad "\"private\": true is missing; this repository does not publish to a registry"
  # npm packs "main" but not "renderer": without "files" the tarball has no UI.
  [[ "${files}" == true ]] || bad "\"files\": [\"out\"] is missing; the tarball would have no renderer"

  for bundle in "${main}" "${renderer}"; do
    [[ "${bundle}" == - ]] && continue
    if [[ ! -f "${dir}/${bundle}" ]]; then bad "${bundle} was not built"; continue; fi
    grep -q '^exports\.default' "${dir}/${bundle}" || bad "${bundle}: no top-level exports.default"
    if grep -qE "require\(\"(${HOST_MODULES})\"\)" "${dir}/${bundle}"; then
      bad "${bundle}: requires a host module instead of reading its global"
    fi
  done
done

exit "${FAIL}"
