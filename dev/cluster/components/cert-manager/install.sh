# cert-manager and Pebble (a test ACME server), with issuers and certificates in each state.

CERT_MANAGER_VERSION="v1.21.2"

echo "==> cert-manager ${CERT_MANAGER_VERSION} and Pebble"
apply_url "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
namespace acme-test
apply pebble.yaml
wait_deploy cert-manager cert-manager cert-manager-cainjector cert-manager-webhook
wait_deploy acme-test pebble

echo "==> Sample issuers, certificates and TLS Secrets"
# The webhook refuses applies until the cainjector has written its CA.
retry apply samples.yaml
