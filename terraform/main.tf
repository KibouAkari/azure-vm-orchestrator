data "azurerm_client_config" "current" {}

locals {
  prefix = lower(replace("${var.project_name}-${var.environment}", "_", "-"))

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

resource "azurerm_subnet_network_security_group_association" "vm" {
  subnet_id                 = azurerm_subnet.vm.id
  network_security_group_id = azurerm_network_security_group.vm.id
}

resource "azurerm_storage_account" "functions" {
  name                     = "st${replace(local.prefix, "-", "")}${random_string.suffix.result}"
  resource_group_name      = azurerm_resource_group.main.name
  location                 = azurerm_resource_group.main.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = local.common_tags
}

resource "azurerm_service_plan" "functions" {
  name                = "asp-${local.prefix}"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  os_type             = "Linux"
  sku_name            = "Y1"
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
    always_on = false
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
    "ORCH_MONTHLY_BUDGET_CHF"  = tostring(var.monthly_budget_chf)
    "ORCH_VM_ADMIN_USERNAME"   = var.vm_admin_username
    "ORCH_VM_SIZE_LINUX"       = var.vm_size_linux
    "ORCH_VM_SIZE_WINDOWS"     = var.vm_size_windows
    "ORCH_API_KEY"             = var.orchestrator_api_key
  }
}

resource "azurerm_role_assignment" "function_rg_contributor" {
  scope                = azurerm_resource_group.main.id
  role_definition_name = "Contributor"
  principal_id         = azurerm_linux_function_app.orchestrator.identity[0].principal_id
}
