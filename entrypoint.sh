#!/bin/sh
set -e

# Remove prerendered static HTML to force runtime SSR with custom settings
# Homepage v1.13.2 bakes en.html/en.json at Docker image build time with empty settings.
# This prevents mounted settings.yaml from being read at runtime.
rm -f /app/.next/server/pages/en.html /app/.next/server/pages/en.json
echo '{"version":4,"routes":{},"dynamicRoutes":{},"notFoundRoutes":[],"preview":{"previewModeId":"0c40a1637270411f8234cc2e99893c6c","previewModeSigningKey":"0d456d40d5e8afa065840017727fd132c00582db5f4cc48dba6350b50d05","previewModeEncryptionKey":"f9e35d5095a6cf8200d73e99d8f80e91afe4a343c49bf25c76421fde6cebf0bf"}}' > /app/.next/prerender-manifest.json

# Patch next-i18next.config.js to add zh-Hans locale support
sed -i 's/locales: \["en"\]/locales: ["en","zh-Hans"]/' /app/next-i18next.config.js

# Homepage fetches iCal server-side. Forward the identity injected by Caddy
# so ical-proxy can select the calendar belonging to the authenticated user.
# Fail loudly after an image upgrade if the known calendar proxy call changes;
# silently falling back would expose the wrong shared calendar.
patched=0
while IFS= read -r file; do
  [ -n "$file" ] || continue
  node - "$file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const source = fs.readFileSync(file, "utf8");
const call = /const\s+\[status,\s*contentType,\s*data\]\s*=\s*await\s+httpProxy\(integration\.url,\s*options\);/;
const replacement = 'options.headers = { ...(options.headers || {}), "X-Authenticated-User": req.headers["x-authenticated-user"] }; const [status, contentType, data] = await httpProxy(integration.url, options);';
if (!call.test(source)) process.exit(2);
fs.writeFileSync(file, source.replace(call, replacement));
NODE
  patched=$((patched + 1))
done <<EOF
$(grep -rl --include='*.js' 'httpProxy(integration.url' /app/.next/server 2>/dev/null || true)
EOF
if [ "$patched" -eq 0 ]; then
  echo "Homepage calendar proxy patch target not found; refusing to start" >&2
  exit 1
fi
echo "Patched calendar proxy identity forwarding in $patched bundle(s)"

# Execute the original entrypoint
exec /usr/local/bin/docker-entrypoint.sh "$@"
