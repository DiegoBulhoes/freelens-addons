# Prometheus Operator seed: each state the pages rank, Usage metrics, and a TargetAllocator collector.

# The kube-prometheus-stack version this seed tracks (89.2.2).
PROMETHEUS_OPERATOR_VERSION="v0.93.1"

echo "==> Prometheus Operator ${PROMETHEUS_OPERATOR_VERSION}"
apply namespaces.yaml
# The bundle hard-codes namespace default and its ClusterRoleBinding subject; kustomize moves both.
apply_kustomized "https://github.com/prometheus-operator/prometheus-operator/releases/download/${PROMETHEUS_OPERATOR_VERSION}/bundle.yaml" <<'EOF'
namespace: prometheus-operator
# The full seed must fit a CI runner's four CPUs.
patches:
  - target: {kind: Deployment, name: prometheus-operator}
    patch: '[{"op": "replace", "path": "/spec/template/spec/containers/0/resources/requests/cpu", "value": "20m"}]'
EOF
kubectl wait --for=condition=Established --timeout=120s \
  crd/servicemonitors.monitoring.coreos.com crd/podmonitors.monitoring.coreos.com \
  crd/scrapeconfigs.monitoring.coreos.com crd/prometheusrules.monitoring.coreos.com \
  crd/prometheuses.monitoring.coreos.com crd/prometheusagents.monitoring.coreos.com \
  crd/alertmanagers.monitoring.coreos.com
wait_deploy prometheus-operator prometheus-operator

# The OpenTelemetry operator registers TargetAllocator support only if these CRDs exist when it
# starts: restarted unless its one pod started after them.
crds_created="$(kubectl get crd servicemonitors.monitoring.coreos.com -o jsonpath='{.metadata.creationTimestamp}')"
otel_started="$(kubectl -n opentelemetry-operator-system get pods -l app.kubernetes.io/name=opentelemetry-operator \
  -o jsonpath='{.items[*].status.containerStatuses[0].state.running.startedAt}')"
if [[ -z "${otel_started}" || "${otel_started}" == *" "* || ! "${otel_started}" > "${crds_created}" ]]; then
  kubectl -n opentelemetry-operator-system rollout restart deployment/opentelemetry-operator-controller-manager
fi
wait_deploy opentelemetry-operator-system opentelemetry-operator-controller-manager

echo "==> Instances, monitors, rules and node metrics"
# No admission webhook in the bundle: the invalid monitors and rules are accepted, then rejected.
apply prometheus.yaml monitors.yaml rules.yaml node-exporter.yaml

echo "==> Collector with a TargetAllocator"
apply targetallocator-rbac.yaml
# The webhook refuses until the restarted operator serves it.
retry apply scraper.yaml
