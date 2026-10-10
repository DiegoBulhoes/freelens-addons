#!/usr/bin/env bash
# Everything that touches the dev k3s, and only it: any other cluster is refused.
#
#   cluster.sh install [component...]    installs components/*, in order, or only those named
#   cluster.sh install --for PACKAGE     installs only what that package's e2e suites need
#   cluster.sh kubectl ARGS...           kubectl on the dev k3s
#   cluster.sh fixtures [package...]     writes the test fixtures, from a full install; read the diff

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

export KUBECONFIG="${DEV_KUBECONFIG_DIR:-/tmp/freelens-addons-k3s}/kubeconfig.yaml"

# install also waits for a k3s just started: the kubeconfig, the API server, then a Ready node
# (a ready API server says nothing about the CNI, and waiting on no node is an error).
if [[ "${1:-}" == install ]]; then
  timeout 300 bash -c "until [[ -r '${KUBECONFIG}' ]] && kubectl get --raw=/readyz >/dev/null 2>&1 \
    && kubectl get nodes -o name 2>/dev/null | grep -q .; do sleep 2; done"
  kubectl wait --for=condition=Ready node --all --timeout=180s
fi

[[ "$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}')" == "freelens-addons-dev" ]] \
  || { echo "refusing: ${KUBECONFIG} is not the dev k3s" >&2; exit 1; }

# trivy needs the workloads; cert-manager-samples, cnpg, mongodb and redis need cert-manager.
COMPONENTS=(workloads argocd trivy cert-manager cert-manager-samples cnpg mongodb redis)

# What each package's e2e suites need, in install order. scripts/checks/e2e-legs.sh reads the keys.
declare -A NEEDS=(
  [argocd]="argocd"
  [trivy]="workloads trivy"
  [cert-manager]="cert-manager cert-manager-samples"
  [cnpg]="cert-manager cnpg"
  [mongodb]="cert-manager mongodb"
  [redis]="cert-manager redis"
)

# Helpers for components/*/install.sh, states.sh and settle.sh.

# Creates the namespace if it does not exist.
namespace() { kubectl create namespace "$1" --dry-run=client -o yaml | kubectl apply -f -; }

# kubectl apply -f for each file.
apply() { for file in "$@"; do kubectl apply -f "${file}"; done; }

# Runs a command every 5s until it succeeds or the seconds pass; the last attempt shows its output.
retry_for() { # seconds command...
  local end=$((SECONDS + $1)); shift
  while ((SECONDS < end)); do "$@" >/dev/null 2>&1 && return 0; sleep 5; done
  "$@"
}

retry() { retry_for 900 "$@"; }

# Retried: a fetch can fail; server-side: some CRDs are too big for the last-applied annotation.
apply_url() { for url in "$@"; do retry kubectl apply --server-side --force-conflicts -f "${url}"; done; }

# Waits for each deployment in the namespace to roll out.
wait_deploy() { # namespace deployment...
  local ns=$1; shift
  for deployment in "$@"; do kubectl -n "${ns}" rollout status "deploy/${deployment}" --timeout=300s; done
}

case "${1:-}" in
  install)
    shift
    if [[ "${1:-}" == --for ]]; then
      [[ -n "${2:-}" && -n "${NEEDS[$2]:-}" ]] || { echo "no package ${2:-}; one of: ${!NEEDS[*]}" >&2; exit 1; }
      read -ra names <<< "${NEEDS[$2]}"
    else
      names=("${@:-${COMPONENTS[@]}}")
    fi
    for name in "${names[@]}"; do
      [[ -f "${HERE}/components/${name}/install.sh" ]] || { echo "no component ${name}" >&2; exit 1; }
      (
        cd "${HERE}/components/${name}"
        source install.sh
        if [[ -f states.sh ]]; then source states.sh; fi
      )
    done
    # Last, so what each settle.sh waits for progresses while the other components install.
    for name in "${names[@]}"; do
      (
        cd "${HERE}/components/${name}"
        if [[ -f settle.sh ]]; then source settle.sh; fi
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
    # Fixtures read across namespaces: a partial install would drop other components' objects.
    { kubectl -n demo get deployment web && kubectl -n acme-test get deployment pebble \
        && kubectl get crd applications.argoproj.io vulnerabilityreports.aquasecurity.github.io \
          certificates.cert-manager.io clusters.postgresql.cnpg.io \
          mongodbcommunity.mongodbcommunity.mongodb.com redis.redis.redis.opstreelabs.in; } >/dev/null \
      || { echo "refusing: fixtures need every component; run cluster.sh install" >&2; exit 1; }
    cd "${HERE}/../.."
    source dev/cluster/fixtures/export.sh "$@"
    ;;
  *)
    sed -n '4,7p' "${HERE}/cluster.sh" >&2
    exit 1
    ;;
esac
