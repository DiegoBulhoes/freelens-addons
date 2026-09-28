# Freelens running headless on Xvfb, reachable over noVNC in a browser, with the
# toolchain that builds the extensions in the same image.
#
# One image rather than two: the only thing either container is for is
# developing these extensions, and the app image already needed Node.
#
# Supply-chain notes, because this image pulls binaries from the internet:
#   - base images are pinned by digest, not by a floating tag;
#   - Node is copied from the official image instead of piping a vendor install
#     script into a shell;
#   - the Freelens .deb is checked against a checksum committed to this repo.
#     Bumping FREELENS_VERSION requires bumping FREELENS_SHA256 with it; the
#     published checksum lives next to the asset as <asset>.sha256.

# node:24-bookworm-slim — Node 24.21.0
FROM node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

# debian:bookworm-slim
FROM debian@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

ARG PNPM_SPEC="pnpm@12.3.4+sha512.961aa41fb077da3a04a441d9f8e15ebc0c96da8ef710b2eb67bf9ee7cb0610eabd48f1fd85f51cffe73846785fa0f87c56a3a872a1d893f8446741b5cce45457"
ARG FREELENS_VERSION=1.10.3
ARG FREELENS_SHA256=f25b7dadbc9e3a7f19b550457d913d01ecbb9c619d7dc7e84dc34995567673b4
ARG TARGETARCH=amd64

# Matching the host UID keeps bind-mounted build output owned by the caller
# instead of by root.
ARG USER_UID=1000
ARG USER_GID=1000

ENV DEBIAN_FRONTEND=noninteractive \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/home/dev/.cache/node/corepack \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH

# Without pipefail, only the last command in a pipeline decides the exit status,
# so a failed download upstream of a pipe would pass unnoticed. The checksum
# verification below depends on this.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
      xvfb x11vnc x11-utils openbox novnc websockify \
      dbus-x11 \
      libgtk-3-0 libnss3 libasound2 libgbm1 libxss1 libxtst6 libxkbcommon0 \
      libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libpango-1.0-0 libcairo2 \
      libsecret-1-0 libnotify4 \
      fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# Node, for building the extensions. Taken from the official image so nothing is
# fetched from a third-party install script.
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/include/node /usr/local/include/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -sf /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && node --version && npm --version

# pnpm, fetched and verified at build time into the cache the runtime uses. The
# spec carries corepack's own integrity hash, so this pins the version and
# checks what was downloaded. Keep it in step with packageManager in the root
# package.json.
RUN corepack enable pnpm \
    && corepack prepare "${PNPM_SPEC}" --activate \
    && pnpm --version

# Freelens, verified against the checksum pinned above.
RUN curl -fsSL -o /tmp/freelens.deb \
      "https://github.com/freelensapp/freelens/releases/download/v${FREELENS_VERSION}/Freelens-${FREELENS_VERSION}-linux-${TARGETARCH}.deb" \
    && echo "${FREELENS_SHA256}  /tmp/freelens.deb" | sha256sum -c - \
    && apt-get update \
    && apt-get install -y --no-install-recommends /tmp/freelens.deb \
    && rm -f /tmp/freelens.deb \
    && rm -rf /var/lib/apt/lists/*

# -l keeps the login records from being padded out to the size of the UID.
RUN groupadd -g "${USER_GID}" dev \
    && useradd -l -m -u "${USER_UID}" -g "${USER_GID}" -s /bin/bash dev \
    && mkdir -p /home/dev/.freelens/extensions /home/dev/.kube /home/dev/.config/Freelens \
                "${PNPM_HOME}/store" "${COREPACK_HOME}" \
    && chown -R dev:dev /home/dev "${PNPM_HOME}"

COPY entrypoint.sh seed-extensions.mjs /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

USER dev
WORKDIR /home/dev

ENV DISPLAY=:99 \
    SCREEN_GEOMETRY=1600x900x24 \
    VNC_PORT=5900 \
    NOVNC_PORT=6080 \
    KUBECONFIG=/home/dev/.kube/config

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
