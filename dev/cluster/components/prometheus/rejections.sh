# The operator's InvalidConfiguration Events, for settle.sh and the fixture export.

rejected() { # namespace
  kubectl -n "$1" get events --field-selector reason=InvalidConfiguration -o name | grep -q .
}

# Events expire after an hour and the operator re-emits them only when a label changes.
reconcile() { # namespace resource name
  kubectl -n "$1" label "$2" "$3" freelens.test/reconcile=1 --overwrite >/dev/null
  kubectl -n "$1" label "$2" "$3" freelens.test/reconcile- >/dev/null
}

wait_rejections() {
  rejected monitoring || reconcile monitoring servicemonitor rejected
  rejected prom-apps || reconcile prom-apps prometheusrule broken-rule
  retry rejected monitoring
  retry rejected prom-apps
}
