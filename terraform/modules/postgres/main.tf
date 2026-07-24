resource "helm_release" "postgresql" {
  name       = "postgres"
  repository = "https://charts.bitnami.com/bitnami"
  chart      = "postgresql"
  version    = "15.5.x"
  namespace  = var.namespace

  set {
    name  = "auth.username"
    value = var.username
  }

  set {
    name  = "auth.password"
    value = var.password
  }

  set {
    name  = "auth.database"
    value = var.database
  }

  set {
    name  = "primary.persistence.size"
    value = "1Gi"
  }
}
