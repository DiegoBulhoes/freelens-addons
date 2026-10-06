# The Trivy operator.

TRIVY_OPERATOR_VERSION="v0.34.0"

echo "==> Trivy operator ${TRIVY_OPERATOR_VERSION}"
apply_url "https://raw.githubusercontent.com/aquasecurity/trivy-operator/${TRIVY_OPERATOR_VERSION}/deploy/static/trivy-operator.yaml"
# Five scans at a time, each asking for little: the seed has to fit a CI runner's four CPUs, and
# the scans that fail on purpose (an image that does not exist) must not hold every slot.
kubectl -n trivy-system patch configmap trivy-operator-trivy-config --type merge \
  -p '{"data":{"trivy.resources.requests.cpu":"25m"}}'
kubectl -n trivy-system set env deployment/trivy-operator OPERATOR_CONCURRENT_SCAN_JOBS_LIMIT=5
wait_deploy trivy-system trivy-operator
