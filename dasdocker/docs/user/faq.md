# dasDocker FAQ

## Why can't my app reach my database?

By design, dasDocker sessions run under restrictive network controls. Direct access to LAN/private databases is typically blocked unless explicitly permitted by policy.

## Why did my session terminate early?

Common causes:

- TTL expired
- Manual kill action
- Policy/security enforcement event
- Runtime failure in the sandboxed workload

Check the live console, session status transitions, and alert feed for details.

## Does dasDocker guarantee complete protection from escapes?

No. dasDocker applies hardening and monitoring controls, but cannot guarantee immunity to all kernel zero-days or side-channel techniques.

## Can I upload production secrets to test with real credentials?

No. Do not submit production secrets or sensitive personal data. Use synthetic or explicitly redacted test data.

## What should I do if I see a critical alert?

Treat it as a potential incident: capture evidence, terminate session, and escalate to security/on-call with the session ID and timestamps.
