output "backstage_url" {
  description = "URL to reach Backstage from the host machine"
  value       = "http://localhost:8080"
}

output "postgres_service" {
  description = "In-cluster DNS name for PostgreSQL"
  value       = "postgres-postgresql.${var.backstage_namespace}.svc.cluster.local:5432"
}
