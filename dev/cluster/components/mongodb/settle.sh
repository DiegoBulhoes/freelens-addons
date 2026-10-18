# Waits for secure-rs and orders-rs to run, upgrade-rs and ledger-rs halfway, catalog-rs-2 primary.

source pods.sh

echo "==> Waiting for secure-rs, orders-rs, upgrade-rs and ledger-rs halfway and catalog-rs-2 as primary"
kubectl -n mongodb wait mongodbcommunity/secure-rs --for=jsonpath='{.status.phase}'=Running --timeout=600s
kubectl -n mongodb-apps wait mongodbcommunity/orders-rs --for=jsonpath='{.status.phase}'=Running --timeout=600s
retry waiting_with upgrade-rs-1 ImagePullBackOff
retry ready upgrade-rs-0
retry unschedulable ledger-rs-2
retry ready ledger-rs-0
retry ready ledger-rs-1
retry agent_says_primary catalog-rs-2
