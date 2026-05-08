# Observability pipeline (Fluent Bit / Prometheus operators) — infra creds segregated from app plane.

path "dasdocker/data/monitor/*" {
  capabilities = ["read"]
}
path "dasdocker/metadata/monitor/*" {
  capabilities = ["read", "list"]
}

# Grafana bootstrap secret per ADR (observability namespace)
path "dasdocker/data/observability/grafana_admin" {
  capabilities = ["read"]
}
path "dasdocker/metadata/observability/grafana_admin" {
  capabilities = ["read", "list"]
}
