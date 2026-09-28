---
title: "Development"
description: "Day-to-day workflow: running the workbench, building extensions, adding a new one, and debugging when nothing appears"
---

# Development

Everything runs in Docker. The host needs Docker; Node, pnpm, Freelens and even the cluster all run
in containers.

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

`make cluster` starts a k3s of its own, installs ArgoCD, the Trivy operator and cert-manager, and
applies a few sample workloads. It writes a kubeconfig to `/tmp/freelens-addons-k3s/kubeconfig.yaml`. Develop
against that: it is disposable, and `make cluster-down` takes its volume with it.

Under `/tmp` on purpose. A kubeconfig in the repository is one `git add -A` away from being
committed, and this one does not survive a reboot either.

`make up` then writes `.env` from the template, fills in your UID and GID, and stops. Set
`KUBECONFIG_PATH` to that file and run it again; it fails until you do. `.env` is git-ignored and
the template holds no real paths.

Any other cluster works as well — point `KUBECONFIG_PATH` at its kubeconfig instead. The container
only ever mounts it read-only.

The second run builds every extension, starts Freelens, and prints the noVNC URL to open. Freelens
picks the cluster up from the mounted kubeconfig automatically, and extensions are enabled on first
sight, so every extension's pages appear in the cluster sidebar straight away.

