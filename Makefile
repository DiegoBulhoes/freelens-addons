# For the agent and CI; everything runs in Docker.

SHELL := /bin/bash

-include .env
# Overridden by dev/act/run.sh to run a second setup beside this one.
PROJECT            ?= freelens-addons
DEBUG_PORT         ?= 9222
# Outside the repository, so the kubeconfig cannot be committed.
DEV_KUBECONFIG_DIR ?= /tmp/freelens-addons-k3s
export DEV_KUBECONFIG_DIR
PACKAGE ?=
FILES   ?=

OSV_SCANNER := $(shell grep -oE 'ghcr\.io/google/osv-scanner@sha256:[0-9a-f]{64}' scripts/security/scan.sh)
# --project-directory keeps `.` and .env meaning the repository root.
COMPOSE := docker compose -p $(PROJECT) -f dev/docker-compose.yml --project-directory .
DEV     := $(COMPOSE) run --rm --no-deps -e FREELENS_DEBUG_PORT=$(DEBUG_PORT) --entrypoint sh -w /workspace freelens -lc
# -C fails on a mistyped name; -r goes one package at a time (one window) and on past a failure.
E2E_RUN := $(if $(PACKAGE),pnpm -C packages/$(PACKAGE) run,pnpm -r --no-bail --workspace-concurrency=1 run)

.PHONY: up check cluster cluster-down e2e-freelens e2e e2e-writes

# Restart, not just rebuild: Freelens caches the loaded bundle.
up: .env
	$(DEV) "pnpm install && pnpm run -r build"
	$(COMPOSE) up -d --build freelens
	$(COMPOSE) restart freelens

check:
	bash scripts/security/osv-direct.sh "$(OSV_SCANNER)"
	$(DEV) "pnpm install --frozen-lockfile && pnpm run lint && pnpm run -r type:check \
	  && pnpm run -r test:coverage && pnpm run -r build && bash scripts/checks/verify-bundles.sh"
	bash scripts/checks/copy-design-standard.sh --check
	bash scripts/checks/e2e-legs.sh
	bash scripts/security/verify-supply-chain.sh

cluster:
	mkdir -p $(DEV_KUBECONFIG_DIR)
	$(COMPOSE) --profile cluster up -d k3s
	bash dev/cluster/cluster.sh install $(if $(PACKAGE),--for $(PACKAGE))

# The kubeconfig is root-owned in sticky /tmp, so the container removes it.
cluster-down:
	-$(COMPOSE) run --rm --no-deps --entrypoint sh k3s -c 'rm -rf /output/..?* /output/.[!.]* /output/*'
	$(COMPOSE) --profile cluster down -v k3s
	-rmdir $(DEV_KUBECONFIG_DIR)

# Freelens with the debugging port the suites drive; make up closes it again.
e2e-freelens: .env
	$(DEV) "pnpm install && pnpm run -r build"
	FREELENS_EXTRA_ARGS=--remote-debugging-port=$(DEBUG_PORT) $(COMPOSE) up -d --build --force-recreate freelens
	until curl -sf --max-time 2 http://localhost:$(DEBUG_PORT)/json/version >/dev/null; do sleep 2; done

# The Prometheus suites read the operator's rejection Events, which expire after an hour.
e2e: e2e-freelens
	$(if $(filter-out prometheus,$(PACKAGE)),,bash dev/cluster/cluster.sh rejections)
	$(DEV) "$(E2E_RUN) test:e2e $(FILES)"

# --if-present: trivy and prometheus have no writes.
e2e-writes: e2e-freelens
	$(DEV) "$(E2E_RUN) --if-present test:e2e-writes $(FILES)"

.env: .env.example
	@[[ -f .env ]] || { cp .env.example .env; sed -i "s|^USER_UID=.*|USER_UID=$$(id -u)|; s|^USER_GID=.*|USER_GID=$$(id -g)|" .env; }
	@grep -qE '^KUBECONFIG_PATH=.+' .env || { echo "KUBECONFIG_PATH is empty in .env" >&2; exit 1; }
