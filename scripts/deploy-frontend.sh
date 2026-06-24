#!/usr/bin/env bash
# Build the SPA for an environment and publish it to S3 + invalidate CloudFront.
#
# Usage:  scripts/deploy-frontend.sh <prod|staging>
# Required env vars:
#   WEB_BUCKET         target hosting bucket (from the web-infra stack output)
#   DISTRIBUTION_ID    CloudFront distribution id (from the web-infra stack output)
# The build reads frontend/.env.production (prod) or .env.staging (staging).
set -euo pipefail

ENV="${1:?usage: deploy-frontend.sh <prod|staging>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FE="$ROOT/frontend"
: "${WEB_BUCKET:?set WEB_BUCKET}"
: "${DISTRIBUTION_ID:?set DISTRIBUTION_ID}"

case "$ENV" in
    prod)    MODE="production" ;;
    staging) MODE="staging" ;;
    *) echo "env must be prod|staging"; exit 1 ;;
esac

cd "$FE"

# Fail fast if the build env is missing/empty — otherwise Vite ships a bundle
# with no Auth0 config and the live app silently can't log in.
ENVFILE=".env.$MODE"
if ! grep -qE '^VITE_AUTH0_DOMAIN=.+' "$ENVFILE" 2>/dev/null \
   || ! grep -qE '^VITE_AUTH0_CLIENT_ID=.+' "$ENVFILE" 2>/dev/null; then
    echo "ERROR: $ENVFILE is missing VITE_AUTH0_DOMAIN / VITE_AUTH0_CLIENT_ID." >&2
    echo "In CI this comes from the FRONTEND_ENV GitHub *Variable* (not a Secret)" >&2
    echo "on the '$ENV' environment. Locally, copy .env.$MODE.example -> .env.$MODE." >&2
    exit 1
fi

npm ci
npm run build -- --mode "$MODE"

# Hashed assets: cache hard. index.html / sw.js / manifest: must revalidate so
# clients pick up new deploys immediately.
aws s3 sync dist/ "s3://$WEB_BUCKET/" --delete \
    --cache-control "public,max-age=31536000,immutable" \
    --exclude "index.html" --exclude "sw.js" --exclude "manifest.webmanifest"
aws s3 sync dist/ "s3://$WEB_BUCKET/" \
    --cache-control "no-cache" \
    --exclude "*" --include "index.html" --include "sw.js" --include "manifest.webmanifest"

aws cloudfront create-invalidation \
    --distribution-id "$DISTRIBUTION_ID" \
    --paths "/index.html" "/sw.js" "/manifest.webmanifest"
