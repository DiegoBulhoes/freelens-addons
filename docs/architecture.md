---
title: "Workbench architecture"
description: "How Freelens runs in Docker, reaches the cluster, and what its extension loader requires of a build"
---

# Workbench architecture

The `freelens` container runs Freelens on a virtual X server, publishes it over noVNC, and carries
the Node and pnpm that build the extensions. The extension packages are bind-mounted where Freelens
reads extensions, so a build is also the install.

## Contents

- [Containers](#containers)
- [Host networking](#host-networking)
- [The extensions directory is the workspace](#the-extensions-directory-is-the-workspace)
- [What the loader requires](#what-the-loader-requires)
  - [The manifest](#the-manifest)
  - [The default export is a class](#the-default-export-is-a-class)
  - [Host modules are globals](#host-modules-are-globals)
  - [The node_modules symlink](#the-node_modules-symlink)
- [Build pipeline](#build-pipeline)
- [Notes](#notes)

## Containers

The `freelens` service is built from `dev/freelens` and carries Xvfb, openbox, x11vnc, websockify,
Freelens, Node and pnpm. The `k3s` service sits behind the `cluster` profile and is started only by
`make cluster`. Both exist for development only; a user installs a tarball.

| Command | What runs |
|---------|-----------|
| `docker compose up` | The entrypoint, so the app |
| `docker compose run --entrypoint sh ...` | A build or the tests in a throwaway container; the app need not be up |

The entrypoint starts each step after the previous one is ready:

1. `Xvfb` on `:99`, then waits until it answers.
2. `openbox`.
3. `x11vnc` on `VNC_PORT`, then `websockify` serving noVNC on `NOVNC_PORT`.
4. `seed-extensions.mjs`, before Freelens starts (see [The node_modules symlink](#the-node_modules-symlink)).
5. Freelens in the foreground, under `dbus-run-session`.

## Host networking

The `freelens` service uses `network_mode: host` so it inherits the host's route to a cluster
reached through a VPN, which a bridge network cannot reach.

| Effect | Detail |
|--------|--------|
| Route | The container reaches any cluster the host reaches |
| Ports | noVNC is served directly on `NOVNC_PORT`, with no mapping |
| Conflicts | A `NOVNC_PORT` or `VNC_PORT` already in use on the host fails the start |
| k3s | Only `freelens` shares the host network. The `k3s` service publishes one port on `127.0.0.1:6443` and must stay on its own network, or flannel builds its bridge and iptables chains on the host |

## The extensions directory is the workspace

`./packages` is bind-mounted read-only at `~/.freelens/extensions`. Freelens treats every
subdirectory with a `package.json` as an installed extension.

Everything under `packages/` must therefore be a valid extension. Freelens calls `.match()` on
`manifest.engines.freelens` without checking it exists, so a helper package there throws during
discovery. Shared build code lives in `build/`.

## What the loader requires

Each of these fails silently, so each is handled in shared config.

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
  "engines": { "freelens": "^1.10.3" }
}
```

`engines.freelens` must start with `^` or a digit. Freelens coerces it to `^MAJOR.MINOR` and matches
it against the running version; an extension that fails is listed as incompatible.

### The default export is a class

The loader does, in essence:

```js
const ExtensionClass = require(manifest[process === "main" ? "main" : "renderer"]).default;
const instance = new ExtensionClass(installedExtension);
instance.activate();  // then register(), then enable()
```

Rollup's default `exports: "auto"` emits `module.exports = Class`, which leaves `.default` undefined,
and the loader then skips the extension. The shared config sets `exports: "named"`.

### Host modules are globals

Freelens assigns its API and shared libraries to globals in each process:

| Process | Globals |
|---------|---------|
| main | `LensExtensions` (`{ Main, Common }`), `Mobx`, `Pty` |
| renderer | `LensExtensions` (`{ Renderer, Common }`), `Mobx`, `MobxReact`, `React`, `ReactDOM`, `ReactJsxRuntime`, `ReactRouter`, `ReactRouterDom` |

`build/vite/global-externals.ts` rewrites those imports into reads of the globals, taking the named
exports from the copy installed as a devDependency. React and MobX are singletons shared with the
host, so a bundled copy breaks hooks and observability.

### The node_modules symlink

Freelens resolves entrypoints through `~/.config/Freelens/node_modules/<manifest name>/`. Its
installer creates that link only when an extension appears while the app runs, so an extension
mounted at startup has none and `require` fails with `Cannot find module`.

`dev/freelens/seed-extensions.mjs` runs before Freelens starts and:

- creates the link and registers each extension as enabled, adding only missing entries, so an
  extension disabled in the UI stays disabled;
- writes a migration marker into the state file it creates, so Freelens does not run its store
  migrations at boot and discard the seeded state.

## Build pipeline

Every extension re-exports `build/vite/extension-config.ts`. It produces one CommonJS file with a
sourcemap per entrypoint.

| Setting | Reason |
|---------|--------|
| `exports: "named"` | Keeps `.default` |
| Not minified | Readable stack traces from Electron |
| `electron` and Node builtins external | The host supplies them |
| Dynamic imports inlined | The loader does one `require` and has no chunk loader |
| Renderer built through the `preload` slot | electron-vite requires an `index.html` for a `renderer` build; `preload` is already a CommonJS library build, as in upstream's `freelens-example-extension` |

## Notes

| Topic | Rule |
|-------|------|
| Reloading | Freelens caches extension code and does not hot-reload it. `make up` builds and restarts |
| noVNC session | A restart drops it; reload the browser tab |
| noVNC URL | Use `resize=scale`. Xvfb has a fixed geometry, so `resize=remote` shows the desktop cropped. The URL `make up` prints uses `scale` |
| `react-dom` global | The host exports `ReactDOM`. Upstream's `freelens-example-extension` maps it to `global.ReactDom`, which is `undefined`; this repository uses the correct name |
| `build/` as a workspace package | pnpm 12.3.4 writes broken root-level symlinks for packages with a peer-dependency suffix, so `build/` owns `vite` and `electron-vite` |
| Named volumes | A path absent from the image is created as root while the container runs unprivileged, so `~/.config/Freelens` and the pnpm and corepack caches are created and chowned at build time |
