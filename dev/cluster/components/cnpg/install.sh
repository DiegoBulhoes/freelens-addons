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
wait_deploy databases rustfs
# Barman creates no bucket before it archives WAL; 409 means it is already there.
create_bucket() {
  kubectl -n databases exec deploy/rustfs -- sh -c 'curl -sS -o /dev/null -w "%{http_code}" -X PUT \
    --aws-sigv4 aws:amz:us-east-1:s3 --user "$RUSTFS_ACCESS_KEY:$RUSTFS_SECRET_KEY" http://localhost:9000/backups' \
    | grep -qE '^(200|409)$'
}
retry create_bucket
# Once hibernated, reports-db's Ready condition is no longer updated.
hibernated() { [[ "$(kubectl -n databases get cluster "$1" -o jsonpath='{.metadata.annotations.cnpg\.io/hibernation}')" == on ]]; }
clusters=(orders-db billing-db inventory-db audit-db)
hibernated reports-db || clusters+=(reports-db)
kubectl -n databases wait "${clusters[@]/#/cluster/}" --for=condition=Ready --timeout=600s
