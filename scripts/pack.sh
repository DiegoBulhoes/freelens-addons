#!/usr/bin/env bash
# Packs each extension into an installable .tgz under dist/.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

OUT_DIR="${OUT_DIR:-dist}"
rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

shopt -s nullglob
packed=0

for manifest in packages/*/package.json; do
  dir=$(dirname "${manifest}")
  name=$(node -p "require('./${manifest}').name")

  echo "Packing ${name}"
  ( cd "${dir}" && pnpm pack --pack-destination "../../${OUT_DIR}" >/dev/null )
  packed=$((packed + 1))
done

if [[ ${packed} -eq 0 ]]; then
  echo "No extensions found under packages/" >&2
  exit 1
fi

( cd "${OUT_DIR}" && sha256sum ./*.tgz > SHA256SUMS )

echo
echo "Packed ${packed} extension(s) into ${OUT_DIR}/:"
ls -1sh "${OUT_DIR}" | tail -n +2 | sed 's/^/  /'
echo
echo "Install one in Freelens: File > Extensions, then give it the path to the .tgz"
