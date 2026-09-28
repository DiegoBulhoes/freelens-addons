---
title: "Security"
description: "Supply-chain controls, what CI enforces, and how assessed findings are excepted"
---

# Security

This workbench downloads a desktop application, a Node toolchain and ~570 npm packages, then
points the result at a production cluster. The controls below exist because each of those is a way
in.

## Contents

- [Dependency age floor](#dependency-age-floor)
- [Lifecycle scripts](#lifecycle-scripts)
- [Pinning](#pinning)
- [Third-party code in CI](#third-party-code-in-ci)
- [What CI enforces](#what-ci-enforces)
- [Dependency updates](#dependency-updates)
- [Vulnerabilities](#vulnerabilities)
- [Credentials](#credentials)
- [Running the checks locally](#running-the-checks-locally)

## Dependency age floor

**No version published less than 15 days ago is ever installed.** Compromised releases of popular
packages are typically found and yanked within days, so waiting removes most of that exposure at
almost no cost.

```yaml
minimumReleaseAge: 21600            # minutes
minimumReleaseAgeStrict: true       # fail, rather than resolve something younger
minimumReleaseAgeIgnoreMissingTime: false
```

**Declare dependencies as ranges, not exact pins,** so the floor does the choosing. pnpm takes the
newest version that clears it and the lockfile records the result.

**An install that fails because nothing in range clears the floor is the policy working.** Wait, or
widen the range. Never lower the floor, and never add `minimumReleaseAgeExclude`; CI fails if
either happens.

**It is enforced on every run, not just when a dependency is added.**
`pnpm install --frozen-lockfile` re-checks every lockfile entry.

## Lifecycle scripts

pnpm blocks dependency lifecycle scripts unless named in `allowBuilds`, as `true` or `false`, and
refuses to stay quiet about an unlisted one. A new native dependency is therefore a decision
someone records, not a warning in a log.

| Package | Allowed | Why |
|---------|---------|-----|
| `esbuild` | yes | Resolves the platform binary Vite transpiles with |
| `electron` | no | Arrives transitively through `@freelensapp/core`; the Electron that runs is the one inside the Freelens container |
| `node-pty` | no | Same route, and nothing here uses a terminal |

## Pinning

| What | How |
|------|-----|
| Container base images | By `sha256` digest, not by tag |
| Freelens `.deb` | `sha256sum -c` against a checksum committed to this repo |
| pnpm | `packageManager` with corepack's integrity hash |
| GitHub Actions | By commit SHA, never by tag |
| Scanner images | By `sha256` digest |

Nothing pipes a downloaded script into a shell: Node is copied out of the official image rather
than installed by a vendor script.

Bumping `FREELENS_VERSION` requires bumping `FREELENS_SHA256` with it. The published checksum sits
next to the release asset as `<asset>.sha256`; the image build fails on a mismatch.

## Third-party code in CI

The scanners run as digest-pinned containers rather than as third-party GitHub Actions.

| | What it gets |
|---|---|
| A third-party action | Someone else's code inside the workflow, with its context and token |
| A digest-pinned image | Exactly the reviewed bytes, with a read-only mount |

The only actions used are GitHub's own, `actions/checkout` and `actions/setup-node`, both pinned to
commit SHAs and both with `persist-credentials: false`. Workflow permissions default to
`contents: read`. When adding a check, add an image, not an action.

## What CI enforces

| Check | Blocks? | Why |
|-------|---------|-----|
| Supply-chain policy (`scripts/verify-supply-chain.sh`) | yes | Guards the controls themselves, so weakening one is a red build rather than a quiet YAML edit |
| Secret scan (gitleaks, full history) | yes | A leaked kubeconfig or token is ours to prevent |
| Dependency CVEs (OSV against the lockfile) | yes | These are dependencies we chose and can move |
| Dockerfile lint (hadolint) | yes | Our Dockerfiles, our fix |
| Bundle contract (`scripts/verify-bundles.sh`) | yes | Every way of breaking the loader fails silently at runtime |
| Image CVEs (Trivy) | **no** | The image carries Electron and Chromium, whose CVEs only a Freelens release can fix; failing on them would leave CI permanently red and train people to ignore it |

`hadolint`'s DL3008 ("pin apt versions") is waived with `--ignore DL3008`, in both the workflow and
`scripts/scan.sh`, with the reason in a comment beside it. Debian's archive keeps only the current
version of a package, so a pinned version stops resolving as soon as the distribution moves. The
package set is pinned by the base image digest instead, which actually holds.

## Dependency updates

There is no bot proposing them. Updates are made by hand, which means the age floor is enforced at
install rather than negotiated in a pull request: `pnpm update` resolves to the newest version
clearing 15 days, and anything younger fails outright.

Two dependencies are held back by a constraint no waiting period fixes: `vite` cannot go to 8 while
electron-vite 5 declares `^5 || ^6 || ^7`, and `@types/node` has to track the Node in the
containers. `react` stays on 17 because the host supplies it as a global.

## Vulnerabilities

**There is no exception list.** The OSV scan blocks on anything it finds, and nothing is configured
to look away.

A transitive package carrying an advisory is pinned forward to the fixed version in
`pnpm-workspace.yaml` instead:

| Override | Arrived under | Fixes |
|----------|---------------|-------|
| `dompurify: 3.4.14` | `monaco-editor` pulled in 3.1.7 | 20 advisories. `@freelensapp/core` already depended on 3.4.14 directly, so this deduplicates onto a version already in the tree. |
| `decode-uri-component: 0.5.0` | `query-string` pulled in 0.2.2 | GHSA-vcc3-ghjq-m6fr |

Neither ever executes here: `@freelensapp/extensions` is a devDependency so `tsc` can read the
host's types, and the built extensions declare no runtime dependencies at all. Pinning them
forward, rather than excepting them, keeps the scan something to read rather than something to
configure around.

If a finding ever cannot be fixed this way, record it with a reason and an expiry rather than a
blanket ignore. `scripts/verify-supply-chain.sh` checks that every exception carries both, and
fails once an expiry passes.

## Credentials

- The kubeconfig is mounted **read-only**, and its path lives in `.env`, which is git-ignored.
- `.env.example` holds placeholders only, never a real path.
- `FIXTURE_REDACT_DOMAINS` in the same file keeps private hostnames out of exported test fixtures.
- Nothing in the repository refers to a location on a developer's machine.

## Running the checks locally

```bash
make check              # lint, typecheck, test, build, bundle contract, supply-chain policy
bash scripts/scan.sh    # gitleaks, OSV, hadolint: the same digest-pinned images CI uses
```

Keep the digests in `scripts/scan.sh` in step with `.github/workflows/security.yaml`, or a clean
local run stops meaning a green CI.
