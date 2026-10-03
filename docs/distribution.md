---
title: "Distribution"
description: "How an extension is packaged, installed, enabled and released"
---

# Distribution

Each extension ships as a `.tgz` attached to a GitHub release and is installed by file path. Nothing
is published to a registry.

## Contents

- [What ships](#what-ships)
- [Installing a release](#installing-a-release)
- [Enabling an extension](#enabling-an-extension)
- [Cutting a release](#cutting-a-release)
- [Why not a registry](#why-not-a-registry)
- [The files field](#the-files-field)

## What ships

| Path in the tarball | What it is |
|---------------------|------------|
| `package/package.json` | The manifest: entrypoints and `engines.freelens` |
| `package/out/main/index.js` | Main-process bundle, plus sourcemap |
| `package/out/renderer/index.js` | Renderer bundle, plus sourcemap |
| `package/LICENSE` | Apache 2.0 |

The tarball has no sources, configuration or `dependencies`. The extension API, React and MobX come
from the host as globals.

Build them with:

```bash
docker compose -f dev/docker-compose.yml --project-directory . \
  run --rm --no-deps --entrypoint sh -w /workspace freelens \
  -lc "pnpm run -r build && bash scripts/pack.sh"
```

## Installing a release

Download the `.tgz` from the release. `sha256sum -c SHA256SUMS` checks it against the checksum file
attached to the same release. Then, in Freelens:

1. Open File > Extensions (`Ctrl+Shift+E`, `Cmd+Shift+E` on macOS).
2. Put the path to the file in the input and press Install, or drag the file onto that area.
3. The extension appears under *Installed extensions* as Disabled. Enable it as in
   [Enabling an extension](#enabling-an-extension).

Extension pages are per cluster, so connect to a cluster before looking for them in the sidebar.

To install without the window, extract the tarball into `~/.freelens/extensions/<name>/`. Freelens
picks it up while running, disabled:

```bash
mkdir -p ~/.freelens/extensions/freelens-addons-argocd
tar xzf freelens-addons-argocd-0.1.0.tgz --strip-components=1 \
  -C ~/.freelens/extensions/freelens-addons-argocd
```

## Enabling an extension

Every newly installed extension starts disabled, and a disabled extension looks the same as one
that failed to load.

1. Open File > Extensions (`Ctrl+Shift+E`, `Cmd+Shift+E` on macOS).
2. Find it under *Installed extensions* by package name: `@freelens-addons/argocd`,
   `@freelens-addons/cert-manager` or `@freelens-addons/trivy`.
3. Open the `⋮` menu on its row and choose Enable. No restart is needed.
4. Open a cluster and pick "All Namespaces" in any list, such as Pods. Freelens opens scoped to one
   namespace, and the pages are nearly empty until the scope is widened.

The extension's group (ArgoCD, cert-manager or Trivy) then appears in the cluster's sidebar.

When the group is missing:

| What you see | Cause and fix |
|--------------|---------------|
| The extension is not listed on the Extensions page | It was not installed. Install it again and read `~/.config/Freelens/logs/lens.log` for `EXTENSION-INSTALLER` |
| Listed as *Disabled* | Step 3 |
| Enabled, and the group is missing on one cluster but not another | The group shows only on a cluster that runs the tool: `applications.argoproj.io` for ArgoCD, `certificates.cert-manager.io` for cert-manager, any Trivy report CRD for Trivy. Check with `kubectl get crd` |
| The cluster runs the tool and the group is still missing | Your credentials cannot list CRDs. Check with `kubectl auth can-i list customresourcedefinitions` |
| The group is there and its pages are empty | The namespace scope, step 4 |

To remove an extension, choose Uninstall from the same `⋮` menu, or delete its folder under
`~/.freelens/extensions/` if it was installed that way.

## Cutting a release

Push a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yaml` then runs, in order:

| Step | Purpose |
|------|---------|
| Install with the lockfile | Re-checks the 15-day age floor on every entry |
| Build | Produces the bundles |
| `verify-bundles.sh` | The loader contract CI asserts |
| Pack | Writes the `.tgz` files and `SHA256SUMS` |
| Unpack each tarball again | Confirms both entrypoints are in the tarball |
| Attach to a GitHub release | The tarballs and `SHA256SUMS` |

The repository and its releases are public.

## Why not a registry

Every extension manifest keeps `"private": true`, so an accidental `npm publish` fails. `pnpm pack`
is unaffected.

| Registry | Why it is not used |
|----------|--------------------|
| Any authenticated registry | Freelens never authenticates: its registry fetches carry only a timeout, with no headers or token, and its npmrc setting reads only the URL |
| GitHub Packages | Its npm registry requires a token for every read, public packages included |
| npmjs | Would work, since it allows anonymous reads. Not chosen: distribution is release tarballs |

Publishing to npmjs would mean dropping `private` from the extension's `package.json`, adding
`publishConfig: { access: "public" }`, and adding a publish step to the release workflow.

## The files field

npm packs whatever `main` names but knows nothing about the Freelens `renderer` field. Without a
`files` field, and with `out/` in `.gitignore`, the tarball has no renderer bundle and the
extension has no UI. Every extension declares:

```json
"files": ["out"]
```

`scripts/verify-bundles.sh` fails the build when it is missing, and the release workflow re-checks
the packed tarball.
