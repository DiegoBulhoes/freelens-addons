# Waits for secure-rs to run, upgrade-rs to fail its image pull and catalog-rs-2 to be primary.

waiting_with() { # pod reason
  kubectl -n mongodb get pod "$1" -o jsonpath='{.status.containerStatuses[*].state.waiting.reason}' \
    | grep -qw "$2"
}

# The extension reads roles from this file, and the preferred member may take over after Running.
agent_says_primary() { # pod
  kubectl -n mongodb exec "$1" -c mongodb-agent -- \
    cat /var/log/mongodb-mms-automation/healthstatus/agent-health-status.json \
    | grep -E '"ReplicationStatus": *1\b' >/dev/null
}

echo "==> Waiting for secure-rs, upgrade-rs's image pull and catalog-rs-2 as primary"
kubectl -n mongodb wait mongodbcommunity/secure-rs --for=jsonpath='{.status.phase}'=Running --timeout=600s
retry waiting_with upgrade-rs-0 ImagePullBackOff
retry agent_says_primary catalog-rs-2
