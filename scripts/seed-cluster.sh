#!/usr/bin/env bash
# Installs what the extensions read into the dev cluster. `make cluster` runs it.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

readonly KUBECONFIG_PATH="${DEV_KUBECONFIG_DIR:-/tmp/freelens-addons-k3s}/kubeconfig.yaml"

# Release tags, never branches, and only past the 15-day age floor.
readonly ARGOCD_VERSION="v3.5.2"
readonly TRIVY_OPERATOR_VERSION="v0.34.0"
readonly CERT_MANAGER_VERSION="v1.21.2"
readonly IMAGE_UPDATER_VERSION="v1.3.0"

export KUBECONFIG="${KUBECONFIG_PATH}"

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
[[ -r "${KUBECONFIG_PATH}" ]] || { echo "no kubeconfig at ${KUBECONFIG_PATH} — run 'make cluster' first" >&2; exit 1; }

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "Namespaces and sample workloads"
kubectl apply -f dev/cluster/00-namespaces.yaml
kubectl apply -f dev/cluster/10-workloads.yaml

# Server-side: the ApplicationSet CRD is too big for the last-applied annotation.
say "ArgoCD ${ARGOCD_VERSION}"
kubectl apply --server-side --force-conflicts -n argocd \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml"

say "Trivy operator ${TRIVY_OPERATOR_VERSION}"
kubectl apply --server-side --force-conflicts -f \
  "https://raw.githubusercontent.com/aquasecurity/trivy-operator/${TRIVY_OPERATOR_VERSION}/deploy/static/trivy-operator.yaml"

say "cert-manager ${CERT_MANAGER_VERSION}"
kubectl apply --server-side --force-conflicts -f \
  "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"

# Its rules must live in the argocd namespace, beside the Applications.
say "Argo CD Image Updater ${IMAGE_UPDATER_VERSION}"
kubectl apply --server-side --force-conflicts -n argocd -f \
  "https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/${IMAGE_UPDATER_VERSION}/config/install.yaml"

say "Pebble, a test ACME server"
kubectl apply -f dev/cluster/25-pebble.yaml

say "Waiting for the operators"
kubectl -n argocd rollout status deploy/argocd-server --timeout=300s
kubectl -n trivy-system rollout status deploy/trivy-operator --timeout=300s
for deployment in cert-manager cert-manager-cainjector cert-manager-webhook; do
  kubectl -n cert-manager rollout status "deploy/${deployment}" --timeout=300s
done
kubectl -n acme-test rollout status deploy/pebble --timeout=300s
kubectl -n argocd rollout status deploy/argocd-image-updater-controller --timeout=300s

say "Sample ArgoCD Applications"
kubectl apply -f dev/cluster/20-argocd-applications.yaml

say "Image Updater rules, one per state the page ranks"
kubectl apply -f dev/cluster/40-image-updater.yaml

# The webhook refuses applies with a TLS error until the cainjector has written its CA.
say "Sample certificates, issuers and TLS Secrets"
for attempt in $(seq 1 30); do
  kubectl apply -f dev/cluster/30-cert-manager.yaml >/dev/null 2>&1 && break
  [[ ${attempt} -eq 30 ]] && { kubectl apply -f dev/cluster/30-cert-manager.yaml; exit 1; }
  sleep 4
done
kubectl apply -f dev/cluster/30-cert-manager.yaml

# Valid but failing to renew: issue renewal-stalls, then remove flaky-ca's key.
say "Breaking flaky-ca once renewal-stalls has been issued"
kubectl -n demo wait --for=condition=Ready certificate/renewal-stalls --timeout=300s
kubectl -n demo delete certificate flaky-ca-root --ignore-not-found
kubectl -n demo delete secret flaky-ca-key --ignore-not-found

# States no manifest can declare: a deploy history with two revisions, and drift.
say "Giving guestbook a deploy history, and helm-guestbook some drift"
started() { kubectl -n argocd get application "$1" -o jsonpath='{.status.operationState.startedAt}' 2>/dev/null; }
settle() { # name
  for _ in $(seq 1 120); do
    [[ "$(kubectl -n argocd get application "$1" -o jsonpath='{.status.operationState.phase}/{.status.sync.status}' 2>/dev/null)" == "Succeeded/Synced" ]] && return 0
    sleep 2
  done
  echo "timed out waiting for $1 to settle" >&2
  return 1
}
sync_to() { # name revision
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
# An older commit last; guestbook self-heals to HEAD, leaving two distinct revisions.
sync_to guestbook 5c2d89b897c4df42e06f94622f857dc4d7adc8f8
settle guestbook
sync_to helm-guestbook HEAD
kubectl -n demo scale deployment helm-guestbook --replicas=2

# The old ReplicaSet keeps its SBOM but loses its config audit.
say "Rolling web once, so an old ReplicaSet keeps its SBOM"
kubectl -n demo patch deployment web --type merge \
  -p '{"spec":{"template":{"metadata":{"annotations":{"freelens-addons/rollout":"seeded"}}}}}' >/dev/null
kubectl -n demo rollout status deployment/web --timeout=180s

say "Ready"
kubectl get nodes
echo
echo "KUBECONFIG=${KUBECONFIG_PATH}"
