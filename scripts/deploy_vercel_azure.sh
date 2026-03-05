#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/terraform"
BACKEND_DIR="$ROOT_DIR/backend/functions"
FRONTEND_DIR="$ROOT_DIR/frontend/web"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "❌ Missing required command: $1"
    exit 1
  fi
}

echo "== Azure VM Orchestrator: Fast Deploy (Azure backend + Vercel frontend) =="

require_cmd terraform
require_cmd az
require_cmd node
require_cmd npm
require_cmd zip

if [[ ! -f "$TF_DIR/terraform.tfvars" ]]; then
  echo "❌ Missing $TF_DIR/terraform.tfvars"
  echo "   Copy terraform.tfvars.example and fill in your values first."
  exit 1
fi

echo "\n[1/5] Azure login check..."
az account show >/dev/null 2>&1 || az login >/dev/null

echo "Ensuring Kali marketplace terms are accepted..."
az vm image terms accept --publisher kali-linux --offer kali --plan kali-2025-4 >/dev/null || true

echo "\n[2/5] Deploying infrastructure with Terraform..."
pushd "$TF_DIR" >/dev/null
terraform init -upgrade
terraform apply -auto-approve
FUNCTION_APP_NAME="$(terraform output -raw function_app_name)"
FUNCTION_API_BASE="$(terraform output -raw function_api_base_url)"
popd >/dev/null

echo "\n[3/5] Building and packaging Azure Functions backend..."
pushd "$BACKEND_DIR" >/dev/null
npm install
npm run build

TMP_DIR="$(mktemp -d)"
cp -R dist "$TMP_DIR/"
cp host.json package.json "$TMP_DIR/"
if [[ -f package-lock.json ]]; then
  cp package-lock.json "$TMP_DIR/"
fi

pushd "$TMP_DIR" >/dev/null
npm install --omit=dev --ignore-scripts
zip -qr functionapp.zip .

DEPLOY_ZIP="$TMP_DIR/functionapp.zip"
popd >/dev/null
popd >/dev/null

echo "\n[4/5] Deploying backend ZIP to Function App: $FUNCTION_APP_NAME"
az functionapp deployment source config-zip \
  --name "$FUNCTION_APP_NAME" \
  --resource-group "$(cd "$TF_DIR" && terraform output -raw resource_group_name)" \
  --src "$DEPLOY_ZIP" >/dev/null

echo "\n[5/5] Deploying frontend to Vercel..."
if ! command -v vercel >/dev/null 2>&1; then
  echo "Installing Vercel CLI globally..."
  npm install -g vercel >/dev/null
fi

ORCH_API_KEY="$(grep -E '^[[:space:]]*orchestrator_api_key[[:space:]]*=' "$TF_DIR/terraform.tfvars" | sed -E 's/.*=[[:space:]]*"(.*)"/\1/' | tail -n 1)"
if [[ -z "${ORCH_API_KEY:-}" ]]; then
  echo "❌ Could not read orchestrator_api_key from terraform.tfvars"
  exit 1
fi

pushd "$FRONTEND_DIR" >/dev/null
npm install
VERCEL_URL="$(vercel deploy --prod --yes \
  --build-env ORCHESTRATOR_API_BASE_URL="$FUNCTION_API_BASE/orchestrator" \
  --build-env ORCHESTRATOR_API_KEY="$ORCH_API_KEY" \
  --env ORCHESTRATOR_API_BASE_URL="$FUNCTION_API_BASE/orchestrator" \
  --env ORCHESTRATOR_API_KEY="$ORCH_API_KEY" | tail -n 1)"
popd >/dev/null

echo "\n✅ Done"
echo "Backend API: $FUNCTION_API_BASE/orchestrator"
echo "Frontend URL: $VERCEL_URL"
echo "\nTip: If Vercel asks for login/linking, complete the prompts once. Next runs are mostly automatic."
