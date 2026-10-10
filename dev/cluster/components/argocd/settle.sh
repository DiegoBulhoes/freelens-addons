# frontend-private is in error; podinfo-patches and podinfo-chart have updated an image.

updated() { [[ -n "$(kubectl -n argocd get imageupdater "$1" -o jsonpath='{.status.lastUpdatedAt}')" ]]; }

echo "==> Waiting for the Image Updater's first results"
kubectl -n argocd wait imageupdater/frontend-private --for=condition=Error --timeout=900s
retry updated podinfo-patches
retry updated podinfo-chart
