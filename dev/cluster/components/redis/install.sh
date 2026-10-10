# redis-operator, with a replication and its sentinels, a cluster and standalones in each state.

REDIS_OPERATOR_VERSION="v0.26.0"

echo "==> redis-operator ${REDIS_OPERATOR_VERSION}"
retry kubectl apply --server-side --force-conflicts \
  -k "github.com/OT-CONTAINER-KIT/redis-operator/config/default?ref=${REDIS_OPERATOR_VERSION}"
# Its kustomize pins an older image and never pulls it.
kubectl -n redis-operator-system set image deployment/redis-operator-redis-operator \
  "*=quay.io/opstree/redis-operator:${REDIS_OPERATOR_VERSION}"
kubectl -n redis-operator-system patch deployment redis-operator-redis-operator --type json \
  -p '[{"op":"replace","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
wait_deploy redis-operator-system redis-operator-redis-operator

echo "==> Redis replication, sentinels, cluster and standalones"
namespace redis
apply samples.yaml
kubectl -n redis wait rediscluster/shards --for=jsonpath='{.status.state}'=Ready --timeout=600s
kubectl -n redis wait redisreplication/cache --for=jsonpath='{.status.masterNode}' --timeout=600s
