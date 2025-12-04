# Azure VM Orchestrator -- Browser-basiertes VM-Management

![Project Banner](https://img.shields.io/badge/Status-Alpha-blue)
![License](https://img.shields.io/badge/License-MIT-green)

Dieses Projekt ermöglicht die Bereitstellung, Verwaltung und den
Browser-Zugriff auf **Windows- und Linux-VMs auf Azure**, ähnlich wie
TryHackMe. Nutzer können VMs starten, stoppen, Snapshots erstellen und
nach 30 Tagen wiederherstellen. Das Projekt ist **Terraform-basiert**,
Cloud-portabel und bietet eine **übersichtliche Web-GUI**.

------------------------------------------------------------------------

## 🌟 Features

-   Dynamisches Starten von VMs aus Templates oder Snapshots\
-   Persistente Speicherung von VM-Snapshots (bis zu 30 Tage)\
-   Browser-basierter Zugriff via **Azure Bastion** oder **Apache
    Guacamole**\
-   Web-GUI für einfache Verwaltung (Start/Stop/Snapshot/Delete)\
-   Benutzer- und Rechteverwaltung\
-   Automatisches Cleanup abgelaufener VMs und Snapshots\
-   Multi-Cloud vorbereitet dank Terraform-Modularität

------------------------------------------------------------------------

## 🏗 Architektur

    User Browser
         │
         ▼
    Frontend / GUI (React/Vue)
         │
         ▼
    Backend / Orchestrator (Node.js/Python)
         │
         ▼
    Terraform Layer
         │
         ▼
    Azure Infrastruktur
     - VMs
     - Managed Disks
     - Image Gallery
     - Networking (VNet/Subnets)
     - Bastion Host
         │
         ▼
    Browser Zugriff auf VM (RDP/SSH)

-   **Frontend:** Dashboard, VM-Übersicht, Aktionen\
-   **Backend:** API + Orchestrierung, Terraform Runner, Snapshot
    Management\
-   **Terraform:** Provisionierung aller Ressourcen, State Management\
-   **Azure Infra:** VM-Instanzen, Netzwerk, Managed Disks,
    Bastion/Guacamole

------------------------------------------------------------------------

## 🛠 Technologie Stack

-   **Cloud:** Microsoft Azure\
-   **Provisioning:** Terraform (Module: vm, network, bastion, snapshot,
    image_gallery)\
-   **Backend:** Node.js / Python (REST API)\
-   **Frontend:** React / Vue (GUI Dashboard)\
-   **Browser Access:** Azure Bastion / Apache Guacamole\
-   **Database:** PostgreSQL / MySQL (User, VM, Snapshot Tracking)\
-   **State Management:** Terraform Remote State (Azure Storage)

------------------------------------------------------------------------

## ⚡ Installation & Setup

> Hinweis: Voraussetzung ist ein Azure Account mit Berechtigungen zum
> Anlegen von VMs, Netzwerken und Bastion Hosts.

### 1. Repository klonen

``` bash
git clone https://github.com/KibouAkari/azure-vm-orchestrator.git
cd azure-vm-orchestrator
```

### 2. Terraform vorbereiten

``` bash
cd terraform/environments/dev
terraform init
terraform plan
terraform apply
```

### 3. Backend starten

``` bash
cd backend
npm install
npm run start
```

### 4. Frontend starten

``` bash
cd frontend
npm install
npm run serve
```

------------------------------------------------------------------------

## 📦 Projektstruktur

    terraform/
     ├─ modules/
     │   ├─ vm/
     │   ├─ network/
     │   ├─ image_gallery/
     │   ├─ bastion/
     │   └─ snapshot/
     ├─ environments/
     │   ├─ dev/
     │   └─ prod/
     └─ backend.tf

    backend/
     ├─ controllers/
     ├─ services/
     ├─ db/
     └─ app.js / main.py

    frontend/
     ├─ components/
     ├─ pages/
     └─ App.vue / App.jsx

------------------------------------------------------------------------

## 🔄 VM Lifecycle

1.  **Start VM:** Neues VM aus Template oder Snapshot starten\
2.  **Stop VM:** VM herunterfahren, optional Snapshot erstellen\
3.  **Snapshot Restore:** VM aus gespeicherter Snapshot Disk neu
    erzeugen\
4.  **Auto-Cleanup:** VMs/Snapshots nach 30 Tagen automatisch löschen

------------------------------------------------------------------------

## 📌 Ausblick / Features in Arbeit

-   Multi-Cloud Unterstützung (AWS / GCP)\
-   User-Quotas & Credits\
-   Live Monitoring der VMs\
-   Erweiterte GUI Features (Drag & Drop, Proxmox-Stil Dashboard)

------------------------------------------------------------------------

## 👨‍💻 Author

[KibouAkari](https://github.com/KibouAkari)
