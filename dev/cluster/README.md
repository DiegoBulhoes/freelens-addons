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

| Manifest | Contents |
|----------|----------|
| `00-namespaces.yaml` | Namespaces |
| `10-workloads.yaml` | Sample workloads, running as root with no limits, for Trivy to flag |
| `20-argocd-applications.yaml` | Sample Applications: one synced, one unresolvable, one with automated sync off |
| `25-pebble.yaml` | Pebble, a test ACME server for cert-manager |
| `30-cert-manager.yaml` | Issuers and Certificates in each state the pages render |
| `40-image-updater.yaml` | Image Updater rules in each state the page ranks, against public registries |
| `41-image-updater-refused.yaml` | A rule the controller refuses (Ready=False). Not seeded, since it makes the controller crash-loop; applied by hand only to export that fixture (steps in its header) |
