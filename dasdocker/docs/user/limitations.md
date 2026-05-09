# dasDocker Limitations

This page defines known functional and resource constraints for the production release profile.

## Runtime Limits

- **Maximum TTL**: 3600 seconds
- **Maximum memory per session**: 512 MB
- **Maximum concurrent sessions**: 50

## Supported Runtime Inputs

- GitHub repository URL source
- ZIP archive source

## Operational Constraints

- Sessions are intentionally short-lived and are not designed for long-running stateful services.
- External service access may be blocked by isolation policy.
- Telemetry quality depends on runtime visibility and host sensor availability.

## Security Boundaries Reminder

- dasDocker improves containment and detection, but no sandbox is unconditionally secure.
- Do not process production secrets or regulated personal data in untrusted test runs.
