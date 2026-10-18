# Waits for the first scrapes and evaluations, the rejections, the Alertmanager, and the TargetAllocator's jobs.

PROMETHEUS=/api/v1/namespaces/monitoring/pods/prometheus-seed-0:9090/proxy

# The health of every active target in the scrape pool. Usage: target_health POOL HEALTH
target_health() {
  kubectl get --raw "${PROMETHEUS}/api/v1/targets?state=active" | python3 -c '
import json, sys
pool, health = sys.argv[1:]
found = [t["health"] for t in json.load(sys.stdin)["data"]["activeTargets"] if t["scrapePool"] == pool]
sys.exit(0 if found and all(h == health for h in found) else 1)' "$@"
}

pool_loaded() { kubectl get --raw "${PROMETHEUS}/api/v1/scrape_pools" | grep -q "\"$1\""; }

alert_state() { # ALERTNAME STATE
  kubectl get --raw "${PROMETHEUS}/api/v1/alerts" | python3 -c '
import json, sys
name, state = sys.argv[1:]
alerts = json.load(sys.stdin)["data"]["alerts"]
sys.exit(0 if any(a["labels"]["alertname"] == name and a["state"] == state for a in alerts) else 1)' "$@"
}

rule_health() { # RULE HEALTH
  kubectl get --raw "${PROMETHEUS}/api/v1/rules" | python3 -c '
import json, sys
name, health = sys.argv[1:]
rules = [r for g in json.load(sys.stdin)["data"]["groups"] for r in g["rules"] if r["name"] == name]
sys.exit(0 if rules and all(r["health"] == health for r in rules) else 1)' "$@"
}

alertmanager_active() {
  kubectl get --raw "${PROMETHEUS}/api/v1/alertmanagers" | python3 -c '
import json, sys
sys.exit(0 if json.load(sys.stdin)["data"]["activeAlertmanagers"] else 1)'
}

source rejections.sh

ta_job() {
  kubectl get --raw /api/v1/namespaces/otel-collectors/services/scraper-targetallocator:80/proxy/jobs \
    | grep -q 'serviceMonitor/prom-apps/otel-self/0'
}

no_image_unavailable() {
  kubectl -n prom-broken get prometheus no-image \
    -o jsonpath='{.status.conditions[?(@.type=="Available")].status}' | grep -qx False
}

echo "==> Waiting for Prometheus, its first scrapes and evaluations, and the TargetAllocator"
kubectl -n monitoring wait prometheus/seed --for=condition=Available --timeout=300s
kubectl -n monitoring wait alertmanager/seed --for=condition=Available --timeout=300s
retry no_image_unavailable
wait_rejections
retry pool_loaded serviceMonitor/prom-apps/no-service/0
retry target_health serviceMonitor/monitoring/prom-self/0 up
retry target_health serviceMonitor/monitoring/down-path/0 down
retry target_health serviceMonitor/monitoring/kubelet/0 up
retry target_health podMonitor/monitoring/node-exporter/0 up
retry target_health podMonitor/prom-apps/prom-pods/0 up
retry target_health scrapeConfig/prom-apps/static-self up
retry pool_loaded serviceMonitor/prom-apps/no-endpoints/0
retry alert_state SeedAlwaysFiring firing
retry alert_state SeedPending pending
retry rule_health SeedEvaluationFails err
retry alertmanager_active
wait_deploy otel-collectors scraper-targetallocator
kubectl -n otel-collectors wait opentelemetrycollectors.opentelemetry.io/scraper \
  --for=jsonpath='{.status.scale.statusReplicas}'=1/1 --timeout=300s
retry ta_job
