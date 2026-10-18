# Waits for the gateway to run, broken and the allocator's TargetAllocator to have crashed once, the agent in
# every injected workload, none in the blocked ones, and the sidecar in its carrier.

broken_crashed() {
  kubectl -n otel-collectors get pods -l app.kubernetes.io/instance=otel-collectors.broken \
    -o jsonpath='{.items[*].status.containerStatuses[?(@.name=="otc-container")].lastState.terminated.exitCode}' \
    | grep -q .
}

allocator_crashed() {
  kubectl -n otel-allocator get pods -l app.kubernetes.io/component=opentelemetry-targetallocator \
    -o jsonpath='{.items[*].status.containerStatuses[*].lastState.terminated.exitCode}' | grep -q .
}

echo "==> Waiting for the collectors and the injected workloads"
kubectl -n otel-collectors wait opentelemetrycollectors.opentelemetry.io/gateway \
  --for=jsonpath='{.status.scale.statusReplicas}'=1/1 --timeout=300s
retry broken_crashed
# The pod webhook admits a pod unmutated on any error, so the agent itself is what proves the state.
for workload in otel-apps/checkout otel-apps/ledger otel-namespace/inherited otel-namespace/node-agent \
  otel-orphan/cross-ns; do
  kubectl -n "${workload%/*}" wait pod -l "app=${workload#*/}" --timeout=300s \
    --for=jsonpath='{.spec.initContainers[0].name}'=opentelemetry-auto-instrumentation-python
  kubectl -n "${workload%/*}" wait pod -l "app=${workload#*/}" --for=condition=Ready --timeout=300s
done
kubectl -n otel-allocator wait opentelemetrycollectors.opentelemetry.io/allocator \
  --for=jsonpath='{.status.scale.statusReplicas}'=1/1 --timeout=300s
retry allocator_crashed
kubectl -n otel-sidecar wait pod -l app=carrier --timeout=300s \
  --for=jsonpath='{.metadata.labels.sidecar\.opentelemetry\.io/injected}'=otel-collectors.sidecar
kubectl -n otel-sidecar wait pod -l app=carrier --for=condition=Ready --timeout=300s
# The webhook that injected the ones above: no init container is its refusal.
for workload in otel-blocked/go-service otel-blocked/polyglot otel-tls/secure; do
  kubectl -n "${workload%/*}" wait pod -l "app=${workload#*/}" --for=condition=Ready --timeout=300s
  [[ -z "$(kubectl -n "${workload%/*}" get pods -l "app=${workload#*/}" -o jsonpath='{.items[*].spec.initContainers}')" ]] \
    || { echo "${workload} got the agent" >&2; exit 1; }
done
# A Job's pods finish: the agent, or its absence, stays in their spec.
kubectl -n otel-batch wait job/nightly-run job/migrate --for=condition=Complete --timeout=300s
kubectl -n otel-batch wait pod -l batch.kubernetes.io/job-name=nightly-run --timeout=300s \
  --for=jsonpath='{.spec.initContainers[0].name}'=opentelemetry-auto-instrumentation-python
[[ -z "$(kubectl -n otel-batch get pods -l batch.kubernetes.io/job-name=migrate -o jsonpath='{.items[*].spec.initContainers}')" ]] \
  || { echo "otel-batch/migrate got the agent" >&2; exit 1; }
