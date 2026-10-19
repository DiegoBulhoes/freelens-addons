# Waits for cache's pods to be ready and labelled with one master, for its sentinels, and for sessions' TLS and pod.

all_ready() { # statefulset
  local counts
  counts=$(kubectl -n redis get statefulset "$1" -o jsonpath='{.status.readyReplicas} {.spec.replicas}')
  [[ "${counts% *}" == "${counts#* }" ]]
}

one_master() {
  [[ "$(kubectl -n redis get pod -l app=cache,redis-role=master -o name | wc -l)" -eq 1 ]]
}

# The operator labels roles after it records the master; the drawer and Restart all read the labels.
cache_labelled() {
  retry_for 300 all_ready cache
  kubectl -n redis wait pod -l app=cache --for=jsonpath='{.metadata.labels.redis-role}' --timeout=300s
}

echo "==> Waiting for cache's role labels, its sentinels and sessions"
cache_labelled
# A restarted replica is labelled master until the operator relinks it. One the sentinels did not
# know at a failover keeps following the old master's IP and the operator relinks none: new pods
# all start as masters, which the operator does relink.
if ! retry_for 120 one_master; then
  kubectl -n redis delete pod -l app=cache
  cache_labelled
  retry_for 300 one_master
fi
# A sentinel container restarted in place re-appends its monitor line to the kept config and
# crash-loops on "Duplicate master name"; only a new pod starts clean.
if ! kubectl -n redis wait pod -l app=cache-sentinel-sentinel --for=condition=Ready --timeout=90s; then
  kubectl -n redis delete pod -l app=cache-sentinel-sentinel --wait=false
  retry_for 300 all_ready cache-sentinel-sentinel
fi
kubectl -n redis wait certificate/sessions-tls --for=condition=Ready --timeout=300s
kubectl -n redis wait pod/sessions-0 --for=condition=Ready --timeout=300s
