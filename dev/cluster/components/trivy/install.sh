# The Trivy operator, and a Deployment for states.sh to stall.

TRIVY_OPERATOR_VERSION="v0.34.0"

echo "==> Trivy operator ${TRIVY_OPERATOR_VERSION}"
apply_kustomized "https://raw.githubusercontent.com/aquasecurity/trivy-operator/${TRIVY_OPERATOR_VERSION}/deploy/static/trivy-operator.yaml" <<'EOF'
# Five scans at a time, each asking for little: the seed has to fit a CI runner's four CPUs, and
# the scans that fail on purpose (an image that does not exist) must not hold every slot.
patches:
  - target: {kind: ConfigMap, name: trivy-operator-trivy-config}
    patch: '[{"op": "replace", "path": "/data/trivy.resources.requests.cpu", "value": "25m"}]'
  - target: {kind: Deployment, name: trivy-operator}
    patch: '[{"op": "add", "path": "/spec/template/spec/containers/0/env/-", "value": {"name": "OPERATOR_CONCURRENT_SCAN_JOBS_LIMIT", "value": "5"}}]'
EOF
wait_deploy trivy-system trivy-operator

echo "==> Trivy samples"
apply samples.yaml
