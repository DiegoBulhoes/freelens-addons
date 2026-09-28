---
name: freelens-extension
description: |
  Create a Freelens (Lens) extension in whatever repository you are in: read the
  repository's own conventions first, then scaffold the package, its tests, its docs and
  its registration so it loads. Use when asked to create, add, bootstrap or start a
  Freelens or Lens extension. Carries what the Freelens loader rejects silently and the
  steps that fail with no error at all; everything else it takes from the repository.
license: Apache-2.0
metadata:
  version: "2.1.0"
---

# Freelens extension

Two sources of truth, in this order:

1. **The repository.** Its README, its instructions file, its docs, its existing extensions,
   its build, its tests, its CI. Whatever it already does, this extension does the same way.
2. **Freelens itself.** What its loader demands of any extension, which no repository can
   change. That part is in this skill; the templates are the smallest thing that satisfies it.

When the two disagree, the repository wins, and the disagreement is worth a sentence to the
person asking.

## Contents

- [Read the repository first](#read-the-repository-first)
- [What Freelens demands of any extension](#what-freelens-demands-of-any-extension)
- [The names](#the-names)
- [Design](#design)
- [Procedure](#procedure)
- [Gates](#gates)
- [Do not](#do-not)

## Read the repository first

Before writing a file. Each of these changes what gets written.

| Look for | How | What it decides |
|----------|-----|-----------------|
| Instructions to agents | `CLAUDE.md`, `AGENTS.md`, `.cursorrules`, `CONTRIBUTING.md` | Rules that override this skill: commit style, what runs where, what not to propose |
| The README | `README.md` | Whether extensions are listed there and how; how the repository says to install and develop |
| Documentation | `docs/`, `doc/`, a wiki | Whether each extension gets a page, and in what shape (frontmatter, index, sections) |
| An existing extension | `grep -rl '"renderer"' --include=package.json . \| grep -v node_modules` | The layout to copy: directory structure, file names, class names, id conventions, styling approach |
| A design standard | `styles/design.css` in an existing extension, a script that syncs it | Whether pages are built from shared components. If they are, the new extension carries the same file — copied, never edited |
| A shared build config | `grep -rl 'exports: "named"' . \| grep -v node_modules`, or a `build/` directory | Whether the package re-exports a shared config or carries its own |
| The package manager | `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `packageManager` in the root manifest | Which install command, and its gotchas |
| Dependency policy | `pnpm-workspace.yaml`, `.npmrc`, renovate/dependabot config | Age floors, allowed build scripts, pinned versions to match rather than invent |
| The test setup | `vitest.config.*`, `jest.config.*`, a `test/` directory in an existing extension | The runner, how `@freelensapp/extensions` is resolved under test, coverage rules |
| An e2e harness | `e2e/`, `playwright.config.*`, anything driving Freelens over CDP | Whether a new extension is expected to ship e2e tests, and with what helpers |
| How Freelens is run | `Makefile`, `docker-compose*.yml`, `scripts/`, a `dev/` directory | The command that builds and loads an extension, and whether it restarts the app |
| CI | `.github/workflows/`, `.gitlab-ci.yml` | The gates a pull request meets, so they are run locally first |
| Fixtures | `*/test/fixtures/`, an export script | Whether tests run against real cluster objects, and how those are refreshed |

If the repository has one extension already, that extension is the template and the files
under `templates/` here are only a checklist of what it should contain. If it has none, the
templates are the starting point and the repository's conventions still decide names, paths,
and style.

## What Freelens demands of any extension

These come from the loader and hold in every repository. Most fail **silently** — the extension
is listed and does nothing, or is not listed at all — and the two that do speak up say something
unrelated to the cause.

| Rule | What happens otherwise |
|------|------------------------|
| One CommonJS bundle per entrypoint, and `require(entrypoint).default` is a class | Rollup's default `exports: "auto"` turns a lone default export into `module.exports = Class`, `.default` is undefined, and the extension is skipped without an error |
| `@freelensapp/extensions`, React, MobX and their friends are **globals**, not modules | Bundling a copy ships a second React and a second MobX; both are singletons shared with the host, and hooks and observability break far from the cause. The build rewrites those imports to reads of `globalThis.LensExtensions`, `React`, `ReactDOM`, `ReactJsxRuntime`, `Mobx`, `MobxReact`, `ReactRouter`, `ReactRouterDom` |
| `engines.freelens` present, starting with `^` or a digit, naming `MAJOR.MINOR` | Listed as incompatible |
| `main` and `renderer` in the manifest point at the built files | Nothing to load |
| `files` includes the build output directory | npm auto-includes what `main` names and knows nothing about `renderer`; the packed tarball ships no UI — installs fine, enables fine, does nothing |
| `private: true` unless the repository publishes | An accidental `npm publish` |
| JSX on the automatic runtime (`jsx: "react-jsx"`) | Under the classic runtime a lint fix turning `import React` into `import type React` drops React from the bundle and the JSX fails at runtime, not at build |
| `moduleResolution: node10` | `@freelensapp/core` ships its types through `typesVersions`, which bundler resolution ignores; `Renderer` becomes `any` and nothing is checked |
| `react-dom` maps to `global.ReactDOM` | Upstream's example writes `ReactDom`; that resolves to undefined and bites any extension importing react-dom |
| A newly installed extension is **disabled** until enabled from the `⋮` menu | "It does not work after installing" |
| The host does not hot-reload | It caches the bundle and its watcher sees only directories appearing or disappearing. Build, then restart Freelens. Telling someone a rebuild is enough is telling them something false |

Four facts about the pages, learned the hard way and true of any extension:

- `orderNumber` places a sidebar group only for someone who has never had a sidebar order saved.
  Freelens keeps the order in `lens-user-store.json` (`clusterPageMenuOrder`); a group that appears
  after it was saved is written in at `9999`, the bottom, whatever `orderNumber` says. For an
  existing user a new extension always lands last; they drag it.
- The host's `secretsStore` lists Secrets with their data. An extension that only needs to know a
  Secret exists should ask the API server for a `PartialObjectMetadataList`, and drop the
  `kubectl.kubernetes.io/last-applied-configuration` annotation on arrival — it repeats the
  applied manifest, values included, and annotations are metadata.

- `Navigation.showDetails` does nothing from a plain `clusterPage`. The details drawer is
  rendered only by pages that mount it — the host's own and any built on `KubeObjectListLayout`.
  Navigate to a host list narrowed by `?search=<name>` instead; every list the host renders reads
  it.
- A store's `isLoaded` says a list arrived once, not that it was listed under the namespaces in
  scope now. A hook that skips loading because the store is already loaded shows whatever some
  other page's first mount fetched, for the life of the process. Load on every mount; retry only
  while a store has never loaded.

## The names

| Placeholder | Example | Used for |
|-------------|---------|----------|
| `__PACKAGE__` | `@acme/lens-trivy` | The npm name, in whatever scope the repository uses |
| `__NAME__` | `trivy` | Directory, sidebar item ids (`__NAME__-*`), stylesheet, docs file |
| `__Name__` | `Trivy` | Class names, CSS class prefix `.__Name__-*`, `__Name__Styles`, `__Name__Icon` |
| `__TITLE__` | `Trivy` | The sidebar group and the docs title, as a person reads it |
| `__DESCRIPTION__` | `See what the Trivy operator scanned, what it could not, and what it found` | The manifest's description |

Freelens builds each sidebar item's `data-testid` from the extension's npm name and the **menu
item id**. Prefix every `clusterPageMenus` id with `__NAME__-` so ids stay unique across
extensions and an e2e harness can find them. Page ids are scoped to the extension by Freelens
and stay short.

## Design

Pages are built from one set of components — page, section, cards, rows, boxes, chips, tags,
tables, facts, banner, filters, buttons, search, picker — defined once in
`templates/src/renderer/styles/design.css` and carried by every extension with its own prefix.
[design.md](design.md) says which to use when, the markup of each, and the rules: colours only
from the host's theme, every box on the host's surface grey, anything pressable a `<button>`
aligned left.

If the repository's extensions already carry a `design.css`, that copy is the standard and the new
extension gets the same file. If they carry none, the template is the standard; say so to the
person, since it will make the new extension look unlike the old ones until they adopt it too.
The extension's own stylesheet holds only its domain: a drawing nobody else needs, a palette its
users already know.

## Procedure

Each step ends with a check. Do it before the next step; most failures here are silent.

### 1. Discover

Run the table above. Write down, before creating anything: where extensions live, what one is
called, how it is built, how it is installed, how it is tested, how it is documented, and how
Freelens is started. If the repository has an instructions file, its rules apply from here on.

**Check:** you can name the command that will build this extension and the one that will show
it in Freelens, and both exist already.

### 2. Create the package

Where the repository keeps extensions, following the layout of an existing one if there is one.
Otherwise:

```
<extension>/
  package.json                       templates/package.json
  tsconfig.json                      templates/tsconfig.json — or extend the repository's base, keeping node10 and react-jsx
  electron.vite.config.ts            templates/electron.vite.config.ts — or a re-export of the repository's shared config
  vite/global-externals.ts           templates/vite/global-externals.ts — only when there is no shared config
  vitest.config.ts                   templates/vitest.config.ts
  test/freelens-host.ts              templates/test/freelens-host.ts — what @freelensapp/extensions resolves to under test
  src/main/index.ts                  templates/src/main/index.ts
  src/renderer/index.tsx             templates/src/renderer/index.tsx
  src/renderer/icons/__NAME__.tsx    templates/src/renderer/icons/icon.tsx
  src/renderer/components/styles.tsx templates/src/renderer/components/styles.tsx — injects design.css, then __NAME__.css
  src/renderer/components/stat-card.tsx templates/src/renderer/components/stat-card.tsx
  src/renderer/styles/design.css     templates/src/renderer/styles/design.css — the standard; never edited here
  src/renderer/styles/__NAME__.css   templates/src/renderer/styles/extension.css — the domain's own, nothing more
  src/renderer/styles/css.d.ts       templates/src/renderer/styles/css.d.ts — or tsc cannot see the stylesheet
  src/renderer/pages/overview-page.tsx  templates/src/renderer/pages/overview-page.tsx
```

```bash
SKILL=<path to this skill>            # e.g. .claude/skills/freelens-extension
DEST=<where extensions live>/<name>   # e.g. packages/<name>
SUB='s/__PACKAGE__/<package>/g; s/__NAME__/<name>/g; s/__Name__/<Name>/g; s/__TITLE__/<Title>/g; s/__DESCRIPTION__/<description>/g'

for f in $(cd "$SKILL/templates" && find . -type f -not -path './docs/*'); do
  out="$DEST/$(echo "$f" | sed 's#^\./##; s#icons/icon.tsx#icons/<name>.tsx#; s#styles/extension.css#styles/<name>.css#')"
  mkdir -p "$(dirname "$out")"
  sed "$SUB" "$SKILL/templates/$f" > "$out"
done
```

If the repository shares a build config, replace `electron.vite.config.ts` with the one-line
re-export its other packages use and delete `vite/`. If it syncs `design.css` with a script, run
the script rather than trusting the copy the loop above made. If it shares a base tsconfig, extend it. If
its extensions keep `test/freelens-host.ts` already, copy theirs rather than the template's.

Do not copy an existing extension's hooks, store modules or persistence layer as if they were
scaffolding. Each is a decision that extension made, with its reasons in its comments. Read
them; then write what this one needs.

**Check:** the manifest has `private`, `files`, `engines.freelens`, `main` and `renderer`, and
the directory contains nothing that is not an extension — some hosts read every subdirectory of
the extensions folder as one and throw on a manifest without `engines.freelens`.

### 3. Install, the repository's way

Use its package manager, in whatever environment its instructions say (some repositories run
everything in a container and forbid Node on the host). Then the manager's own trap:

| Manager | Trap |
|---------|------|
| pnpm workspace | `pnpm install --fix-lockfile`, not `pnpm install`. A plain install adds the new importer without resolving its peers, and `@freelensapp/extensions` links to a `.pnpm` directory that does not exist. The error is nothing like the cause: `tsc` says *"this member cannot have an 'override' modifier because its containing class does not extend another class"*, once per member |
| Any, with a minimum release age | Declare ranges, not pins, so the floor chooses. When nothing in range clears the floor, wait or widen; never lower it |
| Any, with `ignore-scripts` or an allow-list for build scripts | A new native dependency is a decision, not a warning to skim |

Match the versions the repository already resolves — of React (Freelens 1.10 shares React 17 as
`global.React`), of `@freelensapp/*`, of vite and electron-vite — rather than the newest.

**Check:** typecheck passes, and the lockfile diff shows one new importer and no changed
resolutions.

### 4. Build, load, see it

Build with the repository's command. Then load it the repository's way: a Makefile target that
restarts a containerised Freelens, or a symlink of the package into `~/.freelens/extensions/`
for a local one, followed by enabling it from the `⋮` menu on the Extensions page — a newly
installed extension is disabled.

**Check:** the group is in the sidebar, its overview page renders the template headline, and
the main-process log line appears where the repository says logs go. The renderer's
`console.log` goes to Chromium's devtools inside the app, not to stdout, so the page rendering is
the proof for that half. If the extension is not there: with no log at all, the directory has no
manifest or is not directly under the extensions folder; with `Cannot find module`, it was not
built or the host module was not mapped to a global; listed but never activated, `.default` is
not a class; listed as incompatible, `engines.freelens` does not match.

### 5. Write what it reads

One `KubeObject` class per kind, extending `Renderer.K8sApi.LensExtensionKubeObject`, with a
static `crd` for a custom resource. Export the fixtures from a real cluster before writing the
parsers: the shape a kind actually has — per-container reports, hashed names, labels present but
empty — is in the cluster, not in its documentation.

If the extension exists for an operator, its sidebar group should not sit on clusters that do not
run it. Every `clusterPageMenus` entry takes `visible`, a MobX `IComputedValue<boolean>` that
Freelens re-reads on its own; bind it to the operator's CRDs through the host's CRD list, which
the sidebar already keeps loaded and watched:

```ts
const installed = computed(() =>
  isInstalled(Renderer.K8sApi.crdStore.items.map((crd) => crd.getName())),
);
```

`isInstalled` belongs in `api/`, with its tests. The hidden case cannot be reached without removing
CRDs, so check it once by pointing the rule at a name that does not exist.

### 6. Keep decisions apart from store access

| Takes plain data, and is tested | Reads a store or sends a patch, and is a thin boundary |
|---|---|
| Parsing, grouping, sorting, filtering, thresholds, what counts as attention | `getStore()`, `loadAll()`, `subscribe()`, `patch()` |

This is what lets the tests run against the real `KubeObject` and `KubeApi` with no mock: under
test, `@freelensapp/extensions` resolves to `test/freelens-host.ts`, the same substitution the
build performs, pointed somewhere a test process can reach. A module that can only be tested
with a mock has a decision and a lookup still tangled.

Anything time-dependent takes `now` as a parameter, so tests pass a fixed moment and "recently"
does not decay into a failure. A hook that loads a store loads it on every mount and retries
only while a store has never loaded.

### 7. Fixtures, from a cluster

If the repository exports fixtures from a cluster, add this extension's kinds to that script and
run it. If it has no such script, write one: `kubectl get <kind> -A -o json`, through a
sanitiser that removes machine identifiers, private hostnames and secret values, into
`test/fixtures/`. Never write a fixture by hand to make a test pass; the bugs that matter are
shapes an author would not think to write. If the kinds need an operator, install it into the
development cluster at a pinned release, with sample objects that are deliberately imperfect —
an overview where everything is green shows nothing about how it ranks, and a list with one row
cannot demonstrate an order.

**Check:** read the whole fixture diff before committing. It is cluster contents.

### 8. Docs, with the extension

Whatever the repository does for its other extensions, done for this one at the same time, not
after. Typically a page per extension — `templates/docs/extension.md` is a shape: what it is for
in one sentence, what it shows, what it will not do — plus the rows that list extensions in the
README. Follow the repository's frontmatter, index and heading conventions exactly. Diagrams
rather than screenshots: a screenshot of a real cluster is someone's namespaces and workloads.
No figures from a cluster in prose.

```bash
sed "$SUB" "$SKILL/templates/docs/extension.md" > <docs dir>/<name>.md
```

### 9. Tests

Unit tests over the decision modules, against the fixtures, with the repository's runner and
its coverage rule (the template ships 95 % over `src/renderer/api/`; the repository's number
wins). If the repository has an e2e harness, the first e2e file opens every page this extension
registers and reads something each only renders with data — copy an existing extension's
page-render test and change the ids; then controls, contents against the cluster, layout, and a
flow, as the extension earns them. The layout suite runs the harness's design check on every page,
if the harness has one (`designViolations` in `build/e2e/design.ts` here); a page that renders
without violations before its data has arrived proves nothing, so wait for something only data
draws. If it has no harness, say so rather than pretending.

### 10. Prove a test fails

Before the commit, break what each new test guards and watch it fail: remove the alignment line,
return the wrong count, skip the load. A test that was green against the bug it was written for
is the most expensive kind to own. When a CSS mutation fails nothing, look for a later
declaration in the same block before concluding the test is weak.

## Gates

Run what the repository runs before a merge — its `make check`, its `npm test`, the steps of
its CI workflow — locally, and its e2e suite if it has one. Where `design.css` is synced by a
script, its check mode passes: the new copy is the standard, byte for byte. If it has no bundle check, verify by
hand what one would: each built entrypoint ends in `exports.default =`, neither bundle contains
`require("@freelensapp/extensions")` or `require("react")`, and the manifest carries `private`,
`files`, `engines.freelens`, `main`, `renderer`.

Commit the way the repository commits. If nothing says, semantic messages in English with no
co-author line, one commit per concern: the package, the docs, the fixtures.

## Do not

- Invent a convention the repository already has. Names, paths, commit style, where tests live, how Freelens is run: read first.
- Propose publishing to a registry unless the repository already does. Freelens fetches without credentials, so a private registry cannot serve it anyway.
- Bundle React, MobX or `@freelensapp/extensions`. They are the host's globals.
- Style a card, row, table or button in the extension's own stylesheet. It is a component of the standard, or a change to the standard.
- Reach for a mock. Split the decision from the lookup instead.
- Lower a coverage threshold or widen an exclusion to make a number pass.
- Write a cluster's numbers into a test, a doc or a commit message.
- Tell anyone a rebuild is enough.
