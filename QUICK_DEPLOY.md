# Quick Deploy — Complete Guide (From Zero to Live)

This is the **single source of truth** to go from:

- Azure subscription 
- Vercel account 
- local code checkout 

to a fully working public app:

- Frontend on `https://<your-project>.vercel.app`
- Backend on Azure Functions
- VM lifecycle controls from the UI

---

## 0) What you get at the end

- Create Azure VMs from the web UI
- Loading state while VM is being provisioned
- Access VM through viewer/noVNC when ready
- `Paste` / `Copy` helper controls in UI
- Auto-expiration after 60 minutes (default)
- Manual `Pause`, `Resume`, `Terminate`
- Multiple VMs per user, with session-level isolation

---

## 1) One-time local prerequisites

Install these tools locally:

- Terraform `>= 1.6`
- Azure CLI (`az`)
- Node.js `>= 20`
- npm
- Vercel CLI (optional, script can install it automatically)

Verify:

```bash
terraform -version
az version
node -v
npm -v
```

---

## 2) Clone and enter project

```bash
git clone <your-repo-url>
cd azure-vm-orchestrator
```

---

## 3) Create your Terraform config file (required)

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
```

Open `terraform.tfvars` and set real values:

- `subscription_id`
- `tenant_id`
- `client_id`
- `client_secret`
- `orchestrator_api_key` (choose a strong secret)
- `frontend_origin` (use `https://<your-project>.vercel.app` after first deploy)

Optional:

- `allowed_client_cidr` (IP restriction)

Return to project root:

```bash
cd ..
```

---

## 4) Login to Azure and Vercel

```bash
az login
vercel login
```

> `vercel login` is usually needed only once.

---

## 5) Run the automation script (main path)

```bash
chmod +x scripts/deploy_vercel_azure.sh
./scripts/deploy_vercel_azure.sh
```

What this script does automatically:

1. `terraform init` + `terraform apply`
2. Build + package Azure Functions backend
3. Deploy backend to your Function App
4. Deploy frontend to Vercel (production)
5. Print public URLs

---

## 6) Validate that everything works

After script completion, open your Vercel URL.

Check this flow:

1. Create VM
2. Wait for loading/provisioning
3. VM appears in list
4. Open viewer/noVNC
5. Try `Pause` then `Resume`
6. Try `Extend +2h`
7. Try `Terminate`

If noVNC in iframe is limited in your browser:

- use **Open noVNC in new tab** for best fullscreen/clipboard behavior.

---

## 7) Multi-user behavior (important)

Current implementation provides **session-based** user separation:

- each browser session gets a generated user ID cookie
- users only see/manage VMs tagged with their owner ID

If you need strict identity-level separation (work/school accounts), add real auth (e.g., Microsoft Entra + NextAuth) as a next step.

---

## 8) VM expiration and cost control

- Default VM TTL is 60 minutes (`ORCH_VM_LIFETIME_MIN`)
- Expired VMs are auto-cleaned by backend cleanup job
- Use `Pause` to save compute costs
- Use `Terminate` when done

---

## 9) Re-deploy after code changes

Any time you change frontend/backend/infra:

```bash
./scripts/deploy_vercel_azure.sh
```

---

## 10) Common issues and quick fixes

### A) `terraform.tfvars` missing

Create it from example:

```bash
cd terraform && cp terraform.tfvars.example terraform.tfvars
```

### B) `Unauthorized` API errors

Ensure same key is used end-to-end:

- `orchestrator_api_key` in `terraform.tfvars`
- frontend env values set by deploy script

### C) Vercel asks project/link questions

Normal on first run. Complete prompts once; later runs are mostly automatic.

### D) Viewer opens but clipboard/fullscreen is inconsistent

Open noVNC in a new tab and use noVNC toolbar there.

### E) You want a public URL without paying for a domain

You already have it:

- Vercel gives `*.vercel.app`
- Azure gives `*.azurewebsites.net`

---

## 11) Minimal command recap

If tools are installed and `terraform.tfvars` is ready:

```bash
az login
vercel login
chmod +x scripts/deploy_vercel_azure.sh
./scripts/deploy_vercel_azure.sh
```

That is the fastest practical path from zero to a live working deployment.
