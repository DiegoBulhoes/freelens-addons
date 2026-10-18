# web rolls once after its scan, so an old ReplicaSet keeps its SBOM but loses its config audit.

has_web_sbom() { kubectl -n demo get sbomreports -o name | grep -q replicaset-web-; }

echo "==> Rolling web once its SBOM exists"
retry has_web_sbom
kubectl -n demo patch deployment web --type merge \
  -p '{"spec":{"template":{"metadata":{"annotations":{"freelens-addons/rollout":"seeded"}}}}}'
kubectl -n demo rollout status deployment/web --timeout=180s

# stalled's new pod is never scheduled, so its old ReplicaSet keeps serving, no longer the current
# revision: the operator drops its vulnerability report and keeps its SBOM, which is "No verdict".

source stalled.sh

has_stalled_sbom() { kubectl -n demo get sbomreports -o name | grep -q replicaset-stalled-; }

echo "==> Stalling stalled's rollout once its SBOM exists"
retry has_stalled_sbom
kubectl -n demo patch deployment stalled --type strategic -p \
  '{"spec":{"template":{"spec":{"nodeSelector":{"freelens-addons/node":"none"}}}}}'

stalled_rolling() { [[ -n "$(old_stalled)" && "$(kubectl -n demo get pods -l app=stalled -o name | wc -l)" -eq 2 ]]; }

# Only a change to a ReplicaSet has the operator look again: drop the old one's report, scan the new.
retry stalled_rolling
kubectl -n demo annotate replicasets -l app=stalled freelens-addons/rollout=stalled --overwrite
