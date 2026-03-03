export type OsType = "linux" | "windows";

export type MarketplaceImage = {
  id: string;
  label: string;
  osType: OsType;
  publisher: string;
  offer: string;
  sku: string;
  version: string;
};

export const marketplaceCatalog: MarketplaceImage[] = [
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
    id: "win2022",
    label: "Windows Server 2022 Datacenter",
    osType: "windows",
    publisher: "MicrosoftWindowsServer",
    offer: "WindowsServer",
    sku: "2022-datacenter-azure-edition",
    version: "latest"
  }
];

export function getMarketplaceImage(imageId: string) {
  return marketplaceCatalog.find((entry) => entry.id === imageId);
}
