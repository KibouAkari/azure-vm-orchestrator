import { ComputeManagementClient } from "@azure/arm-compute";
import { NetworkManagementClient } from "@azure/arm-network";
import { DefaultAzureCredential } from "@azure/identity";

let cached:
  | {
      compute: ComputeManagementClient;
      network: NetworkManagementClient;
    }
  | undefined;

export function getAzureClients(subscriptionId: string) {
  if (cached) {
    return cached;
  }

  const credential = new DefaultAzureCredential();

  cached = {
    compute: new ComputeManagementClient(credential, subscriptionId),
    network: new NetworkManagementClient(credential, subscriptionId)
  };

  return cached;
}
