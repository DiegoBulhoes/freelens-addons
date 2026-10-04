#!/usr/bin/env bash
# kubectl on the dev k3s only: refuses to run against any other cluster.
# Usage: make kubectl ARGS="-n mongodb get pods"

set -euo pipefail

readonly KUBECONFIG_PATH="${DEV_KUBECONFIG_DIR:-/tmp/freelens-addons-k3s}/kubeconfig.yaml"
readonly DEV_NODE="freelens-addons-dev"

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
[[ -r "${KUBECONFIG_PATH}" ]] || { echo "no kubeconfig at ${KUBECONFIG_PATH}; run 'make cluster' first" >&2; exit 1; }

export KUBECONFIG="${KUBECONFIG_PATH}"

# Checked on every call: the file at that path could be replaced by another cluster's.
nodes="$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}')"

if [[ "${nodes}" != "${DEV_NODE}" ]]; then
  echo "refusing: ${KUBECONFIG_PATH} is not the dev k3s (its only node is ${DEV_NODE}; found: ${nodes:-none})." >&2
  exit 1
fi

exec kubectl "$@"
