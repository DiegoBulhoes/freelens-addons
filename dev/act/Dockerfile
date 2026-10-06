# node:24-bookworm-slim — Node 24.21.0, as in dev/freelens; act runs JavaScript actions with it.
FROM node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

# ubuntu:24.04, built 2026-09-18
FROM ubuntu@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55

# Bump each pair together; act publishes checksums.txt, Kubernetes a .sha256 beside each binary.
ARG ACT_VERSION=0.2.89
ARG ACT_SHA256=0191d6f1f3b716b5c55820032605d05fc3c1cdbf581ebeff655019e5dd1524c0
ARG KUBECTL_VERSION=1.35.8
ARG KUBECTL_SHA256=874d5e72dbb819f43cff16bcd1e4f8bac5b7f2361fe1e55049b0a6c676fb0cbf

ENV DEBIAN_FRONTEND=noninteractive

# pipefail: a checksum check must not hide a failed download.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# The CLI talks to the host's daemon through its socket; nothing here runs dockerd.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl git jq make docker.io docker-compose-v2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN curl -fsSL -o /tmp/act.tar.gz \
      "https://github.com/nektos/act/releases/download/v${ACT_VERSION}/act_Linux_x86_64.tar.gz" \
    && echo "${ACT_SHA256}  /tmp/act.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/act.tar.gz -C /usr/local/bin act \
    && rm -f /tmp/act.tar.gz \
    && act --version

RUN curl -fsSL -o /usr/local/bin/kubectl \
      "https://dl.k8s.io/release/v${KUBECTL_VERSION}/bin/linux/amd64/kubectl" \
    && echo "${KUBECTL_SHA256}  /usr/local/bin/kubectl" | sha256sum -c - \
    && chmod +x /usr/local/bin/kubectl \
    && kubectl version --client

COPY ci-local.sh /usr/local/bin/ci-local
