# web rolls once after its scan, so an old ReplicaSet keeps its SBOM but loses its config audit.

has_web_sbom() { kubectl -n demo get sbomreports -o name | grep -q replicaset-web-; }

echo "==> Rolling web once its SBOM exists"
retry has_web_sbom
kubectl -n demo patch deployment web --type merge \
  -p '{"spec":{"template":{"metadata":{"annotations":{"freelens-addons/rollout":"seeded"}}}}}'
kubectl -n demo rollout status deployment/web --timeout=180s
