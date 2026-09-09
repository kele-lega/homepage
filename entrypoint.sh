#!/bin/sh
set -e

# Remove prerendered static HTML to force runtime SSR with custom settings
# Homepage v1.13.2 bakes en.html/en.json at Docker image build time with empty settings.
# This prevents mounted settings.yaml from being read at runtime.
rm -f /app/.next/server/pages/en.html /app/.next/server/pages/en.json
echo '{"version":4,"routes":{},"dynamicRoutes":{},"notFoundRoutes":[],"preview":{"previewModeId":"0c40a1637270411f8234cc2e99893c6c","previewModeSigningKey":"0d456d40d5e8afa065840017727fd132c00582db5f4cc48dba6350b50d05","previewModeEncryptionKey":"f9e35d5095a6cf8200d73e99d8f80e91afe4a343c49bf25c76421fde6cebf0bf"}}' > /app/.next/prerender-manifest.json

# Patch next-i18next.config.js to add zh-Hans locale support
sed -i 's/locales: \["en"\]/locales: ["en","zh-Hans"]/' /app/next-i18next.config.js

# Patch Homepage's current calendar proxy handler so native iCal widgets
# forward the authenticated user to the per-user iCal proxy. The handler's
# first parameter is Next's request object; do not use lexical `arguments`.
candidates=$(find /app/.next/server -type f -name '*.js' -exec grep -l 'calendarProxyHandler' {} + 2>/dev/null || true)
candidate_count=$(printf '%s\n' "$candidates" | sed '/^$/d' | wc -l)
if [ "$candidate_count" -ne 1 ]; then
  echo "Expected exactly one Homepage calendar proxy bundle, found $candidate_count; refusing to start" >&2
  exit 1
fi
file=$candidates
if node - "$file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
let source = fs.readFileSync(file, "utf8");
const signature = 'async function i(a,b){let{group:c,service:d,endpoint:f,index:h}=a.query;';
const signatureReplacement = 'async function i(req,b){let{group:c,service:d,endpoint:f,index:h}=req.query;';
const current = 'let a={};i.url?.includes("outlook")&&(a.headers={"User-Agent":"gethomepage/v1.13.2"});let[c,d,e]=await (0,g.d1)(i.url,a);';
const replacement = 'let p={};req.headers?.["x-authenticated-user"]&&(p.headers={"X-Authenticated-User":req.headers["x-authenticated-user"]}),i.url?.includes("outlook")&&(p.headers={...(p.headers||{}),"User-Agent":"gethomepage/v1.13.2"});let[c,d,e]=await (0,g.d1)(i.url,p);';
const patchedCall = 'req.headers?.["x-authenticated-user"]';
if (source.includes(patchedCall)) {
  if (!source.includes(signatureReplacement)) process.exit(3);
  process.stdout.write("calendar identity patch already present\n");
} else {
  if ((source.split(signature).length - 1) !== 1 || (source.split(current).length - 1) !== 1) process.exit(2);
  source = source.replace(signature, signatureReplacement).replace(current, replacement);
  if (!source.includes(signatureReplacement) || !source.includes(patchedCall)) process.exit(3);
  fs.writeFileSync(file, source);
  process.stdout.write("calendar identity patch applied\n");
}
NODE
then
  echo "Verified calendar identity forwarding in $file"
else
  echo "Homepage calendar proxy patch failed verification; refusing to start" >&2
  exit 1
fi

# Execute the original entrypoint
exec /usr/local/bin/docker-entrypoint.sh "$@"