If any of that fails, the container logs say why — see [Reading logs](#reading-logs).

## The development cluster

| Command | What it does |
|---------|--------------|
| `make cluster` | Start k3s, install the operators, apply the samples |
| `make cluster-down` | Stop it and delete its data |

It is a compose service behind a `cluster` profile, so an ordinary `make up` never starts it. The
image is pinned by digest like every other.

What goes on it lives in `dev/cluster/` as manifests, applied in order by `scripts/seed-cluster.sh`:

| | Why |
|---|---|
| ArgoCD | The ArgoCD extension has nothing to show without it |
| Trivy operator | Writes the reports the Trivy extension reads |
| cert-manager | Issues the certificates the cert-manager extension reads |
| Pebble | Let's Encrypt's test ACME server. Without one, cert-manager never opens an Order, and there is no Order or Challenge to read at all |
| Sample workloads and Applications | Deliberately imperfect: Applications that point at a path or a branch that does not exist, one Deployment that never becomes ready, one whose image does not exist so the scanner never looks at it, and a ClusterRole that reads secrets cluster-wide. An overview where everything is green shows nothing about how it ranks |
| The shapes the tests read | An app-of-apps, from the ArgoCD example repository's own `apps` chart; a multi-source Application (a Helm chart at a version range plus manifests from git); one pinned to a commit; sync waves |
| Sample certificates, issuers and Ingresses | The same, for cert-manager: one naming an issuer that does not exist, one waiting on an issuer that is never ready, an ACME one stuck at its Challenge, an Ingress serving a Secret nothing manages, and one naming a Secret that does not exist |

A few things about the seeding are worth knowing before you change it.

**Upstream manifests are fetched at a release tag, never a branch**, and those tags obey the same
fifteen-day floor as every other dependency here. The newest release is often not the one pinned.

**Both installs use `kubectl apply --server-side`.** ArgoCD's ApplicationSet CRD is larger than the
annotation a client-side apply writes to remember the last configuration, and kubectl rejects it
with `metadata.annotations: Too long`.

**It is where every fixture comes from.** The repository is public, and a real cluster's reports
are its inventory, its roles and its open CVEs. `scripts/export-fixtures.sh` refuses any cluster
whose node is not `freelens-addons-dev`, the name the k3s service is started with. A state the
tests need that the cluster lacks goes into the seed, never into a fixture by hand.

**Some states are caused, not declared.** A certificate that is still valid while its renewal fails
has no manifest. The seed lets `renewal-stalls` be issued by `flaky-ca`, then deletes `flaky-ca`'s
key; renewal falls due three minutes later and fails from then on, while `Ready` stays true for
ninety days. A day-long certificate expired overnight and took the state with it.

The seed causes the others through the tools themselves:

| State | How |
|-------|-----|
| A deploy history with two revisions, several within the hour | `guestbook` is synced by hand to HEAD twice, then to an older commit, and heals itself back |
| Drift that stays | `helm-guestbook` has no automated sync, and its Deployment is scaled after syncing |
| A workload whose image was read and never judged | `web` is rolled once: the old ReplicaSet keeps its SBOM and loses its verdict |
| Pressure on the node | The kubelet's image garbage collection is set to a target it cannot reach, so it warns `FreeDiskSpaceFailed` every few minutes |

**The sample TLS Secrets hold placeholders.** Applying them prints `Warning: tls: failed to find any
PEM data`, which is expected: the API server checks that both keys are there and does not parse
them, and no key material is committed.

## The loop

`make up` after every change. It rebuilds and restarts, which is the only way a new bundle reaches
the running app.

**A rebuild alone is not enough.** Freelens caches an extension's bundle for the life of the
process, and its watcher reacts only to an extension directory appearing or disappearing, never to
file contents. Reloading the window does not help either.

Two more things to expect:

- **Restarting drops the noVNC session.** Reload the browser tab.
- **Extension pages are per-cluster.** They are not on the welcome screen; connect to a cluster,
  then look in the left sidebar.

## Adding an extension

Create `packages/<name>/` with four files. Every directory under `packages/` is read by Freelens as
an installed extension, so it must be a real one — put shared tooling in `build/` instead.

**`package.json`** — `main` and `renderer` point at the build output, and `engines.freelens` gates
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
  "engines": { "freelens": "^1.10.0", "node": ">=22" },
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

`files` is not optional. npm auto-includes what `main` names but knows nothing about `renderer`,
so without it the packed tarball ships no UI: it installs, it enables, and it does nothing.
`verify-bundles.sh` fails on it.

The full procedure — the tests, the fixtures, the docs page, the e2e suite and the gates — is the
`freelens-extension` skill under `.claude/skills/`. It is written for any repository: it reads
this one's conventions (this file, `CLAUDE.md`, the existing packages) before scaffolding, and
its templates are only the minimum the Freelens loader demands.

Keep `@freelensapp/extensions`, `react` and `mobx` in `devDependencies`. They are compiled against
but never shipped — at runtime they resolve to globals the host provides.

**`electron.vite.config.ts`** — one line:

```ts
import { defineExtensionConfig } from "../../build/vite/extension-config";

export default defineExtensionConfig();
```

**`tsconfig.json`** — extends the root config and includes `../../build/vite/**/*`.

**`src/main/index.ts` and `src/renderer/index.tsx`** — each default-exporting a class extending
`Main.LensExtension` and `Renderer.LensExtension`. The skill scaffolds both; copying an existing
package brings its hooks and stores along, which are decisions that package made for its own reasons.

Then run `pnpm install --fix-lockfile` — **not a plain `pnpm install`**. A plain one adds the new
importer to the lockfile without resolving its peers, so `@freelensapp/extensions` links to a
`.pnpm` directory that does not exist. The error names nothing to do with the cause: `tsc` reports
*"this member cannot have an 'override' modifier because its containing class does not extend
another class"*, once per member, because the base class failed to resolve.

Then `make up`. `make check` runs `verify-bundles.sh`, which rejects a manifest or a bundle
Freelens would silently skip.

## Linking to a Kubernetes object

`Navigation.showDetails` does nothing from an extension's own `clusterPage`. It merges a query
parameter into the current route, and the details drawer is rendered only by pages that mount it —
the host's own, and ours built on `KubeObjectListLayout`.

Navigate to a list narrowed to the object instead. The host reads `?search=` on every list page it
renders, so `/pods?search=<name>` lands one click from the drawer:

```tsx
const { Navigation: { navigate } } = Renderer;

navigate(`/pods?search=${encodeURIComponent(pod.name)}`);
```

For one of our own list pages, give it a param and filter on it — `packages/argocd` does this with
`name` on its Applications page, so a row on the overview opens that Application and nothing else.

`getDetailsUrl` belongs in an `href`, never as an argument to `showDetails`: it returns a URL where
a selfLink is expected, and the call then silently does nothing.

## When the extension does not appear

Work through it in this order; the failure modes are silent and each one looks like the last.

| Symptom | Cause |
|---------|-------|
| Nothing in the logs at all | The directory has no `package.json`, or it is not directly under `packages/` |
| `can't load main for "..."` with `Cannot find module '<your entrypoint>'` | Not built — run `make up` |
| `Cannot find module '@freelensapp/extensions'` | The bundle externalised it without mapping it to the host global |
| Listed but never activated, no error | `.default` is not a class — check the bundle ends in `exports.default =` |
| Listed as incompatible | `engines.freelens` does not match the running version |
| Loads, but the page is missing from the sidebar | Extension pages are per-cluster; connect to a cluster first |
| Connected, and the group is still missing | The group shows only when the cluster has the tool's CRDs (`applications.argoproj.io`, `certificates.cert-manager.io`, or any Trivy report CRD), read from Freelens' own CRD list. It appears on its own once they are installed. Without permission to list CRDs it stays hidden |
| In the sidebar, but at the bottom rather than where `orderNumber` puts it | Freelens keeps the sidebar's order in `lens-user-store.json` (`clusterPageMenuOrder`), and it wins over `orderNumber`. A group that appears after the order was saved is written in at `9999`. Drag it, or edit that entry with Freelens stopped |

## Reading logs

```bash
docker compose -f dev/docker-compose.yml --project-directory . logs -f freelens
```

The main process writes `[EXTENSIONS-LOADER]` and `[EXTENSION-DISCOVERY]` lines, and anything an
extension logs from its main half shows up here too. The renderer half's `console.log` goes to
Chromium's devtools inside the app, not to this output.

## Dependencies

| Rule | Where it lives |
|------|----------------|
| Nothing published less than 15 days ago is installed | `minimumReleaseAge: 21600`, strict, in `pnpm-workspace.yaml` |
| Lifecycle scripts run only when named | `allowBuilds`, per package, as `true` or `false` |

**Declare dependencies as ranges, not exact pins,** so the floor does the choosing. The lockfile
records what it picked.

**An install that fails because nothing in range clears the floor is the policy working.** Wait, or
widen the range. Do not lower the floor for one package.

**A new native dependency should be a decision, not a warning to skim.** That is why a lifecycle
script fails the install until someone names it.

## Checks before pushing

```bash
make test               # the tests on their own
make check              # what CI runs: lint, typecheck, test, build, bundle contract, design copies, supply-chain policy
bash scripts/scan.sh    # the scanners: secrets, dependency CVEs, Dockerfiles
```

What to do when it fails:

| Failure | What it means |
|---------|---------------|
| `verify-bundles.sh` | The bundle would not load: `.default` is not a class, or a host module was bundled. Both break silently in the app, which is why they are caught here. |
| `sync-design.sh --check` | An extension's `styles/design.css` is not the standard. Edit the standard in `.claude/skills/freelens-extension/templates/src/renderer/styles/design.css`, then run `bash scripts/sync-design.sh` to copy it out. |
| Coverage, rather than an assertion | A new branch arrived without a case for it. Add the case; do not lower the threshold. See [testing](testing.md). |
| `verify-supply-chain.sh` | A supply-chain control was weakened. Fix the cause rather than the check. See [security](security.md). |

## Commands

The compose file lives in `dev/docker-compose.yml`, so a raw compose command run from the repository
root needs to be told where it is, and to keep resolving paths and `.env` from the root:

```bash
alias dc='docker compose -f dev/docker-compose.yml --project-directory .'
```

The Makefile already does that. The targets:

| Command | What it does |
|---------|--------------|
| `make up` | Build the extensions, then start or restart Freelens |
| `make down` | Stop the containers, keeping Freelens' saved state |
| `make test` | The tests, with the coverage thresholds CI enforces |
| `make check` | Everything CI runs except the scanners |
| `make cluster` | Bring up the k3s cluster and seed it |
| `make cluster-down` | Destroy it, volume included |
| `make e2e` | The end-to-end suite, against a running Freelens |

Everything else is a script or a compose command:

| Command | What it does |
|---------|--------------|
| `bash scripts/scan.sh` | Secret, dependency and Dockerfile scanners |
| `dc logs -f freelens` | Follow the container logs |
| `dc down -v` | Stop everything and discard Freelens' saved state |
| `dc run --rm --no-deps --entrypoint sh -w /workspace freelens -lc "pnpm run lint:fix"` | Apply Biome's safe fixes |
