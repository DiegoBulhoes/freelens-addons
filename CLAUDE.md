# CLAUDE.md

Freelens extensions, developed against a containerised Freelens reachable over noVNC and pointed at
a disposable k3s that `make cluster` brings up and seeds — or at any other cluster, by kubeconfig.
[README.md](README.md) and [docs/](docs/) cover the rest; this file is only what the code does not
show.

## The loader dictates the build

An extension is a CommonJS bundle `require`d into Electron. That is not a stack preference, it is
the only thing the loader accepts. Four rules follow, every one failing *silently*, all handled
centrally. Do not re-solve them in a package.

| Rule | Handled in |
|------|------------|
| `require(entrypoint).default` must be a class. Rollup's `exports: "auto"` breaks it | `build/vite/` |
| `@freelensapp/extensions`, React and MobX are globals, not resolvable modules | `build/vite/` |
| `engines.freelens` present and matching `^MAJOR.MINOR` | each manifest |
| Symlink into `~/.config/Freelens/node_modules/<name>` | `seed-extensions.mjs` |

## Quirks

**No hot reload.** Freelens caches the loaded bundle; its watcher sees only extension directories
appearing or disappearing. `make up` (build + restart) is the loop. A rebuild alone is not enough,
so do not tell the user it is.

**Every page looks empty on a fresh start, and that is the namespace scope.** Freelens opens
scoped to one namespace (`default`, which holds nothing of ours), and the selection lives in
`localStorage` on an origin whose port is chosen fresh each launch — so it is wiped every start and
cannot be set once. Pick "All Namespaces" in a host list page after each `make up`; the e2e suite
does it for itself. `accessibleNamespaces` in `lens-cluster-store.json` is not the lever — it
narrows the options, not the selection.

**A persisted sidebar order beats `orderNumber`.** Freelens writes the order into
`lens-user-store.json` (`clusterPageMenuOrder`), and a group that appears after that was saved is
written in at `9999` — the bottom, whatever its `orderNumber` says. `orderNumber` only places a
group for someone who has never had one saved. ArgoCD 5, cert-manager 6, Trivy 7.

**A sidebar group shows only on a cluster that has its CRDs.** Every `clusterPageMenus` entry
carries `visible`, a MobX computed over `Renderer.K8sApi.crdStore`, which the host's sidebar keeps
loaded and watched; the rule is `isInstalled()` in each package's `api/installed.ts`. No e2e can
cover the hidden case without deleting CRDs from the dev cluster, so it was checked by pointing
cert-manager at a CRD that does not exist and watching the group go.

**Everything under `packages/` must be a valid extension.** Freelens calls `.match()` on
`manifest.engines.freelens` without checking it exists, so a helper package there throws during
discovery. Shared code goes in `build/`.

**The details drawer is not reachable from an extension page.** `Navigation.showDetails` merges a
query parameter into the current route, and the drawer is rendered only by pages that mount it — the
host's own, and ours built on `KubeObjectListLayout`. From a plain `clusterPage` the call is silent
and the click does nothing. Navigate to a list narrowed to the object instead: the host reads
`?search=` on every list it renders. `getDetailsUrl` is for an `href`, never an argument to
`showDetails` — it returns a URL where a selfLink is expected.

**Never read Secrets through the host's `secretsStore`.** It lists them with their data, so every
private key in the cluster lands in the renderer. `use-tls-inventory.ts` asks for a
`PartialObjectMetadataList` instead, and `secret-metadata.ts` drops every annotation but
cert-manager's on arrival — `kubectl apply` leaves the whole manifest, values included, in the
last-applied annotation, and annotations are metadata. The fixture sanitiser removes the same
things for the same reason.

**The API is not legacy**, despite the internal package being `@freelensapp/legacy-extensions`.
`Renderer.LensExtension` is the current and only one. No `Feature`-based API exists for user
extensions in any release, including 1.10.3. Do not go looking for one.

