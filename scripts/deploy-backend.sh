#!/usr/bin/env bash
# Deploy the Sketchable API (Lambda + HTTP API) for an environment.
# Assembles non-secret params from backend/lambda/params/<env>.env and pulls
# secrets from SSM SecureString, then `sam deploy`s the complete set.
#
# Usage:  scripts/deploy-backend.sh <prod|staging>
set -euo pipefail

ENV="${1:?usage: deploy-backend.sh <prod|staging>}"
REGION="${AWS_REGION:-us-east-2}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LAMBDA_DIR="$ROOT/backend/lambda"
PARAMS_FILE="$LAMBDA_DIR/params/$ENV.env"

[ -f "$PARAMS_FILE" ] || { echo "Missing $PARAMS_FILE (copy $ENV.env.example)"; exit 1; }

# Emit SAM's long parameter-override form. Unlike the `Key=Value` shorthand, this
# accepts EMPTY values (e.g. WebACLId= to disable WAF on staging, or an absent SSM
# secret that should leave a feature disabled) — the shorthand rejects those.
OVERRIDES=()
add_override() { OVERRIDES+=("ParameterKey=$1,ParameterValue=$2"); }

# --- non-secret params from the env file --------------------------------------
while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac      # skip blanks/comments
    add_override "${line%%=*}" "${line#*=}"        # split on the first '='
done < "$PARAMS_FILE"

# --- secrets from SSM (empty if absent -> feature stays disabled) -------------
ssm() {
    aws ssm get-parameter --name "$1" --with-decryption \
        --region "$REGION" --query Parameter.Value --output text 2>/dev/null || true
}
PREFIX="/sketchable/$ENV"
add_override "ScriptTokenSecret"     "$(ssm "$PREFIX/script-token-secret")"
add_override "Auth0MgmtClientSecret" "$(ssm "$PREFIX/auth0-mgmt-client-secret")"
add_override "VapidPrivateKey"       "$(ssm "$PREFIX/vapid-private-key")"

cd "$LAMBDA_DIR"
sam build
sam deploy \
    --config-env "$ENV" \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset \
    --parameter-overrides "${OVERRIDES[@]}"
