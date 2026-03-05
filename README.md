# Azure VM Orchestrator

<p align="center">
  Browser-first VM lab orchestration on Azure with a modern Next.js control plane.
</p>

<p align="center">
  <img alt="Frontend" src="https://img.shields.io/badge/Frontend-Next.js-111827?style=for-the-badge&logo=nextdotjs" />
  <img alt="Backend" src="https://img.shields.io/badge/Backend-Azure%20Functions-0EA5E9?style=for-the-badge&logo=microsoftazure" />
  <img alt="Infra" src="https://img.shields.io/badge/Infra-Terraform-7C3AED?style=for-the-badge&logo=terraform" />
  <img alt="Cloud" src="https://img.shields.io/badge/Cloud-Azure-2563EB?style=for-the-badge&logo=microsoftazure" />
</p>

---

## Why this project exists

Azure VM Orchestrator gives you a single web UI to spin up short-lived Linux/Windows lab machines in Azure, open them in the browser, and clean them up automatically.

It is optimized for:

- Fast classroom/lab onboarding
- Cost-controlled temporary environments
- Multi-user sessions with ownership isolation
- Browser-native access through a central gateway

---

## Key capabilities

### VM lifecycle

- Create VMs from Azure marketplace images or custom managed images
- Pause, resume, extend, and terminate VMs from the dashboard
- Auto-expiration and cleanup based on TTL

### Browser access

- Central Guacamole gateway for Linux and Windows sessions
- Viewer readiness/progress status in the UI
- File transfer workflow and clipboard helper tools

### Image workflow

- Upload `.vhd` / `.vhdx` / `.img` files to Azure Storage
- Convert uploaded files into managed images
- Assign images to custom areas/topics for simplified launch flows

### Performance-oriented orchestration

- Premium Azure Functions hosting with `always_on`
- Pre-warmed pool logic for topic-specific starts
- Async gateway registration and optimized VM list/status refresh paths

---

## Architecture

| Layer | Tech | Purpose |
|---|---|---|
| Frontend | Next.js App Router | Dashboard, image menu, user interactions |
| Frontend API proxy | Next.js Route Handlers | Auth/header forwarding and payload normalization |
| Backend | Azure Functions (TypeScript) | VM orchestration and business logic |
| Cloud APIs | Azure SDKs | Compute, network, storage operations |
| Infra as Code | Terraform | Provision Azure resources and app settings |

Core directories:

- `frontend/web` — web app and proxy API routes
- `backend/functions` — orchestration functions
- `terraform` — Azure infrastructure definitions
- `scripts/deploy_vercel_azure.sh` — fastest deployment script

---

## Security and isolation model

- API key between frontend proxy and backend
- Per-session user ownership tags on managed VMs
- Backend-side ownership checks before VM mutations
- Sensitive values provided via Terraform variables and app settings

This is session-based isolation. For strict enterprise identity separation, add real auth (for example Microsoft Entra ID).

---

## Requirements

- Azure subscription
- Vercel account
- Terraform `>= 1.6`
- Azure CLI
- Node.js `>= 20` (22 LTS recommended)
- npm
- zip

---

## Quick start

Use the full guide in [QUICK_DEPLOY.md](QUICK_DEPLOY.md).

Minimal flow:

1. Install prerequisites
2. Create `terraform/terraform.tfvars`
3. Run `az login` and `vercel login`
4. Execute `./scripts/deploy_vercel_azure.sh`

---

## Operational notes

- Default Azure region is `switzerlandnorth`
- Public URLs work without custom domains:
  - Vercel: `*.vercel.app`
  - Azure Function API: `*.azurewebsites.net`
- On occasional Azure API hiccups during Terraform apply, rerun the command (guide includes fallback steps)

---

## Documentation

- Full setup and deployment: [QUICK_DEPLOY.md](QUICK_DEPLOY.md)

