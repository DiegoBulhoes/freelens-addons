# A real upgrade and a memory change, each stopped halfway.

source pods.sh

shape() { # set
  kubectl -n mongodb get mongodbcommunity "$1" 2>/dev/null -o jsonpath='{.spec.members} {.spec.version}
    {.spec.statefulSet.spec.template.spec.containers[0].resources.requests.memory}
    {.spec.statefulSet.spec.template.spec.containers[0].resources.limits.memory}
    {.spec.memberConfig[2].votes}' | xargs
}

# Any shape but the file's is recreated, volumes too: a new set's agent credentials refuse old data.
created() { # set shape
  if [[ "$(shape "$1")" != "$2" ]]; then
    kubectl -n mongodb delete -f "$1.yaml" --ignore-not-found --wait
    kubectl -n mongodb wait --for=delete "statefulset/$1" --timeout=300s 2>/dev/null || true
    kubectl -n mongodb delete pod -l "app=$1-svc" --ignore-not-found --wait --timeout=300s
    kubectl -n mongodb delete pvc -l "app=$1-svc" --ignore-not-found --wait --timeout=300s
    kubectl create -f "$1.yaml"
  fi
  kubectl -n mongodb wait "mongodbcommunity/$1" --for=jsonpath='{.status.phase}'=Running --timeout=900s
}

# After a restart the version hook takes upgrade-rs-0 down too, so its image is checked as well.
if [[ "$(shape upgrade-rs)" != "2 8.0.999 200M" || "$(mongod_image upgrade-rs-0)" != *:8.0.12-ubi8 ]] \
  || ! kubectl -n mongodb get pod upgrade-rs-1 >/dev/null 2>&1; then
  echo "==> upgrade-rs healthy, then asking for a version with no image"
  created upgrade-rs "2 8.0.12 200M"
  retry agent_says_primary upgrade-rs-0
  kubectl -n mongodb patch mongodbcommunity upgrade-rs --type merge -p '{"spec":{"version":"8.0.999"}}'
fi

if [[ "$(shape ledger-rs)" != "3 8.0.12 1Ti 1Ti 0" ]]; then
  echo "==> ledger-rs healthy, then asking for more memory than a node has"
  created ledger-rs "3 8.0.12 200M 0"
  # The operator sets a 500M limit, which a request may not exceed. containers/0 is mongod.
  kubectl -n mongodb patch mongodbcommunity ledger-rs --type json -p '[{"op":"replace",
    "path":"/spec/statefulSet/spec/template/spec/containers/0/resources",
    "value":{"requests":{"cpu":"25m","memory":"1Ti"},"limits":{"memory":"1Ti"}}}]'
fi
