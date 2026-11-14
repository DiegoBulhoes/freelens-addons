# ArgoCD and Argo CD Image Updater, with sample Applications and rules.

ARGOCD_VERSION="v3.5.2"
IMAGE_UPDATER_VERSION="v1.3.0"

echo "==> ArgoCD ${ARGOCD_VERSION} and Image Updater ${IMAGE_UPDATER_VERSION}"
namespace argocd
apply_kustomized -n argocd \
  "https://raw.githubusercontent.com/argoproj/argo-cd/${ARGOCD_VERSION}/manifests/install.yaml" \
  "https://raw.githubusercontent.com/argoproj-labs/argocd-image-updater/${IMAGE_UPDATER_VERSION}/config/install.yaml" <<'EOF'
# The same image as the manifest's public.ecr.aws one, which answers CI runners with 429.
images:
  - name: public.ecr.aws/docker/library/redis
    newName: mirror.gcr.io/library/redis
    digest: sha256:08ad0b1d280850169a790dba1393ff7a90aef951fc19632cf4d3ce4f78e679ba
EOF
wait_deploy argocd argocd-redis argocd-server argocd-applicationset-controller argocd-image-updater-controller

echo "==> Sample Applications, ApplicationSets and Image Updater rules"
# The Applications deploy there without CreateNamespace.
namespace demo
apply applications.yaml application-sets.yaml image-updater.yaml
