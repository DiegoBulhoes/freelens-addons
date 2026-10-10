# Pebble (a test ACME server), with issuers and certificates in each state.

echo "==> Pebble"
namespace acme-test
apply pebble.yaml
wait_deploy acme-test pebble

echo "==> Sample issuers, certificates and TLS Secrets"
namespace demo
apply samples.yaml
