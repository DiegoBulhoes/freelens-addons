# frontend-private is in error; podinfo-patches and podinfo-chart have updated an image; git-pinned has checked;
# guestbooks has generated both Applications, broken-template has failed.

updated() { [[ -n "$(kubectl -n argocd get imageupdater "$1" -o jsonpath='{.status.lastUpdatedAt}')" ]]; }

echo "==> Waiting for the Image Updater's first results"
kubectl -n argocd wait imageupdater/frontend-private --for=condition=Error --timeout=900s
retry updated podinfo-patches
retry updated podinfo-chart
kubectl -n argocd wait imageupdater/git-pinned --for=condition=Ready --timeout=900s

echo "==> Waiting for the ApplicationSets"
kubectl -n argocd wait applicationset/guestbooks --for=condition=ResourcesUpToDate --timeout=600s
kubectl -n argocd wait application/guestbook-blue application/guestbook-green \
  --for=jsonpath='{.status.health.status}'=Healthy --timeout=600s
kubectl -n argocd wait applicationset/broken-template --for=condition=ErrorOccurred --timeout=600s
