# README Update Handoff - Documentation Engineer

## Scope Delivered
- Replaced `README.md` with a full operator-facing setup and runtime manual in the required section order.
- Added companion policy/configuration files:
  - `.env.example`
  - `.gitignore`
  - `SECURITY.md`
  - `CONTRIBUTING.md`

## Sections Added or Reworked
- Project introduction, feature list, and security disclaimer
- Architecture overview with ASCII system diagram
- Prerequisites matrix with minimum versions
- Project structure tree and key path purpose notes
- Environment configuration policy and `.env.example` template
- End-to-end setup guide (8 ordered steps)
- Quick-start operational runbook for experienced operators
- Test execution matrix and API quick reference
- Security notes (guarantees, limits, disclosure policy)
- Troubleshooting matrix and contributor policy
- License placeholder note (MIT pending stakeholder confirmation)

## Source Inputs and Assumptions
This update was aligned with the following handoff and ADR materials available in-repo:
- `docs/architecture/infrastructure-stack-adr.md`
- `docs/handoffs/agent-18-p2-handoff.md`
- `docs/handoffs/agent-03-p2-handoff.md`
- `docs/handoffs/agent-04-handoff.md`
- `docs/handoffs/agent-14-p2-handoff.md`
- `docs/handoffs/agent-05-phase1-handoff.md` (used because `agent-05-p2-handoff.md` was not present)
- `docs/handoffs/agent-08-p3-handoff.md` (used because `agent-08-p2-handoff.md` was not present)

## Environment Assumptions
- Primary host baseline: Ubuntu 22.04 LTS
- Kernel baseline for eBPF: 5.15+ with BTF support
- Docker network isolation constants:
  - Network name: `dasdocker-isolated`
  - Subnet: `172.31.0.0/16`
  - Gateway/sinkhole DNS: `172.31.0.1`
- Core dev service ports:
  - Orchestrator API: `3001`
  - Event bus: `3002`
  - Frontend Vite dev server: `5173`

## Human Operator Decisions Required
- Vault unseal strategy selection for long-term operations:
  - Manual Shamir ceremony (documented default) vs cloud/KMS auto-unseal
- Production TLS trust model:
  - Replacing self-signed Vault/bootstrap certificates with organization PKI
- Final license confirmation before public release:
  - MIT currently documented as placeholder pending stakeholder sign-off
- Production service supervision topology:
  - Confirming final `systemd` units for event bus/eBPF/network-monitor in deployment images

## Security and Compliance Notes
- README explicitly warns against committing `.env` and Vault credentials.
- `.gitignore` includes secret and sensitive artifact patterns (`.env`, keys, pcap, `.vault-token`).
- `SECURITY.md` provides private disclosure instructions and contact placeholder.
- `CONTRIBUTING.md` includes Squad A security review triggers and minimum testing policy.