**One image for the app and the toolchain; a second service only for the cluster.** The Freelens
image carries Node and pnpm. `docker compose up` runs the app; `docker compose run --entrypoint sh
... freelens` runs a build or the tests in a throwaway container, with the app not even required to
be up. The `k3s` service sits behind the `cluster` profile so an ordinary `make up` never starts it.
The compose file, the image and the cluster manifests all live in `dev/`, so a compose command
needs `-f dev/docker-compose.yml --project-directory .` — the second half is what keeps `.` and
`.env` meaning the repository root.

**`network_mode: host` is load-bearing — for the `freelens` service only.** A cluster on a private
range routed through a VPN on the host is out of reach from a bridge network; sharing the host namespace is also how the container reaches the k3s API published on
`127.0.0.1:6443`. The `k3s` service must **not** share it: with the host namespace, flannel builds
its bridge and iptables chains on the host, beside the VPN's own rules. One published loopback
port is all it needs.

**A new workspace package needs `pnpm install --fix-lockfile`.** A plain `pnpm install` adds the
importer without resolving its peers, so `@freelensapp/extensions` links to a `.pnpm` directory that
does not exist. The error is nothing like the cause: `tsc` reports *"this member cannot have an
'override' modifier because its containing class does not extend another class"*, once per member,
because the base class failed to resolve.

**`build/` is a workspace package, not loose files.** pnpm 12.3.4 writes broken root-level symlinks
for any package with a peer-dependency suffix: `node_modules/vite` points at `.pnpm/vite@7.3.6/...`
while the real directory is `vite@7.3.6_@types+node@22.20.1`. Links inside a workspace package are
correct, so `build/` owns its own `vite` and `electron-vite`. Moving those to root devDependencies
stops the types resolving.

**JSX uses the automatic runtime** (`jsx: "react-jsx"`), mapped onto `global.ReactJsxRuntime`. Under
the classic runtime, a lint autofix turning `import React` into `import type React` drops React from
the bundle and the JSX fails at runtime rather than at build. Do not switch back.

**`files: ["out"]` is mandatory in every manifest.** npm auto-includes what `main` names but knows
nothing about `renderer`, so without it the tarball ships no UI: installs fine, enables fine, does
nothing. `verify-bundles.sh` fails on it.

**A newly installed extension is disabled.** The user enables it from the `⋮` menu. Check this first
when someone reports an extension "not working" after installing. `seed-extensions.mjs` sidesteps it
in the workbench.

**Named volumes inherit ownership from the image.** A path absent from the image is created as root
and the container runs unprivileged, so create and chown such paths at build time.

**Upstream's example misspells a global.** `freelens-example-extension` maps `react-dom` to
`global.ReactDom`; the host exports `ReactDOM`. Verified against the app bundle.

## Design, one standard

**Every page is built from one set of components, and a package does not restyle them.** The
standard is `.claude/skills/freelens-extension/templates/src/renderer/styles/design.css`; `design.md`
beside the skill says which component when. Each package carries it as `styles/design.css` with its
prefix filled in, written by `scripts/sync-design.sh` and checked by `--check` in `make check` and
CI. Edit the standard, run the script; never edit a copy. A package's own stylesheet holds its
domain only — ArgoCD's status dots, Trivy's severities, cert-manager's validity bar and chain.

Copies, not one shared sheet: extensions are installed separately, and two sharing class names
restyle each other whenever their versions differ. Every layout suite runs `designViolations`
(`build/e2e/design.ts`) on each page, which also fails on a class of ours no stylesheet defines —
what a renamed component leaves behind.

**Every box sits on `--sidebarBackground`, and hover is `--sidebarItemHoverBackground`.** Not
`--layoutBackground`: in the light theme it is the same grey as the surface, so a hover on it
changes nothing.

**What we render into a host page mounts the stylesheet itself.** A `KubeObjectListLayout`, a
details drawer and a dialog have no root of ours above them. The ArgoCD Applications list drew its
status badges without dots for as long as it existed, because only the dashboard mounted the styles.

## Distribution, decided

`.tgz` attached to releases, installed by file path. Nothing goes to npm or any registry,
and every manifest keeps `"private": true` so an accidental publish fails. Do not propose a registry
again without the user raising it, for two verified reasons:

- **Freelens never authenticates.** Its fetches carry only a timeout: no headers, no token, and the
  npmrc setting reads the URL but not credentials. Install-by-name needs anonymous read.
