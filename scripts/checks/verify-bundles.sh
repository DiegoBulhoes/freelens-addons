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
  # Freelens installs what these name on each user's machine, from the registry: no lockfile, no
  # age floor, no scan. Everything an extension uses is bundled or a host global.
  runtime=$(node -p "const p = require('./${dir}/package.json');
    ['dependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies', 'bundleDependencies']
      .filter((key) => p[key] && Object.keys(p[key]).length > 0).concat(JSON.stringify(p.files) === '[\"out\"]' ? [] : ['files']).join(' ')")
  [[ -z "${runtime}" ]] || bad "package.json declares ${runtime}: an extension ships only out/, with no runtime dependency"

  for bundle in "${main}" "${renderer}"; do
    [[ "${bundle}" == - ]] && continue
    if [[ ! -f "${dir}/${bundle}" ]]; then bad "${bundle} was not built"; continue; fi
    grep -q '^exports\.default' "${dir}/${bundle}" || bad "${bundle}: no top-level exports.default"
    if grep -qE "require\(\"(${HOST_MODULES})\"\)" "${dir}/${bundle}"; then
      bad "${bundle}: requires a host module instead of reading its global"
    fi
    # Only the extension's own src/: docs/security.md rests on no third-party code being shipped.
    if [[ ! -f "${dir}/${bundle}.map" ]]; then
      bad "${bundle}: no source map, so what it bundles cannot be checked"
    else
      if ! foreign=$(node -p "JSON.parse(require('node:fs').readFileSync('${dir}/${bundle}.map', 'utf8')).sources.filter((s) => !s.startsWith('../../src/')).join(' ')"); then
        bad "${bundle}: its source map could not be read"
      elif [[ -n "${foreign}" ]]; then
        bad "${bundle}: bundles code from outside src/: ${foreign}"
      fi
    fi
  done

  # The tarball packs all of out/: anything beside the bundles and their maps would ship unchecked.
  if [[ -d "${dir}/out" ]]; then
    stray=$(cd "${dir}" && find out -type f | grep -vxF -e "${main}" -e "${main}.map" -e "${renderer}" -e "${renderer}.map" | tr '\n' ' ')
    [[ -z "${stray}" ]] || bad "out/ holds files other than the bundles and their maps: ${stray}"
  fi
done

exit "${FAIL}"
