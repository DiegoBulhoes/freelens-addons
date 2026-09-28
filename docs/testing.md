---
title: "Testing"
description: "How the extension is tested against real cluster objects, why there are no mocks, and what the coverage thresholds cover"
---

# Testing

The tests run against objects exported from a real ArgoCD installation, constructed through the
same classes the running extension uses. There are no mocks.

## Contents

- [Running them](#running-them)
- [End-to-end](#end-to-end)
  - [Where they live](#where-they-live)
  - [The files](#the-files)
  - [Contents, and where the truth comes from](#contents-and-where-the-truth-comes-from)
  - [Layout, which nothing else looks at](#layout-which-nothing-else-looks-at)
  - [What is deliberately not covered](#what-is-deliberately-not-covered)
  - [Flows](#flows)
  - [What Freelens makes awkward](#what-freelens-makes-awkward)
  - [Ambient state is the enemy](#ambient-state-is-the-enemy)
- [Why no mocks](#why-no-mocks)
- [Fixtures](#fixtures)
- [What is covered](#what-is-covered)
- [Refreshing the fixtures](#refreshing-the-fixtures)
- [Writing a test](#writing-a-test)

## Running them

```bash
make test
```

That applies the same coverage thresholds CI does, so a pass here is a pass there. `make check`
runs it alongside lint, typecheck, build and the supply-chain gates.

To iterate on one file, run vitest directly in the dev container:

```bash
docker compose -f dev/docker-compose.yml --project-directory . \
  run --rm --no-deps --entrypoint sh -w /workspace freelens \
  -lc "cd packages/argocd && pnpm test:watch"
```

## End-to-end

```bash
make e2e
```

The unit suites cover the rules. What they cannot reach is the rendered page:
whether a keystroke in a field arrives at the rule, whether a click opens
anything, whether a component was wired in at all. Every defect of that shape
in this repository was found by a person looking at the screen, and one of them
had been there since the extension was written.

`make e2e` restarts the workbench with `--remote-debugging-port=9222` and
drives the real Freelens through the Chrome DevTools Protocol. The port listens
on loopback only, and normal runs do not open it.

### Where they live

Each extension owns its own, next to the code they exercise. The harness is
shared and sits outside them, in `build/e2e`, which is where shared non-extension
code goes — the specs reach it by relative path, the way each package already
reaches `build/vite`.

```
build/e2e/                 cdp.ts, freelens.ts, design.ts — the protocol, the harness, the design check
packages/argocd/e2e/       seven files, run by `pnpm --filter …/argocd test:e2e`
packages/trivy/e2e/        seven files
packages/cert-manager/e2e/ six files
```

`make e2e` runs them one package after the other:
`pnpm -r --workspace-concurrency=1 run test:e2e`. The serialisation is not a
detail — there is one window and one cluster, and two vitest processes driving
the same UI would fight. Each package's unit config includes only
`test/**/*.test.ts`, so `make test` never picks an e2e file up, and each
`type:check` now covers its `e2e/tsconfig.json`.

The cost of the split is in `namespace-scope.e2e.ts`: it exists because one defect
sat in both extensions' hooks, and there are now two of it, one per package. A
change to how either loads its stores should be tried against both. Each file says
so, and names its twin.

### The files

One property per file, and a flow is a property too.

| File | Package | What it holds the code to |
|------|---------|--------------------------|
| `pages-render.e2e.ts` | all | Every page that extension registers opens, renders its own content, and lists the rows the cluster has |
| `controls.e2e.ts` | all | Every control the extension renders gets pressed, and has to do what its label says |
| `contents.e2e.ts` | all | The numbers on the page are the cluster's numbers, and a list said to be ordered is ordered |
| `layout.e2e.ts` | all | Nothing runs off the side, every page follows the design standard, colours come from the host's theme, and a truncated cell explains itself on hover |
| `filters.e2e.ts` | argocd, trivy | The filter field written into its pages narrows the list, empties it, and comes back |
| `namespace-scope.e2e.ts` | all | Its pages catch up when the namespace scope changes under them |
| `navigation.e2e.ts` | trivy | A row click lands somewhere: the host's Pods list narrowed by `?search=`, and the workloads page with the subject in its params |
| `flow-pin.e2e.ts` | argocd | Pinning an Application from its row menu, as far as the file a restart will read |
| `flow-renewal.e2e.ts` | cert-manager | A failing renewal followed from the overview to the object that explains it, to what else depends on that, and on to the Secret in the host's list |

### Contents, and where the truth comes from

A number written into a test is the development cluster's contents on the day it
was written. So `contents.e2e.ts` asks the cluster instead: the frame can reach
the host's own Kubernetes proxy on its origin, and `clusterItems` turns that into
the count a card is compared against. Eight of the ArgoCD overview's cards are
checked that way, against the Applications the API returns.

Where asking would mean re-implementing the rule under test, an invariant is used
instead — two pages reading one store have to agree, a report cannot describe
more workloads than there are reports, a headline cannot count more roles than
the cluster has.

### Layout, which nothing else looks at

Reading text and counting elements all passes on a page whose table runs off the
side, whose clickable names are centred, or whose colours are painted in rather
than taken from the host. `layout.e2e.ts` asserts on `getComputedStyle` and
`scrollWidth`, and each of its cases guards something that has gone wrong here: a
row built as a `<button>` inherits `text-align: center`, a wide table pushed the
page sideways, and a colour written into the stylesheet looks right in one theme
only.

Every page is also read against the design standard (`build/e2e/design.ts`, and
[the standard itself](../.claude/skills/freelens-extension/design.md)): each card,
row, box, table, facts list and banner sits on the host's surface grey; each
pressable component that is a `<button>` is aligned left; a table's header is the
host's table header colour; a pressed filter carries the accent; and every class of ours on the page has a rule in some stylesheet — a
component renamed and left behind renders in the browser's defaults, beside
neighbours that follow the standard. It waits for something only data draws
first, or an empty page would pass. Removing the `text-align` reset from
`button.<Name>-row` in `design.css` fails it with
`button.Trivy-row is aligned center`.

Hover is in there too. The host wraps a column's contents in a tooltip so a value
too long for its column stays readable; the tooltip renders into a portal and
only on a pointer sequence, so nothing short of a real hover shows whether it was
wired up.

### What is deliberately not covered

| | Why |
|---|---|
| `Sync`, `Refresh`, `Hard Refresh`, `Refresh N`, `Sync N` | They patch Applications. The cluster is disposable and could carry it, but this suite stays read-only; `patches.ts` covers what they send |
| `Logs`, from a row's menu | It opens the host's own log dialog, which is Freelens' UI rather than ours |
| The coverage section's rows | They exist only while a workload has no verdict, so on a cluster the scanner has finished with there are none, and a test for them would pass by finding nothing |
| The clipboard itself | Reading it needs a permission the frame does not have, so what is asserted is the notification the button promises |
| Severity ordering of the attention list | It needs rows of differing severity, and the seeded cluster does not reliably produce them. Pinned-first is asserted instead, which does discriminate |

### Flows

A flow is one `it`. Splitting it into a test per step lets it pass halfway, which
is the opposite of what it is for, and it logs the journey it took so a failure
reads as "it got this far".

**A flow sources its own data.** `flow-renewal.e2e.ts` starts from whichever
certificate the overview lists as failing to renew and follows the object that
explains it, rather than a certificate named in the test, which would be a
fixture with an expiry date. Re-seeding the cluster changes nothing in it.

**A flow may go past the screen.** `flow-pin.e2e.ts` reads the extension's
per-cluster state file, on the volume both containers share. That is the half
that had to change when pins moved out of `localStorage`, and it is the half a
test of the screen cannot see: the pin renders either way, and it is the next
launch that loses it. The suite cannot restart Freelens — it runs in a throwaway
container with no way to drive the app's — so the file is as far as it goes.

Dropping the write to disk and re-running proves the split earns its keep:
`pages-render` and `filters` stay green and only `flow-pin` fails.

**A flow leaves nothing behind.** `flow-pin.e2e.ts` unpins at the end and asserts
a clean start, which is a strict precondition on purpose — a run that tolerates
finding it pinned cannot tell pinning from having been pinned already.

### What Freelens makes awkward

All of it is handled in `e2e/freelens.ts`, and every row below was a test that
passed or failed for a reason unrelated to the code.

| | |
|---|---|
| The cluster's pages are in an iframe of another origin | It is not a CDP target of its own, so evaluation goes through its execution context, looked up by origin |
| That context is replaced when the frame reloads | The newest is taken, and only once it has answered — a reload creates the replacement before the old one is reported destroyed, so the obvious choice is the one about to stop working |
| A sidebar entry is identified by prose | An entry's label is wording and a group's text carries its icon's ligature name. Freelens gives every item a `data-testid` built from the extension name and the item's id, which is what the suite drives |
| A sidebar group must be expanded first, and the expand icon toggles | Expansion is attempted on every pass, and only when the icon shows it is closed. Freelens remembers which groups are open, so a single early attempt makes a suite that passes only while an earlier run left the group open |
| The view starts scoped to one namespace | Every page renders its empty state, and the selection lives in `localStorage` on an origin whose port is new each launch, so it cannot be set up once. Each file widens the scope itself |

### Ambient state is the enemy

Two of the rows above are the same mistake: a test that reads whatever the last
run left behind. Both were found by collapsing the sidebar and re-running, and
by reverting a fix to see the suite stay green.

**Check that a new test fails without its fix.** The first version of
`pages-render.e2e.ts` widened the namespace scope before any of our pages
mounted, which is exactly what hides a page that never reloads its stores — the
defect it was written for. It passed against the bug. `namespace-scope.e2e.ts`
exists because narrow, look, widen, look again is the order a person produces,
and the suite has to produce it too.

There is no Playwright. It would do this well and brings a browser download
and a dependency tree, against a fifteen-day age floor and a rule about
third-party code in CI. Node ships a WebSocket, CDP is JSON over it, and
`e2e/cdp.ts` is the part of the protocol these tests use.

**Not in `make check`, and not in CI.** They need a cluster and a window. The
CI would need an API server serving the fixtures, which is a larger piece of
work than the suite itself.

## Why no mocks

`@freelensapp/extensions` cannot be imported outside Electron, and the built extension never
bundles it: `build/vite` rewrites the import to `globalThis.LensExtensions`, which the Freelens
process supplies. The tests apply the same substitution, pointed somewhere a test process can
reach.

| Under test, this | resolves to |
|------------------|-------------|
| `@freelensapp/extensions` | `test/freelens-host.ts` |
| `KubeObject` | The real class from `@freelensapp/kube-object` |
| `KubeApi` | The real class from `@freelensapp/kube-api` |
| `localStorage` | jsdom's own |

So the accessors, the `selfLink` validation and the label parsing are all the real ones.

**That matters more than it sounds.** `getAnnotations()` returns `"key=value"` strings rather than
an object, and the code depends on that. A hand-written stand-in would have returned an object and
the test would have proved nothing.

**The same argument applies to storage.** What has to be right is the behaviour when storage
throws, and a stub only throws when told to.

Two things in `freelens-host.ts` are not the host's own implementations, and no test exercises
either:

- `getApi()` and `getStore()` throw, which is what the real ones do before an extension is
  registered.
- `KubeObjectStore` is a bare class, because it lives in `@freelensapp/core`, which cannot load
  outside Electron.

## Fixtures

`packages/argocd/test/fixtures/` holds Applications, an AppProject, a Node and its warning
events, exported from a running cluster.

**Hand-written fixtures contain the fields their author remembered,** which is why they never catch
the interesting cases. All three of these were real bugs in this extension, and all three are in
the fixtures:

| Shape | What it broke |
| --- | --- |
| `spec.sources` rather than `spec.source` | Half the Applications showed no source at all |
| No `status` yet | The overview crashed rather than reporting Unknown |
| `revisions` rather than `revision` in history | Rollback resolved to nothing |

**Anything that asks "is this recent" takes `now` as a parameter** rather than reading the clock.
Tests pass `fixtureNow()`, the newest timestamp in the fixtures, so "recently" keeps meaning what
it meant when the cluster was in this state instead of passing today and failing tomorrow.

## What is covered

Coverage is measured over `src/renderer/api/`, the layer that decides things. The thresholds are
95% for statements, branches, functions and lines, and the suite fails below them, so a new branch
cannot arrive untested without someone noticing.

Two groups of files are excluded, both deliberately:

| Excluded | Why |
| --- | --- |
| `types.ts` | Declarations only; there is no runtime code to execute |
| `cluster-health.ts`, `workloads.ts`, `actions.ts`, `project-actions.ts` | The store-access boundary — each reads a Freelens store or sends a patch and delegates every decision elsewhere |

**Nothing was excluded to make a number.** The logic those four files used to hold was moved out so
it could be tested, and what remains in them is the call that sends it:

| Decides | Sends |
|---------|-------|
| `pressure.ts`: what counts as cluster pressure | `cluster-health.ts` |
| `workload-selection.ts`: an Application's pods, and where the ArgoCD UI is | `workloads.ts` |
| `patches.ts`: every body written into a cluster | `actions.ts`, `project-actions.ts` |

**The React pages and menus are not covered.** Reaching them means standing up Freelens' component
library, navigation and stores. The mocks that would take are larger than the code they cover, and
they would assert that the mocks behave as written. Those are verified by `verify-bundles.sh` and
by running the extension against a real cluster.

## Refreshing the fixtures

```bash
KUBECONFIG=/path/to/kubeconfig scripts/export-fixtures.sh          # every package
KUBECONFIG=/path/to/kubeconfig scripts/export-fixtures.sh trivy    # one of them
```

What the script does to what it exports:

| Change | Why |
|--------|-----|
| Replaces node IPs, machine and system UUIDs, and the boot ID | They identify the host and say nothing about behaviour |
| Redacts the domains in `FIXTURE_REDACT_DOMAINS` | `.env` is git-ignored, so no private hostname reaches a committed file |
| Fills in `metadata.selfLink` | The API server stopped sending it in Kubernetes 1.20, but Freelens' client derives it before constructing a `KubeObject`. A fixture without it is one the application never sees. |
| Drops `managedFields` and `operationState.syncResult` | Four fifths of the bytes, and no code reads them |
| Redacts every literal `env` value on a Pod, and drops `envFrom` | Where a credential sits in plain text, and a real cluster has hundreds. The variable names stay, so the shape is still real |
| Drops an `SbomReport`'s component list | Hundreds of entries per image and tens of megabytes across a cluster, and coverage is decided from the report's labels and summary |
| Drops the matched text on an `ExposedSecretReport` | A refresh against a cluster that has one would otherwise commit the secret itself |

**Read the diff before committing.** These are cluster contents.

Three things in the Trivy fixtures were found only because they are real, and no hand-written one
would have had them: a report whose subject name was too long for a label, so the operator wrote a
`name-hash` and the name survives only in `ownerReferences`; ReplicaSets with an SBOM and no config
audit, which is why coverage unions every report kind rather than trusting one; and rows that
repeat a finding verbatim, because the operator emits one per Go binary embedding a module.

## Writing a test

Each suite is grouped by the kind of input rather than by function:

1. What the cluster normally reports.
2. What it reports when something is wrong.
3. What it reports that nobody expects. This is where the bugs have been.

Use `variantOf(name, change)` to build a case. It starts from a real Application and changes only
the field the test is about, so a case for "no status yet" is still an object the application
would accept everywhere else:

```ts
const stuck = variantOf("guestbook", (data) => {
  statusOf(data).operationState = {
    phase: "Running",
    startedAt: new Date(NOW - 20 * 60_000).toISOString(),
  };
});

expect(getAttentionItems([stuck], NOW)[0]?.headline).toBe("Sync stuck");
```
