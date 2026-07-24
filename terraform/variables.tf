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

variable "repo_url" {
  description = "GitHub URL of this repo, used by ArgoCD to pull manifests"
  type        = string
  default     = "https://github.com/jsundquist/personal-idp.git"
}
