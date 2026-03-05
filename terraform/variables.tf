variable "project_name" {
  description = "Project/application name used in resource naming."
  type        = string
  default     = "vm-orchestrator"
}

variable "environment" {
  description = "Environment name (dev, test, prod)."
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "switzerlandnorth"
}

variable "subscription_id" {
  description = "Azure subscription ID."
  type        = string
}

variable "tenant_id" {
  description = "Azure tenant ID."
  type        = string
}

variable "allowed_client_cidr" {
  description = "Public IP/CIDR allowed to access VM remote ports (RDP/VNC/SSH)."
  type        = string
  default     = "0.0.0.0/0"
}

variable "max_parallel_vms" {
  description = "Soft limit consumed by backend logic."
  type        = number
  default     = 3
}

variable "vm_lifetime_minutes" {
  description = "Default VM lifetime before cleanup."
  type        = number
  default     = 60
}

variable "vm_provisioning_timeout_minutes" {
  description = "Timeout for VM provisioning operations in backend logic."
  type        = number
  default     = 15
}

variable "monthly_budget_chf" {
  description = "Monthly budget target in CHF (for app config + alerting reference)."
  type        = number
  default     = 50
}

variable "vm_admin_username" {
  description = "Default admin username for created VMs."
  type        = string
  default     = "azureuser"
}

variable "vm_size_linux" {
  description = "Default Linux VM size."
  type        = string
  default     = "Standard_D2s_v5"
}

variable "vm_size_windows" {
  description = "Default Windows VM size."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "gateway_vm_size" {
  description = "Size of the central Guacamole gateway VM."
  type        = string
  default     = "Standard_D4s_v5"
}

variable "function_plan_sku" {
  description = "App Service plan SKU for Function App (EP1 recommended for low latency)."
  type        = string
  default     = "EP1"
}

variable "orchestrator_api_key" {
  description = "Shared API key required by backend endpoints."
  type        = string
  sensitive   = true
}

variable "frontend_origin" {
  description = "Allowed frontend origin for CORS (e.g. Vercel URL)."
  type        = string
  default     = "https://your-project.vercel.app"
}

variable "tags" {
  description = "Additional tags to apply to all resources."
  type        = map(string)
  default     = {}
}
