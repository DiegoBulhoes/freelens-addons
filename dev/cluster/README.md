# Development cluster

A disposable k3s cluster to develop the extensions against. The kubeconfig is written to
`/tmp/freelens-addons-k3s/kubeconfig.yaml`, outside the repository.

| Command | What it does |
|---------|--------------|
| `make cluster` | Start k3s and install what the extensions read |
| `make cluster PACKAGE=cnpg` | Start k3s and install only what that extension's e2e suites read, as its CI leg does |
| `make cluster-down` | Stop it and delete its data |

## cluster.sh

Everything that touches this cluster goes through `cluster.sh`, which refuses any other.

| Command | What it does |
|---------|--------------|
| `cluster.sh install` | Installs every component in `components/`, in order. `make cluster` runs it |
| `cluster.sh install redis` | Installs only that component |
| `cluster.sh install --for cnpg` | Installs what that package's e2e suites need, from `NEEDS` in `cluster.sh`. `make cluster PACKAGE=cnpg` runs it. An unknown package fails and lists the known ones |
| `cluster.sh kubectl ARGS...` | kubectl on this cluster. `make kubectl ARGS="..."` runs it |
| `cluster.sh fixtures [package...]` | Writes the test fixtures, through `fixtures/sanitise.py` ([testing](../../docs/testing.md#fixtures)). Refuses unless every component is installed: fixtures read across namespaces |

An install runs each component's `install.sh` and `states.sh`, in order, then each one's
`settle.sh`, in the same order, so what a `settle.sh` waits for progresses while the rest installs.

`--for` installs a package's own component after the ones it needs (the Needs column below); the
cert-manager package's own component is `cert-manager-samples`. A new extension adds its component,
its `--for` entry in `NEEDS` and its leg in the CI matrix; `scripts/checks/e2e-legs.sh` fails until
`packages/`, the entries and the legs name the same set.

## What gets installed

One directory per component, under `components/`:

| File | What it does |
|------|--------------|
| `install.sh` | Installs the operator at a pinned version (at its top) and applies the samples, with the helpers in `cluster.sh` |
| `*.yaml` | The samples it applies, in each state the pages render |
| `states.sh` | States no manifest can declare, caused after the install. Not every component has one |
| `settle.sh` | Waits, once every component is installed, for asynchronous results the e2e suites read once and nothing else waits for. It never changes the cluster. Not every component has one |

| Directory | Needs | Installs | Samples | States |
|-----------|-------|----------|---------|--------|
| `workloads/` | — | Nothing | Workloads in `demo`, running as root with no limits, for Trivy to flag | — |
| `argocd/` | — | ArgoCD and Argo CD Image Updater | Applications (one synced, one unresolvable, one with automated sync off); Image Updater rules in each state the page ranks | A deploy history with two revisions, and drift |
| `trivy/` | `workloads` | Trivy operator | — | `web` rolls once its SBOM exists, so an old ReplicaSet keeps it |
| `cert-manager/` | — | cert-manager | `demo-ca`, the CA chain the other components' certificates come from | — |
| `cert-manager-samples/` | `cert-manager` | Pebble, a test ACME server | Issuers, Certificates and Ingresses in each state the pages render | `flaky-ca` loses its key, so one certificate stops renewing |
| `cnpg/` | `cert-manager` | CloudNativePG and its Barman Cloud plugin | RustFS as the S3 store; Postgres clusters, backups, schedules, poolers, managed roles, a tablespace, publications and subscriptions; one server certificate from cert-manager | The replicated table, a switchover, a hibernated cluster, a replica that stopped replaying |
| `mongodb/` | `cert-manager` | MongoDB Controllers for Kubernetes | Replica sets: healthy with a preferred primary, an arbiter on the previous series, a volume that cannot bind, a user whose password Secret is missing, a version with no image, TLS from cert-manager | — |
| `redis/` | `cert-manager` | redis-operator | A replication watched by sentinels, a sharded cluster, a standalone with TLS from cert-manager, one whose volume cannot bind, one whose image does not exist | — |

`argocd/image-updater-refused.yaml` is a rule the controller refuses (Ready=False). It is never
applied, since it makes the controller crash-loop; apply it by hand only to export that fixture
(steps in its header).

## Helpers

`cluster.sh` defines these for `install.sh`, `states.sh` and `settle.sh`:

| Helper | What it does |
|--------|--------------|
| `namespace NAME` | Creates the namespace if it does not exist |
| `apply FILE...` | `kubectl apply -f` each file |
| `apply_url URL...` | Applies each URL server-side, retried since a fetch can fail |
| `wait_deploy NAMESPACE DEPLOYMENT...` | Waits for each deployment to roll out |
| `retry COMMAND...` | Runs the command every 5s until it succeeds, for up to 15 minutes; the last attempt shows its output |
| `retry_for SECONDS COMMAND...` | The same, for up to that many seconds |
