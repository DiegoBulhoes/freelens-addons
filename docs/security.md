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
| Dependency malware and CVEs (OSV against the lockfile, `scripts/security/osv-direct.sh`), before any install | malware at any depth, and a version chosen here; a transitive CVE is a warning |
| Dockerfile lint (hadolint) | yes |
| Bundles (`build/vite/first-party-only.ts` at build, `scripts/checks/verify-bundles.sh` after): the loader contract, and nothing outside each extension's `src/` | yes |
| Image CVEs (Trivy) | no |

Trivy on the image reports without blocking because its CVEs are in Electron and Chromium, which
only a Freelens release can fix.

hadolint's DL3008 ("pin apt versions") is waived with `--ignore DL3008` in the workflow and in
`scripts/security/scan.sh`, with the reason in a comment. Debian's archive keeps only the current version of
a package, so the base image digest pins the package set instead.

## Dependency updates

Updates are made by hand, with no bot. `make deps-refresh` resolves the lockfile again: every
dependency, transitive ones too, moves to the newest version its range allows and the 15-day floor
admits, and only `pnpm-lock.yaml` changes. It resolves in a throwaway copy and promotes the new
lockfile only if the gate passes, so a rejected one never reaches an install. Run it monthly; it is
also how a transitive finding gets fixed. `pnpm update` is not used: under `minimumReleaseAgeStrict` it asks to write
`minimumReleaseAgeExclude`, which the floor forbids.

| Held back | Reason |
|-----------|--------|
| `vite` on 7 | electron-vite 5 declares `^5 \|\| ^6 \|\| ^7` |
| `@types/node` | Tracks the Node in the containers |
| `react` on 17 | The host supplies it as a global |

## Vulnerabilities

`scripts/security/osv-direct.sh` runs OSV-Scanner on the whole lockfile before anything installs
it: first in CI, first in the release workflow, in `make check`, and in `make deps-refresh` between
resolving and installing. It decides per finding:

| Finding | Blocks |
|---------|--------|
| Known malware (`MAL-` advisory, or CWE-506), at any depth. Judged in a second pass without `osv-scanner.toml`, so no exception can hide it | yes |
| A version this repository chooses: a `name@version` an importer of the lockfile declares (pnpm included, through `packageManager`), an override target, or `rollup` and `esbuild`, whose generated code ships in every bundle | yes |
| Any other transitive development dependency | no, printed as a warning |
| The scanner failing, printing no report, reading no package, or the importers reading as empty | yes |

Why a transitive finding only warns: what users install carries no third-party code. A build fails
when its module graph, its watched files (CSS reached by `@import` or `url()`) or its remaining
`require()`s reach anything outside the extension's `src/` besides the host's globals, `electron`
and Node's own modules (`build/vite/first-party-only.ts`). `verify-bundles.sh` fails a bundle whose
source map does, an `out/` with any other file, and a `package.json` with runtime dependencies,
which Freelens would install on each user's machine with no lockfile, floor or scan. Such a finding is in tooling, which does run here, at build and
test time: vite, vitest and jsdom, and the host packages `build/vite/global-externals.ts` loads to
list their exports. Malware there blocks; an ordinary advisory waits for the next
`make deps-refresh`, or for its parent's release when the parent's range excludes the fix. No
override is added for a transitive advisory: a list of pins nobody keeps is the cost this avoids.

Two overrides from before that rule remain in `pnpm-workspace.yaml`; each makes its package a
version chosen here, so a later advisory against it blocks:

| Override | Arrived under |
|----------|---------------|
| `dompurify: 3.4.16` | `monaco-editor` pins 3.1.7 |
| `decode-uri-component: 0.5.0` | `query-string` pulled in 0.2.2 |

A finding that blocks with no fixed release, or none past the age floor yet, goes in
`osv-scanner.toml` as one `[[IgnoredVulns]]` per advisory, with a `reason` and an `ignoreUntil`;
never per version, which would also hide what is published against it later.
`scripts/security/verify-supply-chain.sh` reads `osv-scanner.toml` with a closed grammar (anything
but those three keys in such tables fails), and fails on a `MAL-` exception and from an expiry day
on. It reads every workflow as data, through a digest-pinned `yq`, and fails when a workflow that
installs does not run the gate, when anything but `actions/checkout` runs before it, when the gate
step or its job sets `if`, `continue-on-error`, `defaults`, `container` or anything besides `name`
and `run`, when a job does not wait on the gate's job or can run after it failed, when
`OSV_SCANNER` is set anywhere but the top-level `env` or to another digest than `scan.sh`'s, and
when a `docker://` action is not pinned. It then runs the gate on probe lockfiles: malware, malware
with an exception for it, a declared version, an override target, a bundler, and an ordinary
transitive finding, which alone must pass.

## Credentials

- The kubeconfig is mounted read-only. Its path lives in `.env`, which is git-ignored.
- `.env.example` holds placeholders only.
- `FIXTURE_REDACT_DOMAINS` in `.env` keeps private hostnames out of exported test fixtures.
- Nothing in the repository refers to a location on a developer's machine.

## Running the checks locally

```bash
make check              # the dependency gate, lint, typecheck, test, build, bundles, supply-chain policy
bash scripts/security/scan.sh    # gitleaks, OSV, hadolint: the same digest-pinned images CI uses
```

Both need Docker and `jq` on the host. Keep the digests in `scripts/security/scan.sh` in step with
`.github/workflows/ci.yaml` and `.github/workflows/release.yaml`; the Makefile reads the OSV one
from `scan.sh`, and `verify-supply-chain.sh` fails when the three differ.
