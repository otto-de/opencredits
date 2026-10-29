# syntax=docker/dockerfile:1
# Pin base images by digest in production (Dependabot keeps them updated).
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY test ./test
RUN npx tsc -p tsconfig.json

FROM ${NODE_IMAGE} AS syft
# Verify the latest Syft release before building and keep this value current.
ARG SYFT_VERSION=1.18.1
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /tmp/syft
RUN set -eu; \
    arch="$(dpkg --print-architecture)"; \
    file="syft_${SYFT_VERSION}_linux_${arch}.tar.gz"; \
    base="https://github.com/anchore/syft/releases/download/v${SYFT_VERSION}"; \
    curl -fsSLO "${base}/${file}"; \
    curl -fsSLO "${base}/syft_${SYFT_VERSION}_checksums.txt"; \
    grep " ${file}\$" "syft_${SYFT_VERSION}_checksums.txt" | sha256sum -c -; \
    tar -xzf "${file}" syft; \
    install -m 0755 syft /usr/local/bin/syft

FROM ${NODE_IMAGE}
LABEL org.opencontainers.image.title="OpenCredits" \
      org.opencontainers.image.description="Publishes an accessible open source license page" \
      org.opencontainers.image.licenses="Apache-2.0"
ENV NODE_ENV=production \
    OPENCREDITS_LOG_LEVEL=info
WORKDIR /app
# OpenCredits has no runtime dependencies, so no node_modules are copied.
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist/src ./dist/src
COPY --from=syft /usr/local/bin/syft /usr/local/bin/syft
COPY LICENSE NOTICE ./
USER node
ENTRYPOINT ["node", "/app/dist/src/cli.js"]
CMD ["--help"]
