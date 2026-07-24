variable "namespace" {
  description = "Kubernetes namespace to deploy Backstage into"
  type        = string
}

variable "postgres_host" {
  description = "PostgreSQL hostname (in-cluster DNS)"
  type        = string
}

variable "postgres_port" {
  description = "PostgreSQL port"
  type        = string
  default     = "5432"
}

variable "postgres_user" {
  description = "PostgreSQL username"
  type        = string
}

variable "postgres_password" {
  description = "PostgreSQL password"
  type        = string
  sensitive   = true
}

variable "image" {
  description = "Backstage Docker image"
  type        = string
  default     = "backstage:local"
}

variable "replicas" {
  description = "Number of Backstage pod replicas"
  type        = number
  default     = 1
}
