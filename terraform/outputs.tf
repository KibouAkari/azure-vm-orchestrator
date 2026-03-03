output "resource_group_name" {
  value       = azurerm_resource_group.main.name
  description = "Resource group containing orchestrator resources."
}

output "function_app_name" {
  value       = azurerm_linux_function_app.orchestrator.name
  description = "Azure Function App name for VM orchestration API."
}

output "function_api_base_url" {
  value       = "https://${azurerm_linux_function_app.orchestrator.default_hostname}/api"
  description = "Base URL used by frontend (Vercel) to call backend API."
}

output "vm_subnet_id" {
  value       = azurerm_subnet.vm.id
  description = "Subnet ID where short-lived VMs should be created."
}
