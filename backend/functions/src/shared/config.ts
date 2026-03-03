export type OrchestratorConfig = {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  subnetId: string;
  allowedClientCidr: string;
  maxParallelVms: number;
  vmLifetimeMin: number;
  vmAdminUsername: string;
  vmSizeLinux: string;
  vmSizeWindows: string;
  apiKey: string;
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getConfig(): OrchestratorConfig {
  return {
    subscriptionId: requireEnv("AZURE_SUBSCRIPTION_ID"),
    resourceGroup: requireEnv("AZURE_RESOURCE_GROUP"),
    location: process.env.AZURE_LOCATION ?? "switzerlandnorth",
    subnetId: requireEnv("AZURE_SUBNET_ID"),
    allowedClientCidr: process.env.ORCH_ALLOWED_CLIENT_CIDR ?? "0.0.0.0/0",
    maxParallelVms: Number(process.env.ORCH_MAX_PARALLEL_VMS ?? "3"),
    vmLifetimeMin: Number(process.env.ORCH_VM_LIFETIME_MIN ?? "60"),
    vmAdminUsername: process.env.ORCH_VM_ADMIN_USERNAME ?? "azureuser",
    vmSizeLinux: process.env.ORCH_VM_SIZE_LINUX ?? "Standard_B1s",
    vmSizeWindows: process.env.ORCH_VM_SIZE_WINDOWS ?? "Standard_B1s",
    apiKey: requireEnv("ORCH_API_KEY")
  };
}
