# flaky-ca loses its key once renewal-stalls is issued: valid, but failing to renew.

echo "==> Breaking flaky-ca"
kubectl -n demo wait certificate/renewal-stalls --for=condition=Ready --timeout=300s
kubectl -n demo delete certificate flaky-ca-root --ignore-not-found
kubectl -n demo delete secret flaky-ca-key --ignore-not-found
