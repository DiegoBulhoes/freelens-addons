---
title: "Security"
description: "Supply-chain controls, what CI enforces, and how vulnerabilities are handled"
---

# Security

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

No version published less than 15 days ago is installed, since compromised releases are usually
found and yanked within days.

```yaml
minimumReleaseAge: 21600            # minutes
minimumReleaseAgeStrict: true       # fail, rather than resolve something younger
minimumReleaseAgeIgnoreMissingTime: false
```

| Rule | Detail |
|------|--------|
| Declare ranges, not exact pins | pnpm picks the newest version that clears the floor and the lockfile records it |
| Nothing in range clears the floor | Wait, or widen the range |
| Never lower the floor or add `minimumReleaseAgeExclude` | CI fails if either happens |
| Checked on every install | `pnpm install --frozen-lockfile` re-checks every lockfile entry |

## Lifecycle scripts

pnpm runs a dependency's lifecycle scripts only when `allowBuilds` names it as `true`, and reports
any package not listed there.

| Package | Allowed | Reason |
|---------|---------|--------|
| `esbuild` | yes | Resolves the platform binary Vite transpiles with |
| `electron` | no | Arrives transitively through `@freelensapp/core`; the Electron that runs is the one inside the Freelens container |
| `node-pty` | no | Same route, and nothing here uses a terminal |

## Pinning

| What | How |
|------|-----|
| Container base images | By `sha256` digest |
| Freelens `.deb` | `sha256sum -c` against a checksum committed to this repo |
| pnpm | `packageManager` with corepack's integrity hash |
| GitHub Actions | By commit SHA |
| Scanner images | By `sha256` digest |

No downloaded script is piped into a shell. Node is copied out of the official image.

Bump `FREELENS_SHA256` together with `FREELENS_VERSION`. The published checksum sits next to the
release asset as `<asset>.sha256`, and the image build fails on a mismatch.

## Third-party code in CI

No third-party GitHub Actions are used, so no outside code runs with the workflow's context and
token. Scanners run as digest-pinned containers with a read-only mount.

The only actions are GitHub's `actions/checkout` and `actions/setup-node`, pinned to commit SHAs
with `persist-credentials: false`. Workflow permissions default to `contents: read`. To add a check,
add an image.

## What CI enforces

| Check | Blocks |
|-------|--------|
| Supply-chain policy (`scripts/security/verify-supply-chain.sh`), which guards the controls on this page | yes |
| Secret scan (gitleaks, full history) | yes |
| Dependency CVEs (OSV against the lockfile) | yes |
| Dockerfile lint (hadolint) | yes |
| Bundle contract (`scripts/checks/verify-bundles.sh`) | yes |
| Image CVEs (Trivy) | no |

Trivy on the image reports without blocking because its CVEs are in Electron and Chromium, which
only a Freelens release can fix.

hadolint's DL3008 ("pin apt versions") is waived with `--ignore DL3008` in the workflow and in
`scripts/security/scan.sh`, with the reason in a comment. Debian's archive keeps only the current version of
a package, so the base image digest pins the package set instead.

## Dependency updates

Updates are made by hand, with no bot. `pnpm update` resolves to the newest version older than 15
days.

| Held back | Reason |
|-----------|--------|
| `vite` on 7 | electron-vite 5 declares `^5 \|\| ^6 \|\| ^7` |
| `@types/node` | Tracks the Node in the containers |
| `react` on 17 | The host supplies it as a global |

## Vulnerabilities

The OSV scan blocks on any finding. A transitive package with an advisory is pinned forward to the
fixed version in `overrides` in `pnpm-workspace.yaml`:

| Override | Arrived under |
|----------|---------------|
| `dompurify: 3.4.14` | `monaco-editor` pulled in 3.1.7 |
| `decode-uri-component: 0.5.0` | `query-string` pulled in 0.2.2 |
| `brace-expansion: 1.1.21` | `minimatch` pulled in 1.1.18 |
| `fast-uri: 3.1.8` | `ajv` pulled in 3.1.7 |
| `ip-address: 10.7.1` | `socks` pulled in 10.7.0 |
| `moment: 2.31.0` | `@freelensapp/*` and `chart.js` pulled in 2.30.1 |

None runs here: `@freelensapp/extensions` is a devDependency for its types, and the built
extensions declare no runtime dependencies.

When no fixed release exists, or none clears the age floor yet, the finding goes in
`osv-scanner.toml` with a reason and an `effectiveUntil`. `scripts/security/verify-supply-chain.sh` fails
on an exception missing either, and once an expiry passes.

## Credentials

- The kubeconfig is mounted read-only. Its path lives in `.env`, which is git-ignored.
- `.env.example` holds placeholders only.
- `FIXTURE_REDACT_DOMAINS` in `.env` keeps private hostnames out of exported test fixtures.
- Nothing in the repository refers to a location on a developer's machine.

## Running the checks locally

```bash
make check              # lint, typecheck, test, build, bundle contract, supply-chain policy
bash scripts/security/scan.sh    # gitleaks, OSV, hadolint: the same digest-pinned images CI uses
```

Keep the digests in `scripts/security/scan.sh` in step with `.github/workflows/security.yaml`.
