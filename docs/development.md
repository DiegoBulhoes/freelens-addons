---
title: "Development"
description: "Running the workbench, the development cluster, adding an extension, and what to check when one does not appear"
---

# Development

Everything runs in Docker. The host needs only Docker: Node, pnpm, Freelens and the cluster run in
containers.

## Contents

- [First run](#first-run)
- [The development cluster](#the-development-cluster)
- [The loop](#the-loop)
- [Adding an extension](#adding-an-extension)
- [Linking to a Kubernetes object](#linking-to-a-kubernetes-object)
- [When the extension does not appear](#when-the-extension-does-not-appear)
- [Reading logs](#reading-logs)
- [Dependencies](#dependencies)
- [Checks before pushing](#checks-before-pushing)
- [Commands](#commands)

## First run

```bash
make cluster
make up
```

1. `make cluster` starts a disposable k3s, installs ArgoCD, the Trivy operator and cert-manager,
   applies sample workloads, and writes a kubeconfig to `/tmp/freelens-addons-k3s/kubeconfig.yaml`.
   It lives under `/tmp` so it cannot be committed by accident.
2. The first `make up` writes `.env` from the template with your UID and GID, then stops. Set
   `KUBECONFIG_PATH` to the kubeconfig. `.env` is git-ignored.
3. The second `make up` builds every extension and starts Freelens, on noVNC at
   `http://localhost:6080/vnc.html?autoconnect=1&resize=scale`. The cluster and the extensions are
   picked up and enabled automatically.
4. Pick "All Namespaces" in any list page. Freelens starts scoped to `default` on every launch;
   `accessibleNamespaces` in `lens-cluster-store.json` narrows the options, not the selection.

Any other cluster works too: point `KUBECONFIG_PATH` at its kubeconfig. The container mounts it
read-only. If something fails, see [Reading logs](#reading-logs).

## The development cluster

| Command | What it does |
|---------|--------------|
| `make cluster` | Start k3s, install the operators, apply the samples |
| `make cluster-down` | Stop it and delete its data |

It is a compose service behind the `cluster` profile, so `make up` never starts it. Its image is
pinned by digest. Each component has a directory in `dev/cluster/components/` with an `install.sh`, its samples and,
when needed, a `states.sh`; `dev/cluster/cluster.sh install` runs them in order, or only the ones named
([dev/cluster/README.md](../dev/cluster/README.md)):

| Component | Purpose |
|-----------|---------|
| ArgoCD | Source for the ArgoCD extension |
| Trivy operator | Writes the reports the Trivy extension reads |
| cert-manager | Issues the certificates the cert-manager extension reads |
| Pebble | Test ACME server, so cert-manager creates Orders and Challenges |
| Sample workloads and Applications | Failing cases on purpose: Applications pointing at a missing path or branch, a Deployment that never becomes ready, one with a missing image the scanner cannot read, a ClusterRole that reads secrets cluster-wide |
| Shapes the tests read | An app-of-apps, a multi-source Application (Helm chart plus git manifests), one pinned to a commit, sync waves |
| Sample certificates, issuers and Ingresses | A certificate naming a missing issuer, one waiting on an issuer that is never ready, an ACME one stuck at its Challenge, an Ingress serving an unmanaged Secret, one naming a missing Secret |

Rules for changing the seed:

- Fetch upstream manifests at a release tag, never a branch. Tags follow the 15-day floor, so the
  pinned one is often not the newest.
- Install with `kubectl apply --server-side`. ArgoCD's ApplicationSet CRD is too large for a
  client-side apply.
- Every test fixture comes from this cluster, because the repository is public.
  `dev/cluster/cluster.sh fixtures` refuses any cluster whose node is not `freelens-addons-dev`. A state
  the tests need goes into the component's `states.sh`, never into a hand-written fixture.
- The sample TLS Secrets hold placeholders. `Warning: tls: failed to find any PEM data` on apply is
  expected.

Some states have no manifest and are caused by the seed:

| State | How |
|-------|-----|
| A certificate that stays valid while its renewal fails | `renewal-stalls` is issued by `flaky-ca`, then `flaky-ca`'s key is deleted. Renewal falls due three minutes later and keeps failing while `Ready` stays true |
| A deploy history with several recent revisions | `guestbook` is synced by hand to HEAD twice, then to an older commit, and heals itself back |
| Drift that stays | `helm-guestbook` has no automated sync, and its Deployment is scaled after syncing |
| A workload whose image was read and never judged | `web` is rolled once: the old ReplicaSet keeps its SBOM and loses its verdict |
| Pressure on the node | The kubelet's image garbage collection target is unreachable, so it warns `FreeDiskSpaceFailed` every few minutes |

## The loop

Run `make up` after every change. A rebuild alone is not enough: Freelens caches the bundle for the
life of the process, and `make up` restarts it. Reloading the window does not help.

- Restarting drops the noVNC session. Reload the browser tab.
- Extension pages are per cluster. Connect to a cluster, then look in the left sidebar.

## Adding an extension

Start from the `freelens-extension` skill in `.claude/skills/`. It covers the tests, fixtures, docs
page, e2e suite and gates, and reads this repository's conventions before scaffolding. Do not copy
an existing package.

Every directory under `packages/` must be a real extension. Shared tooling goes in `build/`.

A package has four parts.

`package.json` points `main` and `renderer` at the build output, and `engines.freelens` gates
compatibility:

```json
{
  "name": "@freelens-addons/<name>",
  "version": "0.1.0",
  "private": true,
  "license": "Apache-2.0",
  "main": "out/main/index.js",
  "renderer": "out/renderer/index.js",
  "files": ["out"],
  "engines": { "freelens": "^1.10.3", "node": ">=22" },
  "scripts": {
    "build": "electron-vite build",
    "watch": "electron-vite build --watch",
    "type:check": "tsc --noEmit && tsc --noEmit -p e2e/tsconfig.json",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "vitest run --config e2e/vitest.config.ts"
  }
}
```

`files` is required. Without it the tarball ships no `renderer` and the extension does nothing.
`verify-bundles.sh` fails on it. Keep `@freelensapp/extensions`, `react` and `mobx` in
`devDependencies`: at runtime they are globals the host provides.

`electron.vite.config.ts` is one line:

```ts
import { defineExtensionConfig } from "../../build/vite/extension-config";

export default defineExtensionConfig();
```

`tsconfig.json` extends the root config and includes `../../build/vite/**/*`.

`src/main/index.ts` and `src/renderer/index.tsx` each default-export a class extending
`Main.LensExtension` and `Renderer.LensExtension`.

Then:

1. Run `pnpm install --fix-lockfile`, not a plain `pnpm install`. A plain install leaves the peers
   unresolved, and `tsc` then reports *"this member cannot have an 'override' modifier because its
   containing class does not extend another class"* once per member.
2. Run `make up`.
3. Run `make check`. Its `verify-bundles.sh` rejects a manifest or bundle Freelens would skip.

## Linking to a Kubernetes object

`Navigation.showDetails` does nothing from an extension's own `clusterPage`, because only pages
that mount the details drawer render it. Navigate to a list narrowed with `?search=` instead. The
host reads it on every list page:

```tsx
const { Navigation: { navigate } } = Renderer;

navigate(`/pods?search=${encodeURIComponent(pod.name)}`);
```

For one of our own list pages, add a param and filter on it. `packages/argocd` does this with
`name` on its Applications page.

Use `getDetailsUrl` in an `href` only. It returns a URL, and `showDetails` expects a selfLink.

## When the extension does not appear

Check in this order.

| Symptom | Cause |
|---------|-------|
| Nothing in the logs | The directory has no `package.json`, or is not directly under `packages/` |
| `can't load main for "..."` with `Cannot find module '<your entrypoint>'` | Not built. Run `make up` |
| `Cannot find module '@freelensapp/extensions'` | The bundle externalised it without mapping it to the host global |
| Listed, never activated, no error | `.default` is not a class. The bundle should end in `exports.default =` |
| Listed as incompatible | `engines.freelens` does not match the running version |
| Loaded, page missing from the sidebar | Connect to a cluster first |
| Connected, group still missing | The group shows only when the cluster has the tool's CRDs (`applications.argoproj.io`, `certificates.cert-manager.io`, or any Trivy report CRD). Without permission to list CRDs it stays hidden |
| Group at the bottom of the sidebar instead of at its `orderNumber` | The saved order in `lens-user-store.json` (`clusterPageMenuOrder`) wins, and a new group is saved at `9999`. Drag it, or edit that entry with Freelens stopped |

## Reading logs

```bash
docker compose -f dev/docker-compose.yml --project-directory . logs -f freelens
```

Look for `[EXTENSIONS-LOADER]` and `[EXTENSION-DISCOVERY]` lines. Logs from an extension's main
half appear here. The renderer half's `console.log` goes to Chromium's devtools inside the app.

## Dependencies

| Rule | Where it lives |
|------|----------------|
| Nothing published less than 15 days ago is installed | `minimumReleaseAge: 21600`, strict, in `pnpm-workspace.yaml` |
| Lifecycle scripts run only when named | `allowBuilds`, per package, as `true` or `false` |

- Declare ranges, not exact pins, so the floor picks the version. The lockfile records it.
- If nothing in range clears the floor, wait or widen the range. Never lower the floor.
- A new dependency with a lifecycle script fails the install until it is named in `allowBuilds`.

## Checks before pushing

```bash
make check              # CI's first four jobs: lint, typecheck, unit tests, build, with the policy checks
bash scripts/security/scan.sh    # the scanners: secrets, dependency CVEs, Dockerfiles
```

| Failure | What to do |
|---------|------------|
| `verify-bundles.sh` | The bundle would not load: `.default` is not a class, or a host module was bundled |
| `copy-design-standard.sh --check` | A package's `styles/design.css` differs from the standard. Edit `.claude/skills/freelens-extension/templates/src/renderer/styles/design.css`, then run `bash scripts/checks/copy-design-standard.sh` |
| Coverage | Add a case for the new branch. Do not lower the threshold. See [testing](testing.md) |
| `verify-supply-chain.sh` | A supply-chain control was weakened. Fix the cause, not the check. See [security](security.md) |

## Commands

The compose file is in `dev/`, so a raw compose command from the repository root needs:

```bash
alias dc='docker compose -f dev/docker-compose.yml --project-directory .'
```

The Makefile already does this. It holds only what the agent working here and CI run.

| Command | What it does |
|---------|--------------|
| `make up` | Build the extensions, then start or restart Freelens |
| `make down` | Stop the containers, keeping Freelens' saved state |
| `make check` | CI's first four jobs: lint, typecheck, unit tests with their coverage thresholds, build |
| `make cluster` | Bring up the k3s cluster and seed it |
| `make cluster-down` | Destroy it, volume included |
| `make kubectl ARGS="..."` | kubectl on the dev k3s, refused on any other cluster |
| `make e2e` | The end-to-end suite, against a running Freelens |
| `make e2e-writes` | Real writes through each extension on the dev k3s, checked in the cluster |
| `make ci-local` | The CI workflow through act, beside the dev setup; `JOB=lint` for one job |
| `bash scripts/security/scan.sh` | Secret, dependency and Dockerfile scanners |
| `dc logs -f freelens` | Follow the container logs |
| `dc down -v` | Stop everything and discard Freelens' saved state |
| `dc run --rm --no-deps --entrypoint sh -w /workspace freelens -lc "pnpm run lint:fix"` | Apply Biome's safe fixes |
