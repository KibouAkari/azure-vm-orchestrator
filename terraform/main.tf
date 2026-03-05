data "azurerm_client_config" "current" {}

locals {
  prefix = lower(replace("${var.project_name}-${var.environment}", "_", "-"))
  storage_account_prefix = substr(replace(lower(replace("${var.project_name}-${var.environment}", "_", "-")), "-", ""), 0, 17)

  common_tags = merge(
    {
      project     = var.project_name
      environment = var.environment
      managed_by  = "terraform"
    },
    var.tags
  )
}

resource "random_string" "suffix" {
  length  = 5
  lower   = true
  upper   = false
  special = false
  numeric = true
}

resource "random_password" "gateway_admin" {
  length           = 24
  special          = true
  override_special = "!@#%-_=+"
}

resource "azurerm_resource_group" "main" {
  name     = "rg-${local.prefix}"
  location = var.location
  tags     = local.common_tags
}

resource "azurerm_virtual_network" "main" {
  name                = "vnet-${local.prefix}"
  address_space       = ["10.42.0.0/16"]
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.common_tags
}

resource "azurerm_subnet" "vm" {
  name                 = "snet-vm"
  resource_group_name  = azurerm_resource_group.main.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.42.1.0/24"]
}

resource "azurerm_network_security_group" "vm" {
  name                = "nsg-vm-${local.prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  tags                = local.common_tags
}

resource "azurerm_network_security_rule" "allow_rdp" {
  name                        = "allow-rdp"
  priority                    = 100
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "3389"
  source_address_prefix       = var.allowed_client_cidr
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.vm.name
}

resource "azurerm_network_security_rule" "allow_vnc" {
  name                        = "allow-vnc"
  priority                    = 110
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "5901"
  source_address_prefix       = var.allowed_client_cidr
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.vm.name
}

resource "azurerm_network_security_rule" "allow_ssh" {
  name                        = "allow-ssh"
  priority                    = 120
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "22"
  source_address_prefix       = var.allowed_client_cidr
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.vm.name
}

resource "azurerm_network_security_rule" "allow_novnc_web" {
  name                        = "allow-novnc-web"
  priority                    = 130
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "6080"
  source_address_prefix       = var.allowed_client_cidr
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.vm.name
}

resource "azurerm_network_security_rule" "allow_http" {
  name                        = "allow-http"
  priority                    = 131
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "80"
  source_address_prefix       = var.allowed_client_cidr
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.vm.name
}

resource "azurerm_network_security_rule" "allow_https" {
  name                        = "allow-https"
  priority                    = 132
  direction                   = "Inbound"
  access                      = "Allow"
  protocol                    = "Tcp"
  source_port_range           = "*"
  destination_port_range      = "443"
  source_address_prefix       = var.allowed_client_cidr
  destination_address_prefix  = "*"
  resource_group_name         = azurerm_resource_group.main.name
  network_security_group_name = azurerm_network_security_group.vm.name
}

resource "azurerm_subnet_network_security_group_association" "vm" {
  subnet_id                 = azurerm_subnet.vm.id
  network_security_group_id = azurerm_network_security_group.vm.id
}

resource "azurerm_public_ip" "gateway" {
  name                = "pip-gateway-${local.prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = local.common_tags
}

resource "azurerm_network_interface" "gateway" {
  name                = "nic-gateway-${local.prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name

  ip_configuration {
    name                          = "ipconfig1"
    subnet_id                     = azurerm_subnet.vm.id
    private_ip_address_allocation = "Dynamic"
    public_ip_address_id          = azurerm_public_ip.gateway.id
  }

  tags = local.common_tags
}

