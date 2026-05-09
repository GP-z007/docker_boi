# Contributing to dasDocker

Thanks for contributing to dasDocker. This project enforces strict security and testing standards.

## Branch Naming
- Use feature branches only; never commit directly to `main`.
- Recommended format:
  - `feat/<scope>`
  - `fix/<scope>`
  - `docs/<scope>`
  - `chore/<scope>`

## Commit Message Format
Use Conventional Commits:
- `feat(component): add runtime capability`
- `fix(network): block metadata egress path`
- `docs(readme): update setup instructions`

## Pull Request Requirements
Every PR must include:
1. Linked issue or dispatch context
2. Risk summary (security/operational impact)
3. Test evidence for changed behaviour
4. Documentation updates when interfaces or operator flows change
5. Passing CI status before review request

## Squad A Security Checklist (Mandatory When Applicable)
If your PR touches container runtime policy, network controls, authn/z, secrets, or lifecycle destruction:
- [ ] Capability posture remains restrictive (`--cap-drop ALL`, no privilege escalation)
- [ ] Seccomp/AppArmor profiles are enforced and tested
- [ ] Network isolation policy changes are validated with unit/integration/red-team tests
- [ ] Secrets are not committed; Vault path usage is documented
- [ ] Self-destruct behaviour (TTL + watchdog fallback) still passes tests
- [ ] Threat model assumptions are updated if attack surface changed

## Test Requirement Policy
- Minimum required for all code changes:
  - unit tests
  - integration tests
- Required for security-sensitive changes:
  - red-team/adversarial tests
  - regression tests for previous bypasses
- Required for infra changes:
  - infrastructure host tests
  - network and profile validation suites where relevant

Run representative suites before opening a PR:

```bash
sudo bash tests/infrastructure/test_host_hardening.sh
sudo bash tests/network/test_network_unit.sh
sudo bash tests/security/test_seccomp_profile.sh
cd services/orchestrator && npm test
cd ../frontend && npm test
```

## Code Review Expectations
- Keep PRs focused and reviewable.
- Provide rollback notes for risky changes.
- Resolve review comments with concrete follow-up commits.
- Security-impacting changes require Squad A approval before merge.
