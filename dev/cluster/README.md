# Development cluster

A disposable k3s cluster to develop the extensions against. The kubeconfig is written to
`/tmp/freelens-addons-k3s/kubeconfig.yaml`, outside the repository.

| Command | What it does |
|---------|--------------|
| `make cluster` | Start k3s and install what the extensions read |
| `make cluster-down` | Stop it and delete its data |

## cluster.sh

Everything that touches this cluster goes through `cluster.sh`, which refuses any other.

| Command | What it does |
|---------|--------------|
| `cluster.sh install` | Installs every component in `components/`, in order. `make cluster` runs it |
| `cluster.sh install redis` | Installs only that component |
| `cluster.sh kubectl ARGS...` | kubectl on this cluster. `make kubectl ARGS="..."` runs it |
| `cluster.sh fixtures [package...]` | Writes the test fixtures, through `fixtures/sanitise.py` ([testing](../../docs/testing.md#fixtures)) |

## What gets installed

One directory per component, under `components/`:

| File | What it does |
|------|--------------|
| `install.sh` | Installs the operator at a pinned version (at its top) and applies the samples, with the helpers in `cluster.sh` |
| `*.yaml` | The samples it applies, in each state the pages render |
| `states.sh` | States no manifest can declare, caused after the install. Not every component has one |

| Directory | Installs | Samples | States |
|-----------|----------|---------|--------|
| `workloads/` | Nothing | Workloads in `demo`, running as root with no limits, for Trivy to flag | — |
| `argocd/` | ArgoCD and Argo CD Image Updater | Applications (one synced, one unresolvable, one with automated sync off); Image Updater rules in each state the page ranks | A deploy history with two revisions, and drift |
| `trivy/` | Trivy operator | — | `web` rolls once its SBOM exists, so an old ReplicaSet keeps it |
| `cert-manager/` | cert-manager and Pebble, a test ACME server | Issuers and Certificates in each state the pages render | `flaky-ca` loses its key, so one certificate stops renewing |
| `cnpg/` | CloudNativePG and its Barman Cloud plugin | RustFS as the S3 store; Postgres clusters, backups, schedules, poolers, managed roles, a tablespace, publications and subscriptions; one server certificate from cert-manager | The replicated table, a switchover, a hibernated cluster, a replica that stopped replaying |
| `mongodb/` | MongoDB Controllers for Kubernetes | Replica sets: healthy with a preferred primary, an arbiter on the previous series, a volume that cannot bind, a user whose password Secret is missing, a version with no image, TLS from cert-manager | — |
| `redis/` | redis-operator | A replication watched by sentinels, a sharded cluster, a standalone with TLS from cert-manager, one whose volume cannot bind, one whose image does not exist | — |

`argocd/image-updater-refused.yaml` is a rule the controller refuses (Ready=False). It is never
applied, since it makes the controller crash-loop; apply it by hand only to export that fixture
(steps in its header).
