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

resource "kubernetes_deployment" "backstage" {
  metadata {
    name      = "backstage"
    namespace = var.namespace
    labels = {
      app = "backstage"
    }
  }

  spec {
    replicas = var.replicas

    selector {
      match_labels = {
        app = "backstage"
      }
    }

    template {
      metadata {
        labels = {
          app = "backstage"
        }
      }

      spec {
        container {
          name              = "backstage"
          image             = var.image
          image_pull_policy = "Never"

          port {
            container_port = 7007
          }

          env_from {
            secret_ref {
              name = kubernetes_secret.postgres_credentials.metadata[0].name
            }
          }

          resources {
            requests = {
              cpu    = "200m"
              memory = "512Mi"
            }
            limits = {
              cpu    = "500m"
              memory = "1Gi"
            }
          }

          readiness_probe {
            http_get {
              path = "/healthcheck"
              port = 7007
            }
            initial_delay_seconds = 30
            period_seconds        = 10
          }
        }
      }
    }
  }
}

resource "kubernetes_service" "backstage" {
  metadata {
    name      = "backstage"
    namespace = var.namespace
  }

  spec {
    selector = {
      app = "backstage"
    }

    port {
      port        = 80
      target_port = 7007
    }

    type = "LoadBalancer"
  }
}
