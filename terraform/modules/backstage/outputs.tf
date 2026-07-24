output "service_name" {
  description = "Name of the Backstage Kubernetes service"
  value       = kubernetes_service.backstage.metadata[0].name
}
