# OpenTelemetry Operator, with collectors and opted-in workloads in each Coverage state but Unknown.

OTEL_OPERATOR_VERSION="v0.158.0"

echo "==> OpenTelemetry Operator ${OTEL_OPERATOR_VERSION}"
apply_url "https://github.com/open-telemetry/opentelemetry-operator/releases/download/${OTEL_OPERATOR_VERSION}/opentelemetry-operator.yaml"
# The full seed must fit a CI runner's four CPUs.
kubectl -n opentelemetry-operator-system set resources deployment/opentelemetry-operator-controller-manager \
  -c manager --requests=cpu=50m
wait_deploy opentelemetry-operator-system opentelemetry-operator-controller-manager

echo "==> Instrumentations and collectors"
# Per file: the webhooks refuse until their CA lands, and apply reports only the last file.
retry apply instrumentations.yaml
retry apply collectors.yaml

echo "==> Workloads"
# After the Instrumentations: a pod admitted before its Instrumentation is never injected.
apply samples.yaml
