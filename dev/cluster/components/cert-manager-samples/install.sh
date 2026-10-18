# Pebble (a test ACME server), with issuers and certificates in each state.

echo "==> Pebble"
namespace acme-test
apply pebble.yaml
wait_deploy acme-test pebble

# Pebble keeps accounts in memory: once it restarts, the issuer registers again.
started="$(kubectl -n acme-test get pods -l app=pebble \
  -o jsonpath='{.items[*].status.containerStatuses[0].state.running.startedAt}' | tr ' ' '\n' | sort | tail -1)"
registered="$(kubectl get clusterissuer pebble --ignore-not-found \
  -o jsonpath='{.status.conditions[?(@.type=="Ready")].lastTransitionTime}')"
if [[ -n "${registered}" ]] && (($(date -d "${started}" +%s) > $(date -d "${registered}" +%s))); then
  kubectl delete clusterissuer pebble
  kubectl -n cert-manager delete secret pebble-account --ignore-not-found
fi

echo "==> Sample issuers, certificates and TLS Secrets"
namespace demo
apply samples.yaml
