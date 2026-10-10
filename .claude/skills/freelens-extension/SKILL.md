---
name: freelens-extension
description: |
  Create a Freelens (Lens) extension, or add a page, table, drawer, dialog, menu or action to
  one, in whatever repository you are in. Reads the repository's conventions first, then
  scaffolds the package, its tests, its docs and its registration so it loads, and builds every
  screen from one design standard: sidebar groups and sub-groups, list pages drawn as the host's
  lists, drawers, confirmations, bulk selection, both themes. Use whenever someone asks to
  create, extend or restyle a Freelens or Lens extension, add a screen or submenu to one, or make
  one look like the rest, even if they do not say "design".
license: Apache-2.0
metadata:
  version: "2.5.0"
---

# Freelens extension

Two sources of truth:

1. **The repository.** Its instructions, docs, extensions, build, tests and CI. It wins.
2. **Freelens.** What its loader demands. That part is here.

If they disagree, follow the repository and tell the person.

## Contents

- [What is in this skill](#what-is-in-this-skill)
- [Read the repository first](#read-the-repository-first)
- [What Freelens demands](#what-freelens-demands)
- [Names](#names)
- [Procedure](#procedure)
- [Gates](#gates)
- [Do not](#do-not)

## What is in this skill

| Path | What |
|------|------|
| `design.md` | The design standard. Read before drawing a screen |
| `templates/` | A minimal extension: manifest, build, tests, pages, ready-made components |
| `templates/src/renderer/styles/design.css` | The standard's components, with a `__Name__` prefix |
| `scripts/copy-design-standard.sh` | Writes `design.css` into every extension; `--check` fails on drift |
| `harness/design.ts`, `harness/cdp.ts` | `designViolations()`, `dialogColourViolations()` and the CDP client they run on |

## Read the repository first

Each finding changes what gets written.

| Look for | Decides |
|----------|---------|
| `CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md` | Rules that override this skill |
| `README.md`, `docs/` | How extensions are listed and documented |
| An existing extension (`grep -rl '"renderer"' --include=package.json .`) | Layout, names, ids, styling. It is the template |
| A `design.css` in an extension | The standard to copy. Never edit a copy |
| A shared build config (`grep -rl 'exports: "named"' .`, `build/`) | Re-export it instead of carrying one |
| Lockfile, `packageManager` | Install command and its traps |
| `pnpm-workspace.yaml`, `.npmrc`, renovate | Age floors, allowed build scripts, versions to match |
| `vitest.config.*`, `test/` | Runner, how `@freelensapp/extensions` resolves, coverage |
| `e2e/`, a CDP harness | Whether e2e tests are expected, with which helpers |
| `Makefile`, compose files, `scripts/` | How to build and load into Freelens |
| CI workflows | The gates to run locally |
| A per-extension seed (`--for` in a cluster script), a CI `matrix:` of e2e legs | Entries the new extension needs |
| An export script, `test/fixtures/` | Whether tests use real cluster objects |

No extension yet: the templates are the start; names and paths still follow the repository.

## What Freelens demands

Most of these fail silently.

| Rule | Otherwise |
|------|-----------|
| One CommonJS bundle per entrypoint; `require(entry).default` is a class | Rollup's `exports: "auto"` drops `.default`; the extension is skipped |
| `@freelensapp/extensions`, React, MobX are globals | A second React or MobX breaks hooks and observability |
| `engines.freelens` starts with `^` or a digit, names `MAJOR.MINOR` | Listed as incompatible. Freelens keeps only `MAJOR.MINOR` |
| `main` and `renderer` point at the build output | Nothing loads |
| `files` includes the build output | The tarball ships no UI |
| `private: true` unless the repository publishes | Accidental publish |
| `jsx: "react-jsx"` | A lint fix to `import type React` breaks JSX at runtime |
| `moduleResolution: node10` | `Renderer` becomes `any` |
| `react-dom` maps to `global.ReactDOM` | Upstream's example writes `ReactDom`: undefined |
| A new install is disabled | Enable it from the `⋮` menu |
| No hot reload | Build, then restart Freelens. A rebuild alone does nothing |

Host facts, true everywhere:

- **Sidebar order.** A saved order in `lens-user-store.json` beats `orderNumber`. A new group lands last for existing users.
- **Secrets.** `secretsStore` loads every value. Ask for a `PartialObjectMetadataList`; drop `last-applied-configuration`.
- **Details drawer.** `Navigation.showDetails` does nothing from a plain `clusterPage`. Navigate to a host list with `?search=<name>`.
- **`isLoaded`.** Means "loaded once", not "loaded for this namespace scope". Load on every mount.
- **`ConfirmDialog`.** Copies plain-object props. Form values reach `ok` through callbacks.

## Names

| Placeholder | Example | For |
|-------------|---------|-----|
| `__PACKAGE__` | `@acme/lens-backups` | npm name |
| `__NAME__` | `backups` | Directory, menu ids (`__NAME__-*`), stylesheet, docs file |
| `__Name__` | `Backups` | Classes, CSS prefix, `__Name__Styles`, `__Name__Icon` |
| `__TITLE__` | `Backups` | Sidebar group, docs title |
| `__DESCRIPTION__` | `See which backups ran, which failed, and what nothing backs up` | Manifest |

Prefix every `clusterPageMenus` id with `__NAME__-`. The host builds test ids from it.

## Procedure

Each step ends with a check. Run it before the next.

### 1. Discover

Run the table above. Note where extensions live, how they build, load, test and document.

**Check:** you can name the build command and the load command, and both exist.

### 2. Create the package

Copy the templates with the placeholders filled:

```bash
SKILL=<path to this skill>
DEST=<where extensions live>/<name>
SUB='s/__PACKAGE__/<package>/g; s/__NAME__/<name>/g; s/__Name__/<Name>/g; s/__TITLE__/<Title>/g; s/__DESCRIPTION__/<description>/g'

for f in $(cd "$SKILL/templates" && find . -type f -not -path './docs/*'); do
  out="$DEST/$(echo "$f" | sed 's#^\./##; s#icons/icon.tsx#icons/<name>.tsx#; s#styles/extension.css#styles/<name>.css#')"
  mkdir -p "$(dirname "$out")"
  sed "$SUB" "$SKILL/templates/$f" > "$out"
done
```

Then adapt to the repository:

- Shared build config: replace `electron.vite.config.ts` with its re-export; delete `vite/`.
- Shared tsconfig: extend it; keep `node10` and `react-jsx`.
- Existing `test/freelens-host.ts`: copy theirs.
- `design.css`: run the repository's copy-design-standard.sh, or `$SKILL/scripts/copy-design-standard.sh <where extensions live>`.
- Do not copy another extension's hooks or stores. Write what this one needs.

**Check:** the manifest has `private`, `files`, `engines.freelens`, `main`, `renderer`. The directory holds only extensions.

### 3. Install

Use the repository's package manager, where its instructions say.

| Trap | Fix |
|------|-----|
| pnpm workspace: plain `pnpm install` leaves peers unresolved; `tsc` then says *"cannot have an 'override' modifier"* | `pnpm install --fix-lockfile` |
| Minimum release age | Declare ranges. Never lower the floor |
| Build-script allow-list | A new native dependency is a decision |

Match the versions already resolved (React 17, `@freelensapp/*`, vite, electron-vite).

**Check:** typecheck passes; the lockfile adds one importer and changes nothing else.

### 4. Build, load, see it

Build and load the repository's way. Enable the extension from `⋮`.

**Check:** the group shows, the overview renders, the main log line appears.

| Symptom | Cause |
|---------|-------|
| No log | No manifest, or not directly under the extensions folder |
| `Cannot find module` | Not built, or a host module not mapped to a global |
| Listed, never activated | `.default` is not a class |
| Incompatible | `engines.freelens` does not match |

### 5. Write what it reads

- One `KubeObject` class per kind, extending `Renderer.K8sApi.LensExtensionKubeObject`.
- Export fixtures before writing parsers. The real shape is in the cluster.
- Hide the group on clusters without the CRDs:

```ts
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);
```

`isInstalled` lives in `api/`, tested. Check the hidden case once with a CRD name that does not exist.

### 6. Decisions apart from store access

| Takes plain data, tested | Reads a store or patches, thin |
|--------------------------|--------------------------------|
| Parsing, sorting, filtering, thresholds, attention | `getStore()`, `loadAll()`, `subscribe()`, `patch()` |

- Under test, `@freelensapp/extensions` resolves to `test/freelens-host.ts`. No mocks.
- Time-dependent code takes `now`.
- Hooks load on every mount; retry only while never loaded.

### 7. Fixtures

- Use the repository's export script, or write one: `kubectl get <kind> -A -o json` through a sanitiser.
- Never hand-write a fixture.
- Seed the dev cluster with deliberately imperfect objects.
- Seeded per extension (here: `dev/cluster/components/<name>/`, `cluster.sh install --for <name>`):
  add the component, and the extension's `--for` entry naming every component it needs, in
  install order.
- A state the e2e suites read that arrives asynchronously: wait for it in the component's
  `settle.sh`. It only waits; `states.sh` causes the state.

**Check:** read the whole fixture diff. It is cluster contents. A fresh cluster seeded with only
the extension's `--for` entry shows every page's rows.

### 8. Docs

With the extension, not after. Follow the repository's shape.

```bash
sed "$SUB" "$SKILL/templates/docs/extension.md" > <docs dir>/<name>.md
```

Diagrams, no screenshots, no cluster figures.

### 9. Tests

- Unit tests on the decision modules, with the repository's coverage rule (template: 95% of `src/renderer/api/`).
- First e2e file: open every page, read something only data draws.
- Then controls, contents, layout, a flow.
- Layout: `designViolations` on every page; `dialogColourViolations` with each dialog open. Use the repository's copy or `harness/`.
- E2E as a CI matrix (here: `leg:` in `.github/workflows/ci.yaml`): add the extension's leg. `scripts/checks/e2e-legs.sh` fails until the legs, `packages/` and the `--for` entries match.
- No harness: say so.

### 10. Prove a test fails

Break what each new test guards and watch it fail. If a CSS mutation fails nothing, look for a later declaration in the same block.

## Gates

- Run what CI runs, locally, and the e2e suite, also as the extension's leg alone on a fresh cluster (here: `make ci-local JOB=e2e LEG=<name>`).
- `copy-design-standard.sh --check` passes.
- No bundle check? Verify by hand: `exports.default =` at the end, no `require("react")` or `require("@freelensapp/extensions")`.
- Commit the repository's way. Default: semantic, English, one commit per concern.

## Do not

- Comment what the code shows. One line, only for a hidden reason.
- Invent a convention the repository has.
- Propose a registry. Freelens fetches without credentials.
- Bundle React, MobX or `@freelensapp/extensions`.
- Restyle a component in the extension's stylesheet.
- Mock. Split the decision from the lookup.
- Lower coverage or widen exclusions.
- Write cluster numbers into tests, docs or commits.
- Say a rebuild is enough.
