---
title: "Workbench Architecture"
description: "How Freelens runs in Docker, how it reaches the cluster, and what its extension loader requires of a build"
---

# Workbench Architecture

One container and a pair of bind mounts. It runs Freelens on a virtual X server, publishes it over
noVNC, and carries the toolchain that builds the extensions. The directory holding the extension
packages is the same directory Freelens reads extensions from, so building and installing are one
step.

## Contents

- [Containers](#containers)
- [Why network_mode: host](#why-network_mode-host)
- [The extensions directory is the workspace](#the-extensions-directory-is-the-workspace)
- [What the loader requires](#what-the-loader-requires)
  - [The manifest](#the-manifest)
  - [The default export must be a class](#the-default-export-must-be-a-class)
  - [Host modules are globals, not modules](#host-modules-are-globals-not-modules)
  - [The symlink Freelens does not create](#the-symlink-freelens-does-not-create)
- [Build pipeline](#build-pipeline)
- [Things that bite](#things-that-bite)

## Containers

One service, `freelens`, built from `dev/freelens`. It carries Xvfb, openbox, x11vnc,
websockify and Freelens itself, plus the Node and pnpm that build the extensions.

| Command | What runs |
|---------|-----------|
| `docker compose up` | The entrypoint, so the app |
| `docker compose run --entrypoint sh ...` | A build or the tests, in a throwaway container, with the app untouched and not even required to be up |

It exists only for development. What a user installs is a tarball, and no part of this is involved
in that.

The entrypoint boots in this order, and each step waits for the previous one:

1. `Xvfb` on `:99`, then a wait until it actually answers. Electron fails in confusing ways against
   a half-initialised X server.
2. `openbox`, so windows have a manager.
3. `x11vnc` on `VNC_PORT`, then `websockify` serving noVNC on `NOVNC_PORT`.
4. `seed-extensions.mjs`, which must run before Freelens starts. See
   [The symlink Freelens does not create](#the-symlink-freelens-does-not-create).
5. Freelens in the foreground, under `dbus-run-session`.

## Why network_mode: host

A cluster whose API server sits on a private address reached through a VPN on the host is out of
reach from a container on a bridge network, which has no route to it.

| | Effect |
|---|---|
| Gained | The container inherits the host's route to the cluster |
| Gained | noVNC is published directly on `NOVNC_PORT`, with no port mapping |
| Cost | Port conflicts are now host-wide: `NOVNC_PORT` or `VNC_PORT` already in use fails the start |

## The extensions directory is the workspace

`./packages` is bind-mounted read-only at `~/.freelens/extensions`. Freelens treats every
subdirectory holding a `package.json` as an installed extension, so `packages/argocd` and "the
ArgoCD extension installed in Freelens" are the same thing, and building is also the install step.

The consequence is a hard rule: **everything under `packages/` must be a valid extension.** Freelens
calls `.match()` on `manifest.engines.freelens` without checking it exists, so a helper package
dropped in there throws during discovery. Shared build code lives in `build/`.

## What the loader requires

All four of these fail quietly rather than loudly, which is why they are pinned in shared config
rather than left to each package.

| Requirement | Handled by |
|-------------|------------|
| The manifest declares entrypoints and a matching `engines.freelens` | Each package's `package.json` |
| `.default` is a class | `build/vite/extension-config.ts` (`exports: "named"`) |
| Host libraries are read from globals | `build/vite/global-externals.ts` |
| The extension is symlinked into Freelens' `node_modules` | `dev/freelens/seed-extensions.mjs` |

### The manifest

```json
{
  "main": "out/main/index.js",
  "renderer": "out/renderer/index.js",
  "engines": { "freelens": "^1.10.0" }
}
```

`engines.freelens` must start with `^` or a digit and is coerced to `^MAJOR.MINOR` before being
matched against the running version. An extension failing the match is listed as incompatible.

### The default export must be a class

The loader is, in essence:

```js
const ExtensionClass = require(manifest[process === "main" ? "main" : "renderer"]).default;
const instance = new ExtensionClass(installedExtension);
instance.activate();  // then register(), then enable()
```

Rollup's default `exports: "auto"` turns a lone default export into `module.exports = Class`, which
leaves `.default` undefined. The loader reads an undefined class as "this extension has no code for
this process" and moves on silently. The shared config sets `exports: "named"`.

### Host modules are globals, not modules

Freelens does not make `@freelensapp/extensions` resolvable. It assigns the API to globals on the
process the extension is loaded into:

| Process | Globals |
|---------|---------|
| main | `LensExtensions` (`{ Main, Common }`), `Mobx`, `Pty` |
| renderer | `LensExtensions` (`{ Renderer, Common }`), `Mobx`, `MobxReact`, `React`, `ReactDOM`, `ReactJsxRuntime`, `ReactRouter`, `ReactRouterDom` |

`build/vite/global-externals.ts` rewrites those imports into reads of the globals, materialising the
named exports it discovers from the copy installed as a devDependency. Bundling a second React or
MobX does more than bloat the output: they are singletons shared with the host, and a duplicate
breaks hooks and observability far from the cause.

### The symlink Freelens does not create

Freelens resolves an extension's entrypoints through
`~/.config/Freelens/node_modules/<manifest name>/`, a symlink its installer creates **only** on the
watcher's "add" event, meaning when an extension appears while the app is running. Anything already
mounted at startup never fires that event, so the link is missing and `require` fails with
`Cannot find module`.

`dev/freelens/seed-extensions.mjs` does two things before Freelens starts:

- Creates the link, and registers each extension as enabled. It only adds missing entries, so an
  extension disabled in the UI stays disabled.
- Stamps a migration marker into the state file it creates. Without one, Freelens runs its store
  migrations at boot and discards the seeded state, because a file just created has nothing to
  migrate.

## Build pipeline

`build/vite/extension-config.ts` is the single config every extension re-exports. Per entrypoint it
produces one CommonJS file with a sourcemap:

| Setting | Why |
|---------|-----|
| `exports: "named"` | So `.default` survives, as above |
| Not minified | A stack trace from inside Electron should be readable |
| `electron` and Node builtins external | The host supplies them |
| Dynamic imports inlined | The loader does one `require`, with no chunk loader to resolve |
| Renderer built through the `preload` slot | electron-vite validates a `renderer` config as a web app and refuses to build without an `index.html`, which a library has no reason to own. `preload` is already a CommonJS library build, and this mirrors upstream's `freelens-example-extension`. |

## Things that bite

**Freelens does not hot-reload extension code.** Its watcher reacts to extension directories
appearing and disappearing, not to file contents, and the loaded bundle stays cached for the life of
the process. `make up` builds and restarts.

**Restarting drops the noVNC session.** x11vnc restarts with the container; reload the browser tab.

**Use `resize=scale` in the noVNC URL, not `resize=remote`.** Xvfb has a fixed geometry, so asking
the server to resize does nothing and the desktop is shown cropped behind scrollbars. `scale` fits
the whole screen into the browser window, which is how the URL `make up` prints is formed.

**The upstream example misspells one global.** `freelens-example-extension` maps `react-dom` to
`global.ReactDom`, but the host exports `ReactDOM`. The misspelling resolves to `undefined` at
runtime and only bites an extension that imports react-dom. This repo uses the correct name.

**pnpm 12.3.4 writes broken root-level symlinks** for packages with a peer-dependency suffix. This
is why `build/` is a workspace package that owns `vite` and `electron-vite` rather than loose files
relying on root devDependencies.

**Named volumes inherit ownership from the image.** A path that does not exist in the image is
created as root, and the container runs as an unprivileged user. Both `~/.config/Freelens` and the
pnpm and corepack caches are created and chowned at build time for this reason.
