# redis-operator, with a replication and its sentinels, a cluster and standalones in each state.

REDIS_OPERATOR_VERSION="v0.26.0"

echo "==> redis-operator ${REDIS_OPERATOR_VERSION}"
apply_kustomized "github.com/OT-CONTAINER-KIT/redis-operator/config/default?ref=${REDIS_OPERATOR_VERSION}" <<EOF
# Its kustomize pins an older image and never pulls it.
images:
  - name: quay.io/opstree/redis-operator
    newTag: ${REDIS_OPERATOR_VERSION}
patches:
  - target: {kind: Deployment, name: redis-operator-redis-operator}
    patch: '[{"op": "replace", "path": "/spec/template/spec/containers/0/imagePullPolicy", "value": "IfNotPresent"}]'
EOF
wait_deploy redis-operator-system redis-operator-redis-operator

echo "==> Redis replication, sentinels, cluster and standalones"
namespace redis
apply samples.yaml
kubectl -n redis wait rediscluster/shards --for=jsonpath='{.status.state}'=Ready --timeout=600s
kubectl -n redis wait redisreplication/cache --for=jsonpath='{.status.masterNode}' --timeout=600s
