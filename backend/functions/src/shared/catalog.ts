export type OsType = "linux" | "windows";

export type MarketplaceImage = {
  id: string;
  label: string;
  osType: OsType;
  publisher: string;
  offer: string;
  sku: string;
  version: string;
  plan?: {
    name: string;
    product: string;
    publisher: string;
  };
};

export const marketplaceCatalog: MarketplaceImage[] = [
  {
    id: "ubuntu-24.04",
    label: "Ubuntu 24.04 LTS",
    osType: "linux",
    publisher: "Canonical",
    offer: "ubuntu-24_04-lts",
    sku: "server",
    version: "latest"
  },
  {
    id: "ubuntu-22.04",
    label: "Ubuntu 22.04 LTS",
    osType: "linux",
    publisher: "Canonical",
    offer: "0001-com-ubuntu-server-jammy",
    sku: "22_04-lts-gen2",
    version: "latest"
  },
  {
    id: "debian-12",
    label: "Debian 12",
    osType: "linux",
    publisher: "Debian",
    offer: "debian-12",
    sku: "12",
    version: "latest"
  },
  {
    id: "kali-latest",
    label: "Kali Linux",
    osType: "linux",
    publisher: "kali-linux",
    offer: "kali",
    sku: "kali-2025-4",
    version: "latest",
    plan: {
      name: "kali-2025-4",
      product: "kali",
      publisher: "kali-linux"
    }
  },
  {
    id: "archlinux",
    label: "Arch Linux (compat image)",
    osType: "linux",
    publisher: "Canonical",
    offer: "0001-com-ubuntu-server-jammy",
    sku: "22_04-lts-gen2",
    version: "latest"
  },
  {
    id: "win2022",
    label: "Windows Server 2022 Datacenter",
    osType: "windows",
    publisher: "MicrosoftWindowsServer",
    offer: "WindowsServer",
    sku: "2022-datacenter-azure-edition",
    version: "latest"
  }
];

const imageAliases: Record<string, string> = {
  ubuntu2404: "ubuntu-24.04",
  ubuntu2204: "ubuntu-22.04",
  debian12: "debian-12",
  kali: "kali-latest",
  arch: "archlinux"
};

export function getMarketplaceImage(imageId: string) {
  const normalizedId = imageAliases[imageId] ?? imageId;
  return marketplaceCatalog.find((entry) => entry.id === normalizedId);
}
