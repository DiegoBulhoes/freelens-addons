#!/usr/bin/env bash
# Everything that touches the dev k3s, and only it: any other cluster is refused.
#
#   cluster.sh install [component...]   installs components/*, in order, or only those named
#   cluster.sh kubectl ARGS...           kubectl on the dev k3s
#   cluster.sh fixtures [package...]     writes the test fixtures; read the diff before committing

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

export KUBECONFIG="${DEV_KUBECONFIG_DIR:-/tmp/freelens-addons-k3s}/kubeconfig.yaml"
[[ "$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}')" == "freelens-addons-dev" ]] \
  || { echo "refusing: ${KUBECONFIG} is not the dev k3s" >&2; exit 1; }

# argocd and trivy need the workloads; cnpg, mongodb and redis need cert-manager's issuers.
COMPONENTS=(workloads argocd trivy cert-manager cnpg mongodb redis)

# Helpers for components/*/install.sh and states.sh.

# Creates the namespace if it does not exist.
namespace() { kubectl create namespace "$1" --dry-run=client -o yaml | kubectl apply -f -; }

# kubectl apply -f for each file.
apply() { for file in "$@"; do kubectl apply -f "${file}"; done; }

# kubectl apply for each URL, server-side: some CRDs are too big for the last-applied annotation.
apply_url() { for url in "$@"; do kubectl apply --server-side --force-conflicts -f "${url}"; done; }

# Waits for each deployment in the namespace to roll out.
wait_deploy() { # namespace deployment...
  local ns=$1; shift
  for deployment in "$@"; do kubectl -n "${ns}" rollout status "deploy/${deployment}" --timeout=300s; done
}

# Runs a command every 5s until it succeeds, for up to 15 minutes.
retry() {
  for _ in $(seq 1 180); do "$@" >/dev/null 2>&1 && return 0; sleep 5; done
  "$@"
}

case "${1:-}" in
  install)
    shift
    for name in "${@:-${COMPONENTS[@]}}"; do
      [[ -f "${HERE}/components/${name}/install.sh" ]] || { echo "no component ${name}" >&2; exit 1; }
      (
        cd "${HERE}/components/${name}"
        source install.sh
        if [[ -f states.sh ]]; then source states.sh; fi
      )
    done
    echo "==> Ready. KUBECONFIG=${KUBECONFIG}"
    ;;
  kubectl)
    shift
    exec kubectl "$@"
    ;;
  fixtures)
    shift
    cd "${HERE}/../.."
    source dev/cluster/fixtures/export.sh "$@"
    ;;
  *)
    sed -n '4,6p' "${HERE}/cluster.sh" >&2
    exit 1
    ;;
esac
