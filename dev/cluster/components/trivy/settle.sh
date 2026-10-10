# The ReplicaSets now serving web (rolled by states.sh) and api have vulnerability reports.

scanned() { # app label
  local rs
  # Only the ReplicaSet a rollout left serving has ready pods.
  rs="$(kubectl -n demo get replicasets -l "app=$1" \
    -o jsonpath='{.items[?(@.status.readyReplicas)].metadata.name}')"
  [[ -n "${rs}" && -n "$(kubectl -n demo get vulnerabilityreports -o name \
    -l "trivy-operator.resource.kind=ReplicaSet,trivy-operator.resource.name=${rs}")" ]]
}

echo "==> Waiting for the scans of web and api"
retry scanned web
retry scanned api
