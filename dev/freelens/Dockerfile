# node:24-bookworm-slim — Node 24.21.0
FROM node@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node

# debian:bookworm-slim
FROM debian@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251

ARG PNPM_SPEC="pnpm@12.3.4+sha512.961aa41fb077da3a04a441d9f8e15ebc0c96da8ef710b2eb67bf9ee7cb0610eabd48f1fd85f51cffe73846785fa0f87c56a3a872a1d893f8446741b5cce45457"
# Bump both together; the published checksum is <asset>.sha256 beside the release asset.
ARG FREELENS_VERSION=1.10.3
ARG FREELENS_SHA256=f25b7dadbc9e3a7f19b550457d913d01ecbb9c619d7dc7e84dc34995567673b4
ARG TARGETARCH=amd64

# The host's UID, so bind-mounted build output is not owned by root.
ARG USER_UID=1000
ARG USER_GID=1000

ENV DEBIAN_FRONTEND=noninteractive \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/home/dev/.cache/node/corepack \
    PNPM_HOME=/usr/local/share/pnpm \
    PATH=/usr/local/share/pnpm:$PATH

# pipefail: the checksum check below must not hide a failed download.
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

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/include/node /usr/local/include/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -sf /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
    && ln -sf /usr/local/lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
    && node --version && npm --version

# Keep PNPM_SPEC in step with packageManager in the root package.json.
RUN corepack enable pnpm \
    && corepack prepare "${PNPM_SPEC}" --activate \
    && pnpm --version

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
