# For the agent working here and for CI; everything runs in Docker.

SHELL := /bin/bash

-include .env
# Other values let make ci-local run a second setup beside this one.
PROJECT            ?= freelens-addons
DEBUG_PORT         ?= 9222
# Outside the repository, so the kubeconfig cannot be committed.
DEV_KUBECONFIG_DIR ?= /tmp/freelens-addons-k3s
export DEV_KUBECONFIG_DIR

# The pinned OSV-Scanner, from the one script that keeps it outside the workflows.
OSV_SCANNER := $(shell grep -oE 'ghcr\.io/google/osv-scanner@sha256:[0-9a-f]{64}' scripts/security/scan.sh)

# --project-directory keeps `.` and .env meaning the repository root.
COMPOSE := docker compose -p $(PROJECT) -f dev/docker-compose.yml --project-directory .
DEV     := $(COMPOSE) run --rm --no-deps -e FREELENS_DEBUG_PORT=$(DEBUG_PORT) --entrypoint sh -w /workspace freelens -lc

.PHONY: up down check deps-refresh cluster cluster-down kubectl e2e-freelens e2e e2e-writes ci-local

# Restart, not just rebuild: Freelens caches the loaded bundle.
up: .env
	$(DEV) "pnpm install && pnpm run -r build"
	$(COMPOSE) up -d --build freelens
	$(COMPOSE) restart freelens

down:
	$(COMPOSE) down

# CI's first four jobs, the dependency gate first.
check:
	bash scripts/security/osv-direct.sh "$(OSV_SCANNER)"
	$(DEV) "pnpm install --frozen-lockfile && pnpm run lint && pnpm run -r type:check \
	  && pnpm run -r test:coverage && pnpm run -r build && bash scripts/checks/verify-bundles.sh"
	bash scripts/checks/copy-design-standard.sh --check
	bash scripts/security/verify-supply-chain.sh

# Resolves every dependency again, transitive ones too, to the newest its range allows and the
# 15-day floor admits; only the lockfile changes. Monthly, and how a transitive finding gets fixed.
# Resolved in a throwaway copy and promoted only if the gate passes, so a rejected lockfile never
# reaches an install. Not pnpm update: under minimumReleaseAgeStrict it asks to write
# minimumReleaseAgeExclude.
deps-refresh: .env
	rm -rf .deps-refresh
	mkdir -p .deps-refresh
	cp package.json pnpm-workspace.yaml $(wildcard osv-scanner.toml) .deps-refresh/
	for manifest in build/package.json packages/*/package.json; do \
	  mkdir -p ".deps-refresh/$$(dirname "$$manifest")" && cp "$$manifest" ".deps-refresh/$$manifest"; done
	$(DEV) "cd .deps-refresh && pnpm install --lockfile-only"
	bash scripts/security/osv-direct.sh "$(OSV_SCANNER)" .deps-refresh
	cp .deps-refresh/pnpm-lock.yaml pnpm-lock.yaml
	rm -rf .deps-refresh
	$(DEV) "pnpm install --frozen-lockfile"

cluster:
	mkdir -p $(DEV_KUBECONFIG_DIR)
	$(COMPOSE) --profile cluster up -d k3s
	bash dev/cluster/cluster.sh install

# The kubeconfig is root-owned in sticky /tmp, so the container removes it.
cluster-down:
	-$(COMPOSE) run --rm --no-deps --entrypoint sh k3s -c 'rm -rf /output/..?* /output/.[!.]* /output/*'
	$(COMPOSE) --profile cluster down -v k3s
	-rmdir $(DEV_KUBECONFIG_DIR)

# Refuses any cluster but the dev k3s. make kubectl ARGS="-n mongodb get pods"
kubectl:
	@bash dev/cluster/cluster.sh kubectl $(ARGS)

# Freelens with its debugging port, which the suites drive; make up closes it again.
e2e-freelens: .env
	$(DEV) "pnpm install && pnpm run -r build"
	FREELENS_EXTRA_ARGS=--remote-debugging-port=$(DEBUG_PORT) $(COMPOSE) up -d --build --force-recreate freelens
	until curl -sf --max-time 2 http://localhost:$(DEBUG_PORT)/json/version >/dev/null; do sleep 2; done

# One package at a time: two suites would fight over the one window.
e2e: e2e-freelens
	$(DEV) "pnpm -r --workspace-concurrency=1 run test:e2e"

e2e-writes: e2e-freelens
	$(DEV) "pnpm -r --workspace-concurrency=1 run test:e2e-writes"

# ci.yaml through act, as another project on other ports. JOB=lint for one job; KEEP=1 keeps its setup.
ci-local:
	docker build -t freelens-addons/act:local dev/act
	mkdir -p /tmp/freelens-addons-act
	docker run --rm --user $$(id -u):$$(id -g) --group-add $$(stat -c %g /var/run/docker.sock) \
	  -v /var/run/docker.sock:/var/run/docker.sock -v "$(CURDIR)":/repo:ro \
	  -v /tmp/freelens-addons-act:/tmp/freelens-addons-act \
	  -e USER_UID=$$(id -u) -e USER_GID=$$(id -g) -e KEEP=$(KEEP) \
	  freelens-addons/act:local ci-local $(JOB)

.env: .env.example
	@[[ -f .env ]] || { cp .env.example .env; sed -i "s|^USER_UID=.*|USER_UID=$$(id -u)|; s|^USER_GID=.*|USER_GID=$$(id -g)|" .env; }
	@grep -qE '^KUBECONFIG_PATH=.+' .env || { echo "KUBECONFIG_PATH is empty in .env" >&2; exit 1; }
