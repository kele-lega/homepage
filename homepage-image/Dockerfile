# syntax=docker/dockerfile:1
# Build the pinned upstream release with reviewable source-level compatibility patches.
FROM node:22-slim AS source
WORKDIR /app
ADD --checksum=sha256:77ee38462b91f794166c49e4e12a5c8caf0da33ab36b264d778c5905c8f920b7 https://codeload.github.com/gethomepage/homepage/tar.gz/6b6926108e35c3902dd23f6bc337162b7289450b /tmp/homepage.tar.gz
RUN tar -xzf /tmp/homepage.tar.gz --strip-components=1 && mkdir -p config
COPY apply-patches.mjs /tmp/apply-patches.mjs
RUN node /tmp/apply-patches.mjs /app

FROM source AS dependencies
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
RUN --mount=type=cache,id=homepage-pnpm,target=/pnpm/store pnpm install --frozen-lockfile --store-dir=/pnpm/store

FROM dependencies AS test
COPY tests/ src/__tests__/local/
RUN pnpm exec vitest run src/__tests__/local src/__tests__/pages/api/auth src/__tests__/pages/auth src/middleware.test.js src/widgets/calendar/proxy.test.js src/components/toggles/signout.test.jsx --maxWorkers=2

FROM test AS builder
ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_VERSION=v2.4.0
ENV NEXT_PUBLIC_REVISION=6b6926108e35c3902dd23f6bc337162b7289450b
RUN find src -type f \( -name '*.test.*' -o -name '*.spec.*' \) -delete && pnpm run build

FROM ghcr.io/gethomepage/homepage:v2.4.0 AS runner
# Drop the base image's prebuilt app; keep its public assets and runtime tooling.
RUN rm -rf /app/.next /app/node_modules
COPY --from=builder --chown=1000:1000 /app/.next/standalone/ /app/
COPY --from=builder --chown=1000:1000 /app/.next/static/ /app/.next/static/
LABEL org.opencontainers.image.version="v2.4.0-local.1"
LABEL org.opencontainers.image.revision="6b6926108e35c3902dd23f6bc337162b7289450b"
