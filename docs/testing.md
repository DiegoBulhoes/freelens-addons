---
title: "Testing"
description: "Unit tests on real cluster objects, the end-to-end suite, fixtures and coverage"
---

# Testing

## Contents

- [Layers](#layers)
- [Commands](#commands)
- [Unit tests](#unit-tests)
- [End-to-end](#end-to-end)
- [Fixtures](#fixtures)
- [Rules](#rules)

## Layers

```mermaid
flowchart LR
  F["fixtures<br/><i>exported from the dev k3s</i>"] --> U["unit tests<br/><i>api/ modules, no mocks</i>"]
  U --> C["coverage<br/><i>95% of src/renderer/api</i>"]
  W["running Freelens<br/><i>dev k3s</i>"] --> E["e2e<br/><i>CDP, read only</i>"]
  B["verify-bundles.sh"] --> X["make check"]
  C --> X
```

| Layer | Covers | Runs in |
|-------|--------|---------|
| Unit | Every decision in `src/renderer/api/` | `make test`, `make check`, CI |
| Bundle check | Manifests and bundles Freelens would skip | `make check`, CI |
| End-to-end | Pages, controls, numbers, layout and design in the real app | `make e2e` (needs a cluster and a window) |

## Commands

```bash
make test
make e2e
```

Watch one package:

```bash
docker compose -f dev/docker-compose.yml --project-directory . \
  run --rm --no-deps --entrypoint sh -w /workspace freelens \
  -lc "cd packages/argocd && pnpm test:watch"
```

## Unit tests

Under test, `@freelensapp/extensions` resolves to `test/freelens-host.ts`, which re-exports the
real `KubeObject` and `KubeApi`. `getApi()` and `getStore()` throw, as they do before registration.

Decisions live in `api/` modules that take plain data and are covered. Modules that read a store or
send a patch are excluded and decide nothing.

| Decides, and is covered | Reads a store or sends a patch, and is excluded |
|-------------------------|--------------------------------------------------|
| `pressure.ts` | `cluster-health.ts` |
| `workload-selection.ts` | `workloads.ts` |
| `patches.ts` | `actions.ts`, `project-actions.ts` |
| `store-state.ts`, `pins.ts`, `persist.ts` | `use-argocd-stores.ts` |
| `image-updates.ts`, `image-updater-patches.ts`, `image-updater-tables.ts` | `use-image-updater-stores.ts`, `image-updater-actions.ts` |
| `coverage.ts`, `scan-progress.ts`, `subjects.ts` | `reports.ts`, `use-trivy-stores.ts` |
| `check-link.ts`, `rbac.ts`, `workload-rows.ts`, `installed.ts` | `use-rbac-stores.ts` |
| `namespace-scope.ts`, `table.ts` (every package) | `load-stores.ts`, `use-namespace-scope.ts` (every package) |
| `workload-pods.ts`, `workload-filter.ts` | `use-workload-pods.ts` |
| `clusters.ts`, `backups.ts`, `rows.ts`, `attention.ts`, `operations.ts`, `store-state.ts` (CloudNativePG) | `kinds.ts`, `actions.ts`, `use-cnpg-stores.ts` |
| `agent.ts`, `members.ts`, `replica-sets.ts`, `operations.ts`, `rows.ts`, `upkeep.ts` (MongoDB) | `kinds.ts`, `actions.ts`, `use-mongodb-stores.ts`, `use-agents.ts` |
| `nodes.ts`, `health.ts`, `operations.ts`, `rows.ts`, `upkeep.ts` (Redis) | `kinds.ts`, `actions.ts`, `use-redis-stores.ts` |
| `expiry.ts`, `attention.ts`, `chain.ts`, `issuers.ts`, `unmanaged.ts`, `certificate-filter.ts`, `commands.ts`, `secret-metadata.ts`, `renewal.ts`, `requests.ts` | `kinds.ts`, `actions.ts`, `use-cert-manager-stores.ts`, `use-tls-inventory.ts` |

Coverage: 95% of statements, branches, functions and lines in `src/renderer/api/`; `types.ts` is
excluded. React pages are covered by the e2e suite and `verify-bundles.sh`.

A case starts from a real fixture and changes only the field under test:

```ts
const stuck = variantOf("guestbook", (data) => {
  statusOf(data).operationState = {
    phase: "Running",
    startedAt: new Date(NOW - 20 * 60_000).toISOString(),
  };
});

expect(getAttentionItems([stuck], NOW)[0]?.headline).toBe("Sync stuck");
```

## End-to-end

`make e2e` restarts Freelens with `--remote-debugging-port=9222` (loopback only) and drives it over
the Chrome DevTools Protocol, one package at a time.

| Path | Holds |
|------|-------|
| `build/e2e/cdp.ts` | The protocol client, over Node's WebSocket |
| `build/e2e/freelens.ts` | Cluster frame, sidebar, namespace scope, dialogs, notifications |
| `build/e2e/design.ts` | `designViolations()` and `dialogColourViolations()` |
| `packages/<name>/e2e/` | Each extension's suite, `pnpm test:e2e` |

| File | Checks |
|------|--------|
| `pages-render.e2e.ts` | Every page opens and shows the cluster's rows |
| `controls.e2e.ts` | Every control does what its label says |
| `contents.e2e.ts` | Numbers match the cluster, asked through the host's proxy |
| `layout.e2e.ts` | No overflow; the design standard on every page |
| `filters.e2e.ts` | Filters narrow, empty and restore the list |
| `namespace-scope.e2e.ts` | Pages follow the namespace scope (one per extension) |
| `navigation.e2e.ts` | Row clicks land on the right page (Trivy) |
| `image-updater.e2e.ts` | The Image Updater screens, drawer and dialogs (ArgoCD) |
| `flow-pin.e2e.ts`, `flow-renewal.e2e.ts` | One flow each, start to end |

Actions that write (Sync, Refresh, Undo, Delete, Renew) are pressed up to their confirmation and
cancelled; what they send is covered by the unit tests.

## Fixtures

```bash
KUBECONFIG=/tmp/freelens-addons-k3s/kubeconfig.yaml scripts/export-fixtures.sh          # every package
KUBECONFIG=/tmp/freelens-addons-k3s/kubeconfig.yaml scripts/export-fixtures.sh argocd   # one
```

The script refuses any cluster whose node is not `freelens-addons-dev`, and sanitises what it
writes. Read the diff before committing.

| Removed or replaced | Reason |
|---------------------|--------|
| Node IPs, machine and system UUIDs, boot ID | Identify the host |
| Domains in `FIXTURE_REDACT_DOMAINS` | Private hostnames |
| Pod `env` values, `envFrom` | Credentials |
| Exposed-secret matches, ACME tokens and keys, last-applied annotations | Secrets |
| `managedFields`, `operationState.syncResult`, SBOM component lists | Size |

`metadata.selfLink` is filled in, since the client expects it.

## Rules

| Rule | Why |
|------|-----|
| No mocks | The real classes catch shapes a stand-in would get wrong |
| Never hand-write a fixture | Cause the state in `scripts/seed-cluster.sh` instead |
| Time-dependent code takes `now` | Tests pass `fixtureNow()`; cert-manager's reads `exported-at.json` |
| A new test fails without its fix | Check by reverting the fix |
| e2e sets up its own state | Freelens remembers sidebar groups and starts scoped to one namespace |
| e2e follows a person's order | Narrow, look, widen, look |
| Change a loading path, run every `namespace-scope.e2e.ts` | The hooks share one pattern |
