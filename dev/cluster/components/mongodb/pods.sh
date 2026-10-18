# What states.sh and settle.sh ask of a member.

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

unschedulable() { # pod
  [[ "$(kubectl -n mongodb get pod "$1" -o jsonpath='{.status.conditions[?(@.type=="PodScheduled")].reason}')" == Unschedulable ]]
}

ready() { # pod
  [[ "$(kubectl -n mongodb get pod "$1" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}')" == True ]]
}

mongod_image() { # pod
  kubectl -n mongodb get pod "$1" -o jsonpath='{.spec.containers[?(@.name=="mongod")].image}' 2>/dev/null
}
