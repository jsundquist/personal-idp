output "service_host" {
  description = "In-cluster DNS hostname for PostgreSQL"
  value       = "postgres.${var.namespace}.svc.cluster.local"
}

output "service_port" {
  description = "PostgreSQL port"
  value       = "5432"
}

output "username" {
  description = "PostgreSQL username"
  value       = var.username
}
