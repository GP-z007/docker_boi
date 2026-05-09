# dasDocker Security Posture

dasDocker is a containment and observability platform for running untrusted code in time-bounded sessions. It is a hardening layer, not an absolute trust boundary.

## What dasDocker Guarantees (Within Designed Controls)

- **Network isolation intent**: sessions are designed for deny-by-default isolation from LAN resources unless explicitly allowed by policy.
- **Volatile runtime storage intent**: writable session runtime data is ephemeral and expected to be removed on teardown.
- **Time-bounded execution**: sessions are bounded by TTL and targeted for automatic destruction when TTL expires.
- **Runtime telemetry**: process, network, and alert telemetry is emitted for operator and analyst review.

## What dasDocker Does NOT Guarantee

- Protection against all **zero-day kernel/container runtime exploits**.
- Elimination of all **side-channel attack** vectors.
- Prevention of every **supply-chain or dependency compromise** introduced by submitted code.
- Absolute protection if users submit **production secrets or sensitive personal data** into untrusted workloads.

## Self-Destruct Timer Guarantees

- TTL defines the maximum target runtime for a session.
- On TTL expiry, dasDocker initiates forced teardown.
- Under system stress, destruction timing may drift from exact TTL; operators should treat this as a bounded best-effort control validated by platform monitoring and watchdog enforcement.

## If You Suspect Container Escape or Breach

1. **Treat as active security incident.**
2. **Do not continue interacting** with the session.
3. Capture evidence:
   - Session ID
   - Console output snapshot
   - Process tree state
   - Network timeline and alert feed entries
4. Terminate the session immediately.
5. Notify security/on-call using your incident channel and reference the session ID.
6. Follow containment and forensics steps in `docs/operations/runbook.md` (container escape incident response).
