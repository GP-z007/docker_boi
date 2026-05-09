# SBOM Artifacts

This directory is the repository location for SBOM outputs attached to releases.

## Generation source of truth

SBOM generation is automated in CI (`.github/workflows/ci.yml`) in the `generate-sbom` job:

- `syft` produces SPDX JSON per built image.
- `grype` scans each SBOM and fails the pipeline on High/Critical findings.

## Expected files per release

- `ebpf-monitor.spdx.json`
- `sandbox-stub.spdx.json`

Release automation should copy/upload the exact CI-generated artifacts here (or publish via release artifacts) to preserve provenance.
