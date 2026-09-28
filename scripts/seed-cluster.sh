#!/usr/bin/env bash
#
# Install what the extensions read into the development cluster.
#
# Upstream manifests are fetched at a release tag, never a branch: a branch
# would mean today's install differs from tomorrow's with nothing in the
# repository changing. The tags obey the same fifteen-day floor as every other
# dependency here — see docs/security.md — so the newest release is often not
# the one pinned.
#
# Usage: scripts/seed-cluster.sh   (make cluster runs it)

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

readonly KUBECONFIG_PATH="${DEV_KUBECONFIG_DIR:-/tmp/freelens-addons-k3s}/kubeconfig.yaml"

# Pinned releases. Raise these deliberately, and only past the age floor.
readonly ARGOCD_VERSION="v3.5.2"
readonly TRIVY_OPERATOR_VERSION="v0.34.0"
readonly CERT_MANAGER_VERSION="v1.21.2"

export KUBECONFIG="${KUBECONFIG_PATH}"

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
[[ -r "${KUBECONFIG_PATH}" ]] || { echo "no kubeconfig at ${KUBECONFIG_PATH} — run 'make cluster' first" >&2; exit 1; }

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "Namespaces and sample workloads"
kubectl apply -f dev/cluster/00-namespaces.yaml
kubectl apply -f dev/cluster/10-workloads.yaml

# Server-side apply for both: the ApplicationSet CRD is larger than the
# annotation a client-side apply writes to remember the last configuration,
# and kubectl rejects it with "metadata.annotations: Too long".
say "ArgoCD ${ARGOCD_VERSION}"
kubectl apply --server-side --force-conflicts -n argocd \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"

say "Trivy operator ${TRIVY_OPERATOR_VERSION}"
kubectl apply --server-side --force-conflicts -f \
  "https://raw.githubusercontent.com/aquasecurity/trivy-operator/${TRIVY_OPERATOR_VERSION}/deploy/static/trivy-operator.yaml"

# A release asset rather than a raw file at a tag, because that is the only
# place cert-manager publishes its static manifest.
say "cert-manager ${CERT_MANAGER_VERSION}"
kubectl apply --server-side --force-conflicts -f \
  "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"

say "Pebble, a test ACME server"
kubectl apply -f dev/cluster/25-pebble.yaml

say "Waiting for the operators"
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s
kubectl -n trivy-system rollout status deploy/trivy-operator --timeout=300s
for deployment in cert-manager cert-manager-cainjector cert-manager-webhook; do
  kubectl -n cert-manager rollout status "deploy/${deployment}" --timeout=300s
done
kubectl -n acme-test rollout status deploy/pebble --timeout=300s

say "Sample ArgoCD Applications"
kubectl apply -f dev/cluster/20-argocd-applications.yaml

# A rolled-out webhook is not yet an answering one: the cainjector still has to
# write its CA into the webhook configuration, and until it has, every apply is
# refused with a TLS error. Retrying is what cert-manager's own docs do.
say "Sample certificates, issuers and TLS Secrets"
for attempt in $(seq 1 30); do
  kubectl apply -f dev/cluster/30-cert-manager.yaml >/dev/null 2>&1 && break
  [[ ${attempt} -eq 30 ]] && { kubectl apply -f dev/cluster/30-cert-manager.yaml; exit 1; }
  sleep 4
done
kubectl apply -f dev/cluster/30-cert-manager.yaml

# The state a list of certificates cannot show — still valid, renewal already
# failing — has no manifest. It has to be caused: let `renewal-stalls` be issued
# while flaky-ca works, then take flaky-ca's key away. Renewal falls due three
# minutes after issue and fails from then on, while Ready stays true for ninety days.
say "Breaking flaky-ca once renewal-stalls has been issued"
kubectl -n demo wait --for=condition=Ready certificate/renewal-stalls --timeout=300s
kubectl -n demo delete certificate flaky-ca-root --ignore-not-found
kubectl -n demo delete secret flaky-ca-key --ignore-not-found

# The ArgoCD states no manifest can declare, caused through ArgoCD itself: a
# history with two revisions and several deploys inside the hour, which the
# compare link and "syncing repeatedly" read, and drift on an Application with
# no automated sync, which stays OutOfSync and names what differs.
say "Giving guestbook a deploy history, and helm-guestbook some drift"
started() { kubectl -n argocd get application "$1" -o jsonpath='{.status.operationState.startedAt}' 2>/dev/null; }
settle() { # name: wait until the last operation succeeded and the sync is clean
  for _ in $(seq 1 120); do
    [[ "$(kubectl -n argocd get application "$1" -o jsonpath='{.status.operationState.phase}/{.status.sync.status}' 2>/dev/null)" == "Succeeded/Synced" ]] && return 0
    sleep 2
  done
  echo "timed out waiting for $1 to settle" >&2
  return 1
}
sync_to() { # name revision: start a sync as a person would, and wait for it
  local before
  before=$(started "$1")
  kubectl -n argocd patch application "$1" --type merge -p \
    "{\"operation\":{\"initiatedBy\":{\"username\":\"seed\"},\"sync\":{\"revision\":\"$2\"}}}" >/dev/null
  for _ in $(seq 1 120); do
    [[ "$(started "$1")" != "${before}" && "$(kubectl -n argocd get application "$1" -o jsonpath='{.status.operationState.phase}')" == "Succeeded" ]] && return 0
    sleep 2
  done
  echo "timed out syncing $1 to $2" >&2
  return 1
}
settle guestbook
sync_to guestbook HEAD
sync_to guestbook HEAD
# An older commit last. guestbook heals itself back to HEAD, so its last two
# deploys are two different revisions, which is what a compare link needs.
sync_to guestbook 5c2d89b897c4df42e06f94622f857dc4d7adc8f8
settle guestbook
sync_to helm-guestbook HEAD
kubectl -n demo scale deployment helm-guestbook --replicas=2

# A rollout leaves the previous ReplicaSet behind at zero replicas. Its config
# audit goes and its SBOM stays, which is why coverage has to union the report
# kinds rather than trust any one of them as the list of workloads.
say "Rolling web once, so an old ReplicaSet keeps its SBOM"
kubectl -n demo patch deployment web --type merge \
  -p '{"spec":{"template":{"metadata":{"annotations":{"freelens-addons/rollout":"seeded"}}}}}' >/dev/null
kubectl -n demo rollout status deployment/web --timeout=180s

say "Ready"
kubectl get nodes
echo
echo "KUBECONFIG=${KUBECONFIG_PATH}"
