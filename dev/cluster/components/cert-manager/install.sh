# cert-manager and the CA chain other components' certificates come from.

CERT_MANAGER_VERSION="v1.21.2"

echo "==> cert-manager ${CERT_MANAGER_VERSION}"
apply_url "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER_VERSION}/cert-manager.yaml"
wait_deploy cert-manager cert-manager cert-manager-cainjector cert-manager-webhook

echo "==> The demo-ca issuer"
# The webhook refuses applies until the cainjector has written its CA.
retry apply issuers.yaml
kubectl wait clusterissuer/demo-ca --for=condition=Ready --timeout=300s
