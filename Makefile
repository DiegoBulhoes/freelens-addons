# Everything runs in Docker. The host needs Docker and a kubeconfig, nothing else.

SHELL := /bin/bash

# The compose file lives in dev/ with the rest of the workbench; --project-directory
# keeps relative paths and .env resolving from the repository root.
COMPOSE := docker compose -f dev/docker-compose.yml --project-directory .
DEV     := $(COMPOSE) run --rm --no-deps --entrypoint sh -w /workspace freelens -lc

-include .env
NOVNC_PORT ?= 6080
NOVNC_URL  := http://localhost:$(NOVNC_PORT)/vnc.html?autoconnect=1&resize=scale

.DEFAULT_GOAL := up

# Builds first, then restarts: Freelens caches the loaded bundle and only reads
# it again at startup, so starting without restarting shows the previous build.
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

# The coverage thresholds are part of the run, so a pass here is a pass in CI.
.PHONY: test
test:
	$(DEV) "pnpm run -r test:coverage"

# A cluster of its own, so developing an extension never points at something
# that matters. The kubeconfig goes to /tmp: it cannot be committed and does
# not survive a reboot.
DEV_KUBECONFIG_DIR ?= /tmp/freelens-addons-k3s

.PHONY: cluster
cluster:
	@mkdir -p $(DEV_KUBECONFIG_DIR)
	DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) $(COMPOSE) --profile cluster up -d k3s
	@echo "waiting for the API server"
	@until [ -r "$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml" ]; do sleep 2; done
	@until KUBECONFIG=$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml kubectl get --raw=/readyz >/dev/null 2>&1; \
	  do sleep 2; done
	@# A ready API server says nothing about the node: if the CNI cannot come up,
	@# every pod stays in ContainerCreating. Fail here rather than in a rollout
	@# five minutes later. The node registers a moment after the API answers, and
	@# `kubectl wait` on nothing is an error, so wait for it to exist first.
	@until KUBECONFIG=$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml \
	  kubectl get nodes -o name 2>/dev/null | grep -q .; do sleep 2; done
	KUBECONFIG=$(DEV_KUBECONFIG_DIR)/kubeconfig.yaml \
	  kubectl wait --for=condition=Ready node --all --timeout=180s
	DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) bash scripts/seed-cluster.sh
	@echo
	@echo "Set KUBECONFIG_PATH in .env to $(DEV_KUBECONFIG_DIR)/kubeconfig.yaml, then 'make up'."

# Takes the volume with it: being disposable is the point of this cluster.
#
# k3s writes the kubeconfig as root, so the container clears it before the
# container is gone. Removing it from here would depend on who happens to own
# the directory, and /tmp is sticky.
.PHONY: cluster-down
cluster-down:
	-DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) $(COMPOSE) \
	   run --rm --no-deps --entrypoint sh k3s -c 'rm -rf /output/..?* /output/.[!.]* /output/*'
	DEV_KUBECONFIG_DIR=$(DEV_KUBECONFIG_DIR) $(COMPOSE) --profile cluster down -v k3s
	-rmdir $(DEV_KUBECONFIG_DIR)

# End-to-end: drives the real Freelens through the Chrome DevTools Protocol.
# Not part of `check` — it needs a cluster and a window, and takes far longer
# than the unit suites. The debugging port only listens on loopback.
.PHONY: e2e
e2e: .env
	$(DEV) "pnpm install && pnpm run -r build"
	FREELENS_EXTRA_ARGS=--remote-debugging-port=9222 $(COMPOSE) up -d --build --force-recreate freelens
	@echo "waiting for the debugging port"
	@until curl -sf --max-time 2 http://localhost:9222/json/version >/dev/null; do sleep 2; done
	@# One window and one cluster, so the packages run one after another rather
	@# than both driving the same UI at once.
	$(DEV) "pnpm -r --workspace-concurrency=1 run test:e2e"
	@echo
	@echo "Freelens still has its debugging port open. 'make up' puts it back."

# What CI runs, minus the scanners, which need to pull their images.
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