- **GitHub Packages cannot serve extensions**, public or private. Its npm registry demands a token
  for every read; GitHub's own public example returns 401 unauthenticated, where npmjs returns 200.

## Tests

**No mocks, and the layout is what makes that possible.** `@freelensapp/extensions` cannot be
imported outside Electron, so under test it resolves to `test/freelens-host.ts`, which re-exports
the real `KubeObject` and `KubeApi` from the standalone packages. Same substitution `build/vite`
performs in production, pointed somewhere a test process can reach.

**Decisions live apart from store access, for that reason.** When adding something that needs a
store, put the decision in a module that takes plain data and leave the lookup at the boundary. Do
not reach for a mock instead.

| Decides, and is covered | Reads a store or sends a patch, and is excluded |
|-------------------------|--------------------------------------------------|
| `pressure.ts` | `cluster-health.ts` |
| `workload-selection.ts` | `workloads.ts` |
| `patches.ts` | `actions.ts`, `project-actions.ts` |
| `store-state.ts`, `pins.ts`, `persist.ts` (real `node:fs`, in a tmpdir) | `use-argocd-stores.ts` |
| `coverage.ts`, `scan-progress.ts`, `subjects.ts` | `reports.ts`, `use-trivy-stores.ts` |
| `check-link.ts`, `rbac.ts`, `workload-rows.ts`, `installed.ts` (all three) | `use-rbac-stores.ts` |
| `workload-pods.ts`, `workload-filter.ts` | `use-workload-pods.ts` |
| `expiry.ts`, `attention.ts`, `chain.ts`, `issuers.ts`, `unmanaged.ts`, `certificate-filter.ts`, `commands.ts`, `secret-metadata.ts`, `renewal.ts` | `kinds.ts`, `actions.ts`, `use-cert-manager-stores.ts`, `use-tls-inventory.ts` |

**A filter written inline in a page is the one thing nothing can test**, and it decides what an
operator sees. Every extension keeps its own in `api/`.

**Each extension owns its e2e suite**, in `packages/<name>/e2e/`, run by its own `test:e2e` script;
the shared harness is `build/e2e/`, reached by relative path like `build/vite`. `make e2e` runs the
packages one after another — there is one window and one cluster, and two vitest processes driving
the same UI fight. The price of the split is that `namespace-scope.e2e.ts` exists three times, once
per extension, because the defect it guards sat in every hook; change one loading path and try all three.

**The e2e suite must not inherit state, and a new test has to fail without its fix.** Freelens
remembers which sidebar groups are open, and it starts scoped to one namespace — under which every
page in both extensions renders its empty state. A suite that reads whatever the last run left
behind passes for the wrong reason: the first `pages-render.e2e.ts` widened the scope before our
pages mounted, which is exactly what hides a page that never reloads its stores, and it passed
against that bug. Check a new test by reverting the fix.

**A store's `isLoaded` says a list arrived once, not that it was listed under the namespaces in
scope now.** These stores are shared with the rest of Freelens, so a hook that skips loading because
the store is already loaded shows whatever scope some other page's first mount fetched, for the life
of the process. Every hook loads on mount and retries only while something has never loaded.

**Anything time-dependent takes `now` as a parameter** (`getAttentionItems`, `getRepeatedSyncs`,
`getPressure`, `isRenewalOverdue`). Tests pass `fixtureNow()`, so "recently" keeps meaning what it
meant when the fixtures were taken rather than decaying into failure. cert-manager's `fixtureNow()`
reads `exported-at.json` rather than the newest timestamp: its objects carry times the cluster
writes once, and the newest can be the instant a renewal fell due — from which none is ever late.

**Fixtures are real cluster contents** (`scripts/export-fixtures.sh`), from the development k3s
and nowhere else: the repository is public, and a real cluster's reports are its open CVEs, its
roles and its inventory. The script refuses any cluster whose node is not `freelens-addons-dev`.
A state the tests need that the cluster lacks is caused in `seed-cluster.sh`, as the failing
renewal, the drift and the deploy history are. Never hand-write one to make a test pass: every bug
that reached production here was a shape an author would not have thought to write.

