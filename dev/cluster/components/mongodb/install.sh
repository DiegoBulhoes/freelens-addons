# MongoDB Controllers for Kubernetes, with replica sets in each state.

MCK_VERSION="1.12.0"

# It watches its own namespace and mongodb-apps, whose set apps.yaml grants it access to.
echo "==> MongoDB Controllers for Kubernetes ${MCK_VERSION}"
namespace mongodb
namespace mongodb-apps
# The manifest's valueFrom cannot be applied over the value set below, so a rerun puts it back first.
if kubectl -n mongodb get deployment/mongodb-kubernetes-operator >/dev/null 2>&1; then
  kubectl -n mongodb patch deployment/mongodb-kubernetes-operator --type=strategic -p \
    '{"spec":{"template":{"spec":{"containers":[{"name":"mongodb-kubernetes-operator","env":[{"name":"WATCH_NAMESPACE","value":null,"valueFrom":{"fieldRef":{"fieldPath":"metadata.namespace"}}}]}]}}}}'
fi
apply_url "https://raw.githubusercontent.com/mongodb/mongodb-kubernetes/${MCK_VERSION}/public/crds.yaml" \
  "https://raw.githubusercontent.com/mongodb/mongodb-kubernetes/${MCK_VERSION}/public/mongodb-kubernetes.yaml"
# It asks for half a CPU; the whole seed has to fit a CI runner's four.
kubectl -n mongodb set resources deployment/mongodb-kubernetes-operator --requests=cpu=50m
# The manifest sets WATCH_NAMESPACE to the pod's own namespace; it also takes a comma-separated list.
kubectl -n mongodb set env deployment/mongodb-kubernetes-operator WATCH_NAMESPACE=mongodb,mongodb-apps
wait_deploy mongodb mongodb-kubernetes-operator

echo "==> MongoDB replica sets"
apply samples.yaml apps.yaml
kubectl -n mongodb wait mongodbcommunity/catalog-rs mongodbcommunity/sessions-rs \
  --for=jsonpath='{.status.phase}'=Running --timeout=600s
kubectl -n mongodb-apps wait mongodbcommunity/orders-rs \
  --for=jsonpath='{.status.phase}'=Running --timeout=600s
