variable "namespace" {
  description = "Kubernetes namespace to deploy PostgreSQL into"
  type        = string
}

variable "password" {
  description = "Password for the PostgreSQL user"
  type        = string
  sensitive   = true
}

variable "username" {
  description = "PostgreSQL username"
  type        = string
  default     = "backstage"
}

variable "database" {
  description = "PostgreSQL database name"
  type        = string
  default     = "backstage"
}
