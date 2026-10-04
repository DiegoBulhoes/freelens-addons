#!/usr/bin/env bash
# Refreshes test fixtures from the dev cluster. Read the diff before committing.
# Usage: KUBECONFIG=/path/to/kubeconfig scripts/export-fixtures.sh [package...]

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Domains to redact stay in git-ignored .env, out of committed files.
# shellcheck source=/dev/null
[[ -f .env ]] && source .env
export FIXTURE_REDACT_DOMAINS="${FIXTURE_REDACT_DOMAINS:-}"

command -v kubectl >/dev/null || { echo "kubectl is required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

out=""

emit() {
  local kind="$1" file="$2"
  shift 2

  echo "  ${kind} → ${out}/${file}"
  kubectl get "${kind}" "$@" -o json | python3 scripts/sanitise-fixture.py > "${out}/${file}"
}

argocd() {
  emit applications.argoproj.io applications.json -A
  emit appprojects.argoproj.io app-projects.json -A
  emit nodes nodes.json
  emit events events.json -A --field-selector type=Warning
  emit imageupdaters.argocd-image-updater.argoproj.io image-updaters.json -A
}

trivy() {
  emit vulnerabilityreports.aquasecurity.github.io vulnerability-reports.json -A
  emit sbomreports.aquasecurity.github.io sbom-reports.json -A
  emit configauditreports.aquasecurity.github.io config-audit-reports.json -A
  emit exposedsecretreports.aquasecurity.github.io exposed-secret-reports.json -A
  # Env values are redacted by the sanitiser.
  emit pods pods.json -A
  emit rbacassessmentreports.aquasecurity.github.io rbac-reports.json -A
  emit clusterrbacassessmentreports.aquasecurity.github.io cluster-rbac-reports.json
}

cert-manager() {
  emit certificates.cert-manager.io certificates.json -A
  emit certificaterequests.cert-manager.io certificate-requests.json -A
  emit issuers.cert-manager.io issuers.json -A
  emit clusterissuers.cert-manager.io cluster-issuers.json
  emit orders.acme.cert-manager.io orders.json -A
  emit challenges.acme.cert-manager.io challenges.json -A
  emit ingresses.networking.k8s.io ingresses.json -A
  # The sanitiser strips Secret data.
  emit secrets tls-secrets.json -A --field-selector type=kubernetes.io/tls

  # Tests' "now": cert-manager's newest timestamp can be the instant a renewal fell due.
  printf '{ "exportedAt": "%s" }\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${out}/exported-at.json"
  echo "  exported at → ${out}/exported-at.json"
}

cnpg() {
  emit clusters.postgresql.cnpg.io clusters.json -A
  emit backups.postgresql.cnpg.io backups.json -A
  emit scheduledbackups.postgresql.cnpg.io scheduled-backups.json -A
  emit poolers.postgresql.cnpg.io poolers.json -A
  emit objectstores.barmancloud.cnpg.io object-stores.json -A
  emit events events.json -A --field-selector type=Warning
  # Env values are redacted by the sanitiser.
  emit pods pods.json -A -l cnpg.io/cluster
  emit publications.postgresql.cnpg.io publications.json -A
  emit subscriptions.postgresql.cnpg.io subscriptions.json -A
  emit poddisruptionbudgets pdbs.json -A -l cnpg.io/cluster
  # Metadata only: names and cert-manager's annotations, never a value.
  kubectl get secrets -n databases -o json \
    | python3 -c 'import json, sys; print(json.dumps({"items": [{"metadata": {"name": s["metadata"]["name"], "namespace": s["metadata"]["namespace"], "annotations": {k: v for k, v in (s["metadata"].get("annotations") or {}).items() if k.startswith("cert-manager.io/")}}} for s in json.load(sys.stdin)["items"]]}, indent=2))' \
    > "${out}/secret-names.json"
  echo "  secret names → ${out}/secret-names.json"
  # What `kubectl cnpg status` reads from each instance: lag, slots, LSNs, archiving.
  {
    printf '{"items":['
    first=1
    for pod in $(kubectl get pods -A -l cnpg.io/podRole=instance --field-selector status.phase=Running \
      -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{" "}{end}'); do
      [[ ${first} -eq 1 ]] || printf ','
      first=0
      printf '{"namespace":"%s","pod":"%s","status":' "${pod%%/*}" "${pod##*/}"
      kubectl get --raw "/api/v1/namespaces/${pod%%/*}/pods/https:${pod##*/}:8000/proxy/pg/status"
      printf '}'
    done
    printf ']}\n'
  } | python3 -m json.tool > "${out}/instance-status.json"
  echo "  instance status → ${out}/instance-status.json"
  kubectl logs -n databases -l cnpg.io/cluster=orders-db,cnpg.io/podRole=instance -c postgres \
    --tail=60 --prefix=false > "${out}/postgres-log.txt"
  echo "  postgres log → ${out}/postgres-log.txt"
  # The exporter's uptime and database sizes, from orders-db's primary.
  kubectl get --raw "/api/v1/namespaces/databases/pods/orders-db-2:9187/proxy/metrics" \
    | grep -E '^(# (HELP|TYPE) )?cnpg_pg_(postmaster_start_time|database_size_bytes)' > "${out}/metrics.txt"
  echo "  metrics → ${out}/metrics.txt"
  # Barman writes the cause of a failed backup here only; billing-db's keys are wrong on purpose.
  kubectl logs -n databases -l cnpg.io/cluster=billing-db,cnpg.io/instanceRole=primary \
    -c plugin-barman-cloud --tail=200 > "${out}/plugin-log.txt"
  echo "  plugin log → ${out}/plugin-log.txt"

  printf '{ "exportedAt": "%s" }\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${out}/exported-at.json"
  echo "  exported at → ${out}/exported-at.json"
}

mongodb() {
  emit mongodbcommunity.mongodbcommunity.mongodb.com replica-sets.json -A
  emit events events.json -n mongodb --field-selector type=Warning
  # Env values are redacted by the sanitiser.
  emit pods pods.json -n mongodb
  emit statefulsets statefulsets.json -n mongodb
  emit persistentvolumeclaims pvcs.json -n mongodb
  # Metadata only, in the shape the extension asks for: names and cert-manager's annotations, never a value.
  kubectl get secrets -n mongodb -o json \
    | python3 -c 'import json, sys; print(json.dumps({"items": [{"metadata": {"name": s["metadata"]["name"], "namespace": s["metadata"]["namespace"], "annotations": {k: v for k, v in (s["metadata"].get("annotations") or {}).items() if k.startswith("cert-manager.io/")}}} for s in json.load(sys.stdin)["items"]]}, indent=2))' \
    > "${out}/secret-names.json"
  echo "  secret names → ${out}/secret-names.json"
  # What the automation agent says of each member: its replication state and its plan.
  {
    printf '{"items":['
    first=1
    # By the agent's container, not the pod's phase: a member whose mongod cannot start still has an agent.
    for pod in $(kubectl get pods -n mongodb -o jsonpath='{range .items[*]}{.metadata.name}{" "}{end}'); do
      [[ -n "$(kubectl get pod -n mongodb "${pod}" \
        -o jsonpath='{.status.containerStatuses[?(@.name=="mongodb-agent")].state.running}')" ]] || continue
      [[ ${first} -eq 1 ]] || printf ','
      first=0
      printf '{"namespace":"mongodb","pod":"%s","health":' "${pod}"
      kubectl exec -n mongodb "${pod}" -c mongodb-agent -- \
        cat /var/log/mongodb-mms-automation/healthstatus/agent-health-status.json
      printf '}'
    done
    printf ']}\n'
  } | python3 -m json.tool > "${out}/agent-health.json"
  echo "  agent health → ${out}/agent-health.json"

  printf '{ "exportedAt": "%s" }\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${out}/exported-at.json"
  echo "  exported at → ${out}/exported-at.json"
}

packages=("$@")
[[ ${#packages[@]} -eq 0 ]] && packages=(argocd trivy cert-manager cnpg mongodb)

# Public repository: only the dev k3s, recognised by its fixed node name.
if [[ "$(kubectl get nodes -o jsonpath='{.items[*].metadata.name}')" != "freelens-addons-dev" ]]; then
  echo "refusing: this is not the development cluster (its only node is freelens-addons-dev)." >&2
  echo "Fixtures are committed to a public repository; export them from 'make cluster' only." >&2
  exit 1
fi

echo "Exporting fixtures from $(kubectl config current-context)"

for package in "${packages[@]}"; do
  out="packages/${package}/test/fixtures"

  [[ -d "packages/${package}" ]] || { echo "no such package: ${package}" >&2; exit 1; }

  echo "${package}:"
  mkdir -p "${out}"
  "${package}"
done

echo
echo "Fixtures written. Read the diff before committing — these are cluster contents."
