# otel-late is opted in after its pods started, so they stay without the agent until a restart.

echo "==> Opting otel-late in after its pods started"
kubectl -n otel-late rollout status deployment/late --timeout=300s
kubectl -n otel-late rollout status daemonset/late-agent --timeout=300s
kubectl annotate namespace otel-late instrumentation.opentelemetry.io/inject-python=true --overwrite

echo "==> Running the nightly CronJob once"
kubectl -n otel-batch get job nightly-run >/dev/null 2>&1 \
  || kubectl -n otel-batch create job nightly-run --from=cronjob/nightly
