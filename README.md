# Azure VM Orchestrator

Production-oriented starter kit for managing short-lived Azure VMs from a modern web app.

## What This Project Does

- Deploys a **public web app** on Vercel (`*.vercel.app`)
- Uses Azure Functions as orchestration backend
- Creates, pauses, resumes, extends, and terminates Azure VMs
- Supports multiple concurrent VMs and split viewer access in the UI
- Enforces automatic VM expiration (default TTL: 60 minutes)

## Architecture

- **Frontend:** Next.js (`frontend/web`)
- **API Gateway/Proxy:** Next.js server routes (`frontend/web/app/api/orchestrator/...`)
- **Backend:** Azure Functions (`backend/functions`)
- **Infra as Code:** Terraform (`terraform`)

## Core Features

- VM lifecycle controls: `Create`, `Pause`, `Resume`, `Extend +2h`, `Terminate`
- Auto-cleanup of expired VMs
- noVNC access flow with in-app viewer + open-in-new-tab option
- Clipboard helper controls (`Paste`/`Copy`)
- Session-based user isolation for VM lists/actions

## Security Model (Current)

- API key required between frontend proxy and backend
- Ownership tags on VMs (`ownerId`) checked for mutations
- Secrets expected in local env/tfvars and cloud environment variables
- Sensitive files are ignored by `.gitignore`

## Fastest Way to Run It

Use the complete from-zero guide:

- [QUICK_DEPLOY.md](QUICK_DEPLOY.md)

That guide starts with only:
- an Azure subscription,
- a Vercel account,
- and this repository.

## Repository Layout

- `terraform/` Infrastructure resources (RG, networking, Function App, settings)
- `backend/functions/` VM orchestration handlers and Azure SDK logic
- `frontend/web/` Dashboard UI and proxy API routes
- `scripts/deploy_vercel_azure.sh` Mostly-automated deployment script
- `QUICK_DEPLOY.md` End-to-end operational guide

## Important Notes

- Default region is configured for `switzerlandnorth`.
- Public URLs can be used without buying a custom domain:
  - Vercel: `*.vercel.app`
  - Azure Function App: `*.azurewebsites.net`
- For stronger multi-user isolation, add real auth (Entra/NextAuth) in a future step.
