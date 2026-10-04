# CloudNativePG and its Barman Cloud plugin, with Postgres clusters in each state.

CNPG_VERSION="1.30.0"
BARMAN_CLOUD_VERSION="v0.15.0"

echo "==> CloudNativePG ${CNPG_VERSION} and Barman Cloud ${BARMAN_CLOUD_VERSION}"
apply_url "https://github.com/cloudnative-pg/cloudnative-pg/releases/download/v${CNPG_VERSION}/cnpg-${CNPG_VERSION}.yaml"
wait_deploy cnpg-system cnpg-controller-manager
# The plugin's certificates need cert-manager.
apply_url "https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/${BARMAN_CLOUD_VERSION}/manifest.yaml"
wait_deploy cnpg-system barman-cloud

echo "==> Postgres clusters, backups and poolers"
apply samples.yaml
kubectl -n databases wait cluster/orders-db cluster/billing-db cluster/inventory-db cluster/reports-db \
  --for=condition=Ready --timeout=600s
