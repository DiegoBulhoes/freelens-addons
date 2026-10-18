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

# save, for the namespaces named only. Usage: save_in FILE RESOURCE NAMESPACE... [-- kubectl get flags...]
save_in() {
  local file=$1 resource=$2 namespaces=(); shift 2
  while (($#)) && [[ "$1" != -- ]]; do namespaces+=("$1"); shift; done
  (($#)) && shift
  kubectl get "${resource}" -A "$@" -o json \
    | python3 -c 'import json, sys; d = json.load(sys.stdin); keep = set(sys.argv[1:]); d["items"] = [i for i in d["items"] if i["metadata"]["namespace"] in keep]; json.dump(d, sys.stdout)' "${namespaces[@]}" \
    | python3 dev/cluster/fixtures/sanitise.py > "${out}/${file}"
}

# Names and cert-manager's annotations only, never a value: what the extensions ask for.
save_secret_names() { # namespace...
  local namespace
  for namespace in "$@"; do kubectl get secrets -n "${namespace}" -o json; done \
    | python3 dev/cluster/fixtures/sanitise.py --names-only > "${out}/secret-names.json"
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
  save application-sets.json applicationsets.argoproj.io -A
  save nodes.json nodes
  save events.json events -A --field-selector type=Warning
  save image-updaters.json imageupdaters.argocd-image-updater.argoproj.io -A
  save_in pods.json pods argocd demo podinfo
}

# The other extensions' namespaces would multiply the reports without adding a case.
TRIVY_NAMESPACES=(trivy-system demo kube-system kube-public default argocd kustomize-guestbook pinned podinfo sync-waves cert-manager acme-test)

trivy() {
  save_in vulnerability-reports.json vulnerabilityreports.aquasecurity.github.io "${TRIVY_NAMESPACES[@]}"
  save_in sbom-reports.json sbomreports.aquasecurity.github.io "${TRIVY_NAMESPACES[@]}"
  save_in config-audit-reports.json configauditreports.aquasecurity.github.io "${TRIVY_NAMESPACES[@]}"
  save_in exposed-secret-reports.json exposedsecretreports.aquasecurity.github.io "${TRIVY_NAMESPACES[@]}"
  save_in pods.json pods "${TRIVY_NAMESPACES[@]}"
  save_in replica-sets.json replicasets.apps "${TRIVY_NAMESPACES[@]}"
  save_in rbac-reports.json rbacassessmentreports.aquasecurity.github.io "${TRIVY_NAMESPACES[@]}"
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
    --tail=60 --prefix=false | python3 dev/cluster/fixtures/sanitise.py --text > "${out}/postgres-log.txt"
  # The exporter's uptime and database sizes, from orders-db's primary.
  kubectl get --raw "/api/v1/namespaces/databases/pods/orders-db-2:9187/proxy/metrics" \
    | grep -E '^(# (HELP|TYPE) )?cnpg_pg_(postmaster_start_time|database_size_bytes)' \
    | python3 dev/cluster/fixtures/sanitise.py --text > "${out}/metrics.txt"
  # Barman writes the cause of a failed backup here only; billing-db's keys are wrong on purpose.
  kubectl logs -n databases -l cnpg.io/cluster=billing-db,cnpg.io/instanceRole=primary \
    -c plugin-barman-cloud --tail=200 | python3 dev/cluster/fixtures/sanitise.py --text > "${out}/plugin-log.txt"
  save_time
}

mongodb() {
  # The namespaces the operator watches: mongodb-apps holds orders-rs.
  local namespace namespaces=(mongodb mongodb-apps) pod
  save replica-sets.json mongodbcommunity.mongodbcommunity.mongodb.com -A
  save_in events.json events "${namespaces[@]}" -- --field-selector type=Warning
  save_in pods.json pods "${namespaces[@]}"
  save_in statefulsets.json statefulsets "${namespaces[@]}"
  save_in pvcs.json persistentvolumeclaims "${namespaces[@]}"
  save_secret_names "${namespaces[@]}"

  # What the automation agent says of each member. By its container, not the pod's phase: a
  # member whose mongod cannot start still has an agent.
  for namespace in "${namespaces[@]}"; do
    for pod in $(kubectl get pods -n "${namespace}" -o jsonpath='{.items[*].metadata.name}'); do
      [[ -n "$(kubectl get pod -n "${namespace}" "${pod}" \
        -o jsonpath='{.status.containerStatuses[?(@.name=="mongodb-agent")].state.running}')" ]] || continue
      kubectl exec -n "${namespace}" "${pod}" -c mongodb-agent -- \
        cat /var/log/mongodb-mms-automation/healthstatus/agent-health-status.json \
        | as_item "${namespace}" "${pod}" health
    done
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

opentelemetry() {
  # demo opts nothing in, so it must give no row.
  local namespaces=(otel-apps otel-namespace otel-orphan otel-ambiguous otel-late otel-blocked otel-tls
    otel-batch otel-collectors otel-sidecar otel-allocator opentelemetry-operator-system demo)
  save collectors.json opentelemetrycollectors.v1beta1.opentelemetry.io -A
  save instrumentations.json instrumentations.opentelemetry.io -A
  save_in workloads.json deployments,statefulsets,daemonsets,cronjobs,jobs "${namespaces[@]}"
  save_in pods.json pods "${namespaces[@]}"
  save namespaces.json namespaces
  # Where the TLS Instrumentation's Secret is looked up.
  save_secret_names otel-tls
  # The operator records no cause; the collector's last run does, and comes and goes as it restarts.
  retry collector_log
  save_time
}

collector_log() {
  kubectl -n otel-collectors logs -l app.kubernetes.io/instance=otel-collectors.broken \
    -c otc-container --previous --tail=60 | python3 dev/cluster/fixtures/sanitise.py --text > "${out}/collector-log.txt"
  grep -q '^Error:' "${out}/collector-log.txt"
}

prometheus() {
  # kube-system holds the kubelet Service the operator keeps; prom-broken the instance that cannot start.
  local namespaces=(monitoring prom-apps prom-outside prom-broken prometheus-operator otel-collectors
    kube-system)
  save service-monitors.json servicemonitors.monitoring.coreos.com -A
  save pod-monitors.json podmonitors.monitoring.coreos.com -A
  save scrape-configs.json scrapeconfigs.monitoring.coreos.com -A
  save prometheus-rules.json prometheusrules.monitoring.coreos.com -A
  save prometheuses.json prometheuses.monitoring.coreos.com -A
  save agents.json prometheusagents.monitoring.coreos.com -A
  save alertmanagers.json alertmanagers.monitoring.coreos.com -A
  save collectors.json opentelemetrycollectors.v1beta1.opentelemetry.io -A
  save_in services.json services "${namespaces[@]}"
  save_in endpoint-slices.json endpointslices.discovery.k8s.io "${namespaces[@]}"
  save_in pods.json pods "${namespaces[@]}"
  save_in pvcs.json persistentvolumeclaims "${namespaces[@]}"
  save namespaces.json namespaces
  save nodes.json nodes
  source dev/cluster/components/prometheus/rejections.sh
  wait_rejections
  save events.json events -A --field-selector reason=InvalidConfiguration
  python3 -c 'import json, sys; sys.exit(0 if json.load(open(sys.argv[1]))["items"] else 1)' \
    "${out}/events.json" || { echo "refusing: no InvalidConfiguration Events" >&2; exit 1; }
  # From the TargetAllocator only /jobs: its /scrape_configs carries the monitors' credentials.
  retry prometheus_api
  targetallocator_jobs > "${out}/targetallocator-jobs.json"
  usage_metrics "${namespaces[@]}" > "${out}/usage-metrics.json"
  save_time
}

# What each running Prometheus answers, one pod per shard; ends once a target is down.
prometheus_api() {
  local entry file key path pod pods
  pods="$(kubectl get pods -A -l app.kubernetes.io/name=prometheus --field-selector status.phase=Running \
    -o jsonpath='{range .items[*]}{.metadata.namespace}/{.metadata.name}{" "}{end}')"
  # file key path
  for entry in "prometheus-targets targets targets?state=active" "scrape-pools scrapePools scrape_pools" \
    "prometheus-rules-live rules rules" "prometheus-alertmanagers alertmanagers alertmanagers"; do
    read -r file key path <<< "${entry}"
    for pod in ${pods}; do
      kubectl get --raw "/api/v1/namespaces/${pod%/*}/pods/${pod#*/}:9090/proxy/api/v1/${path}" \
        | python3 dev/cluster/fixtures/sanitise.py --api | as_item "${pod%/*}" "${pod#*/}" "${key}"
    done | join_items > "${out}/${file}.json"
  done
  grep -q '"health": "down"' "${out}/prometheus-targets.json"
}

# The job names of each TargetAllocator that takes monitors, as {"namespace", "collector", "jobs"}.
targetallocator_jobs() {
  local collector
  for collector in $(kubectl get opentelemetrycollectors.v1beta1.opentelemetry.io -A \
    -o jsonpath='{range .items[?(@.spec.targetAllocator.prometheusCR.enabled==true)]}{.metadata.namespace}/{.metadata.name}{" "}{end}'); do
    kubectl get --raw "/api/v1/namespaces/${collector%/*}/services/${collector#*/}-targetallocator:80/proxy/jobs" \
      | python3 dev/cluster/fixtures/sanitise.py --api \
      | python3 -c 'import json, sys; print(json.dumps({"namespace": sys.argv[1], "collector": sys.argv[2], "jobs": json.load(sys.stdin)}))' \
        "${collector%/*}" "${collector#*/}"
  done | join_items
}

# The Usage page's queries, with its rate window for a 60s step.
USAGE_FS='fstype!~"tmpfs|overlay|squashfs"'
USAGE_NET='device!~"lo|veth.*|cni.*|flannel.*|cali.*"'
USAGE_CONTAINER='container!="",container!="POD",image!=""'
declare -A USAGE_QUERIES=(
  [nodeLabelNode]='count by(node)(node_uname_info)'
  [nodeLabelKubernetesNode]='count by(kubernetes_node)(node_uname_info)'
  [nodeCpuUsed]='sum by(node)(rate(node_cpu_seconds_total{mode!~"idle|iowait|steal"}[2m]))'
  [nodeCpuCores]='count by(node)(node_cpu_seconds_total{mode="idle"})'
  [nodeMemoryUsed]='sum by(node)(node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes)'
  [nodeMemoryTotal]='sum by(node)(node_memory_MemTotal_bytes)'
  [nodeFsUsed]="max by(node,device)(node_filesystem_size_bytes{${USAGE_FS}} - node_filesystem_avail_bytes{${USAGE_FS}})"
  [nodeFsSize]="max by(node,device)(node_filesystem_size_bytes{${USAGE_FS}})"
  [nodeDiskRead]='sum by(node)(rate(node_disk_read_bytes_total[2m]))'
  [nodeDiskWritten]='sum by(node)(rate(node_disk_written_bytes_total[2m]))'
  [nodeNetRx]="sum by(node)(rate(node_network_receive_bytes_total{${USAGE_NET}}[2m]))"
  [nodeNetTx]="sum by(node)(rate(node_network_transmit_bytes_total{${USAGE_NET}}[2m]))"
  [podCpu]="sum by(namespace,pod)(rate(container_cpu_usage_seconds_total{${USAGE_CONTAINER}}[2m]))"
  [podMemory]="sum by(namespace,pod)(container_memory_working_set_bytes{${USAGE_CONTAINER}})"
  [containerCpu]="sum by(namespace,pod,container)(rate(container_cpu_usage_seconds_total{${USAGE_CONTAINER}}[2m]))"
  [containerMemory]="sum by(namespace,pod,container)(container_memory_working_set_bytes{${USAGE_CONTAINER}})"
  [podNetRx]='sum by(namespace,pod)(rate(container_network_receive_bytes_total{pod!="",interface!="lo"}[2m]))'
  [podNetTx]='sum by(namespace,pod)(rate(container_network_transmit_bytes_total{pod!="",interface!="lo"}[2m]))'
  [podDiskIo]='sum by(namespace,pod)(rate(container_fs_reads_bytes_total{container!="",image!=""}[2m]) + rate(container_fs_writes_bytes_total{container!="",image!=""}[2m]))'
  [pvcUsed]='sum by(namespace,persistentvolumeclaim)(kubelet_volume_stats_used_bytes)'
  [pvcCapacity]='sum by(namespace,persistentvolumeclaim)(kubelet_volume_stats_capacity_bytes)'
)

# Each Usage query over the hour before the export, as one JSON line; other namespaces' series dropped.
usage_metrics() {
  local end=$(( $(date +%s) / 60 * 60 )) key range
  for key in $(printf '%s\n' "${!USAGE_QUERIES[@]}" | sort); do
    range="$(python3 -c 'import sys, urllib.parse; print(urllib.parse.urlencode(
      {"query": sys.argv[1], "start": int(sys.argv[2]) - 3600, "end": sys.argv[2], "step": 60}))' \
      "${USAGE_QUERIES[${key}]}" "${end}")"
    kubectl get --raw "/api/v1/namespaces/monitoring/pods/prometheus-seed-0:9090/proxy/api/v1/query_range?${range}" \
      | python3 dev/cluster/fixtures/sanitise.py --api \
      | python3 -c '
import json, sys
key, query, end, keep = sys.argv[1], sys.argv[2], int(sys.argv[3]), set(sys.argv[4:])
answer = json.load(sys.stdin)
answer["data"]["result"] = [
    series for series in answer["data"]["result"] if series["metric"].get("namespace", "") in keep | {""}
]
print(json.dumps({"key": key, "query": query, "start": end - 3600, "end": end, "step": 60, "response": answer}))' \
        "${key}" "${USAGE_QUERIES[${key}]}" "${end}" "$@"
  done | join_items
}

ALL=(argocd trivy cert-manager cnpg mongodb redis opentelemetry prometheus)

for package in "${@:-${ALL[@]}}"; do
  [[ " ${ALL[*]} " == *" ${package} "* ]] || { echo "no fixtures for ${package}; one of: ${ALL[*]}" >&2; exit 1; }
  echo "==> ${package}"
  out="packages/${package}/test/fixtures"
  mkdir -p "${out}"
  "${package}"
done

echo "==> Done. Read the diff before committing: these are cluster contents."
