# CLAUDE.md

Freelens extensions, developed against a containerised Freelens (noVNC) pointed at a disposable
k3s (`make cluster`) or any cluster by kubeconfig.

## Read first

| Where | What is there |
|-------|---------------|
| [README.md](README.md) | The extensions, install, the main commands |
| [docs/](docs/) | Architecture, development and commands, testing, security and supply chain, distribution, one page per extension |
| [.claude/skills/](.claude/skills/) | `freelens-extension`: how to create an extension, the design standard (`design.md`, `templates/.../design.css`). A new extension starts from this skill, not from copying a package |

This file holds only what those do not, plus the rules that must never be broken.

## Never

| Rule | Detail in |
|------|-----------|
| Run pnpm or Node on the host; everything runs in Docker | [docs/development.md](docs/development.md#commands) |
| Lower the 15-day age floor, add a third-party GitHub Action, silence a vulnerability without a reason and `effectiveUntil`, or edit `verify-supply-chain.sh` to make a build pass | [docs/security.md](docs/security.md) |
| Make Trivy on the Freelens image blocking | [docs/security.md](docs/security.md) |
| Propose an npm or GitHub Packages registry unless the user raises it | [docs/distribution.md](docs/distribution.md) |
| Hand-write a fixture, or export one from any cluster but the dev k3s | [docs/testing.md](docs/testing.md) |
| Mock a store; lower the 95% coverage or widen its exclusions | [docs/testing.md](docs/testing.md) |
| Add a test that passes without its fix; let an e2e suite inherit state | [docs/testing.md](docs/testing.md) |
| Edit a package's `styles/design.css`; edit the standard and run `scripts/sync-design.sh` | [design.md](.claude/skills/freelens-extension/design.md) |
| Read Secrets through `secretsStore` | below |
| Put screenshots or cluster-specific figures in docs | below |

## Not written elsewhere

| Fact | Rule |
|------|------|
| A rebuild alone does not reload an extension | `make up` builds and restarts Freelens |
| Sidebar group only with its CRDs | `visible` is a MobX computed over `Renderer.K8sApi.crdStore`, via `isInstalled()` in each `api/installed.ts` |
| The API is not legacy | `Renderer.LensExtension` is the only API, despite the `@freelensapp/legacy-extensions` name. No `Feature`-based API exists |
| Forms in a `ConfirmDialog` | Report values through a callback, never a shared object: the dialog copies plain-object props (`test/dialog-state.test.ts`) |
| Secrets | Read them as a `PartialObjectMetadataList` (`use-tls-inventory.ts`); `secret-metadata.ts` keeps only cert-manager's annotations. `secretsStore` loads every key into the renderer |
| Everything under `packages/` is an extension | A helper package there breaks discovery; shared code goes in `build/` |
| Upstream example misspells a global | It uses `global.ReactDom`; the host exports `ReactDOM` |
| vite stays on 7 | `electron-vite@5` declares `vite ^5 \|\| ^6 \|\| ^7` |
| @types/node stays on 24 | The container's Node |

## Code comments

As few as possible, one line each. Write one only when the reason is not visible in the code and
someone could break it without knowing; never restate the code or tell its history.

## Documentation style

English. `docs/` files carry frontmatter `title`/`description` and open with `## Contents`. Tables
and short topics. An extension page is the idea, a diagram and the features, without explaining the
tool itself. The README only routes. Mermaid diagrams, no screenshots; no counts, cluster or node
names in prose.
