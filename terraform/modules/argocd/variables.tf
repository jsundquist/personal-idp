variable "namespace" {
  description = "Namespace to install ArgoCD into"
  type        = string
  default     = "argocd"
}

variable "repo_url" {
  description = "Git repository URL ArgoCD will watch for manifests"
  type        = string
}

variable "target_revision" {
  description = "Branch or tag ArgoCD will track"
  type        = string
  default     = "main"
}

variable "app_namespace" {
  description = "Namespace where the backstage application resources live"
  type        = string
  default     = "backstage"
}
