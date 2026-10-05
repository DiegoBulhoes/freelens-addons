# The Trivy operator.

TRIVY_OPERATOR_VERSION="v0.34.0"

echo "==> Trivy operator ${TRIVY_OPERATOR_VERSION}"
apply_url "https://raw.githubusercontent.com/aquasecurity/trivy-operator/${TRIVY_OPERATOR_VERSION}/deploy/static/trivy-operator.yaml"
# Two scans at a time, not ten: the whole seed has to fit a CI runner's four CPUs.
kubectl -n trivy-system set env deployment/trivy-operator OPERATOR_CONCURRENT_SCAN_JOBS_LIMIT=2
wait_deploy trivy-system trivy-operator
