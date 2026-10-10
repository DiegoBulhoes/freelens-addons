# Waits for billing-db's archiving and first backup to fail, and for orders-hourly's to complete.

has_backup() { # schedule phase
  kubectl -n databases get backups.postgresql.cnpg.io -l "cnpg.io/scheduled-backup=$1" \
    -o jsonpath='{.items[*].status.phase}' | grep -qw "$2"
}

echo "==> Waiting for billing-db's archiving and backup to fail, and an orders-hourly backup"
kubectl -n databases wait cluster/billing-db --for=condition=ContinuousArchiving=False --timeout=600s
retry has_backup billing-nightly failed
retry has_backup orders-hourly completed
