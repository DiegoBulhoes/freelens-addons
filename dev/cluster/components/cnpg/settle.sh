# Waits for billing-db's archiving and first backup to fail, for orders-db's and audit-db's
# archiving to work, for orders-replica-db to stream from orders-db, and for orders-hourly's
# newest backup to complete.

has_backup() { # schedule phase
  kubectl -n databases get backups.postgresql.cnpg.io -l "cnpg.io/scheduled-backup=$1" \
    -o jsonpath='{.items[*].status.phase}' | grep -qw "$2"
}

newest_backup_is() { # schedule phase
  kubectl -n databases get backups.postgresql.cnpg.io -l "cnpg.io/scheduled-backup=$1" \
    --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].status.phase}' | grep -qx "$2"
}

newest_backup_done() { # schedule
  newest_backup_is "$1" completed || newest_backup_is "$1" failed
}

replica_streams() {
  local primary
  primary=$(kubectl -n databases get cluster orders-replica-db -o jsonpath='{.status.currentPrimary}')
  [[ -n "${primary}" ]] && [[ "$(kubectl -n databases exec "${primary}" -c postgres -- psql -At -c \
    "select status from pg_stat_wal_receiver where sender_host = 'orders-db-rw.databases.svc'")" == streaming ]]
}

echo "==> Waiting for billing-db's archiving and backup to fail, the others' archiving, and an orders-hourly backup"
kubectl -n databases wait cluster/billing-db --for=condition=ContinuousArchiving=False --timeout=600s
kubectl -n databases wait cluster/orders-db cluster/audit-db --for=condition=ContinuousArchiving=True --timeout=600s
retry has_backup billing-nightly failed
retry newest_backup_done orders-hourly
# The immediate run can predate the bucket, and the next scheduled one can be an hour away.
newest_backup_is orders-hourly failed && kubectl -n databases create -f - <<EOF
apiVersion: postgresql.cnpg.io/v1
kind: Backup
metadata:
  generateName: orders-hourly-
  namespace: databases
  labels: { cnpg.io/scheduled-backup: orders-hourly }
spec:
  cluster: { name: orders-db }
  method: plugin
  pluginConfiguration: { name: barman-cloud.cloudnative-pg.io }
EOF
retry newest_backup_is orders-hourly completed

echo "==> Waiting for orders-replica-db's designated primary to stream from orders-db"
kubectl -n databases wait cluster/orders-replica-db --for=condition=Ready --timeout=900s
retry replica_streams
