---
title: "Development"
description: "Running the workbench, the development cluster, adding an extension, and what to check when one does not appear"
---

# Development

Everything runs in Docker. The host needs Docker, plus `jq` for the dependency scan in
`make check` and `scripts/security/scan.sh`: Node, pnpm, Freelens and the cluster run in containers.

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

1. `make cluster` starts a disposable k3s, installs the tool each extension reads with samples in
   each state its pages render, and writes a kubeconfig to `/tmp/freelens-addons-k3s/kubeconfig.yaml`.
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
| `make cluster` | Start k3s and install every component |
| `make cluster PACKAGE=cnpg` | Install only the components that package needs, as its [CI leg](testing.md#in-ci) does. Run `make cluster-down` first for a cluster with nothing else |
| `make cluster-down` | Stop it and delete its data |

It is a compose service behind the `cluster` profile, so `make up` never starts it. Its image is
pinned by digest. Each component has a directory in `dev/cluster/components/` with an `install.sh`,
its samples and, when needed, a `states.sh` and a `settle.sh`
([dev/cluster/README.md](../dev/cluster/README.md)). `dev/cluster/cluster.sh install` runs every
component in order, `install <component...>` only those named, and `install --for <package>` the
ones that package needs, from one map in `cluster.sh`.

| Phase | Runs, for each component installed, in order | Does |
|-------|----------------------------------------------|------|
| Install | `install.sh`, then `states.sh` | Installs the tool at a pinned version, applies the samples, causes the states no manifest declares |
| Settle | `settle.sh`, once every component is installed | Waits, and only waits, for asynchronous results the e2e suites read once and nothing else waits for |

| Component | Purpose | In `--for` |
|-----------|---------|------------|
| `workloads` | Workloads in `demo` for Trivy to flag: running as root with no limits, one that never becomes ready, one with a missing image the scanner cannot read, a ClusterRole that reads secrets cluster-wide | `trivy` |
| `argocd` | ArgoCD and Argo CD Image Updater. Applications failing on purpose (a missing path, revision or namespace) and the shapes the tests read: an app-of-apps, a multi-source Application (Helm chart plus git manifests), one pinned to a commit, sync waves | `argocd` |
| `trivy` | The Trivy operator, which writes the reports the Trivy extension reads | `trivy` |
| `cert-manager` | cert-manager and the `demo-ca` chain the other components' certificates come from | `cert-manager`, `cnpg`, `mongodb`, `redis` |
| `cert-manager-samples` | Pebble, a test ACME server, so cert-manager creates Orders and Challenges. A certificate naming a missing issuer, one waiting on an issuer that is never ready, an ACME one stuck at its Challenge, an Ingress serving an unmanaged Secret, one naming a missing Secret | `cert-manager` |
| `cnpg` | CloudNativePG and its Barman Cloud plugin, with Postgres clusters in each state | `cnpg` |
| `mongodb` | MongoDB Controllers for Kubernetes, with replica sets in each state | `mongodb` |
| `redis` | redis-operator, with replications, sentinels, clusters and standalones in each state | `redis` |

Rules for changing the seed:

- Fetch upstream manifests at a release tag, never a branch. Tags follow the 15-day floor, so the
  pinned one is often not the newest.
- Install with `kubectl apply --server-side`. ArgoCD's ApplicationSet CRD is too large for a
  client-side apply.
- A component that needs another (`cnpg` needs cert-manager's issuers) gets it through the `--for`
  entry of every package that installs it, in install order. The full seed hides a missing one;
  `make cluster PACKAGE=<name>` on a fresh cluster shows it.
- `settle.sh` never changes the cluster. A state to cause goes into `states.sh`.
- Every test fixture comes from this cluster, because the repository is public.
  `dev/cluster/cluster.sh fixtures` refuses any cluster but the dev k3s, and one missing a
  component. A state the tests need goes into the component's `states.sh`, never into a
  hand-written fixture.
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
`devDependencies`: at runtime they are globals the host provides. A bundle carries only the
extension's own `src/`: importing an npm library, even its JSON or CSS (also through `@import`),
fails the build (`build/vite/first-party-only.ts`), and a `package.json` with `dependencies` fails
`verify-bundles.sh`, because [security](security.md#vulnerabilities) rests on it.

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
2. Give it a component in `dev/cluster/components/<name>/`, named in `COMPONENTS` in
   `dev/cluster/cluster.sh` at its place in the install order, and a `--for <name>` entry in the
   same file listing every component it needs, in that order.
3. If a state its e2e suites read arrives asynchronously, wait for it in the component's
   `settle.sh`.
4. Add its leg to the matrix in `.github/workflows/ci.yaml` (`leg:` in job `e2e`).
5. Run `make up`.
6. Run `make check`. Its `verify-bundles.sh` rejects a manifest or bundle Freelens would skip, and
   `e2e-legs.sh` fails until `packages/`, the `--for` entries and the legs name the same
   extensions.
7. Run its leg alone, beside the dev setup: `make ci-local JOB=e2e LEG=<name>`. On the dev
   cluster instead: `make cluster-down`, `make cluster PACKAGE=<name>`, `make e2e PACKAGE=<name>`,
   `make e2e-writes PACKAGE=<name>`; the fixtures need the full seed back (`make cluster-down`,
   `make cluster`).

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
| Connected, group still missing | The group shows only when the cluster has the tool's CRDs, the names in the package's `src/renderer/api/installed.ts`. Without permission to list CRDs it stays hidden |
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
make check              # CI's first four jobs: the dependency gate, lint, typecheck, unit tests, build, policy checks
bash scripts/security/scan.sh    # the scanners: secrets, dependency CVEs, Dockerfiles
```

| Failure | What to do |
|---------|------------|
| `verify-bundles.sh` | The bundle would not load (`.default` is not a class, a host module was bundled), or it or `out/` holds something besides the extension's own `src/` |
| `freelens-first-party-only` (build) | A bundle would carry an npm library's code, JSON or CSS. Remove the import; see [security](security.md#vulnerabilities) |
| `osv-direct.sh` | Known malware, or a known vulnerability in a version chosen here. Fix the version, or add a dated `[[IgnoredVulns]]` with a reason. See [security](security.md#vulnerabilities) |
| `copy-design-standard.sh --check` | A package's `styles/design.css` differs from the standard. Edit `.claude/skills/freelens-extension/templates/src/renderer/styles/design.css`, then run `bash scripts/checks/copy-design-standard.sh` |
| `e2e-legs.sh` | A package has no CI leg or no `--for` entry in `cluster.sh`, or one of them names no package. Add or remove the entry it prints; see [adding an extension](#adding-an-extension) |
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
| `make deps-refresh` | Resolve the lockfile again within the ranges and the 15-day floor; monthly, and the fix for a transitive advisory |
| `make cluster` | Bring up the k3s cluster and seed it; `PACKAGE=cnpg` for only what that package needs |
| `make cluster-down` | Destroy it, volume included |
| `make kubectl ARGS="..."` | kubectl on the dev k3s, refused on any other cluster |
| `make e2e` | The end-to-end suite, against a running Freelens; `PACKAGE=cnpg` for one package, `FILES=layout` for the files whose path matches |
| `make e2e-writes` | Real writes through each extension on the dev k3s, checked in the cluster; `PACKAGE=cnpg` for one package |
| `make ci-local` | The CI workflow through act, beside the dev setup; `JOB=lint` for one job, `JOB=e2e LEG=cnpg` for one end-to-end leg |
| `bash scripts/security/scan.sh` | Secret, dependency and Dockerfile scanners |
| `dc logs -f freelens` | Follow the container logs |
| `dc down -v` | Stop everything and discard Freelens' saved state |
| `dc run --rm --no-deps --entrypoint sh -w /workspace freelens -lc "pnpm run lint:fix"` | Apply Biome's safe fixes |
