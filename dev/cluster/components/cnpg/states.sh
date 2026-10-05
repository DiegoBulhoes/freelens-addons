# A replicated table, a switchover, a hibernated cluster and a replica that stopped replaying.

psql_on() { kubectl -n databases exec "$1" -c postgres -- psql -d "$2" -At -c "$3"; } # pod database sql
primary_of() { kubectl -n databases get cluster "$1" -o jsonpath='{.status.currentPrimary}'; }

echo "==> The orders table on both ends of the subscription"
for cluster in orders-db inventory-db; do
  psql_on "$(primary_of "${cluster}")" app \
    "create table if not exists orders (id bigint primary key, placed_at timestamptz not null default now(), total numeric(10,2) not null)"
done

echo "==> Switching orders-db over, hibernating reports-db"
kubectl -n databases patch cluster orders-db --subresource=status --type merge \
  -p '{"status":{"targetPrimary":"orders-db-2","phase":"Switchover in progress","phaseReason":"Switching over to orders-db-2"}}'
kubectl -n databases annotate cluster reports-db cnpg.io/hibernation=on --overwrite
kubectl -n databases wait cluster/orders-db --for=jsonpath='{.status.currentPrimary}'=orders-db-2 --timeout=300s
kubectl -n databases wait cluster/orders-db --for=condition=Ready --timeout=600s

# Paused before it follows the switchover, it stays on the old timeline and stops streaming.
streaming() { [[ "$(psql_on orders-db-2 postgres "select count(*) from pg_stat_replication where application_name = '$1' and state = 'streaming'")" == 1 ]]; }

echo "==> Pausing replay on orders-db-3, then writing on the primary"
retry streaming orders-db-3
psql_on orders-db-3 postgres "select pg_wal_replay_pause()"
psql_on orders-db-2 app "insert into orders select g, now(), g * 1.5 from generate_series(1, 20000) g on conflict do nothing"
