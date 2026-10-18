# A replicated table, a switchover, a hibernated cluster, a replica cluster and a replica that
# stopped replaying.

psql_on() { kubectl -n databases exec "$1" -c postgres -- psql -d "$2" -At -c "$3"; } # pod database sql
primary_of() { kubectl -n databases get cluster "$1" -o jsonpath='{.status.currentPrimary}'; }

echo "==> The orders table on both ends of the subscription"
for cluster in orders-db inventory-db; do
  psql_on "$(primary_of "${cluster}")" app \
    "create table if not exists orders (id bigint primary key, placed_at timestamptz not null default now(), total numeric(10,2) not null)"
done

echo "==> Switching orders-db over, hibernating reports-db"
[[ "$(primary_of orders-db)" == orders-db-2 ]] || kubectl -n databases patch cluster orders-db --subresource=status --type merge \
  -p '{"status":{"targetPrimary":"orders-db-2","phase":"Switchover in progress","phaseReason":"Switching over to orders-db-2"}}'
# Hibernation keeps the phase the cluster had, so one hibernated in an error is woken first.
if [[ "$(kubectl -n databases get cluster reports-db -o jsonpath='{.status.phase}')" != "Cluster in healthy state" ]]; then
  kubectl -n databases annotate cluster reports-db cnpg.io/hibernation=off --overwrite
  kubectl -n databases wait cluster/reports-db --for=condition=Ready --timeout=600s
fi
kubectl -n databases annotate cluster reports-db cnpg.io/hibernation=on --overwrite
kubectl -n databases wait cluster/orders-db --for=jsonpath='{.status.currentPrimary}'=orders-db-2 --timeout=300s
kubectl -n databases wait cluster/orders-db --for=condition=Ready --timeout=600s

# After the switchover, so it does not cut the replica cluster's base backup.
echo "==> orders-replica-db, a replica cluster of orders-db"
apply replica.yaml

# The slot is not carried over a switchover; created on the old primary, it is lost with it.
echo "==> The subscription's slot on orders-db's primary"
kubectl -n databases wait subscription/orders-sub --for=jsonpath='{.status.applied}'=true --timeout=300s
psql_on orders-db-2 app "select pg_create_logical_replication_slot('orders_sub', 'pgoutput')
  where not exists (select from pg_replication_slots where slot_name = 'orders_sub')"

# Paused before it follows the switchover, it stays on the old timeline and stops streaming.
streaming() { [[ "$(psql_on orders-db-2 postgres "select count(*) from pg_stat_replication where application_name = '$1' and state = 'streaming'")" == 1 ]]; }

echo "==> Pausing replay on orders-db-3, then writing on the primary"
retry streaming orders-db-3
psql_on orders-db-3 postgres "select pg_wal_replay_pause()"
# New ids each run, so the paused replica falls behind again.
psql_on orders-db-2 app "insert into orders select m + g, now(), g * 1.5 from (select coalesce(max(id), 0) m from orders) t, generate_series(1, 20000) g"
