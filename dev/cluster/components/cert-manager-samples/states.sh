# flaky-ca loses its key once renewal-stalls and issuer-broken are issued: both stay valid.
# retired-tls is deleted once issued: cert-manager leaves its Secret behind.
# out-of-date moves to the pebble issuer once issued; Pebble refuses its Order, so the issue fails.

echo "==> Breaking flaky-ca"
kubectl -n demo wait certificate/renewal-stalls --for=condition=Ready --timeout=300s
kubectl -n demo wait certificate/issuer-broken --for=condition=Ready --timeout=300s
kubectl -n demo delete certificate flaky-ca-root --ignore-not-found
kubectl -n demo delete secret flaky-ca-key --ignore-not-found

echo "==> Retiring retired-tls"
kubectl -n demo wait certificate/retired-tls --for=condition=Ready --timeout=300s
kubectl -n demo delete certificate retired-tls --ignore-not-found

echo "==> Moving out-of-date to the ACME issuer, whose server refuses its name"
kubectl -n demo wait certificate/out-of-date --for=condition=Ready --timeout=300s
kubectl -n demo patch certificate out-of-date --type=merge \
  -p '{"spec":{"issuerRef":{"group":"cert-manager.io","kind":"ClusterIssuer","name":"pebble"}}}'
