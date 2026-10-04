# Development cluster

A disposable k3s cluster to develop the extensions against. The kubeconfig is written to
`/tmp/freelens-addons-k3s/kubeconfig.yaml`, outside the repository.

| Command | What it does |
|---------|--------------|
| `make cluster` | Start k3s and install what the extensions read |
| `make cluster-down` | Stop it and delete its data |

## What gets installed

`scripts/seed-cluster.sh` installs these at pinned release tags, then applies the manifests below in order.

| Component | Why |
|-----------|-----|
| ArgoCD | Read by the ArgoCD extension |
| Trivy operator | Writes the reports the Trivy extension reads |
| cert-manager | Read by the cert-manager extension |
| Argo CD Image Updater | Its rules feed the Image Updater page |
| CloudNativePG and its Barman Cloud plugin | Read by the CloudNativePG extension |
| MongoDB Controllers for Kubernetes | Read by the MongoDB extension |
| redis-operator | Read by the Redis extension |

| Manifest | Contents |
|----------|----------|
| `00-namespaces.yaml` | Namespaces |
| `10-workloads.yaml` | Sample workloads, running as root with no limits, for Trivy to flag |
| `20-argocd-applications.yaml` | Sample Applications: one synced, one unresolvable, one with automated sync off |
| `25-pebble.yaml` | Pebble, a test ACME server for cert-manager |
| `30-cert-manager.yaml` | Issuers and Certificates in each state the pages render |
| `40-image-updater.yaml` | Image Updater rules in each state the page ranks, against public registries |
| `50-cnpg.yaml` | RustFS as the S3 store, and Postgres clusters, backups, schedules, poolers, managed roles, a tablespace, publications and subscriptions in each state the pages rank, and one server certificate from cert-manager. The seed then switches one over, hibernates another, creates the replicated table and pauses replay on one replica |
| `60-mongodb.yaml` | MongoDB replica sets in each state the pages rank: healthy with a preferred primary, with an arbiter on the previous series, a volume that cannot bind, a user whose password Secret is missing, a version with no image, and TLS from a cert-manager certificate |
| `70-redis.yaml` | A replication watched by sentinels, a sharded cluster, a standalone with TLS from cert-manager, one whose volume cannot bind and one whose image does not exist |
| `41-image-updater-refused.yaml` | A rule the controller refuses (Ready=False). Not seeded, since it makes the controller crash-loop; applied by hand only to export that fixture (steps in its header) |
