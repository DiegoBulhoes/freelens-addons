# Development cluster

A k3s cluster of its own, so developing an extension does not point at
something that matters. It is disposable: `make cluster-down` takes its volume
with it.

The kubeconfig is written to `/tmp/freelens-addons-k3s/kubeconfig.yaml` rather
than into the repository, so it cannot be committed and does not survive a
reboot.

| Command | What it does |
|---------|--------------|
| `make cluster` | Start k3s and install what the extensions read |
| `make cluster-down` | Stop it and delete its data |

## What gets installed

| | Why |
|---|---|
| ArgoCD | The ArgoCD extension has nothing to show without it |
| Trivy operator | Writes the reports the Trivy extension reads |
| A few sample Applications | So the overview has rows, including ones that fail |

Everything here is a manifest, applied in order by `scripts/seed-cluster.sh`.
Upstream installs are pinned to a release tag rather than tracking a branch.
