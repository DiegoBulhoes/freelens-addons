# Everything runs in Docker.

SHELL := /bin/bash

# --project-directory keeps `.` and .env meaning the repository root.
COMPOSE := docker compose -f dev/docker-compose.yml --project-directory .
DEV     := $(COMPOSE) run --rm --no-deps --entrypoint sh -w /workspace freelens -lc

-include .env
NOVNC_PORT ?= 6080
NOVNC_URL  := http://localhost:$(NOVNC_PORT)/vnc.html?autoconnect=1&resize=scale

.DEFAULT_GOAL := up

# Restart, not just rebuild: Freelens caches the loaded bundle.
.PHONY: up
up: .env
	$(DEV) "pnpm install && pnpm run -r build"
	$(COMPOSE) up -d --build freelens
	$(COMPOSE) restart freelens
	@echo
	@echo "Freelens is on $(NOVNC_URL)"

.PHONY: down
down:
	$(COMPOSE) down

.PHONY: test
test:
	$(DEV) "pnpm run -r test:coverage"

# Outside the repository, so the kubeconfig cannot be committed.
DEV_KUBECONFIG_DIR ?= /tmp/freelens-addons-k3s

.PHONY: cluster
cluster:
	@mkdir -p $(DEV_KUBECONFIG_DIR)
	DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) $(COMPOSE) --profile cluster up -d k3s
	@echo "waiting for the API server"
	@until [ -r "$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml" ]; do sleep 2; done
	@until KUBECONFIG=$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml kubectl get --raw=/readyz >/dev/null 2>&1; \
	  do sleep 2; done
	@# A ready API server says nothing about the CNI. `kubectl wait` on no node is an error.
	@until KUBECONFIG=$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml \
	  kubectl get nodes -o name 2>/dev/null | grep -q .; do sleep 2; done
	KUBECONFIG=$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml \
	  kubectl wait --for=condition=Ready node --all --timeout=180s
	DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) bash scripts/seed-cluster.sh
	@echo
	@echo "Set KUBECONFIG_PATH in .env to $(DEV_KUBECONFIG_DIR)/kubeconfig.yaml, then 'make up'."

# kubectl on the dev k3s only; refuses any other cluster. make kubectl ARGS="-n mongodb get pods"
.PHONY: kubectl
kubectl:
	@DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) bash scripts/dev-kubectl.sh $(ARGS)

# The kubeconfig is root-owned in sticky /tmp, so the container removes it.
.PHONY: cluster-down
cluster-down:
	-DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) $(COMPOSE) \
	   run --rm --no-deps --entrypoint sh k3s -c 'rm -rf /output/..?* /output/.[!.]* /output/*'
	DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) $(COMPOSE) --profile cluster down -v k3s
	-rmdir $(DEV_KUBECONFIG_DIR)

.PHONY: e2e
e2e: .env
	$(DEV) "pnpm install && pnpm run -r build"
	FREELENS_EXTRA_ARGS=--remote-debugging-port=9222 $(COMPOSE) up -d --build --force-recreate freelens
	@echo "waiting for the debugging port"
	@until curl -sf --max-time 2 http://localhost:9222/json/version >/dev/null; do sleep 2; done
	@# One window: two suites at once would fight over it.
	$(DEV) "pnpm -r --workspace-concurrency=1 run test:e2e"
	@echo
	@echo "Freelens still has its debugging port open. 'make up' puts it back."

# What CI runs, minus the scanners.
.PHONY: check
check:
	$(DEV) "pnpm run lint && pnpm run -r type:check && pnpm run -r test:coverage && pnpm run -r build"
	@bash scripts/verify-bundles.sh
	@bash scripts/sync-design.sh --check
	@bash scripts/verify-supply-chain.sh

.env: .env.example
	@if [ ! -f .env ]; then \
		cp .env.example .env; \
		sed -i "s|^USER_UID=.*|USER_UID=$$(id -u)|; s|^USER_GID=.*|USER_GID=$$(id -g)|" .env; \
		echo "Created .env. Set KUBECONFIG_PATH to your kubeconfig, then run 'make up' again."; \
	fi
	@if ! grep -qE '^KUBECONFIG_PATH=.+' .env; then \
		echo "ERROR: KUBECONFIG_PATH is empty in .env. Set it to an absolute kubeconfig path."; \
		exit 1; \
	fi
