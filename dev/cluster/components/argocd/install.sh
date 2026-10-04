# ArgoCD and Argo CD Image Updater, with sample Applications and rules.

ARGOCD_VERSION="v3.5.2"
IMAGE_UPDATER_VERSION="v1.3.0"

echo "==> ArgoCD ${ARGOCD_VERSION} and Image Updater ${IMAGE_UPDATER_VERSION}"
namespace argocd
kubectl apply --server-side --force-conflicts -n argocd \
  -f "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml" \
  -f "https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/${IMAGE_UPDATER_VERSION}/config/install.yaml"
wait_deploy argocd argocd-server argocd-image-updater-controller

echo "==> Sample Applications and Image Updater rules"
apply applications.yaml image-updater.yaml
