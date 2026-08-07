#!/bin/sh
set -e

# Remove prerendered static HTML to force runtime SSR with custom settings
# Homepage v1.13.2 bakes en.html/en.json at Docker image build time with empty settings.
# This prevents mounted settings.yaml from being read at runtime.
rm -f /app/.next/server/pages/en.html /app/.next/server/pages/en.json
echo '{"version":4,"routes":{},"dynamicRoutes":{},"notFoundRoutes":[],"preview":{"previewModeId":"0c40a1637270411f8234cc2e99893c6c","previewModeSigningKey":"0d456d40d5e8afa065840017727fd132c00582db5f4cc159c48dba6350b50d05","previewModeEncryptionKey":"f9e35d5095a6cf8200d73e99d8f80e91afe4a343c49bf25c76421fde6cebf0bf"}}' > /app/.next/prerender-manifest.json

# Patch next-i18next.config.js to add zh-Hans locale support
sed -i 's/locales: \["en"\]/locales: ["en","zh-Hans"]/' /app/next-i18next.config.js

# Execute the original entrypoint
exec /usr/local/bin/docker-entrypoint.sh "$@"
