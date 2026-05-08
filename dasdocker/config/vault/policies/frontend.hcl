# Build-time / runtime SPA configuration secrets only (never orchestrator KV).

path "dasdocker/data/frontend/*" {
  capabilities = ["read"]
}
path "dasdocker/metadata/frontend/*" {
  capabilities = ["read", "list"]
}
