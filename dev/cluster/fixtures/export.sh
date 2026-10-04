# Writes the test fixtures from the dev k3s, from the repository root. Run by `cluster.sh fixtures`.

# Domains to redact stay in git-ignored .env, out of committed files. Only that line is read.
FIXTURE_REDACT_DOMAINS=""
if [[ -f .env ]]; then
  FIXTURE_REDACT_DOMAINS="$(sed -n 's/^FIXTURE_REDACT_DOMAINS=//p' .env | tail -1 | tr -d "\"'")"
fi
export FIXTURE_REDACT_DOMAINS

# kubectl get, sanitised. Usage: save FILE RESOURCE [kubectl get flags...]
save() {
  local file=$1; shift
  kubectl get "$@" -o json | python3 dev/cluster/fixtures/sanitise.py > "${out}/${file}"
}

# Names and cert-manager's annotations only, never a value: what the extensions ask for.
save_secret_names() { # namespace
  kubectl get secrets -n "$1" -o json | python3 dev/cluster/fixtures/sanitise.py --names-only > "${out}/secret-names.json"
}

# The tests' "now".
save_time() {
  printf '{ "exportedAt": "%s" }\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "${out}/exported-at.json"
}

# The JSON on stdin, as one line {"namespace", "pod", KEY: <it>}. Usage: as_item NAMESPACE POD KEY
as_item() {
  python3 -c 'import json, sys; print(json.dumps({"namespace": sys.argv[1], "pod": sys.argv[2], sys.argv[3]: json.load(sys.stdin)}))' "$@"
}

# Those lines, as {"items": [...]}.
join_items() {
  python3 -c 'import json, sys; print(json.dumps({"items": [json.loads(line) for line in sys.stdin]}, indent=4))'
}

argocd() {
  save applications.json applications.argoproj.io -A
  save app-projects.json appprojects.argoproj.io -A
  save nodes.json nodes
  save events.json events -A --field-selector type=Warning
  save image-updaters.json imageupdaters.argocd-image-updater.argoproj.io -A
}

trivy() {
  save vulnerability-reports.json vulnerabilityreports.aquasecurity.github.io -A
  save sbom-reports.json sbomreports.aquasecurity.github.io -A
  save config-audit-reports.json configauditreports.aquasecurity.github.io -A
  save exposed-secret-reports.json exposedsecretreports.aquasecurity.github.io -A
  save pods.json pods -A
  save rbac-reports.json rbacassessmentreports.aquasecurity.github.io -A
  save cluster-rbac-reports.json clusterrbacassessmentreports.aquasecurity.github.io
}

cert-manager() {
  save certificates.json certificates.cert-manager.io -A
  save certificate-requests.json certificaterequests.cert-manager.io -A
  save issuers.json issuers.cert-manager.io -A
  save cluster-issuers.json clusterissuers.cert-manager.io
  save orders.json orders.acme.cert-manager.io -A
  save challenges.json challenges.acme.cert-manager.io -A
  save ingresses.json ingresses.networking.k8s.io -A
  save tls-secrets.json secrets -A --field-selector type=kubernetes.io/tls
  save_time
}

cnpg() {
  save clusters.json clusters.postgresql.cnpg.io -A
  save backups.json backups.postgresql.cnpg.io -A
  save scheduled-backups.json scheduledbackups.postgresql.cnpg.io -A
  save poolers.json poolers.postgresql.cnpg.io -A
  save object-stores.json objectstores.barmancloud.cnpg.io -A
  save events.json events -A --field-selector type=Warning
  save pods.json pods -A -l cnpg.io/cluster
  save publications.json publications.postgresql.cnpg.io -A
  save subscriptions.json subscriptions.postgresql.cnpg.io -A
  save pdbs.json poddisruptionbudgets -A -l cnpg.io/cluster
  save_secret_names databases

  # What `kubectl cnpg status` reads from each instance: lag, slots, LSNs, archiving.
  for pod in $(kubectl get pods -n databases -l cnpg.io/podRole=instance --field-selector status.phase=Running \
    -o jsonpath='{.items[*].metadata.name}'); do
    kubectl get --raw "/api/v1/namespaces/databases/pods/https:${pod}:8000/proxy/pg/status" \
      | as_item databases "${pod}" status
  done | join_items > "${out}/instance-status.json"

  kubectl logs -n databases -l cnpg.io/cluster=orders-db,cnpg.io/podRole=instance -c postgres \
    --tail=60 --prefix=false > "${out}/postgres-log.txt"
  # The exporter's uptime and database sizes, from orders-db's primary.
  kubectl get --raw "/api/v1/namespaces/databases/pods/orders-db-2:9187/proxy/metrics" \
    | grep -E '^(# (HELP|TYPE) )?cnpg_pg_(postmaster_start_time|database_size_bytes)' > "${out}/metrics.txt"
  # Barman writes the cause of a failed backup here only; billing-db's keys are wrong on purpose.
  kubectl logs -n databases -l cnpg.io/cluster=billing-db,cnpg.io/instanceRole=primary \
    -c plugin-barman-cloud --tail=200 > "${out}/plugin-log.txt"
  save_time
}

mongodb() {
  save replica-sets.json mongodbcommunity.mongodbcommunity.mongodb.com -A
  save events.json events -n mongodb --field-selector type=Warning
  save pods.json pods -n mongodb
  save statefulsets.json statefulsets -n mongodb
  save pvcs.json persistentvolumeclaims -n mongodb
  save_secret_names mongodb

  # What the automation agent says of each member. By its container, not the pod's phase: a
  # member whose mongod cannot start still has an agent.
  for pod in $(kubectl get pods -n mongodb -o jsonpath='{.items[*].metadata.name}'); do
    [[ -n "$(kubectl get pod -n mongodb "${pod}" \
      -o jsonpath='{.status.containerStatuses[?(@.name=="mongodb-agent")].state.running}')" ]] || continue
    kubectl exec -n mongodb "${pod}" -c mongodb-agent -- \
      cat /var/log/mongodb-mms-automation/healthstatus/agent-health-status.json \
      | as_item mongodb "${pod}" health
  done | join_items > "${out}/agent-health.json"
  save_time
}

redis() {
  save standalones.json redis.redis.redis.opstreelabs.in -n redis
  save replications.json redisreplications.redis.redis.opstreelabs.in -n redis
  save clusters.json redisclusters.redis.redis.opstreelabs.in -n redis
  save sentinels.json redissentinels.redis.redis.opstreelabs.in -n redis
  save events.json events -n redis --field-selector type=Warning
  save pods.json pods -n redis
  save pvcs.json persistentvolumeclaims -n redis
  save_secret_names redis
  save_time
}

ALL=(argocd trivy cert-manager cnpg mongodb redis)

for package in "${@:-${ALL[@]}}"; do
  [[ " ${ALL[*]} " == *" ${package} "* ]] || { echo "no fixtures for ${package}; one of: ${ALL[*]}" >&2; exit 1; }
  echo "==> ${package}"
  out="packages/${package}/test/fixtures"
  mkdir -p "${out}"
  "${package}"
done

echo "==> Done. Read the diff before committing: these are cluster contents."