**Coverage is 95% across `src/renderer/api/`.** If a change drops below, add the case. Do not lower
the threshold or widen the exclusions. [docs/testing.md](docs/testing.md) has the reasoning.

## Supply chain and CI

Standing constraints the user asked for, not defaults to revisit.
[docs/security.md](docs/security.md) has the reasoning.

| Control | Rule |
|---------|------|
| Age floor | Nothing younger than 15 days: `minimumReleaseAge: 21600` with `minimumReleaseAgeStrict`. Declare **ranges**, not pins, so the floor chooses. When nothing in range clears it, wait or widen — never lower the floor. |
| Lifecycle scripts | Opt-in per package, in `allowBuilds` |
| Pinning | Base images by digest, downloaded binaries against a committed checksum, no vendor script piped into a shell |
| Credentials | `.env.example` holds placeholders only; real paths live in git-ignored `.env` |

**No third-party GitHub Actions.** The user does not want someone else's code running with the
workflow's context. Scanners run as digest-pinned containers via `docker run`; the only actions are
GitHub's own, pinned to commit SHAs. When adding a check, add an image, not an action.

**A vulnerability is fixed, not silenced.** There is no exception list: a transitive package
carrying an advisory is pinned forward in `overrides` in `pnpm-workspace.yaml`. Only when that is
impossible, record it with a written reason and an `effectiveUntil`. Never a blanket ignore.

**`verify-supply-chain.sh` guards the controls themselves** — the age floor, opt-in build scripts,
digest pinning, SHA-pinned actions, and that any exception carries a reason and an unexpired date.
Weakening a control is meant to fail CI. Do not edit the script to make a build pass.

**Trivy on the Freelens image reports but does not block.** Its CVEs live in Electron and Chromium,
only a Freelens release can fix them, and a permanently red CI teaches people to ignore it. Do not
"fix" this by making it blocking.

## Versions that look stale but are not

| Pin | Why |
|-----|-----|
| react, @types/react on 17 | Freelens 1.10.3 bundles `react ^17.0.2` and shares it as `global.React` |
| vite on 7 | `electron-vite@5` declares `vite ^5 \|\| ^6 \|\| ^7` |
| @types/node on 24 | Matches the Node in the container |

## Commands

`make cluster` (k3s up and seeded; then point `KUBECONFIG_PATH` in `.env` at
`/tmp/freelens-addons-k3s/kubeconfig.yaml`), `make up` (build, then start or restart), `make down`,
`make test`, `make e2e` (every package, one after another, against a running Freelens), `make check`
(what CI runs minus the scanners), `make cluster-down` (volume included). Everything else is a
script or a compose command, listed in [docs/development.md](docs/development.md#commands).
Everything runs in Docker; do not run pnpm or Node on the host.

**A new extension starts from the `freelens-extension` skill** (`.claude/skills/freelens-extension/`),
not from copying a package. The skill is generic: it reads a repository's conventions — this file,
the docs, the existing packages — before writing anything, and its templates are only what the
Freelens loader demands. Here that means the shared `build/vite` config, the `packages/` layout,
the fixtures script and the e2e harness. It was proven by scaffolding a throwaway extension through
`pnpm install --fix-lockfile`, `make check`, a real `make up` and its own e2e file.

## Documentation style

English. Files in `docs/` carry frontmatter `title`/`description` and open with a `## Contents`
index. Prefer tables and short topics over paragraphs. Say what a thing does rather than selling it.

**Every extension gets `docs/<name>.md`**, added with the extension, not after. One page in the
same shape: what it is for in a sentence, what it shows, what it will not do. The README is
routing — the repository's purpose, the extensions and their status, how to install, how to
develop, and links to everything else. It does not explain an extension.

**Diagrams, not screenshots.** Mermaid renders on GitHub, survives a redesign, and carries no
cluster contents — a screenshot of a real cluster is the owner's namespaces, workloads and
repository, and blurring it leaves nothing worth showing.

**No cluster-specific figures in prose.** "105 workloads", "52 Applications", a cluster or node
name: they date instantly and they describe someone's estate. Say what the rule is instead.
