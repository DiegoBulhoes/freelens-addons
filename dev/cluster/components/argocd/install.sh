# ArgoCD and Argo CD Image Updater, with sample Applications and rules.

ARGOCD_VERSION="v3.5.2"
IMAGE_UPDATER_VERSION="v1.3.0"

echo "==> ArgoCD ${ARGOCD_VERSION} and Image Updater ${IMAGE_UPDATER_VERSION}"
namespace argocd
retry kubectl apply --server-side --force-conflicts -n argocd \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml" \
  -f "https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/${IMAGE_UPDATER_VERSION}/config/install.yaml"
# The same image as the manifest's public.ecr.aws one, which answers CI runners with 429.
kubectl -n argocd set image deployment/argocd-redis \
  redis=mirror.gcr.io/library/redis@sha256:08ad0b1d280850169a790dba1393ff7a90aef951fc19632cf4d3ce4f78e679ba
wait_deploy argocd argocd-redis argocd-server argocd-applicationset-controller argocd-image-updater-controller

echo "==> Sample Applications, ApplicationSets and Image Updater rules"
# The Applications deploy there without CreateNamespace.
namespace demo
apply applications.yaml application-sets.yaml image-updater.yaml
