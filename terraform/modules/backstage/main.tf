resource "kubernetes_secret" "postgres_credentials" {
  metadata {
    name      = "backstage-postgres-credentials"
    namespace = var.namespace
  }

  data = {
    POSTGRES_HOST     = var.postgres_host
    POSTGRES_PORT     = var.postgres_port
    POSTGRES_USER     = var.postgres_user
    POSTGRES_PASSWORD = var.postgres_password
  }
}
