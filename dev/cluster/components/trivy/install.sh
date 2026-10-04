# The Trivy operator.

TRIVY_OPERATOR_VERSION="v0.34.0"

echo "==> Trivy operator ${TRIVY_OPERATOR_VERSION}"
apply_url "https://raw.githubusercontent.com/aquasecurity/trivy-operator/${TRIVY_OPERATOR_VERSION}/deploy/static/trivy-operator.yaml"
wait_deploy trivy-system trivy-operator
