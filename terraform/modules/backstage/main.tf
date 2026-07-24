resource "kubernetes_service_account" "backstage" {
  metadata {
    name      = "backstage"
    namespace = var.namespace
  }
}

resource "kubernetes_cluster_role" "backstage_kubernetes_reader" {
  metadata {
    name = "backstage-kubernetes-reader"
  }

  rule {
    api_groups = [""]
    resources  = ["pods", "services", "configmaps", "resourcequotas", "limitranges", "events", "namespaces", "nodes"]
    verbs      = ["get", "list", "watch"]
  }

  rule {
    api_groups = ["apps"]
    resources  = ["deployments", "replicasets", "statefulsets", "daemonsets"]
    verbs      = ["get", "list", "watch"]
  }

  rule {
    api_groups = ["autoscaling"]
    resources  = ["horizontalpodautoscalers"]
    verbs      = ["get", "list", "watch"]
  }

  rule {
    api_groups = ["networking.k8s.io"]
    resources  = ["ingresses"]
    verbs      = ["get", "list", "watch"]
  }

  rule {
    api_groups = ["batch"]
    resources  = ["jobs", "cronjobs"]
    verbs      = ["get", "list", "watch"]
  }

  rule {
    api_groups = ["metrics.k8s.io"]
    resources  = ["pods", "nodes"]
    verbs      = ["get", "list"]
  }
}

resource "kubernetes_cluster_role_binding" "backstage_kubernetes_reader" {
  metadata {
    name = "backstage-kubernetes-reader"
  }

  role_ref {
    api_group = "rbac.authorization.k8s.io"
    kind      = "ClusterRole"
    name      = kubernetes_cluster_role.backstage_kubernetes_reader.metadata[0].name
  }

  subject {
    kind      = "ServiceAccount"
    name      = kubernetes_service_account.backstage.metadata[0].name
    namespace = var.namespace
  }
}

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
        annotations = {
          "backstage.io/kubernetes-id" = "backstage"
        }
      }

      spec {
        service_account_name = kubernetes_service_account.backstage.metadata[0].name

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

    type = "ClusterIP"
  }
}

resource "kubernetes_ingress_v1" "backstage" {
  metadata {
    name      = "backstage"
    namespace = var.namespace
  }

  spec {
    rule {
      http {
        path {
          path      = "/"
          path_type = "Prefix"

          backend {
            service {
              name = kubernetes_service.backstage.metadata[0].name
              port {
                number = 80
              }
            }
          }
        }
      }
    }
  }
}
