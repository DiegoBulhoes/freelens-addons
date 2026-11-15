# CLAUDE.md

Freelens 2.x extensions, developed against a containerised Freelens (noVNC) pointed at a disposable
k3s (`make cluster`) or any cluster by kubeconfig.

## Read first

| Where | What is there |
|-------|---------------|
| [README.md](README.md) | The extensions, install, the main commands |
| [docs/general/](docs/general/) | Architecture, development and commands, testing, security and supply chain, distribution |
| [docs/extensions/](docs/extensions/) | One page per extension |
| [.claude/skills/](.claude/skills/) | `freelens-extension`: how to create an extension, the design standard (`design.md`, `templates/.../design.css`). A new extension starts from this skill, not from copying a package |

This file holds only what those do not, plus the rules that must never be broken.

## Never

| Rule | Detail in |
|------|-----------|
| Run pnpm or Node on the host; everything runs in Docker | [docs/general/development.md](docs/general/development.md#commands) |
| Lower the 15-day age floor; add a third-party GitHub Action; add an `osv-scanner.toml` entry without a `reason` and an expiry, or for a version instead of an advisory; add an override for a transitive advisory; edit `verify-supply-chain.sh`, `osv-direct.sh` or `first-party-only.ts` to make a build pass | [docs/general/security.md](docs/general/security.md) |
| Make Trivy on the Freelens image blocking | [docs/general/security.md](docs/general/security.md) |
| Propose an npm or GitHub Packages registry unless the user raises it | [docs/general/distribution.md](docs/general/distribution.md) |
| Hand-write a fixture, or export one from any cluster but the dev k3s | [docs/general/testing.md](docs/general/testing.md) |
| Mock a store; lower the 95% coverage or widen its exclusions | [docs/general/testing.md](docs/general/testing.md) |
| Add a test that passes without its fix; let an e2e suite inherit state | [docs/general/testing.md](docs/general/testing.md) |
| Edit a package's `styles/design.css`; edit the standard and run `scripts/checks/copy-design-standard.sh` | [design.md](.claude/skills/freelens-extension/design.md) |
| Read Secrets through `secretsStore` | below |
| Put screenshots or cluster-specific figures in docs | below |

## Not written elsewhere

| Fact | Rule |
|------|------|
| A rebuild alone does not reload an extension | `make up` builds and restarts Freelens |
| Sidebar group only with its CRDs | `visible` is a MobX computed over `Renderer.K8sApi.crdStore`, via `isInstalled()` in each `api/shared/installed.ts` |
| The API | `Main.LensExtension` and `Renderer.LensExtension` from `@freelensapp/extensions` 2.x are the only API. No `Feature`-based API exists |
| Forms in a `ConfirmDialog` | Report values through a callback, never a shared object: the dialog copies plain-object props (`packages/argocd/test/shared/dialog-state.test.ts`) |
| Secrets | Read them as a `PartialObjectMetadataList` (`use-tls-inventory.ts`); `secret-metadata.ts` keeps only cert-manager's annotations. `secretsStore` loads every key into the renderer |
| Everything under `packages/` is an extension | A helper package there breaks discovery; shared code goes in `build/` |
| A page registration | `Page` is a plain arrow, `(props) => <X {...props} />`: the host wraps it in `observer`, and an `observer` passed there fails the route registration |
| The renderer has no Node | File and process work lives in main, reached over `Main.Ipc`/`Renderer.Ipc` (argocd's state file); the build refuses a builtin or `electron` in the renderer |
| `FREELENS_VERSION` in `.env` | Overrides the compose default; the dev image and the e2e suites run that Freelens |
| Host globals | Every host module comes from `globalThis.FreelensExtensionApi` (`ReactDom`, not `ReactDOM`); `build/vite/global-externals.ts` maps them |

## Consistent styles

Before building or changing a screen, look at how the other extensions and the host's own lists
draw the same thing, and match them. Reuse the host's components (`Checkbox`, `MenuActions`,
`Drawer`, `ConfirmDialog`) rather than a native element, and the standard's components rather than
new CSS. A difference from the others is a bug unless the user asked for it.

## Code comments

As few as possible, one line each. Write one only when the reason is not visible in the code and
someone could break it without knowing; never restate the code or tell its history.

## Documentation style

English. `docs/` files carry frontmatter `title`/`description` and open with `## Contents`. Tables
and short topics. An extension page is the idea, a diagram and the features, without explaining the
tool itself. The README only routes. Mermaid diagrams, no screenshots; no counts, cluster or node
names in prose.
