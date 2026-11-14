# MongoDB Controllers for Kubernetes, with replica sets in each state.

MCK_VERSION="1.12.0"

# It watches its own namespace and mongodb-apps, whose set apps.yaml grants it access to.
echo "==> MongoDB Controllers for Kubernetes ${MCK_VERSION}"
namespace mongodb
namespace mongodb-apps
apply_kustomized "https://raw.githubusercontent.com/mongodb/mongodb-kubernetes/${MCK_VERSION}/public/crds.yaml" \
  "https://raw.githubusercontent.com/mongodb/mongodb-kubernetes/${MCK_VERSION}/public/mongodb-kubernetes.yaml" <<'EOF'
# It asks for half a CPU; the whole seed has to fit a CI runner's four. The manifest sets
# WATCH_NAMESPACE to the pod's own namespace; it also takes a comma-separated list.
patches:
  - target: {kind: Deployment, name: mongodb-kubernetes-operator}
    patch: |
      - {op: replace, path: /spec/template/spec/containers/0/resources/requests/cpu, value: 50m}
      - {op: test, path: /spec/template/spec/containers/0/env/4/name, value: WATCH_NAMESPACE}
      - {op: replace, path: /spec/template/spec/containers/0/env/4, value: {name: WATCH_NAMESPACE, value: "mongodb,mongodb-apps"}}
EOF
wait_deploy mongodb mongodb-kubernetes-operator

echo "==> MongoDB replica sets"
apply samples.yaml apps.yaml
kubectl -n mongodb wait mongodbcommunity/catalog-rs mongodbcommunity/sessions-rs \
  --for=jsonpath='{.status.phase}'=Running --timeout=600s
kubectl -n mongodb-apps wait mongodbcommunity/orders-rs \
  --for=jsonpath='{.status.phase}'=Running --timeout=600s
