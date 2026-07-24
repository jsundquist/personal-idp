variable "postgres_password" {
  description = "Password for the PostgreSQL backstage user"
  type        = string
  sensitive   = true
}

variable "backstage_namespace" {
  description = "Kubernetes namespace for all Backstage resources"
  type        = string
  default     = "backstage"
}
