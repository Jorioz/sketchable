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
