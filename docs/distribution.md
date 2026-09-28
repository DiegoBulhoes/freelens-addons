---
title: "Distribution"
description: "How an extension reaches someone else's Freelens, and how a release is cut"
---

# Distribution

Freelens installs an extension from an npm-style tarball. Nothing about the development workbench
is involved: what a user installs is a self-contained `.tgz` carrying the built bundles and the
manifest.

This repository ships private tarballs attached to GitHub releases and publishes to no registry.
[Why not npm](#why-not-npm) has the reasoning.

## Contents

- [What ships](#what-ships)
- [Installing a release](#installing-a-release)
- [Enabling an extension](#enabling-an-extension)
- [Cutting a release](#cutting-a-release)
- [Why not npm](#why-not-npm)
- [GitHub Packages](#github-packages)
- [The packaging trap](#the-packaging-trap)

## What ships

| Path in the tarball | What it is |
|---------------------|------------|
| `package/package.json` | The manifest: entrypoints and `engines.freelens` |
| `package/out/main/index.js` | Main-process bundle, plus sourcemap |
| `package/out/renderer/index.js` | Renderer bundle, plus sourcemap |
| `package/LICENSE` | Apache 2.0 |

Nothing else. No sources, no configuration, no `dependencies`. The extension API, React and MobX
all come from the host as globals, so the tarball is a few kilobytes and has no install-time
dependency resolution to go wrong.

Build them with:

```bash
docker compose -f dev/docker-compose.yml --project-directory . \
  run --rm --no-deps --entrypoint sh -w /workspace freelens \
  -lc "pnpm run -r build && bash scripts/pack.sh"
```

## Installing a release

Download the `.tgz` from the release, then in Freelens:

1. **File > Extensions** (`Ctrl+Shift+E`, `Cmd+Shift+E` on macOS).
2. Put the path to the downloaded file in the input and press **Install**, or drag the file onto
   that area.
3. The extension appears under *Installed extensions* as **Disabled**. Enable it: see
   [Enabling an extension](#enabling-an-extension).

Two things catch people here:

- **Step 3 is not optional.** Freelens registers a newly installed extension disabled, and one that
  is installed but disabled looks exactly like one that failed to load.
- **Extension pages are per-cluster.** Connect to a cluster before looking for them in the sidebar.

`SHA256SUMS` accompanies each release. `sha256sum -c SHA256SUMS` checks a download before
installing it.

To install without the window, extract a tarball into `~/.freelens/extensions/<name>/`. Freelens
watches that folder and picks the extension up while it runs, disabled like any other:

```bash
mkdir -p ~/.freelens/extensions/freelens-addons-argocd
tar xzf freelens-addons-argocd-0.1.0.tgz --strip-components=1 \
  -C ~/.freelens/extensions/freelens-addons-argocd
```

## Enabling an extension

Every newly installed extension starts disabled, whichever way it was installed.

1. **File > Extensions** (`Ctrl+Shift+E`, `Cmd+Shift+E` on macOS).
2. Find it under *Installed extensions*, by its package name: `@freelens-addons/argocd`,
   `@freelens-addons/cert-manager` or `@freelens-addons/trivy`.
3. Open the `⋮` menu on its row and choose **Enable**. The state changes to *Enabled* at once; no
   restart is needed.
4. Open a cluster, and pick "All Namespaces" in any list, Pods for instance. Freelens opens scoped
   to one namespace, and the pages read nearly empty until the scope is widened.

The extension's group then sits in the cluster's sidebar: ArgoCD, cert-manager or Trivy.

When the group is not there:

| What you see | Why, and what to do |
|--------------|---------------------|
| The extension is not listed on the Extensions page | It was not installed. Install it again and read `~/.config/Freelens/logs/lens.log` for `EXTENSION-INSTALLER` |
| Listed as *Disabled* | Step 3 |
| Enabled, and the group is missing on one cluster but not another | The group shows only on a cluster that runs the tool: `applications.argoproj.io` for ArgoCD, `certificates.cert-manager.io` for cert-manager, any Trivy report CRD for Trivy. `kubectl get crd` answers it |
| The cluster runs the tool and the group is still missing | Your credentials cannot list CRDs, which is how the group decides. `kubectl auth can-i list customresourcedefinitions` answers it |
| The group is there and its pages are empty | The namespace scope, step 4 |

To remove one, choose **Uninstall** from the same `⋮` menu, or delete its folder under
`~/.freelens/extensions/` if it was installed that way.

## Cutting a release

Push a tag:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yaml` then runs these steps in order:

| Step | Why it is there |
|------|-----------------|
| Install with the lockfile | Re-checks the 15-day age floor on every entry |
| Build | Produces the bundles that get packed |
| `verify-bundles.sh` | The same loader contract CI asserts |
| Pack | Writes the `.tgz` files and `SHA256SUMS` |
| Unpack each tarball again | Confirms both entrypoints survived packing |
| Attach to a GitHub release | The tarballs and `SHA256SUMS` |

The extra unpack exists because a release that cannot load is worse than no release, and the
failure it guards against is invisible until someone tries to install it. See
[The packaging trap](#the-packaging-trap).

The repository is public, and so are its releases: anyone can download a tarball and check it against `SHA256SUMS`.

## Why not npm

Decided: release tarballs only. Nothing is published to a registry, and every extension
manifest keeps `"private": true`, so an accidental `npm publish` fails rather than leaking the
package. `pnpm pack` is unaffected by it.

| | Release tarballs | Publishing to npmjs |
|---|---|---|
| How a user installs | By file path | By package name |
| Update notification | None | Freelens checks the registry |
| Who can read it | Anyone with repository access | Anyone at all |
| CI needs | Nothing extra | A publish token with provenance |
| Scope to hold | None | `@freelens-addons`, currently unclaimed |

Should that change, the route is: drop `private` from the extension's `package.json`, add
`publishConfig: { access: "public" }`, and add a publish step to the release workflow. It has to be
npmjs, for the reasons in the next section.

## GitHub Packages

GitHub hosts an npm registry at `https://npm.pkg.github.com`, and a package there can be private.
It still cannot serve extensions, for two independent reasons.

**Freelens never authenticates.** Preferences lets you change where it looks: the default registry,
a custom URL, or npmrc, which shells out to `pnpm config get registry` and reads only the URL, with
`npm*` variables stripped from the environment on purpose. But both halves of an install by name,
the metadata request and the tarball download, build their fetch options with nothing but a
timeout:

```js
const fetchOpts = {};
if (opts?.timeout) { fetchOpts.signal = withTimeout(opts.timeout).signal; }
result = await proxyFetch(url, fetchOpts);
```

No headers, no `Authorization`, no npmrc token.

**GitHub Packages requires a token even for public packages.** Unlike the container registry, its
npm registry has no anonymous read at all. GitHub's own public example package answers an
unauthenticated request with a 401:

```console
$ curl -s https://npm.pkg.github.com/@codertocat%2Fhello-world-npm
{"error":"authentication token not provided"}

$ curl -s -o /dev/null -w '%{http_code}\n' https://registry.npmjs.org/@freelensapp%2Ffluxcd-extension
200
```

So a package published there, public or private, is one Freelens cannot install by name. The
tarball would still have to be fetched with credentials outside the app and installed by file path,
which is the same manual step as downloading a release asset with more setup around it. GitHub
Releases already gives private, versioned, checksummed tarballs.

The choice is binary: private distribution means installing from a file, and install by name means
a registry that is readable anonymously, which in practice means npmjs.

## The packaging trap

npm includes whatever `main` points at, automatically. It knows nothing about `renderer`, which is
a Freelens-specific manifest field. With `out/` in `.gitignore` and no `files` field, `pnpm pack`
produces a tarball containing the main bundle and no renderer bundle at all. That extension
installs cleanly, enables cleanly, and has no user interface whatsoever.

Every extension therefore declares:

```json
"files": ["out"]
```

`scripts/verify-bundles.sh` fails the build when it is missing, and the release workflow re-checks
the packed tarball. This was a real defect, found by packing an extension and reading what came
out.