resource "azurerm_linux_virtual_machine" "gateway" {
  name                  = "vm-gateway-${local.prefix}"
  location              = azurerm_resource_group.main.location
  resource_group_name   = azurerm_resource_group.main.name
  size                  = var.gateway_vm_size
  admin_username        = var.vm_admin_username
  admin_password        = random_password.gateway_admin.result
  disable_password_authentication = false
  network_interface_ids = [azurerm_network_interface.gateway.id]

  source_image_reference {
    publisher = "Canonical"
    offer     = "0001-com-ubuntu-server-jammy"
    sku       = "22_04-lts-gen2"
    version   = "latest"
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
  }

  custom_data = base64encode(<<-CLOUD_INIT
    #cloud-config
    package_update: true
    packages:
      - docker.io
      - caddy
      - python3
      - curl
    write_files:
      - path: /opt/guac/user-mapping.xml
        permissions: "0644"
        content: |
          <user-mapping>
            <authorize username="viewer" password="viewer">
            </authorize>
          </user-mapping>

      - path: /opt/guac/guacamole.properties
        permissions: "0644"
        content: |
          guacd-hostname: 127.0.0.1
          guacd-port: 4822
          user-mapping: /opt/guac/user-mapping.xml

      - path: /usr/local/bin/bootstrap-gateway.sh
        permissions: "0755"
        content: |
          #!/usr/bin/env bash
          set -euo pipefail

          mkdir -p /opt/guac

          systemctl enable docker
          systemctl restart docker

          docker rm -f guacd guacamole >/dev/null 2>&1 || true
          docker pull guacamole/guacd:1.5.5
          docker pull guacamole/guacamole:1.5.5

          docker run -d --name guacd --restart unless-stopped --network host guacamole/guacd:1.5.5
          docker run -d --name guacamole --restart unless-stopped --network host \
            -e GUACD_HOSTNAME=127.0.0.1 \
            -e GUACD_PORT=4822 \
            -e GUACAMOLE_HOME=/opt/guac \
            -v /opt/guac:/opt/guac \
            guacamole/guacamole:1.5.5

          PUBLIC_IP="$(curl -s -H Metadata:true 'http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text' || true)"
          if [[ -z "$${PUBLIC_IP:-}" ]]; then
            exit 0
          fi

          HOST="$${PUBLIC_IP//./-}.sslip.io"
          cat > /etc/caddy/Caddyfile <<EOF
          $${HOST} {
            reverse_proxy 127.0.0.1:8080
            header {
              -X-Frame-Options
              -Content-Security-Policy
            }
          }
          EOF

          systemctl enable caddy
          systemctl restart caddy
    runcmd:
      - /usr/local/bin/bootstrap-gateway.sh
    CLOUD_INIT
  )

  tags = merge(local.common_tags, {
    role = "central-gateway"
  })
}

resource "azurerm_storage_account" "functions" {
  name                     = "st${local.storage_account_prefix}${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = local.common_tags
}

resource "azurerm_storage_container" "custom_images" {
  name                  = "custom-images"
  storage_account_id    = azurerm_storage_account.functions.id
  container_access_type = "private"
}

resource "azurerm_service_plan" "functions" {
  name                = "asp-${local.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = var.function_plan_sku
  tags                = local.common_tags
}

resource "azurerm_application_insights" "functions" {
  name                = "appi-${local.prefix}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  application_type    = "web"
  tags                = local.common_tags
}

resource "azurerm_linux_function_app" "orchestrator" {
  name                       = "func-${local.prefix}-${random_string.suffix.result}"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  service_plan_id            = azurerm_service_plan.functions.id
  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key
  https_only                 = true
  tags                       = local.common_tags

  identity {
    type = "SystemAssigned"
  }

  site_config {
    always_on = true
    cors {
      allowed_origins = [var.frontend_origin]
    }
    application_stack {
      node_version = "20"
    }
  }

  app_settings = {
    "APPINSIGHTS_INSTRUMENTATIONKEY"        = azurerm_application_insights.functions.instrumentation_key
    "APPLICATIONINSIGHTS_CONNECTION_STRING" = azurerm_application_insights.functions.connection_string
    "WEBSITE_RUN_FROM_PACKAGE"              = "1"

    "AZURE_SUBSCRIPTION_ID" = var.subscription_id
    "AZURE_TENANT_ID"       = var.tenant_id
    "AZURE_RESOURCE_GROUP"  = azurerm_resource_group.main.name
    "AZURE_LOCATION"        = var.location
    "AZURE_SUBNET_ID"       = azurerm_subnet.vm.id

    "ORCH_ALLOWED_CLIENT_CIDR" = var.allowed_client_cidr
    "ORCH_MAX_PARALLEL_VMS"    = tostring(var.max_parallel_vms)
    "ORCH_VM_LIFETIME_MIN"     = tostring(var.vm_lifetime_minutes)
    "ORCH_VM_PROVISIONING_TIMEOUT_MIN" = tostring(var.vm_provisioning_timeout_minutes)
    "ORCH_MONTHLY_BUDGET_CHF"  = tostring(var.monthly_budget_chf)
    "ORCH_VM_ADMIN_USERNAME"   = var.vm_admin_username
    "ORCH_VM_SIZE_LINUX"       = var.vm_size_linux
    "ORCH_VM_SIZE_WINDOWS"     = var.vm_size_windows
    "ORCH_GATEWAY_VM_NAME"     = azurerm_linux_virtual_machine.gateway.name
    "ORCH_GATEWAY_BASE_URL"    = "https://${replace(azurerm_public_ip.gateway.ip_address, ".", "-")}.sslip.io"
    "ORCH_IMAGE_STORAGE_ACCOUNT" = azurerm_storage_account.functions.name
    "ORCH_IMAGE_STORAGE_CONTAINER" = azurerm_storage_container.custom_images.name
    "ORCH_API_KEY"             = var.orchestrator_api_key
  }
}

resource "azurerm_role_assignment" "function_rg_contributor" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_linux_function_app.orchestrator.identity[0].principal_id
}

resource "azurerm_role_assignment" "function_storage_blob_data_contributor" {
  scope                = azurerm_storage_account.functions.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_linux_function_app.orchestrator.identity[0].principal_id
}
