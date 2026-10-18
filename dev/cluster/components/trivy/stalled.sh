# stalled's ReplicaSets, for states.sh and settle.sh; the old one still serves, past its revision.
old_stalled() { stalled_where '$2 != r && $3 > 0'; }

new_stalled() { stalled_where '$2 == r'; }

stalled_where() { # awk condition on name ($1), revision ($2), ready pods ($3); r is the Deployment's
  local rows='{range .items[*]}{.metadata.name} {.metadata.annotations.deployment\.kubernetes\.io/revision} {.status.readyReplicas}{"\n"}{end}'
  local revision rs
  revision="$(kubectl -n demo get deployment stalled \
    -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}')"
  rs="$(kubectl -n demo get replicasets -l app=stalled -o jsonpath="${rows}" \
    | awk -v r="${revision}" "$1 {print \$1}")"
  [[ -n "${rs}" && "${rs}" != *$'\n'* ]] && echo "${rs}"
}
