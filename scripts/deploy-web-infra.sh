#!/usr/bin/env bash
# Create/update the web-hosting stack (S3 + CloudFront) for an environment.
# Run this rarely — only when the hosting infra changes. ACM cert must be us-east-1.
#
# Usage:  scripts/deploy-web-infra.sh <prod|staging>
# Required env vars:
#   WEB_BUCKET        e.g. sketchable-web        (prod) / sketchable-web-staging
#   WEB_ALIASES       e.g. sketchable.jorio.dev  (or staging.sketchable.jorio.dev)
#   WEB_CERT_ARN      ACM cert ARN in us-east-1 covering WEB_ALIASES
set -euo pipefail

ENV="${1:?usage: deploy-web-infra.sh <prod|staging>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${WEB_BUCKET:?set WEB_BUCKET}"
: "${WEB_ALIASES:?set WEB_ALIASES}"
: "${WEB_CERT_ARN:?set WEB_CERT_ARN}"

# CloudFront is global; deploy this stack in us-east-1 to keep it near the cert.
aws cloudformation deploy \
    --region us-east-1 \
    --stack-name "sketchable-web-$ENV" \
    --template-file "$ROOT/backend/web/template.yaml" \
    --no-fail-on-empty-changeset \
    --parameter-overrides \
        "WebBucketName=$WEB_BUCKET" \
        "DomainAliases=$WEB_ALIASES" \
        "AcmCertificateArn=$WEB_CERT_ARN"

echo "Outputs:"
aws cloudformation describe-stacks --region us-east-1 \
    --stack-name "sketchable-web-$ENV" \
    --query "Stacks[0].Outputs" --output table
