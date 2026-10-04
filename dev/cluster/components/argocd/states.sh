# guestbook gets a deploy history with two revisions; helm-guestbook drifts.

# ArgoCD removes .operation once the sync has run.
sync_done() { [[ -z "$(kubectl -n argocd get application "$1" -o jsonpath='{.operation}')" ]]; }

sync() { # application revision
  kubectl -n argocd patch application "$1" --type merge \
    -p "{\"operation\":{\"initiatedBy\":{\"username\":\"seed\"},\"sync\":{\"revision\":\"$2\"}}}"
  retry sync_done "$1"
  kubectl -n argocd wait "application/$1" --for=jsonpath='{.status.operationState.phase}'=Succeeded --timeout=300s
}

echo "==> Deploy history for guestbook, drift for helm-guestbook"
kubectl -n argocd wait application/guestbook --for=jsonpath='{.status.sync.status}'=Synced --timeout=300s
sync guestbook HEAD
sync guestbook HEAD
# An older commit last; guestbook self-heals to HEAD, leaving two distinct revisions.
sync guestbook 5c2d89b897c4df42e06f94622f857dc4d7adc8f8
kubectl -n argocd wait application/guestbook --for=jsonpath='{.status.sync.status}'=Synced --timeout=300s
sync helm-guestbook HEAD
kubectl -n demo scale deployment helm-guestbook --replicas=2
