# Waits for cache's pods to be ready and labelled with their roles, and for sessions' TLS and pod.

echo "==> Waiting for cache's role labels and for sessions"
# The operator labels roles after it records the master; the drawer and Restart all read the labels.
kubectl -n redis wait pod -l app=cache --for=condition=Ready --timeout=300s
kubectl -n redis wait pod -l app=cache --for=jsonpath='{.metadata.labels.redis-role}' --timeout=300s
kubectl -n redis wait certificate/sessions-tls --for=condition=Ready --timeout=300s
kubectl -n redis wait pod/sessions-0 --for=condition=Ready --timeout=300s
