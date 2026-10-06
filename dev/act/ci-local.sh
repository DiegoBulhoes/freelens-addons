#!/usr/bin/env bash
# Runs .github/workflows/ci.yaml through act, on a copy of the working tree, as another project
# on other ports, so the dev setup beside it is left alone. `make ci-local` calls it.
# Usage: ci-local [job]; every job, in order, when none is named.

set -euo pipefail

JOB=${1:-}
ROOT=/tmp/freelens-addons-act
SRC=${ROOT}/src
IMAGE=freelens-addons/act:local

export PROJECT=freelens-addons-act K3S_PORT=6444 DEBUG_PORT=9223 VNC_PORT=5901 NOVNC_PORT=6081
export DEV_KUBECONFIG_DIR=${ROOT}/k3s
export KUBECONFIG_PATH=${DEV_KUBECONFIG_DIR}/kubeconfig.yaml HOME=${ROOT}/home

mkdir -p "${HOME}" "${DEV_KUBECONFIG_DIR}"
git config --global --add safe.directory /repo

# What is tracked and what is not ignored, as a push would carry it, with its history (the secret
# scan reads it); no .env, no node_modules. A job's steps write as root, so the last copy goes as root.
fresh_copy() {
  docker run --rm --user 0 -v "${ROOT}:${ROOT}" "${IMAGE}" rm -rf "${SRC}"
  mkdir -p "${SRC}"
  git -C /repo ls-files -z -co --exclude-standard --deduplicate \
    | tar -C /repo --null --ignore-failed-read -T - -cf - | tar -C "${SRC}" -xf -
  tar -C /repo -cf - .git | tar -C "${SRC}" -xf -
  # act -j also runs a job's needs, and the loop below already keeps that order; the copy act runs
  # sits outside .github/workflows, so the policy check still reads the real ci.yaml.
  sed '/^    needs: /d' "${SRC}/.github/workflows/ci.yaml" >"${ROOT}/ci-act.yaml"
}

# Otherwise act asks which runner image to use.
echo "-P ubuntu-latest=${IMAGE}" > "${HOME}/.actrc"

clean_up() {
  [[ "${KEEP:-}" == 1 ]] && { echo "==> KEEP=1: ${PROJECT} left running"; return; }
  echo "==> Removing ${PROJECT}"
  make -C "${SRC}" down cluster-down >/dev/null 2>&1 || true
  # As on GitHub, the next run's Freelens starts with no state; the pnpm store is kept.
  docker volume rm "${PROJECT}_freelens-state" >/dev/null 2>&1 || true
}
trap clean_up EXIT

# --bind: the steps' docker compose binds paths the host's daemon must find as they are here.
run_job() {
  fresh_copy
  (
    cd "${SRC}"
    act workflow_dispatch -W "${ROOT}/ci-act.yaml" -j "$1" \
      --pull=false --bind --network host --rm \
      --container-options "-v ${DEV_KUBECONFIG_DIR}:${DEV_KUBECONFIG_DIR}" \
      --env "PROJECT=${PROJECT}" --env "K3S_PORT=${K3S_PORT}" --env "DEBUG_PORT=${DEBUG_PORT}" \
      --env "VNC_PORT=${VNC_PORT}" --env "NOVNC_PORT=${NOVNC_PORT}" \
      --env "DEV_KUBECONFIG_DIR=${DEV_KUBECONFIG_DIR}" --env "USER_UID=${USER_UID}" --env "USER_GID=${USER_GID}"
  )
}

# One job at a time, in the workflow's order, each on a fresh copy as on GitHub; --bind would
# otherwise hand one job's node_modules to the next. Stops at the first that fails.
if [[ -n "${JOB}" ]]; then
  run_job "${JOB}"
else
  for job in $(act -l -W /repo/.github/workflows/ci.yaml | awk 'NR > 1 { print $2 }'); do
    echo "==> ${job}"
    run_job "${job}"
  done
fi
