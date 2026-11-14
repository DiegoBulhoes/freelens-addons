# The ReplicaSets now serving web (rolled by states.sh) and api have vulnerability reports.

scanned() { # app label
  local rs
  # Only the ReplicaSet a rollout left serving has ready pods.
  rs="$(kubectl -n demo get replicasets -l "app=$1" \
    -o jsonpath='{.items[?(@.status.readyReplicas)].metadata.name}')"
  [[ -n "${rs}" && -n "$(kubectl -n demo get vulnerabilityreports -o name \
    -l "trivy-operator.resource.kind=ReplicaSet,trivy-operator.resource.name=${rs}")" ]]
}

# A report expires a day after its scan (report-ttl), and those of a seed expire together: a rerun
# then waits behind a re-scan of every workload, five at a time. It gives up once no report is added.
while_scanning() { # command...
  local count last=-1 since=${SECONDS}
  until "$@" >/dev/null 2>&1; do
    count="$(kubectl get vulnerabilityreports -A -o name | wc -l)"
    if ((count != last)); then last=${count}; since=${SECONDS}; fi
    ((SECONDS - since < 900)) || { echo "gave up waiting for: $*, no report added for 900s" >&2; return 1; }
    sleep 5
  done
}

echo "==> Waiting for the scans of web and api"
while_scanning scanned web
while_scanning scanned api

# unscannable's image does not exist: audited, never scanned, so "Not looked at" is always seeded.
audited() { # app label
  local rs
  rs="$(kubectl -n demo get replicasets -l "app=$1" -o jsonpath='{.items[0].metadata.name}')"
  [[ -n "${rs}" && -n "$(kubectl -n demo get configauditreports -o name \
    -l "trivy-operator.resource.kind=ReplicaSet,trivy-operator.resource.name=${rs}")" ]]
}

echo "==> Waiting for the config audit of unscannable"
retry audited unscannable

source stalled.sh

reports_of() { # kind ReplicaSet
  local of="trivy-operator.resource.kind=ReplicaSet,trivy-operator.resource.name=$2"
  [[ -n "$2" ]] && kubectl -n demo get "$1" -o name -l "${of}"
}

stalled_settled() {
  [[ -n "$(reports_of sbomreports "$(old_stalled)")" \
    && -z "$(reports_of vulnerabilityreports "$(old_stalled)")" \
    && -n "$(reports_of vulnerabilityreports "$(new_stalled)")" ]]
}

echo "==> Waiting for stalled's old ReplicaSet to lose its verdict, and the new one's scan"
while_scanning stalled_settled
