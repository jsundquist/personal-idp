resource "kubernetes_namespace" "backstage" {
  metadata {
    name = var.backstage_namespace
  }
}

module "postgres" {
  source    = "./modules/postgres"
  namespace = kubernetes_namespace.backstage.metadata[0].name
  password  = var.postgres_password
}

module "backstage" {
  source    = "./modules/backstage"
  namespace = kubernetes_namespace.backstage.metadata[0].name

  postgres_host     = module.postgres.service_host
  postgres_port     = module.postgres.service_port
  postgres_user     = module.postgres.username
  postgres_password = var.postgres_password

  depends_on = [module.postgres]
}
