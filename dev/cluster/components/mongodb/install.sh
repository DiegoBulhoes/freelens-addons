# MongoDB Controllers for Kubernetes, with replica sets in each state.

MCK_VERSION="1.12.0"

# It watches its own namespace, so the replica sets live beside it.
echo "==> MongoDB Controllers for Kubernetes ${MCK_VERSION}"
namespace mongodb
apply_url "https://raw.githubusercontent.com/mongodb/mongodb-kubernetes/${MCK_VERSION}/public/crds.yaml" \
  "https://raw.githubusercontent.com/mongodb/mongodb-kubernetes/${MCK_VERSION}/public/mongodb-kubernetes.yaml"
# It asks for half a CPU; the whole seed has to fit a CI runner's four.
kubectl -n mongodb set resources deployment/mongodb-kubernetes-operator --requests=cpu=50m
wait_deploy mongodb mongodb-kubernetes-operator

echo "==> MongoDB replica sets"
apply samples.yaml
kubectl -n mongodb wait mongodbcommunity/catalog-rs mongodbcommunity/sessions-rs \
  --for=jsonpath='{.status.phase}'=Running --timeout=600s
