# Quick Deploy Guide

<p align="center">
	<strong>From zero to production in the fastest practical CLI-first flow.</strong><br/>
	Azure + Terraform + Vercel, with minimal manual steps.
</p>

---

## What you will have at the end

- Public frontend on Vercel
- Backend API on Azure Functions
- Terraform-managed Azure infrastructure
- Browser-accessible Linux/Windows lab VMs
- One-command redeploy path for daily updates

---

## 1) Prerequisites (install once)

You need these tools:

- Azure CLI
- Terraform (>= 1.6)
- Node.js (>= 20, recommended: 22 LTS) + npm
- Vercel CLI
- zip

### macOS (Homebrew)

```bash
brew update
brew install azure-cli terraform node
brew install zip
npm install -g vercel@latest
```

### Ubuntu / Debian

```bash
sudo apt-get update
sudo apt-get install -y curl unzip zip gnupg software-properties-common

# Azure CLI
curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash

# Terraform
wget -O- https://apt.releases.hashicorp.com/gpg | \
	gpg --dearmor | \
	sudo tee /usr/share/keyrings/hashicorp-archive-keyring.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | \
	sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt-get update && sudo apt-get install -y terraform

# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Vercel CLI
sudo npm install -g vercel@latest
```

### Windows (PowerShell, winget)

```powershell
winget install Microsoft.AzureCLI
winget install Hashicorp.Terraform
winget install OpenJS.NodeJS.LTS
npm install -g vercel@latest
```

### Verify installation

```bash
az version
terraform -version
node -v
npm -v
vercel --version
zip -v
```

---

## 2) Clone repository

```bash
git clone <your-repository-url>
cd azure-vm-orchestrator
```

---

## 3) Configure Terraform variables

If `terraform/terraform.tfvars.example` exists:

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
cd ..
```

If it does not exist, create `terraform/terraform.tfvars` manually:

```hcl
subscription_id       = "<azure-subscription-id>"
tenant_id             = "<azure-tenant-id>"
orchestrator_api_key  = "<very-strong-random-secret>"
frontend_origin       = "https://your-project.vercel.app"

# Optional
allowed_client_cidr   = "0.0.0.0/0"
location              = "switzerlandnorth"
```

Minimum required values:

- `subscription_id`
- `tenant_id`
- `orchestrator_api_key`
- `frontend_origin`

---

## 4) Login (CLI-first)

```bash
az login
az account set --subscription "<your-subscription-id>"
vercel login
```

Tip: `vercel login` is usually needed only once per machine.

---

## 5) Fast deploy (recommended)

Run the deployment script from repository root:

```bash
chmod +x scripts/deploy_vercel_azure.sh
./scripts/deploy_vercel_azure.sh
```

The script performs:

1. Terraform init + apply
2. Backend build and zip packaging
3. Azure Function App zip deployment
4. Frontend deployment to Vercel
5. Output of live URLs

---

## 6) Post-deploy checks

Open your Vercel URL and validate:

1. Dashboard loads
2. Create VM works
3. Viewer status progresses to ready
4. Pause / Resume / Extend / Terminate work
5. Image Menu is reachable and functional

Optional backend health check:

```bash
API_KEY="<same orchestrator_api_key from terraform.tfvars>"
curl -s -H "x-api-key: $API_KEY" -H "x-user-id: smoke-test" \
	"https://<your-function-app>.azurewebsites.net/api/orchestrator/vms"
```

---

## 7) Known reliability fallback (if script partially fails)

Sometimes Terraform can fail with transient Azure API read/reset errors during app settings operations.

### Safe retry path

Run the script again:

```bash
./scripts/deploy_vercel_azure.sh
```

### Backend-only deploy fallback

If infra already exists and only backend code changed:

```bash
cd backend/functions
npm install
npm run build

TMP_DIR=$(mktemp -d)
cp -R dist "$TMP_DIR/"
cp host.json package.json "$TMP_DIR/"
[ -f package-lock.json ] && cp package-lock.json "$TMP_DIR/"

cd "$TMP_DIR"
npm install --omit=dev --ignore-scripts
zip -qr functionapp.zip .

az functionapp deployment source config-zip \
	--name "<function-app-name>" \
	--resource-group "<resource-group-name>" \
	--src "$TMP_DIR/functionapp.zip"
```

---

## 8) Daily workflow (very fast)

For normal changes:

```bash
./scripts/deploy_vercel_azure.sh
```

For frontend-only changes:

```bash
cd frontend/web
npm install
vercel deploy --prod
```

---

## 9) Important configuration notes

- Default region is `switzerlandnorth`
- Function runtime is configured for Node.js 20 in Azure
- Local development should use Node.js 20+ (22 LTS recommended)
- VMs are session-scoped in current isolation model
- VM TTL defaults to `ORCH_VM_LIFETIME_MIN=60`

---

## 10) Troubleshooting quick list

### `Unauthorized` from orchestrator API

Check that `orchestrator_api_key` in Terraform matches what frontend uses.

### Terraform apply fails with transient Azure errors

Retry the command. Most failures are temporary control-plane/API interruptions.

### Vercel asks to link project

Complete prompts once; subsequent deploys are usually non-interactive.

### Viewer is slow to become ready

This can happen when no matching pre-warmed VM is available and a full start is required.

---

## 11) One-screen command recap

```bash
az login
az account set --subscription "<your-subscription-id>"
vercel login

chmod +x scripts/deploy_vercel_azure.sh
./scripts/deploy_vercel_azure.sh
```

That is the fastest complete path for initial setup and repeated deployments.
