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
readonly CNPG_VERSION="1.30.0"
readonly BARMAN_CLOUD_VERSION="v0.15.0"
readonly MCK_VERSION="1.12.0"
readonly REDIS_OPERATOR_VERSION="v0.26.0"

export KUBECONFIG="${KUBECONFIG_PATH}"

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
[[ -r "${KUBECONFIG_PATH}" ]] || { echo "no kubeconfig at ${KUBECONFIG_PATH} — run 'make cluster' first" >&2; exit 1; }
[[ "$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}')" == "freelens-addons-dev" ]] \
  || { echo "refusing: ${KUBECONFIG_PATH} is not the dev k3s (its only node is freelens-addons-dev)" >&2; exit 1; }

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

say "CloudNativePG ${CNPG_VERSION}"
kubectl apply --server-side --force-conflicts -f \
  "https://github.com/cloudnative-pg/cloudnative-pg/releases/download/v${CNPG_VERSION}/cnpg-${CNPG_VERSION}.yaml"

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
kubectl -n cnpg-system rollout status deploy/cnpg-controller-manager --timeout=300s

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

# The plugin's certificates need cert-manager, so it comes after it.
say "Barman Cloud plugin ${BARMAN_CLOUD_VERSION}"
kubectl apply --server-side --force-conflicts -f \
  "https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/${BARMAN_CLOUD_VERSION}/manifest.yaml"
kubectl -n cnpg-system rollout status deploy/barman-cloud --timeout=300s

say "Postgres clusters, backups and poolers"
kubectl apply -f dev/cluster/50-cnpg.yaml
for cluster in orders-db billing-db inventory-db reports-db; do
  kubectl -n databases wait --for=condition=Ready "cluster/${cluster}" --timeout=600s
done

# The subscription needs the table on both ends; the publication carries its rows across.
psql_on() { # pod database sql
  kubectl -n databases exec "$1" -c postgres -- psql -d "$2" -At -c "$3"
}
for cluster in orders-db inventory-db; do
  psql_on "$(kubectl -n databases get cluster "${cluster}" -o jsonpath='{.status.currentPrimary}')" app \
    "create table if not exists orders (id bigint primary key, placed_at timestamptz not null default now(), total numeric(10,2) not null)"
done

# States no manifest can declare: a switchover, and a hibernated cluster.
say "Switching orders-db over, hibernating reports-db"
kubectl -n databases patch cluster orders-db --subresource=status --type merge -p \
  '{"status":{"targetPrimary":"orders-db-2","phase":"Switchover in progress","phaseReason":"Switching over to orders-db-2"}}' >/dev/null
kubectl -n databases annotate cluster reports-db cnpg.io/hibernation=on --overwrite
for _ in $(seq 1 100); do
  [[ "$(kubectl -n databases get cluster orders-db -o jsonpath='{.status.currentPrimary}')" == "orders-db-2" ]] && break
  sleep 3
done

# Replication lag: one replica stops replaying while the primary keeps writing.
say "Pausing replay on orders-db-3, then writing on the primary"
kubectl -n databases wait --for=condition=Ready cluster/orders-db --timeout=600s
psql_on orders-db-3 postgres "select pg_wal_replay_pause()"
psql_on orders-db-2 app "insert into orders select g, now(), g * 1.5 from generate_series(1, 20000) g on conflict do nothing"

# Watches its own namespace, so the replica sets live beside it.
say "MongoDB Controllers for Kubernetes ${MCK_VERSION}"
for manifest in crds mongodb-kubernetes; do
  kubectl apply --server-side --force-conflicts -f \
    "https://raw.githubusercontent.com/mongodb/mongodb-kubernetes/${MCK_VERSION}/public/${manifest}.yaml"
done
kubectl -n mongodb rollout status deploy/mongodb-kubernetes-operator --timeout=300s

say "MongoDB replica sets"
kubectl apply -f dev/cluster/60-mongodb.yaml
for replica_set in catalog-rs sessions-rs; do
  kubectl -n mongodb wait --for=jsonpath='{.status.phase}'=Running "mongodbcommunity/${replica_set}" --timeout=600s
done

# Its kustomize pins an older image and never pulls; both set to what the release published.
say "redis-operator ${REDIS_OPERATOR_VERSION}"
kubectl apply --server-side --force-conflicts \
  -k "github.com/OT-CONTAINER-KIT/redis-operator/config/default?ref=${REDIS_OPERATOR_VERSION}"
kubectl -n redis-operator-system patch deployment redis-operator-redis-operator --type json -p \
  "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/image\",\"value\":\"quay.io/opstree/redis-operator:${REDIS_OPERATOR_VERSION}\"},{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/imagePullPolicy\",\"value\":\"IfNotPresent\"}]"
kubectl -n redis-operator-system rollout status deployment/redis-operator-redis-operator --timeout=300s

say "Redis replication, sentinels, cluster and standalone"
kubectl apply -f dev/cluster/70-redis.yaml
kubectl -n redis wait --for=jsonpath='{.status.state}'=Ready rediscluster/shards --timeout=600s
# The master moves on failover, so wait for any.
timeout 600 sh -c 'until [ -n "$(kubectl -n redis get redisreplication cache -o jsonpath="{.status.masterNode}")" ]; do sleep 5; done'

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
