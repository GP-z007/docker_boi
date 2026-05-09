namespace "dasdocker-staging" {
  description = "Staging namespace that must mirror production security controls."
  quota       = "dasdocker-staging-quota"
}

quota "dasdocker-staging-quota" {
  region = "global"

  limit {
    region = "global"
    cpu    = 120000
    memory = 245760
  }
}

job "orchestrator" {
  region      = "global"
  datacenters = ["dc1"]
  type        = "service"
  namespace   = "dasdocker-staging"

  group "orchestrator" {
    count = 3

    scaling {
      enabled = true
      min     = 3
      max     = 20

      policy {
        cooldown            = "2m"
        evaluation_interval = "30s"
        check "cpu_allocated" {
          source = "prometheus"
          query  = "avg(nomad_client_allocs_cpu_total_percent{job=\"orchestrator\"})"
          strategy "target-value" {
            target = 65
          }
        }
      }
    }
  }
}

job "event-bus" {
  region      = "global"
  datacenters = ["dc1"]
  type        = "service"
  namespace   = "dasdocker-staging"

  group "event-bus" {
    count = 2

    scaling {
      enabled = true
      min     = 2
      max     = 20

      policy {
        cooldown            = "2m"
        evaluation_interval = "30s"
        check "cpu_allocated" {
          source = "prometheus"
          query  = "avg(nomad_client_allocs_cpu_total_percent{job=\"event-bus\"})"
          strategy "target-value" {
            target = 60
          }
        }
      }
    }
  }
}
